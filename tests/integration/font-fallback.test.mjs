import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import opentype from "opentype.js";
import { load } from "../helpers/runtime-helper.mjs";
import { coldPass } from "../../src/compiler/full-pass.js";
import { engine, run, liveDriver } from "../../src/compiler/runtime.js";
import { paragraphs, preamble } from "../../src/core/document.js";
import { wireDevices, mailbox, send, decodeFrame, encodeRequest } from "../../src/protocol/transport.js";
import { decodeDisplayList, equivalent } from "../../src/protocol/display-list.js";

function coverage(path) {
  const bytes = fs.readFileSync(new URL("../../vendor/engine/bundles/chinese/files/fonts/" + path, import.meta.url));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).tables.cmap.glyphIndexMap;
}

test("CJK fallback follows font coverage in headings, styles, sizes and resident edits", async () => {
  const base = coverage("opentype/public/fandol/FandolKai-Regular.otf");
  const candidates = [
    coverage("opentype/public/fandol/FandolSong-Regular.otf"),
    coverage("truetype/public/ipaex/ipaexm.ttf"),
    coverage("truetype/public/nanum/NanumMyeongjo-Regular.ttf"),
  ];
  // Select missing characters from actual cmaps; no document-specific codepoints.
  const missing = candidates.flatMap(map => Object.keys(map).map(Number)
    .filter(code => code >= 0x4e00 && code <= 0xd7af && map[code] && !base[code]).slice(0, 3));
  assert.ok(missing.length >= 7, "Fixture fonts must exercise several fallback candidates");
  const common = Object.keys(base).map(Number).find(code => code >= 0x4e00 && base[code]);
  const text = String.fromCodePoint(common, ...missing);
  const source = String.raw`\documentclass[fontset=fandol]{ctexart}
\setCJKmainfont{FandolKai-Regular.otf}[AutoFakeBold=2.5]
\setCJKsansfont{FandolKai-Regular.otf}
\setCJKmonofont{FandolKai-Regular.otf}
\begin{document}
\section{` + text + String.raw`}

` + text + String.raw`

\textbf{` + text + String.raw`}

\textit{` + text + String.raw`}

\textsf{` + text + String.raw`}

\texttt{` + text + String.raw`}

{\Large ` + text + String.raw`}

` + text.repeat(10) + String.raw`
\end{document}`;
  const res = await load();
  const result = await coldPass(res, {files: {"main.tex": source}, main: "main.tex"}, {}, {});
  assert.ok(!result.logs.some(line => /Missing character:|node filter.*error/.test(line)), result.logs.join("\n"));
  const glyphs = result.pages.flatMap(page => page.lines.flatMap(line => line.items
    .filter(item => item[0] === "g").map(item => ({char: item[2], font: page.fonts[item[1]]}))));
  for (const code of missing) {
    const matches = glyphs.filter(item => item.char === code);
    assert.ok(matches.length >= 7, "Fallback glyph disappeared from a heading/style/size: " + code);
    assert.ok(matches.every(item => !item.font.filename.includes("FandolKai")), "Missing glyph kept the primary font");
  }
  assert.ok(glyphs.filter(item => item.char === common).every(item => item.font.filename.includes("FandolKai")),
    "Available glyphs must retain their primary font");
  assert.ok(new Set(glyphs.filter(item => item.char === missing[0]).map(item => item.font.size)).size >= 2,
    "Fallback glyphs must follow the requested size");

  const units = result.capture.units, spans = paragraphs(source);
  assert.equal(units.length, spans.length);
  const requests = units.flatMap((unit, i) => [
    {op: "context", id: unit.uid, ctx: unit},
    {op: "compile", req: i + 1, ctx: unit.uid, source: spans[i].text},
  ]);
  requests.push({op: "shutdown"});
  const frames = [], box = mailbox(), logs = [];
  const live = await engine(res, {"live.tex": liveDriver(preamble(source))}, line => logs.push(line),
    {REX_REQ: "/rex-input", REX_RESP: "/rex-output"});
  wireDevices(live, box, bytes => {
    frames.push(decodeFrame(bytes));
    const next = requests.shift();
    if (next) send(box, encodeRequest(next));
  });
  assert.equal(run(live, "live.tex"), 0, logs.join("\n"));
  const results = frames.filter(frame => frame.header.op === "result");
  assert.equal(results.length, units.length, JSON.stringify(frames.map(frame => frame.header)));
  for (const [i, frame] of results.entries()) {
    assert.equal(frame.header.status, "ok");
    assert.ok(equivalent(decodeDisplayList(frame.binary), units[i], result.pages), "Fallback live geometry differs: " + i);
  }

  const absent = Array.from({length: 256}, (_, i) => 0x20000 + i)
    .find(code => !base[code] && candidates.every(map => !map[code]));
  assert.ok(absent, "Fixture fonts must leave an uncovered character");
  const unsupported = await coldPass(res, {files: {"main.tex": preamble(source) +
    "\\begin{document}" + String.fromCodePoint(absent) + "\\end{document}"}, main: "main.tex"}, {}, {});
  assert.ok(unsupported.logs.some(line => line.includes("Missing character:")),
    "Characters outside fallback coverage must retain a missing-glyph diagnostic");
  const hooked = await coldPass(res, {files: {"main.tex": source.replace("\\begin{document}",
    "\\AtBeginDocument{\\setbox0=\\hbox{" + text + "}}\n\\begin{document}")}, main: "main.tex"}, {}, {});
  assert.ok(!hooked.logs.some(line => line.includes("Missing character:")),
    "Fallback must also work in document-start hooks: " + hooked.logs.join("\n"));
});
