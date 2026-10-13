import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {installTools} from '../../scripts/install-tools.mjs';

test('fresh installs use the verified two-tool runtime and reject corrupt inputs before modifying an install', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'rex-tools-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'runtime'), {recursive: true});
  await cp(new URL('../../runtime/busytex/', import.meta.url), path.join(root, 'runtime/busytex'), {recursive: true});
  await installTools(root);
  const target = path.join(root, 'vendor/bibliography/busytex.wasm'), original = await readFile(target);
  assert.ok(original.length < 256 * 1024);
  const source = path.join(root, 'runtime/busytex/busytex.wasm');
  await writeFile(source, original.subarray(0, -1));
  await assert.rejects(installTools(root), /integrity mismatch/);
  assert.deepEqual(await readFile(target), original);
});
