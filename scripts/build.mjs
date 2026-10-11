import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundles } from "../src/compiler/assets.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const vendors = [ "bibliography", "type1", "pdfjs", "opentype.js", "opentype-LICENSE", "pdf-lib.mjs", "pdf-lib-LICENSE.md", "ctablestack.sty"];
const engineFiles = ["luatex.mjs", "luatex.wasm", "logger.js", "vfs/bundle.js", "vfs/lazyfs.js", "LICENSE", "NOTICE.md", "licenses", "bundles/hot.json", ...bundles.map(name => "bundles/" + name)];
for (const name of [...vendors, ...engineFiles.map(name => "engine/" + name)]) {
  try { await access(path.join(root, "vendor", name)); }
  catch { throw Error(`Missing vendor/${name}. Run npm ci and npm run setup first.`); }
}
await mkdir(path.join(root, "artifacts"), { recursive: true });
const stage = await mkdtemp(path.join(root, "artifacts", "build-"));
const copy = (from, to) => cp(path.join(root, from), path.join(stage, to), {
  recursive: true,
  filter: file => ![".DS_Store", "__pycache__"].includes(path.basename(file)),
});
try {
  // An explicit publication boundary excludes tests, tooling and development links.
  for (const name of ["index.html", "style.css", "sw.js", "_headers"])
    await copy("public/" + name, name);
  await copy("src", "assets");
  for (const name of [...vendors, ...engineFiles.map(name => "engine/" + name)])
    await copy("vendor/" + name, "vendor/" + name);
  for (const name of ["LICENSE", "THIRD_PARTY.md"]) await copy(name, name);
  const files = {};
  async function inventory(dir, prefix = "") {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const name = prefix + entry.name, file = path.join(dir, entry.name);
      if (entry.isDirectory()) await inventory(file, name + "/");
      else {
        const bytes = await readFile(file);
        files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      }
    }
  }
  await inventory(stage);
  await writeFile(path.join(stage, "manifest.json"), JSON.stringify({ schema: 1, files }, null, 2) + "\n");
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  await rename(stage, path.join(root, "dist"));
  console.log(`Built dist/: ${Object.keys(files).length} files, with SHA-256 inventory and component licences.`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
