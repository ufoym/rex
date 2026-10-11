import { openBrowser } from "../helpers/browser-helper.mjs";
import assert from "node:assert/strict";
const {page, close} = await openBrowser({isolation: false});
try {
  const context = page.context();
  await page.waitForFunction(
    () => window.rex?.session.warmed,
    {},
    { timeout: 120000 },
  );
  await page.evaluate(() => rex.session.warmed);
  assert.ok(await page.evaluate(() => crossOriginIsolated));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => window.rex?.session.warmed,
    {},
    { timeout: 120000 },
  );
  await page.evaluate(() => rex.session.warmed);
  assert.ok(await page.evaluate(() => rex.session.layout.pdf.length > 1000));
  await page.evaluate(async () => {
    await rex.session.edit(
      rex.session.source.replace(
        "Edit this paragraph",
        "Edit this offline paragraph",
      ),
    );
    clearTimeout(rex.session.timer);
  });
  assert.ok(await page.evaluate(() => rex.session.lastTiming));
  console.log(
    "Static host without COOP/COEP headers and offline WASM editing passed.",
  );
} finally {
  await close();
}
