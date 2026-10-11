import { chromium } from "playwright";
import assert from "node:assert/strict";
import { startServer } from "../../scripts/serve.mjs";

export async function openBrowser({ isolation = true, viewport, basePath = "/" } = {}) {
  // Tests own an ephemeral server and always exercise the publishable build.
  const server = await startServer({ isolation, basePath });
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.url);
    return {
      browser, page,
      close: async () => {
        try { await browser.close(); }
        finally { await server.close(); }
        assert.deepEqual(errors, [], "Uncaught browser errors");
      },
    };
  } catch (error) {
    try { await browser?.close(); }
    finally { await server.close(); }
    throw error;
  }
}
