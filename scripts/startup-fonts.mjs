import {readFile, writeFile, mkdir} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resources} from "../src/compiler/runtime.js";
import {coldPass} from "../src/compiler/full-pass.js";
import {fontCacheKey} from "../src/compiler/font-cache.js";
import {starterDocument} from "../src/core/starter.js";
import {digest, packFiles} from "../src/protocol/snapshot.js";

// Generate tables with the same WASM and immutable font timestamps as browsers.
// No system TeX installation or project-specific font-name cache is used.
export async function startupFonts() {
  const io = {
    fetch: async url => new Uint8Array(await readFile(fileURLToPath(url))),
    fetchSync: url => new Uint8Array(readFileSync(fileURLToPath(url))),
    fetchJson: async url => JSON.parse(await readFile(fileURLToPath(url), "utf8")),
  };
  const res = await resources(io);
  const key = await fontCacheKey(res, await io.fetch(new URL("../vendor/engine/luatex.wasm", import.meta.url)));
  const identity = await digest(packFiles({key, starterDocument, script: await readFile(new URL(import.meta.url))}));
  const cache = new URL(`../artifacts/startup-fonts/${identity}.bin`, import.meta.url);
  let bytes;
  try { bytes = await readFile(cache); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    await coldPass(res, {files: {"main.tex": starterDocument}, main: "main.tex"}, {}, {});
    bytes = packFiles(res.fontCache);
    await mkdir(new URL("../artifacts/startup-fonts/", import.meta.url), {recursive: true});
    await writeFile(cache, bytes);
  }
  return {key, bytes};
}
