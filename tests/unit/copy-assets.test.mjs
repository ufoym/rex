import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, rename, writeFile, readFile, stat, access, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {copyAssets, publishDirectory, recoverDirectory, removeExcludedAssets} from "../../scripts/copy-assets.mjs";

test("published copies preserve bytes and paths, exclude metadata, and isolate writes in both directions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rex-copy-"));
  try {
    const source = path.join(root, "source"), target = path.join(root, "stage/vendor");
    const bytes = Buffer.alloc(128 * 1024, 37);
    await mkdir(path.join(source, "nested"), {recursive: true});
    await mkdir(path.join(source, "__pycache__"));
    await writeFile(path.join(source, "nested/font.bin"), bytes);
    for (const file of ["._font.bin", ".DS_Store", "__pycache__/module.pyc"])
      await writeFile(path.join(source, file), "metadata");
    await copyAssets(source, target);
    await removeExcludedAssets(path.join(root, "stage"));
    const original = path.join(source, "nested/font.bin"), copy = path.join(target, "nested/font.bin");
    assert.deepEqual(await readFile(copy), bytes);
    assert.notEqual((await stat(original)).ino, (await stat(copy)).ino);
    for (const file of ["._font.bin", ".DS_Store", "__pycache__"])
      await assert.rejects(access(path.join(target, file)), {code: "ENOENT"});
    await writeFile(copy, "published edit");
    assert.deepEqual(await readFile(original), bytes);
    await writeFile(original, "source edit");
    assert.equal(await readFile(copy, "utf8"), "published edit");
    await access(path.join(source, ".DS_Store"));
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("directory publication restores interrupted moves, rolls back failed swaps and removes old files only after success", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rex-publish-"));
  try {
    const destination = path.join(root, "release"), stage = path.join(root, "stage");
    const previous = destination + ".rex-previous", userBackup = destination + ".previous";
    await mkdir(userBackup);
    await writeFile(path.join(userBackup, "asset"), "user backup");
    await mkdir(destination);
    await writeFile(path.join(destination, "asset"), "previous");
    await rename(destination, previous);
    await recoverDirectory(destination);
    assert.equal(await readFile(path.join(destination, "asset"), "utf8"), "previous");
    // Moving the destination also moves this deliberately invalid stage path.
    // Installation fails, and the previous directory must be restored intact.
    const invalidStage = path.join(destination, "nested-stage");
    await mkdir(invalidStage);
    await assert.rejects(publishDirectory(invalidStage, destination), {code: "ENOENT"});
    assert.equal(await readFile(path.join(destination, "asset"), "utf8"), "previous");
    await mkdir(stage);
    await writeFile(path.join(stage, "asset"), "replacement");
    await publishDirectory(stage, destination);
    assert.equal(await readFile(path.join(destination, "asset"), "utf8"), "replacement");
    await assert.rejects(access(previous), {code: "ENOENT"});
    // An interruption after installation can leave a previous directory behind.
    await mkdir(previous);
    await writeFile(path.join(previous, "asset"), "obsolete");
    await recoverDirectory(destination);
    assert.equal(await readFile(path.join(destination, "asset"), "utf8"), "replacement");
    await assert.rejects(access(previous), {code: "ENOENT"});
    assert.equal(await readFile(path.join(userBackup, "asset"), "utf8"), "user backup");
  } finally { await rm(root, {recursive: true, force: true}); }
});
