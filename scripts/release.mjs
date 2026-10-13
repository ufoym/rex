import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {copyAssets, publishDirectory} from "./copy-assets.mjs";

const required = ["index.html", "style.css", "assets/ui/theme.js", "standalone/app.js", "standalone/workers.js", "standalone/resources.js", "LICENSE", "THIRD_PARTY.md"];

// Local workers already contain the full application and compressed resources.
// Ship those exact bytes once, keeping component notices outside the archive too.
export async function releaseLocal(dist, output) {
  const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  if (manifest.schema !== 1 || required.some(name => !manifest.files?.[name]))
    throw Error("Local release requires a complete build. Run npm run build first.");
  const files = Object.fromEntries(Object.entries(manifest.files).filter(([name]) =>
    required.includes(name) || name.startsWith("vendor/engine/licenses/") ||
    (name.startsWith("vendor/") && /license|notice|copying|ofl|readme/i.test(path.basename(name)))));
  await mkdir(path.dirname(output), {recursive: true});
  const stage = await mkdtemp(path.join(path.dirname(output), ".rex-local-"));
  try {
    for (const [name, expected] of Object.entries(files)) {
      if (path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw Error("Invalid release path: " + name);
      const source = path.join(dist, name), bytes = await readFile(source);
      if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
        throw Error("Release input does not match build manifest: " + name);
      await copyAssets(source, path.join(stage, name));
    }
    await writeFile(path.join(stage, "manifest.json"), JSON.stringify({schema: 1, distribution: "local", files, generatedInputs: manifest.generatedInputs}, null, 2) + "\n");
    const unpackedBytes = Object.values(files).reduce((sum, file) => sum + file.bytes, 0) + (await stat(path.join(stage, "manifest.json"))).size;
    await publishDirectory(stage, output);
    return {files: Object.keys(files).length + 1, unpackedBytes};
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await releaseLocal(path.join(root, "dist"), path.join(root, "artifacts/releases/rex-local"));
  console.log(`Local release folder: ${result.files} files, ${(result.unpackedBytes / 2 ** 20).toFixed(1)} MiB. Open artifacts/releases/rex-local/index.html directly; distribute the entire folder. No ZIP is generated.`);
}
