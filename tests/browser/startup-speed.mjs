import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium, webkit} from "playwright";

const results = [];
for (const browserType of [chromium, webkit]) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext();
    await context.route(/^https?:\/\//, route => route.abort("internetdisconnected"));
    if (browserType === chromium) await context.setOffline(true);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.startupMilestones = {};
      const timer = setInterval(() => {
        const editor = window.rex?.editor, session = window.rex?.session;
        if (editor?.state.doc.length && !startupMilestones.editor) startupMilestones.editor = performance.now();
        if (window.rex?.renderer.views.get(1)?.ready && !startupMilestones.preview) startupMilestones.preview = performance.now();
        if (session?.warmed && !startupMilestones.warming) {
          startupMilestones.warming = performance.now();
          session.warmed.then(() => { startupMilestones.ready = performance.now(); clearInterval(timer); });
        }
      }, 10);
    });
    await page.goto(process.env.REX_LOCAL_DIST
      ? pathToFileURL(path.resolve(process.env.REX_LOCAL_DIST, "index.html")).href
      : new URL("../../dist/index.html", import.meta.url).href);
    await page.waitForFunction(() => window.rex?.editor.state.doc.length, {}, {timeout: 15000});
    assert.equal(await page.evaluate(() => !!rex.session.layout), false, "Editor must be usable while the compiler starts");
    // Editing before the compiler is ready must survive startup and reach the PDF.
    await page.evaluate(() => {
      const editor = rex.editor, text = editor.state.doc.toString(), from = text.indexOf("Edit this paragraph");
      if (from < 0) throw Error("Missing starter text");
      editor.dispatch({changes: {from, to: from + "Edit this paragraph".length, insert: "Edit this first paragraph"}});
    });
    await page.waitForFunction(() => startupMilestones.ready, {}, {timeout: 120000});
    const result = await page.evaluate(async () => {
      const session = rex.session;
      const text = (await (await rex.renderer.pdf.getPage(1)).getTextContent()).items.map(item => item.str).join("");
      const before = session.lastTiming;
      await session.edit(session.source.replace("Edit this first paragraph", "Edit this fluent paragraph"));
      clearTimeout(session.timer);
      if (session.lastTiming === before) throw Error("First edit after startup did not paint live");
      return {...startupMilestones, text, paint: session.lastTiming.paint};
    });
    assert.ok(result.text.includes("Edit this first paragraph"), "Startup lost an early edit");
    // A relative budget remains meaningful on slower CI CPUs; absolute timings
    // are recorded in the report for before/after measurements on one machine.
    assert.ok(result.editor < result.preview / 10, `${browserType.name()}: compiler loading delayed the editor: ${JSON.stringify(result)}`);
    assert.ok(result.paint < 100, "First paragraph was not warmed");
    delete result.text;
    results.push({browser: browserType.name(), ...result});
    console.log(browserType.name(), "local startup (ms)", result);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
await fs.mkdir("artifacts/tests", {recursive: true});
await fs.writeFile("artifacts/tests/startup-speed.json", JSON.stringify(results, null, 2) + "\n");
