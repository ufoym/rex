import test from "node:test";
import assert from "node:assert/strict";
import {gzipSync} from "node:zlib";
import {createLocalResources} from "../../src/compiler/local-resources.js";
import {packFiles} from "../../src/protocol/snapshot.js";
import {InputPending} from "../../src/compiler/async-runtime.js";

test("local resources pause uncached reads, cache requested chunks and recover after a corrupt chunk", async () => {
  const catalog = {files: {"font.otf": "font", "biber.data": "biber"}, chunks: {
    font: {script: "font.js", label: "font", bytes: 100, entries: 1},
    biber: {script: "biber.js", label: "Biber", bytes: 200, entries: 1},
  }};
  let corrupt = false; const reads = [], events = [];
  const local = createLocalResources(catalog, async script => {
    reads.push(script);
    const id = script === "font.js" ? "font" : "biber";
    const contents = id === "font" ? {"font.otf": "font bytes"} : {"biber.data": "Perl bytes"};
    return {id, data: corrupt ? "AAAA" : gzipSync(packFiles(contents)).toString("base64")};
  });
  local.progress = details => events.push(details);
  assert.equal(Object.keys(local.files).length, 0);
  let wait;
  assert.throws(() => local.load('font.otf'), error => { wait = error.ready; return error instanceof InputPending; });
  await wait;
  assert.equal(new TextDecoder().decode(local.load("font.otf")), "font bytes");
  assert.deepEqual(reads, ["font.js"]);
  assert.equal(local.files["biber.data"], undefined);
  local.load("font.otf"); assert.equal(reads.length, 1);
  corrupt = true; await assert.rejects(local.loadAsync("biber.data"));
  assert.equal(local.files["biber.data"], undefined);
  corrupt = false; assert.equal(new TextDecoder().decode(await local.loadAsync("biber.data")), "Perl bytes");
  assert.equal(events.at(-1).loadedBytes, 200);
  assert.throws(() => local.load("missing.ttf"), /Missing packaged/);
});

test('asynchronous loads coalesce a shared chunk and can retry failed decompression', async () => {
  let corrupt = true, reads = 0;
  const catalog = {files: {'a.sty': 'tex', 'b.sty': 'tex'}, chunks: {tex: {script: 'tex.js', label: 'LaTeX', bytes: 99, entries: 2}}};
  const local = createLocalResources(catalog, async () => {
    reads++;
    return {id: 'tex', data: corrupt ? 'AAAA' : gzipSync(packFiles({'a.sty': 'A', 'b.sty': 'B'})).toString('base64')};
  });
  await assert.rejects(local.loadAsync('a.sty'));
  assert.deepEqual(Object.keys(local.files), []);
  corrupt = false;
  const bytes = await Promise.all([local.loadAsync('a.sty'), local.loadAsync('b.sty')]);
  assert.deepEqual(bytes.map(b => new TextDecoder().decode(b)), ['A', 'B']);
  assert.equal(reads, 2, 'Only one successful decode should serve both file requests');
});


test('local tool factories execute without importing worker Blob URLs', async t => {
  const previous = globalThis.rexLocal;
  t.after(() => { if (previous === undefined) delete globalThis.rexLocal; else globalThis.rexLocal = previous; });
  const local = createLocalResources({files: {}, chunks: {}, tools: {
    busytex: {script: 'tools/busytex.js', label: 'BibTeX / MakeIndex', bytes: 99},
  }}, async () => 'globalThis.rexLocal.tools.busytex = () => "tool ready";');
  globalThis.rexLocal = local;
  local.progress = () => {};
  const factory = await local.tool('busytex');
  assert.equal(factory.default(), 'tool ready');
});
