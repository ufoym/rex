import test from "node:test";
import assert from "node:assert/strict";
import { resources } from "../../src/compiler/runtime.js";

test("engine download failures include the resource URL on mobile", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("Load failed"); };
  try {
    await assert.rejects(resources(undefined, "https://example.test/rex/vendor/"),
      /Failed to load engine resource https:\/\/example\.test\/rex\/vendor\/engine\/bundles\/core\/manifest\.json: TypeError: Load failed/);
  } finally { globalThis.fetch = original; }
});
