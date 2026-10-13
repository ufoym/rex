import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pruneAssets, pruneBiber} from "../../scripts/prune-assets.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
test("Biber trim reuses encoded blocks and preserves retained ranges and block boundaries", () => {
  const chunks = Array.from({length: 6}, (_, i) => Buffer.alloc(2048, i + 1));
  const bytes = Buffer.concat([...chunks, Buffer.alloc(4096)]);
  const files = [
    {filename: "/before$&.pm", start: 0, end: 2500},
    {filename: "/opt/perl-wasm/lib/site_perl/5.38.2/Params/Validate/XS.c", start: 2500, end: 10200},
    {filename: "/after.pm", start: 10200, end: 12288},
    {filename: "/empty", start: 6000, end: 6000},
  ];
  const metadata = {files, remote_package_size: bytes.length, package_uuid: "sha256-" + sha(bytes)};
  const blocks = {data: null, cachedOffset: 12288, cachedIndexes: [-1, -1], cachedChunks: [null, null], offsets: chunks.map((_, i) => i * 2048), sizes: chunks.map(() => 2048), successes: chunks.map(() => 0)};
  const source = `exports.CHUNK_SIZE = 2048;\nvar compressedData = ${JSON.stringify(blocks)};\nloadPackage(${JSON.stringify(metadata)});`;
  const result = pruneBiber(source, bytes);
  const next = JSON.parse(result.source.match(/loadPackage\((.+)\);/)[1]);
  const updated = JSON.parse(result.source.match(/var compressedData = (.+);/)[1]);
  assert.equal(result.bytes.length, bytes.length - 4096);
  assert.equal(updated.offsets.length, 4);
  assert.equal(next.package_uuid, "sha256-" + sha(result.bytes));
  for (const file of next.files) {
    const before = files.find(old => old.filename === file.filename);
    assert.deepEqual(result.bytes.subarray(file.start, file.end), bytes.subarray(before.start, before.end));
  }
  assert.deepEqual(pruneBiber(result.source, result.bytes).bytes, result.bytes);
  assert.equal(pruneBiber(result.source, result.bytes).source, result.source);
  const shared = source.replace(JSON.stringify(metadata), () => JSON.stringify({...metadata, files: [...files, {filename: "/shared.pm", start: 4096, end: 4200}]}));
  assert.throws(() => pruneBiber(shared, bytes), /shared with runtime/);
  assert.throws(() => pruneBiber(source.replace('"cachedOffset":12288', '"cachedOffset":1'), bytes), /Invalid Biber/);
  const damaged = Buffer.from(result.bytes); damaged[0] ^= 1;
  assert.throws(() => pruneBiber(result.source, damaged), /integrity mismatch/);
});

