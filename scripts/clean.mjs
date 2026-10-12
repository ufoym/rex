import {readdir, rm, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

// Keep application assets, external source edits, reports and current build caches.
export async function clean(root) {
  const remove = name => rm(path.join(root, name), {recursive: true, force: true});
  for (const name of [
    "artifacts/benchmarks/realtime-preview/vscode-cache",
    "artifacts/benchmarks/realtime-preview/electron-runtime",
    "artifacts/benchmarks/realtime-preview/engine/target",
    "artifacts/benchmarks/realtime-preview/plugin/node_modules",
    "artifacts/benchmarks/realtime-preview/plugin/dist",
    "artifacts/benchmarks/texpresso-preview/npm-cache",
    "artifacts/benchmarks/texpresso-preview/mupdf-tools",
    "artifacts/benchmarks/texpresso-preview/mupdf.tar.gz",
    "artifacts/benchmarks/texpresso-preview/plugin/node_modules",
    "artifacts/benchmarks/texpresso-preview/upstream/build",
    "artifacts/chinese-packages/historic",
    "artifacts/chinese-packages/ctex",
    "artifacts/chinese-packages/luatexja",
  ]) await remove(name);
  for (const dir of ["artifacts/chinese-packages", "artifacts/debug-tex-import", "artifacts/debug", "artifacts/ctablestack"]) {
    for (const entry of await readdir(path.join(root, dir), {withFileTypes: true}).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if (entry.isFile() && /\.(?:zip|tgz|tar\.(?:gz|xz))$/.test(entry.name)) await remove(dir + "/" + entry.name);
    }
  }
  for (const [dir, extension] of [["artifacts/async-wasm", ".wasm"], ["artifacts/startup-fonts", ".bin"]]) {
    const files = [];
    for (const name of await readdir(path.join(root, dir)).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if (name.endsWith(extension)) files.push({name, modified: (await stat(path.join(root, dir, name))).mtimeMs});
    }
    files.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    for (const {name} of files.slice(1)) await remove(dir + "/" + name);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await clean(fileURLToPath(new URL("../", import.meta.url)));
  console.log("Removed reproducible benchmark/download caches; kept sources, reports, runtime assets and latest build caches.");
}
