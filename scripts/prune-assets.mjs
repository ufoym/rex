import {mkdtemp, readFile, rename, writeFile, rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundles} from "../src/compiler/assets.js";
import {copyAssets, publishDirectory, recoverDirectory} from "./copy-assets.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const otherFormats = new Set(["web2c/tikz.fmt", "web2c/latex.fmt", "web2c/plain.fmt", "web2c/etex.fmt", "web2c/dviluatex.fmt"]);
const buildFiles = new Set([
  "/opt/perl-wasm/lib/site_perl/5.38.2/Params/Validate/XS.c",
  "/opt/perl-wasm/lib/site_perl/5.38.2/Params/Validate/XS.o",
  "/opt/perl-wasm/lib/site_perl/5.38.2/Params/Validate/XS.xs",
  "/opt/perl-wasm/lib/site_perl/5.38.2/auto/share/dist/File-ShareDir/sample.txt",
  "/opt/perl-wasm/lib/site_perl/5.38.2/auto/share/dist/File-ShareDir/subdir/sample.txt",
  "/opt/perl-wasm/lib/site_perl/5.38.2/auto/share/module/File-ShareDir/test_file.txt",
]);

// Reuse upstream's encoded blocks verbatim. No recompression or new decoder:
// only whole blocks belonging exclusively to build/test files can be omitted.
export function pruneBiber(source, bytes) {
  const packageMatch = source.match(/loadPackage\((\{"files":[^\n]+\})\);/);
  const blocksMatch = source.match(/var compressedData = (\{[^\n]+\})\s*;/);
  if (!packageMatch || !blocksMatch || !/exports\.CHUNK_SIZE\s*=\s*2048\b/.test(source))
    throw Error("Unsupported Biber package layout");
  const metadata = JSON.parse(packageMatch[1]), blocks = JSON.parse(blocksMatch[1]);
  if (metadata.remote_package_size !== bytes.length || metadata.package_uuid !== "sha256-" + sha(bytes))
    throw Error("Biber package integrity mismatch");
  const removed = metadata.files.filter(file => buildFiles.has(file.filename));
  if (!removed.length) return {source, bytes, removed: []};
  if (metadata.remote_package_size !== bytes.length || blocks.cachedOffset + 4096 !== bytes.length ||
      blocks.offsets.length !== blocks.sizes.length || blocks.offsets.length !== blocks.successes.length)
    throw Error("Invalid Biber block inventory");
  const drop = new Set();
  for (const file of removed)
    for (let i = Math.ceil(file.start / 2048); i < Math.floor(file.end / 2048); i++) drop.add(i);
  const keptFiles = metadata.files.filter(file => !buildFiles.has(file.filename));
  for (const file of keptFiles) {
    if (file.end > file.start && Array.from(drop).some(i => file.start < (i + 1) * 2048 && file.end > i * 2048))
      throw Error("Cannot remove a Biber block shared with runtime files");
  }
  const counts = [0], chunks = [], offsets = [], sizes = [], successes = [];
  let size = 0;
  for (let i = 0; i < blocks.offsets.length; i++) {
    const start = blocks.offsets[i], end = start + blocks.sizes[i];
    if (start !== (i ? blocks.offsets[i - 1] + blocks.sizes[i - 1] : 0) || end > blocks.cachedOffset)
      throw Error("Invalid Biber block offset");
    counts.push(counts[i] + (drop.has(i) ? 1 : 0));
    if (drop.has(i)) continue;
    offsets.push(size); sizes.push(blocks.sizes[i]); successes.push(blocks.successes[i]);
    chunks.push(bytes.subarray(start, end)); size += blocks.sizes[i];
  }
  if (blocks.offsets.at(-1) + blocks.sizes.at(-1) !== blocks.cachedOffset) throw Error("Truncated Biber blocks");
  chunks.push(bytes.subarray(blocks.cachedOffset));
  const output = Buffer.concat(chunks);
  const remap = position => {
    const block = Math.floor(position / 2048);
    return position - counts[block] * 2048 - (drop.has(block) ? position % 2048 : 0);
  };
  metadata.files = keptFiles.map(file => ({...file, start: remap(file.start), end: remap(file.end)}));
  metadata.remote_package_size = output.length;
  metadata.package_uuid = "sha256-" + sha(output);
  Object.assign(blocks, {cachedOffset: size, offsets, sizes, successes});
  source = source.replace(packageMatch[1], () => JSON.stringify(metadata)).replace(blocksMatch[1], () => JSON.stringify(blocks));
  return {source, bytes: output, removed: removed.map(file => file.filename)};
}

