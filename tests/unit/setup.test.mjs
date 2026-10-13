import test from "node:test";
import assert from "node:assert/strict";
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

test("setup reaches the engine download in a fresh checkout without vendor assets", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const checkout = await mkdtemp(path.join(tmpdir(), "rex-setup-"));
  try {
    for (const name of ["scripts", "src", "package.json"])
      await cp(path.join(root, name), path.join(checkout, name), {recursive: true});
    await symlink(path.join(root, "node_modules"), path.join(checkout, "node_modules"), "dir");
    const bin = path.join(checkout, "bin");
    await mkdir(bin);
    // Stop at the first download so this bootstrap check needs no network or WASM.
    await writeFile(path.join(bin, "curl"), '#!/bin/sh\necho "setup-test: engine download reached"\nexit 73\n', {mode: 0o755});
    const result = spawnSync(process.execPath, ["scripts/setup.mjs"], {
      cwd: checkout, encoding: "utf8", timeout: 30_000,
      env: {...process.env, PATH: bin + path.delimiter + process.env.PATH},
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /setup-test: engine download reached/, result.stderr);
    assert.match(result.stderr, /curl failed/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally { await rm(checkout, {recursive: true, force: true}); }
});
