import assert from "node:assert/strict";
import {mkdir, readFile} from "node:fs/promises";
import {openBrowser} from "../helpers/browser-helper.mjs";
import {project, encodeProject, decodeProject} from "../../src/core/project.js";

const {page, close} = await openBrowser({viewport: {width: 1440, height: 1000}});
const mod = process.platform === "darwin" ? "Meta" : "Control";
const main = String.raw`\documentclass{article}
\begin{document}
Alpha paragraph with ordinary words.

\newpage
\input{chapters/body}
\end{document}`;
const child = "Beta paragraph on the second page.\n";
const doc = () => page.evaluate(() => rex.editor.state.doc.toString());
const ready = () => page.waitForFunction(() => rex.session.layout?.revision === rex.session.revision && !rex.session.busy && /full compilation/.test(document.querySelector("#status").textContent));
try {
  await page.waitForFunction(() => window.rex?.editor);
  assert.equal(await page.locator("#benchmark").isVisible(), false);
  await page.locator("#open-menu > summary").click();
  assert.match(await page.locator("#choose-files").textContent(), /\.rex/);
  assert.match(await page.locator("#choose-folder").textContent(), /subfolders/);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#open-menu").getAttribute("open"), null);
  assert.equal(await page.locator("#open-menu > summary").evaluate(el => el === document.activeElement), true);
  await page.setInputFiles("#open", {name: "navigation.rex", mimeType: "application/octet-stream",
    buffer: Buffer.from(encodeProject(project({"main.tex": main, "chapters/body.tex": child}, "main.tex")))});
  await ready();
  assert.equal(await doc(), main);
  assert.ok(await page.locator(".cm-lineNumbers").count());
  assert.ok(await page.locator(".cm-content span").count(), "LaTeX syntax has no highlighting");
  await page.click("#search");
  assert.ok(await page.getByRole("textbox", {name: "Find", exact: true}).isVisible());
  await page.getByRole("textbox", {name: "Find", exact: true}).pressSequentially("Alpha");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".cm-search").count(), 0);
  assert.equal(await page.evaluate(() => rex.editor.state.sliceDoc(rex.editor.state.selection.main.from, rex.editor.state.selection.main.to)), "Alpha");
  await page.evaluate(() => rex.editor.dispatch({selection: {anchor: rex.editor.state.doc.toString().indexOf("Alpha")}}));
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Tab");
  assert.ok((await doc()).includes("  Alpha"));
  await page.keyboard.press("Shift+Tab");
  assert.equal(await doc(), main);
  await page.keyboard.insertText("Edited ");
  const edited = await doc();
  assert.ok(edited.includes("Edited Alpha"));
  await page.selectOption("#filename", "chapters/body.tex");
  await page.selectOption("#filename", "main.tex");
  await page.locator(".cm-content").focus();
  await page.keyboard.press(`${mod}+z`);
  assert.equal(await doc(), main, "Switching files lost undo history");
  await page.keyboard.press(`${mod}+Shift+z`);
  assert.equal(await doc(), edited);
  await ready();
  await page.waitForFunction(() => document.querySelector("#storage-status").textContent === "Saved in this browser");
  await page.selectOption("#filename", "chapters/body.tex");
  await page.evaluate(() => {
    rex.editor.dispatch({selection: {anchor: 2}});
    document.querySelector("#preview").scrollTo(0, 0);
  });
  await page.click("#locate");
  assert.equal(await page.locator(".source-marker").count(), 1);
  assert.ok(await page.locator("#clear-location").isVisible());
  assert.ok(await page.locator("#preview").evaluate(el => el.scrollTop > 0));
  await page.click("#clear-location");
  assert.equal(await page.locator(".source-marker").count(), 0);
  assert.equal(await page.locator("#preview").evaluate(el => el.scrollTop), 0);
  await page.locator(".cm-content").focus();
  await page.keyboard.press(`${mod}+Alt+j`);
  assert.equal(await page.locator(".source-marker").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".source-marker").count(), 0);
  await page.locator("#download-menu > summary").click();
  const download = page.waitForEvent("download");
  await page.click("#save-project");
  const archive = decodeProject(new Uint8Array(await readFile(await (await download).path())));
  assert.equal(archive.files["main.tex"], edited);
  assert.equal(archive.active, "chapters/body.tex");
  await page.locator("#tools-menu > summary").click();
  await page.click("#benchmark");
  await page.waitForFunction(() => !document.querySelector("#benchmark").disabled);
  assert.equal(await page.evaluate(() => rex.benchmark.samples), 300);
  assert.match(await page.locator("#benchmark-result").textContent(), /Typical.*95%/);
  assert.equal(await page.locator(".cm-content").getAttribute("contenteditable"), "true");
  await page.click("#toggle-log");
  assert.equal(await page.locator("#toggle-log").getAttribute("aria-expanded"), "true");
  assert.ok(await page.locator("#log").isVisible());
  await page.locator("#tools-menu > summary").click();
  await page.click("#toggle-log");
  await page.selectOption("#filename", "main.tex");
  await mkdir("artifacts/tests", {recursive: true});
  await page.screenshot({path: "artifacts/tests/workspace-light.png"});
  await page.click("#theme");
  await page.screenshot({path: "artifacts/tests/workspace-dark.png"});
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({width, height: 844});
    await page.waitForFunction(() => {
      const preview = document.querySelector("#preview");
      return preview.scrollWidth <= preview.clientWidth + 1;
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator("#choose-folder").count(), "Folder import must remain available on mobile");
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: "artifacts/tests/workspace-mobile.png"});
  await page.reload();
  await ready();
  assert.equal(await doc(), edited);
  console.log("Workspace menus, highlighted editor, search, indent, file undo, navigation restore, downloads, diagnostics, autosave and responsive pages passed.");
} finally { await close(); }
