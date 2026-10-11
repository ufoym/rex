import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
function harness() {
  const handlers = new Map(), cache = new Map();
  let network = 0;
  vm.runInNewContext(source, {
    self: {location: new URL("https://example.test/rex/sw.js"), addEventListener: (name, handler) => handlers.set(name, handler)},
    caches: {open: async () => ({match: async request => cache.get(request.url)?.clone(),
      put: async (request, response) => cache.set(request.url, response.clone())})},
    fetch: async () => { network++; return new Response("fresh"); },
    URL, Headers, Response,
  });
  return {
    cache, network: () => network,
    request: url => {
      let result;
      handlers.get("fetch")({request: new Request(url), respondWith: response => result = response});
      return result;
    },
  };
}
test("cached content-hashed bundle files avoid repeated network validation", async () => {
  const h = harness(), url = "https://example.test/rex/vendor/engine/bundles/core/files/a.tfm?v=0123456789abcdef";
  h.cache.set(url, new Response("cached"));
  const response = await h.request(url);
  assert.equal(await response.text(), "cached");
  assert.equal(h.network(), 0);
  assert.equal(response.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
});
test("a new hash and mutable application files still fetch current contents", async () => {
  const h = harness(), old = "https://example.test/rex/vendor/engine/bundles/core/files/a.tfm?v=0123456789abcdef";
  h.cache.set(old, new Response("cached"));
  assert.equal(await (await h.request(old.replace("0123456789abcdef", "fedcba9876543210"))).text(), "fresh");
  const app = "https://example.test/rex/assets/ui/app.js";
  h.cache.set(app, new Response("old application"));
  assert.equal(await (await h.request(app)).text(), "fresh");
  assert.equal(h.network(), 2);
});