export async function pruneAssets(root) {
  const report = {removedFiles: [], removedBytes: 0}, seen = new Set();
  const remove = async name => {
    const file = path.join(root, name);
    const bytes = await readFile(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (!bytes) return;
    await rm(file); report.removedFiles.push(name); report.removedBytes += bytes.length;
  };
  for (const bundle of [...bundles, "tikz-snapshot"]) {
    const base = "vendor/engine/bundles/" + bundle;
    const directory = path.join(root, base);
    await recoverDirectory(directory);
    const text = await readFile(path.join(root, base, "manifest.json"), "utf8").catch(error => { if (error.code !== "ENOENT") throw error; });
    if (!text) continue;
    const manifest = JSON.parse(text);
    const removals = [];
    for (const [name, info] of Object.entries(manifest.files)) {
      if (otherFormats.has(name) || seen.has(name)) {
        if (path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw Error("Invalid bundle path: " + name);
        const file = base + "/files/" + name, bytes = await readFile(path.join(root, file));
        // Upstream manifests use 16-digit SHA-256 prefixes; added CJK assets use full hashes.
        if (bytes.length !== info.size || !/^(?:[a-f0-9]{16}|[a-f0-9]{64})$/.test(info.sha) || !sha(bytes).startsWith(info.sha))
          throw Error("Modified bundle asset: " + file);
        removals.push({file, name, bytes: bytes.length}); delete manifest.files[name];
      } else seen.add(name);
    }
    if (bundle === "tikz-snapshot") {
      if (Object.keys(manifest.files).length) throw Error("Unexpected runtime files in tikz-snapshot");
    }
    if (removals.length || bundle === "tikz-snapshot") {
      manifest.eager = (manifest.eager || []).filter(name => Object.hasOwn(manifest.files, name));
      const scratch = await mkdtemp(path.join(root, "vendor/engine/.bundle-trim-"));
      try {
        const stage = path.join(scratch, bundle);
        await copyAssets(directory, stage);
        for (const {name} of removals) await rm(path.join(stage, "files", name));
        if (bundle === "tikz-snapshot") await rm(path.join(stage, "manifest.json"));
        else await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest));
        await publishDirectory(stage, directory);
      } finally { await rm(scratch, {recursive: true, force: true}); }
      for (const {file, bytes} of removals) { report.removedFiles.push(file); report.removedBytes += bytes; }
      if (bundle === "tikz-snapshot") {
        report.removedFiles.push(base + "/manifest.json"); report.removedBytes += Buffer.byteLength(text);
      }
    }
  }
  const hotPath = path.join(root, "vendor/engine/bundles/hot.json");
  const hotText = await readFile(hotPath, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; });
  if (hotText) {
    const hot = JSON.parse(hotText);
    let changed = false;
    for (const [kind, files] of Object.entries(hot.kinds)) {
      hot.kinds[kind] = files.filter(name => !otherFormats.has(name));
      if (hot.kinds[kind].length !== files.length) changed = true;
    }
    if (changed) {
      const next = hotPath + ".rex-next";
      try { await writeFile(next, JSON.stringify(hot)); await rename(next, hotPath); }
      finally { await rm(next, {force: true}); }
    }
  }
  await remove("vendor/engine/bundles/chinese/doc/luatex/luatexja/luatexja.dtx");
  const bibliography = path.join(root, "vendor/bibliography");
  await recoverDirectory(bibliography);
  const sourcePath = path.join(bibliography, "biber.mjs");
  const source = await readFile(sourcePath, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; });
  if (source) {
    const dataPath = path.join(root, "vendor/bibliography/biber.data"), bytes = await readFile(dataPath);
    const result = pruneBiber(source, bytes);
    if (result.removed.length) {
      const scratch = await mkdtemp(path.join(root, "vendor/.bibliography-trim-"));
      try {
        const stage = path.join(scratch, "bibliography");
        await copyAssets(bibliography, stage);
        await writeFile(path.join(stage, "biber.data"), result.bytes);
        await writeFile(path.join(stage, "biber.mjs"), result.source);
        await publishDirectory(stage, bibliography);
      } finally { await rm(scratch, {recursive: true, force: true}); }
      report.removedBytes += bytes.length - result.bytes.length + Buffer.byteLength(source) - Buffer.byteLength(result.source);
      report.removedFiles.push(...result.removed.map(name => "biber.data:" + name));
    }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await pruneAssets(fileURLToPath(new URL("../", import.meta.url)));
  console.log(`Removed ${report.removedFiles.length} unused resource entries, ${(report.removedBytes / 2 ** 20).toFixed(2)} MiB; kept runtime fonts, WASM engines and caches.`);
}
