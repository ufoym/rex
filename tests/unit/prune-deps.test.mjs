import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, readFile, access, lstat, symlink, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pruneDependencies} from "../../scripts/prune-deps.mjs";

test("dependency pruning preserves build/test inputs, tools, licences and linked source checkouts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rex-prune-"));
  try {
    const kept = ["binaryen/index.js", "binaryen/LICENSE", "pdfjs-dist/build/pdf.mjs", "pdfjs-dist/build/pdf.worker.mjs",
      "pdfjs-dist/LICENSE", "pdf-lib/cjs/index.js", "pdf-lib/dist/pdf-lib.min.js", "pdf-lib/LICENSE.md",
      "opentype.js/dist/opentype.js", "opentype.js/dist/opentype.module.js", "opentype.js/LICENSE",
      "esbuild/bin/esbuild", "playwright/cli.js", "@napi-rs/other/index.js"];
    const removed = ["binaryen/bin/wasm-opt", "pdfjs-dist/legacy/build/pdf.mjs", "pdfjs-dist/build/pdf.mjs.map",
      "pdf-lib/dist/pdf-lib.js", "pdf-lib/es/index.js", "opentype.js/dist/opentype.min.js", "@napi-rs/canvas/index.js",
      "@napi-rs/canvas-darwin-arm64/native.node"];
    for (const name of [...kept, ...removed]) {
      const file = path.join(root, "node_modules", name);
      await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, name);
    }
    await mkdir(path.join(root, "node_modules/.bin"));
    for (const [name, target] of [["wasm-opt", "binaryen/bin/wasm-opt"], ["esbuild", "esbuild/bin/esbuild"], ["playwright", "playwright/cli.js"]])
      await symlink("../" + target, path.join(root, "node_modules/.bin", name));
    const source = path.join(root, "linked-source/mode"); await mkdir(source, {recursive: true});
    await writeFile(path.join(source, "other-language.js"), "owner's source");
    await mkdir(path.join(root, "node_modules/@codemirror"));
    await symlink(path.dirname(source), path.join(root, "node_modules/@codemirror/legacy-modes"), "dir");
    await pruneDependencies(root); await pruneDependencies(root);
    for (const name of kept) assert.equal(await readFile(path.join(root, "node_modules", name), "utf8"), name);
    for (const name of [...removed, ".bin/wasm-opt"]) await assert.rejects(access(path.join(root, "node_modules", name)), {code: "ENOENT"});
    await assert.rejects(lstat(path.join(root, "node_modules/.bin/wasm-opt")), {code: "ENOENT"});
    await access(path.join(root, "node_modules/.bin/esbuild")); await access(path.join(root, "node_modules/.bin/playwright"));
    assert.equal(await readFile(path.join(source, "other-language.js"), "utf8"), "owner's source");
  } finally { await rm(root, {recursive: true, force: true}); }
});
