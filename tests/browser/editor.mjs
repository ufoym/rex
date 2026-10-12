import { openBrowser } from "../helpers/browser-helper.mjs";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { encodeProject, decodeProject, project } from "../../src/core/project.js";
import { PDFDocument, rgb } from "pdf-lib";
import opentype from "opentype.js";
const {browser, page, close} = await openBrowser({ viewport: { width: 1440, height: 1000 } });
const waitForStoredFile = (file, source, active) => page.evaluate(async ({file, source, active}) => {
  const {loadProject} = await import('./assets/core/project.js'), deadline = performance.now() + 10000;
  do {
    const saved = await loadProject();
    if (saved?.files[file] === source && saved.active === active) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
  throw Error('Project autosave did not complete');
}, {file, source, active});
try {
await page.waitForFunction(
  () => window.rex?.session.layout && window.rex.session.live,
  {},
  { timeout: 120000 },
);
await page.waitForFunction(() => Boolean(window.rex?.session.warmed), {}, {polling:100});
await page.evaluate(() => window.rex.session.warmed);
const starter = await page.evaluate(async () => {
  const texts = [];
  for (let n = 1; n <= rex.renderer.pdf.numPages; n++)
    texts.push((await (await rex.renderer.pdf.getPage(n)).getTextContent()).items.map(item => item.str).join(""));
  return {text: texts.join("\n"), log: document.querySelector("#log").textContent, fonts: [...rex.renderer.fonts.keys()]};
});
for (const text of ["你好", "こんにちは", "안녕하세요", "Hello", "Matrices and piecewise functions", "A TikZ diagram", "The TeXbook"])
  assert.ok(starter.text.includes(text), "Starter feature is missing from its PDF: " + text);
assert.ok(!starter.log.includes("Missing character:"), starter.log);
assert.ok(starter.fonts.some(name => name.includes("NanumMyeongjo-Regular")), "Korean font cannot be rendered on Canvas");
// Direct glyph matrices must retain the Canvas transform/clip and both font orientations.
assert.ok(await page.evaluate(async () => {
  const {Renderer} = await import('./assets/ui/renderer.js'), SP = 65536 * 72.27 / 96;
  const renderer = new Renderer(document.createElement('div'));
  const shape = new Path2D('M0 0 L600 0 L450 750 L0 600 Z');
  renderer.glyphPath = () => shape;
  renderer.fonts.set('test.otf', {unitsPerEm: 1000, glyphs: {get: () => ({})}});
  renderer.type1.set('test', {unitsPerEm: 1000, glyphs: {65: true}});
  for (const type1 of [false, true]) for (const dpr of [1, 2]) for (const slant of [0, 170]) {
    const canvases = [document.createElement('canvas'), document.createElement('canvas')];
    for (const canvas of canvases) {canvas.width = 240; canvas.height = 180;}
    const [actual, expected] = canvases.map(c => c.getContext('2d'));
    for (const ctx of [actual, expected]) {
      ctx.setTransform(dpr, .12, -.08, dpr, 7, 9);
      ctx.beginPath(); ctx.rect(0, 0, 90, 65); ctx.clip();
    }
    const f = {filename: type1 ? undefined : 'test.otf', name: 'test', size: 22 * SP, slant, extend: 1130};
    const base = actual.getTransform();
    const items = [['M', 'save', 0, 0, ''], ['M', 'set', 30 * SP, 20 * SP, '.96 .15 -.15 .96'],
      ['c', 0, 1, '1 0 0 rg'], ['g', 1, 65, 7, 35 * SP, 36 * SP, 10 * SP, 1200],
      ['c', 0, 2, ''], ['M', 'restore', 0, 0, ''], ['r', 62 * SP, 48 * SP, 15 * SP, 6 * SP]];
    renderer.drawItems(actual, items, {1: f}, 3, 4, {stacks: new Map(), color: '#000'});
    expected.save(); expected.translate(33, 24); expected.transform(.96, -.15, .15, .96, 0, 0); expected.translate(-33, -24);
    expected.fillStyle = 'red'; expected.save(); expected.translate(38, 40);
    expected.transform(1.0012 * 1.13, 0, -slant / 1000, 1, 0, 0);
    expected.scale(.022, type1 ? -.022 : .022); expected.fill(shape); expected.restore();
    expected.restore(); expected.fillStyle = '#000'; expected.fillRect(65, 52, 15, 6);
    if (JSON.stringify(actual.getTransform()) !== JSON.stringify(base)) return false;
    const a = actual.getImageData(0, 0, 240, 180).data, b = expected.getImageData(0, 0, 240, 180).data;
    if (a.some((byte, i) => byte !== b[i])) return false;
  }
  return true;
}), 'Glyph matrix changed pixels or leaked the Canvas transform');
console.log(
  "layout",
  await page.evaluate(() => ({
    status: document.querySelector("#status").textContent,
    units: rex.session.units.map(
      (u) => u && { uid: u.uid, line: u.begin_line, rows: u.rows },
    ),
    spans: rex.session.layoutSpans.map((s) => s.line),
  })),
);

await page.evaluate(async () => {
  const s = rex.session;
  const next = s.source.replace(
    "Edit this paragraph",
    "Edit this beautiful paragraph",
  );
  await s.edit(next);
  document.querySelector("#editor").value = next;
  clearTimeout(s.timer);
});
assert.ok(
  await page.evaluate(() => Number.isFinite(rex.session.lastTiming?.paint)),
  "First edit did not record a rendered update",
);
assert.equal(await page.evaluate(() => rex.renderer.patches.size), 1);
console.log(
  "edit",
  await page.evaluate(() => ({
    status: document.querySelector("#status").textContent,
    timing: rex.session.lastTiming,
  })),
);
await fs.mkdir("artifacts/tests", { recursive: true });
await page.screenshot({ path: "artifacts/tests/editor.png" });
await page.click("#benchmark");
await page.waitForFunction(
  () => !document.querySelector("#benchmark").disabled,
  {},
  { timeout: 120000 },
);
console.log("benchmark", await page.evaluate(() => rex.benchmark));
await fs.writeFile(
  "artifacts/tests/browser.json",
  JSON.stringify(
    await page.evaluate(() => ({
      benchmark: rex.benchmark,
      timing: rex.session.lastTiming,
      userAgent: navigator.userAgent,
    })),
    null,
    2,
  ),
);
// Math uses the original Type 1 outlines on the live path.
await page.evaluate(async () => {
  const s = rex.session;
  await s.edit(s.source.replace("E = mc^2", "E = mc^3"));
  clearTimeout(s.timer);
});
assert.equal(await page.evaluate(() => rex.renderer.patches.size), 2);
await page.screenshot({ path: "artifacts/tests/math.png" });
// OpenType path drawing must preserve TeX colour, including a span across rows.
await page.evaluate(async () => {
  const s = rex.session;
  await s.edit(
    s.source.replace(
      "This document is typeset entirely in your browser.",
      String.raw`{\color{red}This document is typeset entirely in your browser.}`,
    ),
  );
  clearTimeout(s.timer);
});
assert.ok(
  await page.evaluate(() => {
    const c = rex.renderer.views.get(1).canvas,
      d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i] > d[i + 1] + 40 && d[i] > d[i + 2] + 40) red++;
    return red > 50;
  }),
  "Colour path was drawn black",
);
// Many concurrent edits must paint only the final revision.
await page.evaluate(async () => {
  const s = rex.session,
    base = s.source;
  const edits = [];
  for (let i = 0; i < 10; i++)
    edits.push(
      s.edit(
        base.replace("entirely in your browser", "entirely in browser " + i),
      ),
    );
  await Promise.all(edits);
  clearTimeout(s.timer);
});
assert.ok(
  await page.evaluate(() =>
    rex.session.source.includes("entirely in browser 9"),
  ),
);
assert.equal(await page.evaluate(() => rex.renderer.patches.size), 2);
// Auxiliary state already converged: a text-only update needs one full pass.
const rev = await page.evaluate(() => {
  rex.session.full();
  return rex.session.revision;
});
await page.waitForFunction(
  (rev) => rex.session.layout.revision === rev && !rex.session.busy,
  rev,
  { timeout: 120000 },
);
assert.equal(await page.evaluate(() => rex.session.layout.passes), 1);
// Headings also keep their paragraph-server path.
await page.evaluate(async () => {
  const s = rex.session;
  await s.warmed;
  await s.edit(
    s.source.replace(
      "Write at the speed of thought",
      "Write at the speed of light",
    ),
  );
  clearTimeout(s.timer);
});
assert.equal(await page.evaluate(() => rex.renderer.patches.size), 1);
assert.ok(await page.evaluate(() => !rex.session.contextDirty));
// A preamble change immediately invalidates the previous live context.
await page.evaluate(async () => {
  const s = rex.session;
  await s.warmed;
  await s.edit(s.source.replace("11pt", "12pt"));
  clearTimeout(s.timer);
});
assert.ok(
  await page.evaluate(
    () => rex.session.contextDirty && rex.session.live.closed,
  ),
);
console.log(
  "Math, revision races, aux convergence and preamble invalidation passed.",
);
// Imported projects retain binary dependencies and editable child files across a reload.
const png = await page.evaluate(() => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2;
  canvas.getContext("2d").fillRect(0, 0, 2, 2);
  return [...Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), c => c.charCodeAt(0))];
});
const projectMain = String.raw`\documentclass{article}
\usepackage{graphicx}
\usepackage{makeidx}\makeindex
\begin{document}
\input{chapters/body}

\includegraphics[width=5pt]{images/pixel.png}
\printindex
\end{document}`;
const child = "A chapter with native text, $E=mc^2$, and a keyword.\\index{Alpha}\n";
const projectFiles = {"main.tex": projectMain, "chapters/body.tex": child, "images/pixel.png": new Uint8Array(png)};
await page.setInputFiles("#open", {name: "book.rex", mimeType: "application/octet-stream", buffer: Buffer.from(encodeProject(project(projectFiles, "main.tex", "chapters/body.tex")))});
await page.waitForFunction(() => {
  if (/failed|unavailable/i.test(document.querySelector("#status").textContent)) throw Error(document.querySelector("#log").textContent);
  return Boolean(rex.session.files["chapters/body.tex"] && rex.session.warmed);
}, {}, {timeout: 120000, polling: 100});
await page.evaluate(() => rex.session.warmed);
assert.equal(await page.inputValue("#filename"), "chapters/body.tex");
assert.ok(await page.evaluate(() => rex.session.layout.converged && rex.session.layout.indexRuns === 1), "Imported project's index did not converge");
const editedChild = child.replace("native text", "edited text");
await page.fill("#editor", editedChild);
await page.waitForFunction(() => rex.session.lastTiming && rex.renderer.patches.size > 0, {}, {timeout: 10000});
assert.equal(await page.evaluate(() => rex.session.source), projectMain);
assert.ok(await page.evaluate(() => [...rex.renderer.patches.values()].some(p => p.unit.file.endsWith("/chapters/body.tex"))), "Child file did not update live");
await page.evaluate(() => {clearTimeout(rex.session.timer); const editor = document.querySelector("#editor"); editor.setSelectionRange(2, 2);});
await page.click("#locate");
assert.equal(await page.locator(".source-marker").count(), 1);
await page.selectOption("#filename", "main.tex");
const click = await page.evaluate(() => {
  const unit = rex.session.layoutFiles["chapters/body.tex"].units.find(Boolean), place = unit.placements[0];
  const rect = rex.renderer.views.get(place.page).host.getBoundingClientRect(), sp = 65536 * 72.27 / 96;
  return {x: rect.left + (place.x + 65536) / sp, y: rect.top + (place.y - place.h / 2) / sp};
});
await page.mouse.dblclick(click.x, click.y);
assert.equal(await page.inputValue("#filename"), "chapters/body.tex");
await waitForStoredFile('chapters/body.tex', editedChild, 'chapters/body.tex');
const download = page.waitForEvent("download"); await page.click("#save-project");
const exported = decodeProject(new Uint8Array(await fs.readFile(await (await download).path())));
assert.equal(exported.files["chapters/body.tex"], editedChild); assert.deepEqual(exported.files["images/pixel.png"], new Uint8Array(png));
await page.reload();
await page.waitForFunction(() => Boolean(window.rex?.session.warmed), {}, {timeout: 120000, polling:100}); await page.evaluate(() => rex.session.warmed);
assert.equal(await page.inputValue("#editor"), editedChild);
assert.deepEqual(await page.evaluate(() => [...rex.session.files["images/pixel.png"]]), png);
assert.ok(await page.evaluate(() => rex.session.layout.converged));
// Autosave keeps incomplete source during edits, including drafts that cannot compile.
await page.selectOption("#filename", "main.tex");
const draft = projectMain.replace("\\begin{document}", "");
await page.fill("#editor", draft);
await waitForStoredFile('main.tex', draft, 'main.tex');
await page.reload();
await page.waitForFunction(draft => document.querySelector('#editor').value === draft && /failed/.test(document.querySelector('#status').textContent), draft, {polling:100});
assert.deepEqual(await page.evaluate(() => [...rex.session.files['images/pixel.png']]), png);
await page.fill('#editor', projectMain);
await page.waitForFunction(() => rex.session.layout?.revision === rex.session.revision && rex.session.layout.converged, {}, {polling:100});
console.log("Project persistence, incomplete drafts, portable export, child-file live edits, index generation and bidirectional paragraph navigation passed.");
// Exercise new preview paths before the idle full pass can settle their layout.
const imagePdf = await PDFDocument.create();
imagePdf.addPage([40, 25]).drawRectangle({x: 0, y: 0, width: 20, height: 25, color: rgb(1, 0, 0)});
imagePdf.addPage([40, 25]).drawRectangle({x: 0, y: 0, width: 40, height: 25, color: rgb(0, 1, 0)});
const bitmaps = await page.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
  const ctx = canvas.getContext('2d'), bytes = type => [...Uint8Array.from(atob(canvas.toDataURL(type).split(',')[1]), c => c.charCodeAt(0))];
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 32, 24); const png = bytes('image/png');
  ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 0, 32, 24); return {png, jpg: bytes('image/jpeg')};
});
const liveSource = String.raw`\documentclass{article}
\usepackage{graphicx}\usepackage{booktabs}\usepackage{amsmath}
\begin{document}
First paragraph with ordinary words.

Second paragraph with ordinary words.

\begin{table}\centering\begin{tabular}{ll}\toprule One & Two\\\midrule A & B\\\bottomrule\end{tabular}\caption{Sample}\end{table}

\includegraphics[width=24pt]{red.png}

\includegraphics[width=24pt,angle=15]{drawing.pdf}

\begin{equation}a^2+b^2=c^2\label{pythagoras}\end{equation}

\begin{align}a&=b+1\\c&=d+2\end{align}

Text with a footnote\footnote{Body at the bottom of the page.} and more words.
\end{document}`;
await page.evaluate(({source, pdf, bitmaps}) => rex.session.setFiles({'main.tex': source, 'drawing.pdf': new Uint8Array(pdf),
  'red.png': new Uint8Array(bitmaps.png), 'blue.jpg': new Uint8Array(bitmaps.jpg)}), {source: liveSource, pdf: [...await imagePdf.save()], bitmaps});
