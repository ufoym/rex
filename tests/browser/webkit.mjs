import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { webkit, devices } from "playwright";
import { openBrowser, replaceSource } from "../helpers/browser-helper.mjs";

const {page, close, stopHosting} = await openBrowser({isolation: false, basePath: "/rex/",
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
  console.log("Mobile WebKit: /rex/ isolation, loading progress, PDF export, offline reload and live editing passed.");
} catch (error) {
  console.error(await page.locator("#status").textContent());
  console.error(await page.locator("#log").textContent());
  throw error;
} finally {
  await close();
}