test("resource trimming preserves runtime bytes, the first bundle's resolution, fonts, notices and startup format", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rex-assets-"));
  try {
    const manifests = {};
    for (const [bundle, name, text] of [
      ["luatex", "web2c/dvilualatex.fmt", "runtime format"],
      ["luatex", "web2c/dviluatex.fmt", "unused format"],
      ["latex-core", "web2c/latex.fmt", "unused latex"],
      ["tikz-snapshot", "web2c/tikz.fmt", "unused snapshot"],
      ["luatex", "tex/shared.lua", "first bundle"],
      ["chinese", "tex/shared.lua", "shadowed bundle"],
      ["chinese", "fonts/fandol.otf", "all glyphs"],
      ["latex-extra", "tex/tikz.sty", "runtime TikZ"],
    ]) {
      const base = path.join(root, "vendor/engine/bundles", bundle), bytes = Buffer.from(text);
      await mkdir(path.dirname(path.join(base, "files", name)), {recursive: true});
      await writeFile(path.join(base, "files", name), bytes);
      const m = manifests[bundle] ||= {name: bundle, files: {}, eager: []};
      m.files[name] = {size: bytes.length, sha: bundle === "chinese" ? sha(bytes) : sha(bytes).slice(0, 16)}; m.eager.push(name);
    }
    for (const [bundle, manifest] of Object.entries(manifests))
      await writeFile(path.join(root, "vendor/engine/bundles", bundle, "manifest.json"), JSON.stringify(manifest));
    const base = path.join(root, "vendor/engine/bundles");
    await writeFile(path.join(base, "hot.json"), JSON.stringify({kinds: {tikz: ["web2c/tikz.fmt", "web2c/dvilualatex.fmt", "tex/shared.lua"]}}));
    await mkdir(path.join(base, "chinese/doc"), {recursive: true});
    await writeFile(path.join(base, "chinese/doc/COPYING"), "licence");
    await writeFile(path.join(base, "tikz-snapshot/COPYING"), "unlisted notice");
    await pruneAssets(root);
    const m = JSON.parse(await readFile(path.join(base, "chinese/manifest.json"), "utf8"));
    assert.equal(m.files["tex/shared.lua"], undefined);
    assert.deepEqual(m.eager, ["fonts/fandol.otf"]);
    assert.equal(await readFile(path.join(base, "luatex/files/tex/shared.lua"), "utf8"), "first bundle");
    assert.equal(await readFile(path.join(base, "luatex/files/web2c/dvilualatex.fmt"), "utf8"), "runtime format");
    assert.equal(await readFile(path.join(base, "chinese/files/fonts/fandol.otf"), "utf8"), "all glyphs");
    assert.equal(await readFile(path.join(base, "latex-extra/files/tex/tikz.sty"), "utf8"), "runtime TikZ");
    assert.equal(await readFile(path.join(base, "chinese/doc/COPYING"), "utf8"), "licence");
    await assert.rejects(readFile(path.join(base, "tikz-snapshot/manifest.json")), {code: "ENOENT"});
    assert.equal(await readFile(path.join(base, "tikz-snapshot/COPYING"), "utf8"), "unlisted notice");
    assert.deepEqual(JSON.parse(await readFile(path.join(base, "hot.json"), "utf8")).kinds.tikz, ["web2c/dvilualatex.fmt", "tex/shared.lua"]);
    assert.deepEqual((await pruneAssets(root)).removedFiles, []);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("a modified later resource is rejected before deleting files or changing its bundle manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rex-prune-failure-"));
  try {
    const base = path.join(root, "vendor/engine/bundles/luatex"), bytes = Buffer.from("format");
    await mkdir(path.join(base, "files/web2c"), {recursive: true});
    const files = {};
    for (const name of ["web2c/dviluatex.fmt", "web2c/plain.fmt"]) {
      await writeFile(path.join(base, "files", name), bytes);
      files[name] = {size: bytes.length, sha: sha(bytes)};
    }
    const manifest = JSON.stringify({name: "luatex", files});
    await writeFile(path.join(base, "manifest.json"), manifest);
    await writeFile(path.join(base, "files/web2c/plain.fmt"), "modified");
    await assert.rejects(pruneAssets(root), /Modified bundle asset/);
    assert.deepEqual(await readFile(path.join(base, "files/web2c/dviluatex.fmt")), bytes);
    assert.equal(await readFile(path.join(base, "manifest.json"), "utf8"), manifest);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("Biber trimming recovers an interrupted directory swap and installs a matching loader/data pair with notices intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rex-biber-publish-"));
  try {
    const directory = path.join(root, "vendor/bibliography");
    await mkdir(directory, {recursive: true});
    const bytes = Buffer.concat([Buffer.alloc(2048, 1), Buffer.alloc(2048, 2), Buffer.alloc(2048, 3), Buffer.alloc(4096)]);
    const files = [
      {filename: "/before.pm", start: 0, end: 2048},
      {filename: "/opt/perl-wasm/lib/site_perl/5.38.2/Params/Validate/XS.c", start: 2048, end: 4096},
      {filename: "/after.pm", start: 4096, end: 6144},
    ];
    const metadata = {files, remote_package_size: bytes.length, package_uuid: "sha256-" + sha(bytes)};
    const blocks = {data: null, cachedOffset: 6144, cachedIndexes: [-1, -1], cachedChunks: [null, null], offsets: [0, 2048, 4096], sizes: [2048, 2048, 2048], successes: [0, 0, 0]};
    const source = `exports.CHUNK_SIZE = 2048;\nvar compressedData = ${JSON.stringify(blocks)};\nloadPackage(${JSON.stringify(metadata)});`;
    await writeFile(path.join(directory, "biber.mjs"), source);
    await writeFile(path.join(directory, "biber.data"), bytes);
    await writeFile(path.join(directory, "biber.wasm"), "engine");
    await writeFile(path.join(directory, "TeXlyre-NOTICE"), "notice");
    await rename(directory, directory + ".rex-previous");
    await pruneAssets(root);
    const nextSource = await readFile(path.join(directory, "biber.mjs"), "utf8"), nextBytes = await readFile(path.join(directory, "biber.data"));
    const expected = pruneBiber(source, bytes);
    assert.equal(nextSource, expected.source); assert.deepEqual(nextBytes, expected.bytes);
    assert.equal(await readFile(path.join(directory, "biber.wasm"), "utf8"), "engine");
    assert.equal(await readFile(path.join(directory, "TeXlyre-NOTICE"), "utf8"), "notice");
    assert.deepEqual((await pruneAssets(root)).removedFiles, []);
  } finally { await rm(root, {recursive: true, force: true}); }
});
