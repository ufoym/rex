import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { load } from "../helpers/runtime-helper.mjs";
import { engine, run, collect, liveDriver } from "../../src/compiler/runtime.js";
import { wireDevices, mailbox, send, decodeFrame, encodeRequest } from "../../src/protocol/transport.js";
import { decodeDisplayList, equivalent } from "../../src/protocol/display-list.js";
import { paragraphs, preamble } from "../../src/core/document.js";

test("Chinese classes and packages preserve glyphs, styles and resident paragraph geometry", async () => {
  const res = await load();
  const example = fs.readFileSync(new URL("../../examples/chinese.tex", import.meta.url), "utf8");
  for (const source of [example, example.replace("\\documentclass[fontset=fandol]{ctexart}",
    "\\documentclass{article}\n\\usepackage[fontset=fandol]{ctex}")]) {
    const logs = [];
    const M = await engine(res, {"main.tex": source, "capture.tex": "\\RequirePackage{rex-capture}\\input{main.tex}"}, line => logs.push(line));
    assert.equal(run(M, "capture.tex"), 0, logs.join("\n"));
    assert.ok(!logs.some(line => line.includes("Missing character:")), logs.join("\n"));
    const layout = collect(M);
    assert.equal(new TextDecoder().decode(layout.pdf.slice(0, 4)), "%PDF");
    const glyphs = layout.pages.flatMap(page => page.lines.flatMap(line => line.items.filter(item => item[0] === "g")));
    assert.ok(glyphs.some(item => item[2] === "中".codePointAt(0)), "Chinese glyph disappeared");
    for (const face of ["FandolSong-Regular", "FandolSong-Bold", "FandolHei-Regular", "FandolKai-Regular", "FandolFang-Regular"])
      assert.ok(Object.keys(layout.fonts).some(name => name.includes(face)), "Missing face: " + face);
    const units = layout.capture.units;
    const spans = paragraphs(source);
    assert.equal(units.length, spans.length);
    const requests = units.flatMap((unit, i) => [
      {op: "context", id: unit.uid, ctx: unit},
      {op: "compile", req: i + 1, ctx: unit.uid, source: spans[i].text},
    ]);
    requests.push({op: "shutdown"});
    const frames = [], box = mailbox();
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
    for (const [i, result] of results.entries()) {
      assert.equal(result.header.status, "ok");
      assert.ok(equivalent(decodeDisplayList(result.binary), units[i], layout.pages), "Chinese live geometry differs: " + i);
    }
  }
});
