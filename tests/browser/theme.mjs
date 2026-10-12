import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { openBrowser } from "../helpers/browser-helper.mjs";

for (const browserType of [chromium, webkit]) {
  const {page, close} = await openBrowser({browserType, basePath: "/rex/",
    viewport: {width: 1440, height: 1000}, contextOptions: {colorScheme: "dark"}});
  const theme = page.getByRole("combobox", {name: "Color theme"});
  const current = () => page.evaluate(() => document.documentElement.dataset.theme);
  try {
    assert.equal(await current(), "dark");
    assert.equal(await theme.inputValue(), "system");
    await page.emulateMedia({colorScheme: "light"});
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await theme.selectOption("dark");
    assert.equal(await current(), "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("rex-theme")), "dark");

    // The preference must be applied in the head, before the body is parsed.
    await page.addInitScript(() => {
      new MutationObserver((records, observer) => {
        if (document.body) {
          window.initialTheme = document.documentElement.dataset.theme;
          observer.disconnect();
        }
      }).observe(document, {childList: true, subtree: true});
    });
    await page.reload();
    assert.equal(await page.evaluate(() => window.initialTheme), "dark");
    assert.equal(await theme.inputValue(), "dark");
    await page.emulateMedia({colorScheme: "dark"});
    await theme.selectOption("light");
    assert.equal(await current(), "light");
    await page.reload();
    assert.equal(await current(), "light");
    await theme.selectOption("system");
    assert.equal(await current(), "dark");
    await page.emulateMedia({colorScheme: "light"});
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");

    // Exercise the actual document preview, then verify switching leaves its pixels alone.
    await page.waitForFunction(() => window.rex?.renderer.views.get(1)?.ready);
    const pixels = () => page.evaluate(() => rex.renderer.views.get(1).canvas.toDataURL());
    const before = await pixels();
    await theme.selectOption("dark");
    const styles = await page.evaluate(() => Object.fromEntries(
      ["header", "#editor", ".pane-bar", "#preview", "footer", ".page"].map(selector =>
        [selector, getComputedStyle(document.querySelector(selector)).backgroundColor])));
    for (const selector of ["header", "#editor", "footer"])
      assert.equal(styles[selector], "rgb(28, 35, 48)");
    assert.equal(styles[".pane-bar"], "rgb(32, 40, 54)");
    assert.equal(styles["#preview"], "rgb(18, 23, 32)");
    assert.equal(styles[".page"], "rgb(255, 255, 255)");
    assert.equal(await pixels(), before, "Theme switching must preserve PDF pixels");
    await mkdir("artifacts/tests", {recursive: true});
    await page.screenshot({path: `artifacts/tests/theme-${browserType.name()}.png`});
    await page.setViewportSize({width: 390, height: 844});
    assert.ok(await theme.isVisible());
    await theme.selectOption("light");
    assert.equal(await current(), "light");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // Storage restrictions must still permit theme changes.
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {get() { throw Error("Storage blocked"); }});
    });
    await page.reload();
    assert.equal(await current(), "light");
    await theme.selectOption("dark");
    assert.equal(await current(), "dark");
    console.log(`${browserType.name()}: system theme, saved preference, early startup, PDF colours, mobile and restricted storage passed.`);
  } finally {
    await close();
  }
}
