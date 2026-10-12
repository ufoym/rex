import test from "node:test";
import assert from "node:assert/strict";
import { loadFontCache, saveFontCache } from "../../src/compiler/font-cache.js";
import { packFiles } from "../../src/protocol/snapshot.js";

test("parsed font caches persist only for the exact engine, manifests and TeX scripts", async t => {
  const entries = new Map();
  const original = globalThis.caches;
  t.after(() => { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; });
  globalThis.caches = {open: async () => ({
    match: async url => entries.get(url)?.clone(),
    put: async (url, response) => entries.set(url, response.clone()),
    keys: async () => [...entries.keys()].map(url => new Request(url)),
    delete: async request => entries.delete(request.url),
  })};
  const res = () => ({set: {manifests: [{manifest: {files: {"test.otf": {sha: "a"}}}}]}, scripts: {"test.lua": "original"}});
  const wasm = new Uint8Array([1]), base = "https://example.test/rex/vendor/";
  const first = res(); await loadFontCache(first, wasm, base);
  const file = "/texmf-var/luatex-cache/generic/fonts/otl/test.luc";
  first.fontCache[file] = new Uint8Array([2, 3]);
  await saveFontCache(first);
  const restored = res(); await loadFontCache(restored, wasm, base);
  assert.deepEqual(restored.fontCache, first.fontCache);
  for (const change of [r => r.set.manifests[0].manifest.files["test.otf"].sha = "b", r => r.scripts["test.lua"] = "changed"]) {
    const changed = res(); change(changed);
    await loadFontCache(changed, wasm, base);
    assert.deepEqual(changed.fontCache, {});
  }
  const newEngine = res(); await loadFontCache(newEngine, new Uint8Array([4]), base);
  assert.deepEqual(newEngine.fontCache, {});
  await saveFontCache({...newEngine, fontCache: first.fontCache});
  assert.equal(entries.size, 1, "Old engine/resource versions must not accumulate");
  entries.set(first.fontCacheUrl, new Response(packFiles({"/work/main.tex": "unrelated project data"})));
  const invalid = res(); await loadFontCache(invalid, wasm, base);
  assert.deepEqual(invalid.fontCache, {});
  entries.set(first.fontCacheUrl, new Response("truncated"));
  await loadFontCache(invalid, wasm, base);
  assert.deepEqual(invalid.fontCache, {});
  globalThis.caches.open = async () => { throw Error("Storage unavailable"); };
  await loadFontCache(restored, wasm, base);
  assert.deepEqual(restored.fontCache, {});
  await saveFontCache(first);
});
