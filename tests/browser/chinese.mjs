import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {openBrowser} from "../helpers/browser-helper.mjs";

const {page, close} = await openBrowser({basePath: "/rex/", viewport: {width: 1440, height: 1000}});
try {
  await page.waitForFunction(() => window.rex?.session.warmed);
  const source = await fs.readFile(new URL("../../examples/chinese.tex", import.meta.url), "utf8");
  await page.setInputFiles("#open", {name: "chinese.tex", mimeType: "text/plain", buffer: Buffer.from(source)});
  await page.waitForFunction(() => rex.session.source.includes("中文排版") && rex.session.warmed && !rex.session.busy);
  const compiled = await page.evaluate(async () => {
    const {session, renderer} = rex;
    const text = (await renderer.pdf.getPage(1).then(page => page.getTextContent())).items.map(item => item.str).join("");
    return {text, fonts: [...renderer.fonts.keys()], log: document.querySelector("#log").textContent};
  });
  assert.ok(compiled.text.includes("中文排版"), "PDF lacks Chinese text: " + compiled.text);
  assert.ok(compiled.fonts.some(name => name.includes("FandolSong-Regular")), "Canvas could not parse the Chinese font");
  assert.ok(!compiled.log.includes("Missing character:"), compiled.log);
  const live = await page.evaluate(async () => {
    const s = rex.session;
    await s.edit(s.source.replace("修改这段文字", "编辑这段文字"));
    clearTimeout(s.timer);
    rex.editor.dispatch({changes: {from: 0, to: rex.editor.state.doc.length, insert: s.source}});
    return {patches: rex.renderer.patches.size, paint: s.lastTiming?.paint, log: document.querySelector("#log").textContent};
  });
  assert.equal(live.patches, 1, "Chinese edit did not paint live: " + live.log);
  assert.ok(Number.isFinite(live.paint));
  // Exercise actual Canvas paths with a character not present in the original.
  assert.ok(await page.evaluate(() => [...rex.renderer.patches.values()].some(patch =>
    patch.dl.lines.some(line => line.items.some(item => item[0] === "g" && item[2] === "编".codePointAt(0))))));
  const warm = await page.evaluate(async () => {
    const s = rex.session, timings = [];
    for (let i = 0; i < 6; i++) {
      await s.edit(s.source.replace(i % 2 ? "编辑此段文字" : "编辑这段文字", i % 2 ? "编辑这段文字" : "编辑此段文字"));
      clearTimeout(s.timer);
      timings.push(s.lastTiming?.paint);
      if (rex.renderer.patches.size !== 1) throw Error("Repeated Chinese edit lost its live patch");
    }
    rex.editor.dispatch({changes: {from: 0, to: rex.editor.state.doc.length, insert: s.source}});
    return timings;
  });
  assert.ok(warm.every(Number.isFinite));
  console.log("Chinese paint timings (ms):", {first: live.paint, warm});
  await page.screenshot({path: "artifacts/tests/chinese.png", fullPage: true});
  await page.click("#compile");
  await page.waitForFunction(() => rex.session.layout?.revision === rex.session.revision && !rex.session.busy);
  const download = page.waitForEvent("download");
  await page.locator("#download-menu > summary").click();
  await page.click("#export");
  const pdf = await fs.readFile(await (await download).path());
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const exportedText = await page.evaluate(async bytes => {
    const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
    const doc = await pdfjs.getDocument({data: new Uint8Array(bytes)}).promise;
    try { return (await (await doc.getPage(1)).getTextContent()).items.map(item => item.str).join(""); }
    finally { await doc.destroy(); }
  }, [...pdf]);
  assert.ok(exportedText.includes("编辑这段文字"), "Exported Chinese edit disappeared");
  await page.waitForFunction(async () => {
    const {loadProject} = await import('./assets/core/project.js');
    const saved = await loadProject();
    return saved?.files[saved.main]?.includes("编辑这段文字");
  });
  await page.context().setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.rex?.session.warmed);
  assert.ok(await page.evaluate(() => rex.session.source.includes("编辑这段文字")), "Chinese project was not restored offline");
  console.log("Chinese import, PDF text, Canvas fonts, live glyphs, export and offline reload passed.");
} finally {
  await close();
}
