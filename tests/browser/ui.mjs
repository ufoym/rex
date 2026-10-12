import assert from "node:assert/strict";
import {mkdir, readFile} from "node:fs/promises";
import {openBrowser} from "../helpers/browser-helper.mjs";
import {project, encodeProject, decodeProject} from "../../src/core/project.js";
import {starterDocument} from "../../src/core/starter.js";

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
  assert.equal(await doc(), starterDocument);
  assert.equal(await page.locator("#benchmark").isVisible(), false);
  await page.locator("#open-menu > summary").click();
  assert.match(await page.locator("#choose-files").textContent(), /\.rex/);
  assert.match(await page.locator("#choose-files").textContent(), /^File…/);
  assert.equal(await page.locator("#restore-project").isChecked(), false);
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
  assert.equal(await page.locator("#auto-locate").isChecked(), true);
  const navigationRevision = await page.evaluate(() => {
    rex.navigationCalls = 0;
    rex.navigationCompilations = 0;
    const full = rex.session.full.bind(rex.session);
    rex.session.full = () => { rex.navigationCompilations++; return full(); };
    const locate = rex.renderer.locate.bind(rex.renderer);
    rex.renderer.locate = unit => { rex.navigationCalls++; return locate(unit); };
    rex.editor.dispatch({selection: {anchor: rex.editor.state.doc.toString().indexOf("Alpha")}});
    return rex.session.revision;
  });
  await page.waitForFunction(() => document.querySelector(".source-marker"));
  await page.evaluate(() => {
    rex.navigationMarker = document.querySelector(".source-marker");
    const start = rex.editor.state.doc.toString().indexOf("Alpha");
    for (let i = 0; i < 30; i++) rex.editor.dispatch({selection: {anchor: start + i % 20}});
  });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => rex.navigationCalls), 1, "Cursor movement within a paragraph must not redraw or scroll");
  assert.equal(await page.evaluate(() => rex.navigationMarker === document.querySelector(".source-marker")), true);
  assert.equal(await page.evaluate(() => rex.session.revision), navigationRevision);
  assert.equal(await page.evaluate(() => rex.navigationCompilations), 0, "Navigation must reuse the existing layout without compilation");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".source-marker").count(), 0, "Escape must suspend automatic navigation");
  const compilationStatus = await page.locator("#status").textContent();
  await page.evaluate(() => rex.editor.dispatch({selection: {anchor: 0}}));
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".source-marker").count(), 0);
  assert.equal(await page.locator("#status").textContent(), compilationStatus, "Unmapped source must not overwrite compilation status");
  await page.evaluate(() => rex.editor.dispatch({selection: {anchor: rex.editor.state.doc.toString().indexOf("Alpha")}}));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".source-marker").count(), 0, "Escape must cancel pending navigation");
  await page.locator("#help-menu > summary").click();
  await page.locator("#auto-locate").uncheck();
  await page.keyboard.press("Escape");
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
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".source-marker").count(), 0, "Disabled automatic navigation must leave the preview alone");
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
    await page.locator("#open-menu > summary").click();
    assert.ok(await page.locator("#open-menu .menu-panel").evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth;
    }), "Open and Recent must fit within the viewport");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: "artifacts/tests/workspace-mobile.png"});
  await page.reload();
  await ready();
  assert.equal(await doc(), starterDocument, "Startup should show the example by default");
  assert.equal(await page.locator("#auto-locate").isChecked(), false, "Automatic navigation preference must survive reload");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {configurable: true, value: true});
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  await page.locator("#open-menu > summary").click();
  await page.locator("#recent-projects button").filter({hasText: "navigation.rex"}).waitFor();
  await page.screenshot({path: "artifacts/tests/workspace-recent-mobile.png"});
  await page.locator("#recent-projects button").filter({hasText: "navigation.rex"}).click();
  await page.waitForFunction(edited => rex.editor.state.doc.toString() === edited, edited);
  await ready();
  assert.equal(await doc(), edited);
  await page.locator("#help-menu > summary").click();
  await page.screenshot({path: "artifacts/tests/workspace-startup-settings-mobile.png"});
  await page.locator("#restore-project").check();
  await page.locator("#auto-locate").check();
  await page.reload();
  await ready();
  assert.equal(await doc(), edited);
  assert.equal(await page.locator("#auto-locate").isChecked(), true);
  await page.selectOption("#filename", "chapters/body.tex");
  await page.waitForFunction(() => document.querySelector('.page[data-page="2"] .source-marker'));
  await page.locator(".cm-content").focus();
  await page.keyboard.insertText("Updated ");
  await ready();
  await page.waitForFunction(() => document.querySelector('.page[data-page="2"] .source-marker'));
  await page.selectOption("#filename", "main.tex");
  await page.setInputFiles("#open", {name: "second.tex", mimeType: "text/plain", buffer: Buffer.from(main.replace("Alpha", "Second").replace("\\input{chapters/body}", "Another page."))});
  await page.waitForFunction(async () => (await (await import('./assets/core/project.js')).loadProject())?.name === "second.tex");
  await page.locator("#open-menu > summary").click();
  await page.waitForFunction(() => document.querySelectorAll("#recent-projects button").length === 2);
  await page.locator("#recent-projects button").filter({hasText: "navigation.rex"}).click();
  await page.waitForFunction(edited => rex.editor.state.doc.toString() === edited, edited);
  await ready();
  assert.equal(await doc(), edited, "Opening another file must preserve the previous recent project");
  const storage = await page.evaluate(async () => {
    const {project, saveProject, loadProject, loadRecentProjects} = await import('./assets/core/project.js');
    const draft = project({"main.tex": "\\documentclass{article}", "image.png": new Uint8Array([0, 128, 255])}, "main.tex");
    // Seed the previous single-project format, which has no recent ID.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("rex", 1);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction("projects", "readwrite"), object = transaction.objectStore("projects");
        object.clear(); object.put(draft, "current");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
    await saveProject({...draft, id: "new", name: "book.rex"});
    const migrated = await loadRecentProjects();
    for (let i = 0; i < 11; i++) await saveProject({...draft, id: `project-${i}`, name: "book.rex"});
    await saveProject({...draft, id: "project-10", name: "book.rex", files: {...draft.files, "main.tex": "Updated unfinished draft"}});
    const recent = await loadRecentProjects(), current = await loadProject();
    return {migrated: migrated.map(p => p.id), count: recent.length, ids: recent.map(p => p.id),
      current: current.id, source: current.files["main.tex"], image: [...current.files["image.png"]]};
  });
  assert.deepEqual(storage.migrated, ["new", "legacy"]);
  assert.equal(storage.count, 10);
  assert.equal(new Set(storage.ids).size, 10);
  assert.ok(storage.ids.includes("project-10"));
  assert.equal(storage.current, "project-10");
  assert.equal(storage.source, "Updated unfinished draft");
  assert.deepEqual(storage.image, [0, 128, 255]);
  console.log("Workspace menus, highlighted editor, search, indent, file undo, navigation restore, downloads, diagnostics, autosave and responsive pages passed.");
} finally { await close(); }
