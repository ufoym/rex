import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, readFile, access, rm, utimes} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {clean} from "../../scripts/clean.mjs";

test("clean removes reproducible caches while preserving sources, evidence and current build inputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rex-clean-"));
  try {
    const kept = ["vendor/engine/luatex.wasm", "dist/index.html", "node_modules/binaryen/index.js",
      "artifacts/benchmarks/texpresso-preview/upstream/src/frontend/main.c",
      "artifacts/benchmarks/texpresso-preview/results.json", "artifacts/archive/before.lua",
      "artifacts/debug/probe.mjs", "artifacts/chinese-packages/setup.log", "artifacts/async-wasm/new.wasm"];
    const removed = ["artifacts/benchmarks/realtime-preview/engine/target/release/rtex",
      "artifacts/benchmarks/texpresso-preview/plugin/node_modules/dependency/index.js",
      "artifacts/chinese-packages/fandol.tar.xz", "artifacts/async-wasm/old.wasm"];
    for (const name of [...kept, ...removed]) {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), {recursive: true});
      await writeFile(file, name);
    }
    await utimes(path.join(root, "artifacts/async-wasm/old.wasm"), 1, 1);
    await clean(root);
    await clean(root); // Missing caches and repeat cleanup are harmless.
    for (const name of kept) assert.equal(await readFile(path.join(root, name), "utf8"), name);
    for (const name of removed) await assert.rejects(access(path.join(root, name)), {code: "ENOENT"});
  } finally { await rm(root, {recursive: true, force: true}); }
});
