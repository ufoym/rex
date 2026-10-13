import {mkdir, mkdtemp, writeFile, rm, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {unpackFiles} from '../src/protocol/snapshot.js';
import {publishDirectory} from './copy-assets.mjs';

export async function buildFontAssets(destination) {
  // Setup must download the engine before loading tools that import its runtime.
  const {startupFonts} = await import('./startup-fonts.mjs');
  const seed = await startupFonts(), files = unpackFiles(seed.bytes), metadata = {schema: 1, key: seed.key, files: {}};
  await mkdir(destination, {recursive: true});
  const scratch = await mkdtemp(path.join(destination, '.font-cache-'));
  const directory = path.join(scratch, 'font-cache'), next = path.join(destination, 'font-cache.json.rex-next');
  try {
    await mkdir(directory);
    for (const [name, bytes] of Object.entries(files)) {
      const sha256 = createHash('sha256').update(bytes).digest('hex'), id = sha256.slice(0, 24) + '.bin';
      metadata.files[name] = {asset: 'font-cache/' + id, bytes: bytes.length, sha256};
      await writeFile(path.join(directory, id), bytes);
    }
    await writeFile(next, JSON.stringify(metadata));
    await publishDirectory(directory, path.join(destination, 'font-cache'));
    await rename(next, path.join(destination, 'font-cache.json'));
  } finally { await rm(scratch, {recursive: true, force: true}); await rm(next, {force: true}); }
  return metadata;
}
