import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {copyAssets, publishDirectory} from "./copy-assets.mjs";

const required = ["index.html", "style.css", "assets/ui/theme.js", "standalone/app.js", "standalone/workers.js", "standalone/resources.js", "LICENSE", "THIRD_PARTY.md"];

// Local scripts contain the full application and independently compressed resources.
// Ship those exact bytes once, keeping component notices alongside them.
export async function releaseLocal(dist, output) {
  const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  if (manifest.schema !== 1 || required.some(name => !manifest.files?.[name]))
    throw Error("Local release requires a complete build. Run npm run build first.");
  const text = await readFile(path.join(dist, "standalone/resources.js"), "utf8");
  if (!text.startsWith("globalThis.rexCatalog=")) throw Error("Unsupported local resource inventory. Run npm run build.");
  const catalog = JSON.parse(text.slice("globalThis.rexCatalog=".length).trim().replace(/;$/, ""));
  if (catalog.schema !== 1 || !catalog.chunks || !catalog.tools) throw Error("Invalid local resource inventory");
  for (const {script} of [...Object.values(catalog.chunks), ...Object.values(catalog.tools)]) {
    if (typeof script !== "string" || path.isAbsolute(script) || script.split(/[\\/]/).includes("..") || !manifest.files["standalone/" + script])
      throw Error("Incomplete local resource inventory: " + script);
  }
  const files = Object.fromEntries(Object.entries(manifest.files).filter(([name]) =>
    required.includes(name) || name.startsWith("standalone/") || name.startsWith("vendor/engine/licenses/") ||
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
