import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/serve.mjs";

test("published server exposes compiled assets and licences, with no source or tooling routes", async () => {
  const server = await startServer();
  try {
    const entry = await fetch(server.url);
    assert.equal(entry.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
    assert.equal(entry.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
    assert.match(await entry.text(), /assets\/app\.js/);
    for (const name of ["assets/app.js", "assets/live-worker.js", "assets/tex/rex-live.lua", "vendor/ctablestack.sty", "LICENSE", "THIRD_PARTY.md"])
      assert.equal((await fetch(server.url + name)).status, 200, name);
    assert.match((await fetch(server.url + "assets/app.js")).headers.get("Content-Type"), /javascript/);
    for (const name of ["package.json", "scripts/setup.mjs", "tests/fixtures/layout-baseline.json", "src/app.js", "%2e%2e%2fpackage.json"])
      assert.equal((await fetch(server.url + name)).status, 404, name);
  } finally { await server.close(); }
});

test("development mappings serve original modules without isolation when requested", async () => {
  const server = await startServer({ source: true, isolation: false });
  try {
    const entry = await fetch(server.url);
    assert.equal(entry.headers.get("Cross-Origin-Opener-Policy"), null);
    const script = await fetch(server.url + "assets/app.js");
    assert.equal(script.status, 200);
    assert.match(await script.text(), /import.*Renderer/);
    assert.equal((await fetch(server.url + "vendor/ctablestack.sty")).status, 200);
  } finally { await server.close(); }
});

test("subpath hosting redirects its entry and keeps resources within the site prefix", async () => {
  const server = await startServer({ basePath: "/rex/" });
  try {
    const site = new URL(server.url);
    const redirect = await fetch(site.origin + "/rex", { redirect: "manual" });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("Location"), "/rex/");
    assert.equal((await fetch(server.url + "assets/runtime.js")).status, 200);
    assert.equal((await fetch(site.origin + "/assets/runtime.js")).status, 404);
  } finally { await server.close(); }
});
