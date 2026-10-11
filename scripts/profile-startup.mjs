import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resources } from "../src/compiler/runtime.js";
import { coldPass } from "../src/compiler/full-pass.js";
import { starterDocument } from "../src/core/starter.js";

const io = {
  fetch: async url => new Uint8Array(await readFile(fileURLToPath(url))),
  fetchSync: url => new Uint8Array(readFileSync(fileURLToPath(url))),
  fetchJson: async url => JSON.parse(await readFile(fileURLToPath(url), "utf8")),
};
const res = await resources(io);
// Discard the previous profile before recording a genuinely cold compilation.
res.set.cache.clear();
await res.set.prefetchEager();
const eager = new Set(res.set.cache.keys());
await coldPass(res, {files: {"main.tex": starterDocument}, main: "main.tex"}, {}, {});
const paths = [...res.set.cache.keys()].filter(path => !eager.has(path)).sort();
await writeFile(new URL("../src/compiler/startup-assets.js", import.meta.url),
  "// Profiled dependencies of the bundled starter, including luaotfload font discovery.\n" +
  "// Regenerate with: node scripts/profile-startup.mjs\n" +
  "export const startupAssets = " + JSON.stringify(paths, null, 2) + ";\n");
console.log(`Profiled ${paths.length} startup dependencies.`);
