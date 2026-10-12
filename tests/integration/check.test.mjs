import test from "node:test";
import assert from "node:assert/strict";
import {cp, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

test("checks accept a fresh hosted build without local caches and reject missing modules", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const scratch = await mkdtemp(path.join(tmpdir(), "rex-check-"));
  try {
    await cp(root, scratch, {
      recursive: true,
      filter: file => ![".git", "node_modules", "vendor", "dist", "artifacts"].includes(path.relative(root, file).split(path.sep)[0]),
    });
    for (const name of ["vendor", "dist"]) await symlink(path.join(root, name), path.join(scratch, name), "dir");
    const check = () => spawnSync(process.execPath, [path.join(scratch, "scripts/check.mjs")], {encoding: "utf8"});
    const fresh = check();
    assert.equal(fresh.status, 0, fresh.stderr);
    await writeFile(path.join(scratch, "src/missing-module.js"), ["import {missing} from", JSON.stringify("./missing-worker.js")].join(" ") + ";\n");
    const broken = check();
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /Broken module\/worker path: src\/missing-module\.js → \.\/missing-worker\.js/);
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
});