await page.waitForFunction(() => {
  if (/failed|unavailable/i.test(document.querySelector('#status').textContent)) throw Error(document.querySelector('#log').textContent);
  return Boolean(rex.session.warmed);
}, {}, {polling:100}); await page.evaluate(() => rex.session.warmed);
const liveEdit = async (from, to) => {
  const result = await page.evaluate(async ({from, to}) => {
    const s = rex.session, generation = s.generation, previous = s.lastTiming;
    const promise = s.edit(s.source.replace(from, to)); clearTimeout(s.timer); await promise;
    return {painted: s.lastTiming !== previous, sameEngine: generation === s.generation,
      status: document.querySelector('#status').textContent, log: document.querySelector('#log').textContent.slice(-1500),
      patches: [...rex.renderer.patches.values()].map(p => ({uid: p.unit.uid, origins: p.unit.origins, old: p.unit.placements.length, rows: p.placements.length, images: p.dl.images, inserts: p.dl.inserts}))};
  }, {from, to});
  assert.ok(result.painted && result.sameEngine, JSON.stringify(result)); return result;
};
const longParagraph = 'First paragraph ' + 'with many extra ordinary words to exercise line breaking. '.repeat(8);
let update = await liveEdit('First paragraph with ordinary words.', longParagraph);
assert.ok(update.patches.some(p => p.rows > p.old)); assert.match(update.status, /provisional/);
await liveEdit('extra ordinary words', 'extra\n\nordinary words');
update = await liveEdit(`${longParagraph.replace('extra ordinary words', 'extra\n\nordinary words')}\n\nSecond paragraph`, `${longParagraph.replace('extra ordinary words', 'extra\n\nordinary words')} Second paragraph`);
assert.ok(update.patches.some(p => p.origins.length === 2));
await liveEdit('Second paragraph', 'Second edited paragraph');
await liveEdit('One & Two', 'Three & Four');
await liveEdit('red.png', 'blue.jpg');
assert.ok(await page.evaluate(() => {
  const patch = [...rex.renderer.patches.values()].find(p => p.dl.images && Object.values(p.dl.images_info).some(info => info.file.endsWith('blue.jpg')));
  const place = patch.placements[0], canvas = rex.renderer.views.get(place.page).canvas, ctx = canvas.getContext('2d');
  const sp = 65536 * 72.27 / 96, dpr = devicePixelRatio || 1, top = Math.max(0, Math.floor((place.y - place.h - 65536) / sp * dpr));
  const pixels = ctx.getImageData(0, top, canvas.width, Math.ceil((place.h + place.d + 131072) / sp * dpr)).data;
  let blue = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > pixels[i] + 100 && pixels[i + 2] > pixels[i + 1] + 100) blue++;
  return blue > 100;
}), 'Changed JPEG did not paint its blue pixels');
await liveEdit('width=24pt,angle=15', 'width=30pt,angle=35');
await liveEdit('width=30pt,angle=35', 'width=30pt,angle=35,page=2');
assert.ok(await page.evaluate(() => {
  const patch = [...rex.renderer.patches.values()].find(p => Object.values(p.dl.images_info).some(info => info.file.endsWith('drawing.pdf')));
  const place = patch.placements[0], canvas = rex.renderer.views.get(place.page).canvas, sp = 65536 * 72.27 / 96;
  const pixels = canvas.getContext('2d').getImageData(0, Math.max(0, Math.floor((place.y - place.h - 65536) / sp)), canvas.width, Math.ceil((place.h + place.d + 131072) / sp)).data;
  let green = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > pixels[i] + 100 && pixels[i + 1] > pixels[i + 2] + 100) green++;
  return green > 100 && Object.values(patch.dl.images_info)[0].page === 2;
}), 'Selected PDF page did not paint its green pixels');
await liveEdit('a^2+b^2=c^2', 'a^3+b^3=c^3');
await liveEdit('c&=d+2', 'c&=d+3');
await liveEdit('and more words.', 'and changed words.');
assert.ok(await page.evaluate(() => [...rex.renderer.patches.values()].some(p => p.dl.inserts === 1)));
await page.screenshot({path: 'artifacts/tests/live-content.png'});
console.log('Paragraph growth, repeated splits / merges, tables, transformed images, numbered / aligned equations and footnote markers painted without a full pass.');
// Reset a busy compiler repeatedly; only the final project's layout may be published.
const switchId = await page.evaluate(source => {
  const s = rex.session, files = {...s.files};
  for (const text of ['Abandoned project.', 'Another abandoned project.', 'Final project.'])
    s.setFiles({...files, 'main.tex': source.replace('First paragraph with ordinary words.', text)});
  return s.projectId;
}, liveSource);
await page.waitForFunction(id => {
  if (/failed|unavailable/i.test(document.querySelector('#status').textContent)) throw Error(document.querySelector('#log').textContent);
  return rex.session.layout?.projectId === id && Boolean(rex.session.warmed);
}, switchId, {polling:100});
await page.evaluate(() => rex.session.warmed);
assert.equal(await page.evaluate(() => rex.session.layout.projectId), switchId);
await liveEdit('Final project.', 'Final edited project.');
console.log('Project switches during active compilation keep only the final project and retain live editing.');
const overflow = String.raw`\mbox{${'W'.repeat(90)}}`;
await liveEdit('Final edited project.', overflow);
const overflowPixels = () => page.evaluate(() => {
  const place = rex.session.units.find(Boolean).placements[0], view = rex.renderer.views.get(place.page), sp = 65536 * 72.27 / 96;
  const x = Math.floor((place.x + place.w + 5 * 65536) / sp), y = Math.floor((place.y - place.h - 65536) / sp);
  const pixels = view.canvas.getContext('2d').getImageData(x, y, 40, Math.ceil((place.h + place.d + 2 * 65536) / sp)).data;
  let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 200) ink++;
  return ink;
});
assert.ok(await overflowPixels() > 20, 'Overfull glyphs were clipped to the line box');
await liveEdit(overflow, 'Final edited project.');
assert.equal(await overflowPixels(), 0, 'Shrinking an overfull line left stale glyphs');
// A replacement local font must draw its new outlines even when the path and metrics match.
const localFont = triangle => {
  const path = new opentype.Path(); path.moveTo(0, 0); path.lineTo(600, 0);
  path.lineTo(triangle ? 0 : 600, 700); path.lineTo(0, 700); path.close();
  return [...new Uint8Array(new opentype.Font({familyName: 'Local Test', styleName: 'Regular', unitsPerEm: 1000,
    ascender: 800, descender: -200, glyphs: [new opentype.Glyph({name: '.notdef', advanceWidth: 600}),
      new opentype.Glyph({name: 'A', unicode: 65, advanceWidth: 600, path})]}).toArrayBuffer())];
};
const replacedFont = await page.evaluate(async fonts => {
  const {Renderer} = await import('./assets/ui/renderer.js'), renderer = new Renderer(document.createElement('div'));
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
  const ctx = canvas.getContext('2d'), filename = '/work/fonts/local.otf', sp = 65536 * 72.27 / 96;
  return fonts.map((bytes, index) => {
    renderer.addFonts({[filename]: new Uint8Array(bytes)});
    if (index === 2) return null;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 100, 100);
    renderer.drawItems(ctx, [['g', 1, 65, 1, 10 * sp, 30 * sp, 600, 0]], {1: {filename, size: 12 * 65536}}, 0, 0, {color: '#000'});
    const pixels = ctx.getImageData(0, 0, 100, 100).data;
    let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 150) ink++;
    return ink;
  });
}, [localFont(false), localFont(true), [1, 2, 3], localFont(true)]);
assert.ok(replacedFont[1] < replacedFont[0] * .75, 'Replacing a local font reused stale cached outlines');
assert.equal(replacedFont[3], replacedFont[1], 'A rejected font prevented restoring valid outlines');
// A failed project switch must leave the previous PDF safe to redraw after assets close.
await liveEdit('red.png', 'blue.jpg');
await page.evaluate(() => rex.session.setFiles({'main.tex': String.raw`\documentclass{article}`}));
await page.waitForFunction(() => /Compilation failed/.test(document.querySelector('#status').textContent), {}, {polling:100});
await page.evaluate(() => rex.renderer.repaint(1));
} catch (error) {
  console.error(await page.evaluate(() => ({url:location.href,status:document.querySelector('#status')?.textContent, log:document.querySelector('#log')?.textContent.slice(-5000), busy:window.rex?.session.busy, revision:window.rex?.session.revision, layout:window.rex?.session.layout?.revision, files:Object.keys(window.rex?.session.files || {})})).catch(error => String(error)));
  throw error;
} finally { await close(); }
