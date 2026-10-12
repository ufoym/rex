import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { webkit, devices } from "playwright";
import http from "node:http";
import { openBrowser, replaceSource } from "../helpers/browser-helper.mjs";

const {browser, page, close, stopHosting} = await openBrowser({isolation: false, basePath: "/rex/",
  browserType: webkit, contextOptions: devices["iPhone 13"]});
try {
  await page.waitForFunction(() => window.rex?.session);
  // Reload a fresh project while recording the status shown during startup.
  await page.addInitScript(() => {
    window.startupStatuses = [];
    new MutationObserver(() => {
      const status = document.querySelector("#status")?.textContent;
      if (status && status !== window.startupStatuses.at(-1)) window.startupStatuses.push(status);
    }).observe(document, {subtree: true, childList: true, characterData: true});
  });
  await page.reload();
  await page.waitForFunction(() => window.rex?.session.warmed);
  await page.evaluate(() => rex.session.warmed);
  assert.equal(await page.evaluate(() => rex.session.live.closed), false,
    "Startup warming closed the live engine: " + await page.locator("#log").textContent());
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  assert.ok(await page.evaluate(() => rex.session.layout.pdf.length > 1000));
  assert.ok(await page.evaluate(() => startupStatuses.some(s => /Loading engine resources \d+\/\d+/.test(s))),
    "Startup must show resource download progress");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-menu > summary").click();
  await page.locator("#export").click();
  const download = await downloadPromise;
  assert.equal((await readFile(await download.path())).subarray(0, 4).toString(), "%PDF");
  // Safari can reject cache writes under storage pressure. Exercise the real
  // service worker and worker resource loader with successful HTTP downloads.
  const restricted = await browser.newContext(devices["iPhone 13"]);
  // Inject at the HTTP boundary so faults reach the service worker's own I/O.
  const origin = page.url();
  const proxy = http.createServer(async (request, reply) => {
    const response = await fetch(new URL(request.url, origin));
    const headers = Object.fromEntries(response.headers);
    delete headers["content-length"];
    reply.writeHead(response.status, headers);
    if (request.url !== "/rex/sw.js") { reply.end(Buffer.from(await response.arrayBuffer())); return; }
    reply.end(`
      let deniedWrites = 0, failEngine = false;
      const networkFetch = self.fetch.bind(self);
      self.fetch = request => failEngine && new URL(request.url || request).pathname.endsWith('/engine/luatex.wasm')
        ? Promise.reject(new TypeError('Load failed')) : networkFetch(request);
      Cache.prototype.put = async () => { deniedWrites++; throw new DOMException('Storage full', 'QuotaExceededError'); };
      self.addEventListener('message', event => {
        if (event.data === 'fail-engine') failEngine = true;
        event.ports[0].postMessage(deniedWrites);
      });
      ${await response.text()}`);
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const mobile = await restricted.newPage();
    mobile.setDefaultTimeout(120000);
    await mobile.goto(`http://127.0.0.1:${proxy.address().port}/rex/`);
    await mobile.waitForFunction(() => window.rex?.session.layout || /failed|error/i.test(document.querySelector('#status')?.textContent), {}, {timeout: 120000});
    assert.ok(await mobile.evaluate(() => rex.session.layout?.pdf.length > 1000),
      "Cache quota failure blocked mobile startup: " + await mobile.locator("#status").textContent() + "\n" + await mobile.locator("#log").textContent());
    const denied = await mobile.evaluate(() => new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); };
      navigator.serviceWorker.controller.postMessage('cache-test', [channel.port2]);
    }));
    assert.ok(denied > 0, "The service worker must encounter actual denied cache writes");
    await mobile.evaluate(() => new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
      navigator.serviceWorker.controller.postMessage('fail-engine', [channel.port2]);
    }));
    await mobile.reload();
    await mobile.waitForFunction(() => /Compilation failed/.test(document.querySelector('#status')?.textContent));
    assert.match(await mobile.locator("#log").textContent(), /Failed to load engine resource .*\/rex\/vendor\/engine\/luatex\.wasm: TypeError: Load failed/,
      "Mobile fetch failures must identify the resource instead of only reporting Load failed");
  } finally {
    await restricted.close();
    await new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); });
  }
  await page.waitForFunction(() => rex.session.standbyReady);
  // WebKit's protocol offline emulation aborts navigation before the SW can
  // respond. Stop the origin instead to exercise actual cached responses.
  await stopHosting();
  await page.reload();
  await page.waitForFunction(() => window.rex?.session.warmed);
  await page.evaluate(() => rex.session.warmed);
  assert.equal(await page.evaluate(() => rex.session.live.closed), false,
    "Offline warming closed the live engine: " + await page.locator("#log").textContent());
  await replaceSource(page, await page.evaluate(() => rex.editor.state.doc.toString()).then(s => s.replace("Edit this paragraph", "Edit this offline paragraph")));
  await page.waitForFunction(() => window.rex?.session.lastTiming);
  await mkdir("artifacts/tests", {recursive: true});
  await page.screenshot({path: "artifacts/tests/webkit-mobile.png", fullPage: true});
  console.log("Mobile WebKit: /rex/ isolation, loading progress, cache quota failure, resource failure diagnostics, PDF export, offline reload and live editing passed.");
} catch (error) {
  console.error(await page.locator("#status").textContent());
  console.error(await page.locator("#log").textContent());
  throw error;
} finally {
  await close();
}
