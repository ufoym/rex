import { chromium } from "playwright";
import assert from "node:assert/strict";
import { startServer } from "../../scripts/serve.mjs";

export async function replaceSource(page, text) {
  // CodeMirror owns its selection; use its select-all command rather than a DOM fill.
  const mod = await page.evaluate(() => /Mac|iP(hone|ad|od)/.test(navigator.platform) ? "Meta" : "Control");
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText(text);
}

export async function openBrowser({ isolation = true, viewport, basePath = "/", browserType = chromium, contextOptions = {} } = {}) {
  // Tests own an ephemeral server and always exercise the publishable build.
  const server = await startServer({ isolation, basePath });
  let browser, hosting = true;
  try {
    browser = await browserType.launch();
    const page = await browser.newPage({...contextOptions, ...(viewport ? {viewport} : {})});
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url);
    return {
      browser, page,
      stopHosting: async () => { await server.close(); hosting = false; },
      close: async () => {
        try { await browser.close(); }
        finally { if (hosting) await server.close(); }
        assert.deepEqual(errors, [], "Uncaught browser errors");
      },
    };
  } catch (error) {
    try { await browser?.close(); }
    finally { if (hosting) await server.close(); }
    throw error;
  }
}
