import {lstat, readdir, readlink, rm} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

// These pinned packages supply build inputs or Node test APIs. Keep those exact
// bytes and licences; Rex does not use their other distributions or native CLIs.
const keep = {
  binaryen: {"": ["index.js", "index.d.ts", "package.json", "LICENSE", "README.md"]},
  "pdfjs-dist": {
    "": ["build", "package.json", "LICENSE", "README.md"],
    build: ["pdf.mjs", "pdf.worker.mjs"],
  },
  "pdf-lib": {
    "": ["cjs", "dist", "package.json", "LICENSE.md", "README.md"],
    dist: ["pdf-lib.min.js"],
  },
  "opentype.js": {
    "": ["dist", "package.json", "LICENSE", "README.md"],
    dist: ["opentype.js", "opentype.module.js"],
  },
  "@codemirror/legacy-modes": {mode: ["stex.js", "stex.cjs", "stex.d.ts"]},
};

async function entries(dir) {
  try {
    // npm-linked source checkouts belong to their owner, not this cleanup.
    if ((await lstat(dir)).isSymbolicLink()) return [];
    return await readdir(dir, {withFileTypes: true});
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function pruneDependencies(root) {
  const modules = path.join(root, "node_modules");
  for (const [name, rules] of Object.entries(keep)) {
    const dir = path.join(modules, name);
    if (!(await entries(dir)).length) continue;
    for (const [subdir, names] of Object.entries(rules)) {
      const target = path.join(dir, subdir);
      for (const entry of await entries(target)) {
        if (!names.includes(entry.name)) await rm(path.join(target, entry.name), {recursive: true, force: true});
      }
    }
  }
  // PDF.js is copied for the browser; no Rex command renders PDFs in Node.
  for (const entry of await entries(path.join(modules, "@napi-rs"))) {
    if (entry.name === "canvas" || entry.name.startsWith("canvas-"))
      await rm(path.join(modules, "@napi-rs", entry.name), {recursive: true, force: true});
  }
  for (const entry of await entries(path.join(modules, ".bin"))) {
    if (!entry.isSymbolicLink()) continue;
    const file = path.join(modules, ".bin", entry.name);
    const target = path.resolve(path.dirname(file), await readlink(file));
    if (["binaryen/bin", "opentype.js/bin"].some(dir => target.startsWith(path.join(modules, dir) + path.sep)))
      await rm(file);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await pruneDependencies(fileURLToPath(new URL("../", import.meta.url)));
  console.log("Pruned unused dependency tools and distributions; kept Rex build inputs, Node test APIs and licences.");
}
