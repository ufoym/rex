import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { load } from "../helpers/runtime-helper.mjs";
import {
  engine,
  run,
  collect,
  liveDriver,
} from "../../src/compiler/runtime.js";
import { decodeDisplayList, equivalent } from "../../src/protocol/display-list.js";
import {
  wireDevices,
  mailbox,
  send,
  decodeFrame,
  encodeRequest,
} from "../../src/protocol/transport.js";
import { Session } from "../../src/compiler/session.js";
import { paragraphs, changedSpan, safe } from "../../src/core/document.js";
const pre = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{xcolor}`;
const samples = [
  "The quick brown fox jumps over the lazy dog. This paragraph includes enough text to exercise line breaking, ligatures, kerning and font selection. ".repeat(
    3,
  ),
  String.raw`The identity $E=mc^2$ and $\int_0^1 x^2\,dx=\frac{1}{3}$ are set with native TeX mathematics.`,
  String.raw`Some \textbf{bold}, \textit{italic}, and {\color{red}red text} mixed together.`,
  String.raw`An equation inside a paragraph. \[ e^{i\pi}+1=0 \] It has multiple rows and a rule in $\frac{a}{b}$.`,
  "Café, naïve words and a Unicode byte-counted request.",
  String.raw`\mbox{` + "abcdefgh ".repeat(100) + String.raw`} Short text after a long nested glyph run, with $\frac{a}{b}$ and more text.`,
];
samples.push(
  String.raw`\section{Live headings}`,
  String.raw`\begin{itemize}
\item The first item has $E=mc^2$.

\item The second item has normal text.
\end{itemize}`,
);
samples.push(String.raw`\begin{equation}a^2+b^2=c^2\label{pythagoras}\end{equation}`,
  String.raw`\begin{align}a&=b+1\\c&=d+2\end{align}`);
const source =
  pre + "\n\\begin{document}\n" + samples.join("\n\n") + "\n\n\\end{document}";
const res = await load();
let layout;
test("WASM LuaLaTeX outputs a PDF and exact live rows, including math and colour", async () => {
  const M = await engine(res, {
    "main.tex": source,
    "capture.tex": "\\RequirePackage{rex-capture}\\input{main.tex}",
  });
  assert.equal(run(M, "capture.tex"), 0);
  layout = collect(M);
  assert.equal(new TextDecoder().decode(layout.pdf.slice(0, 4)), "%PDF");
  const units = layout.capture.units;
  assert.equal(units.length, samples.length);
  const box = mailbox();
  const frames = [];
  const requests = [];
  units.forEach((u, i) => {
    requests.push(
      { op: "context", id: u.uid, ctx: u },
      { op: "compile", req: i + 1, ctx: u.uid, source: samples[i] },
    );
  });
  requests.push({ op: "shutdown" });
  const liveLogs = [];
  // A package allocating a function after startup must not overwrite the compiler's slots.
  const driver = liveDriver(pre).replace("\\loop\\rexStep", String.raw`\directlua{lua.get_functions_table()[luatexbase.new_luafunction('rex-test')]=function() error('Lua function slot collision') end}\loop\rexStep`);
  const live = await engine(res, { "live.tex": driver }, line => liveLogs.push(line), {
    REX_REQ: "/rex-input",
    REX_RESP: "/rex-output",
  });
  wireDevices(live, box, (bytes) => {
    const f = decodeFrame(bytes);
    frames.push(f);
    const next = requests.shift();
    if (next) send(box, encodeRequest(next));
  });
  assert.equal(run(live, "live.tex"), 0, liveLogs.join("\n") + "\n" + JSON.stringify({frames:frames.map(f=>f.header),units:units.map(u=>({kind:u.kind,name:u.name,everypar:u.everypar}))}));
  const results = frames.filter((f) => f.header.op === "result");
  assert.equal(results.length, samples.length);
  results.forEach((result, i) => {
    assert.equal(result.header.status, "ok");
    const u = units[i];
    assert.deepEqual(decodeDisplayList(result.binary, true).fonts, decodeDisplayList(result.binary).fonts);
    assert.ok(
      equivalent(
        decodeDisplayList(result.binary),
        u,
        layout.pages,
      ),
      "rows differ for sample " + i,
    );
  });
});
test("native LuaLaTeX and WASM have identical paragraph geometry and glyphs", (t) => {
  if (spawnSync("lualatex", ["--version"]).error) {
    t.skip("Native LuaLaTeX unavailable");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-native-"));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, "main.tex"), source);
  fs.writeFileSync(
    path.join(dir, "capture.tex"),
    "\\RequirePackage{rex-capture}\\input{main.tex}",
  );
  const p = spawnSync(
    "lualatex",
    ["-interaction=batchmode", "-halt-on-error", "capture.tex"],
    {
      cwd: dir,
      env: {
        ...process.env,
        REX_CAPTURE_DIR: dir,
        TEXINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":",
        LUAINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":",
        openout_any: "a",
      },
    },
  );
  assert.equal(p.status, 0, p.stdout?.toString());
  const native = JSON.parse(
    fs.readFileSync(path.join(dir, "capture.rex-page1.json")),
  );
  function canonical(page) {
    return page.lines.map((l) => ({
      w: l.w,
      h: l.h,
      d: l.d,
      items: l.items.map((it) => {
        it = it.slice();
        if (it[0] === "g") {
          const f = page.fonts[it[1]];
          it[1] = [f.name, f.size, f.slant, f.extend, f.squeeze];
          it[4] -= l.x;
          it[5] -= l.y;
        } else if (it[0] === "r") {
          it[1] -= l.x;
          it[2] -= l.y;
        } else if (it[0] === "m") it[2] -= l.x;
        return it;
      }),
    }));
  }
  assert.deepEqual(canonical(layout.pages[0]), canonical(native));
});
test("long resident sessions retain exact output and bounded Lua heap", async () => {
  const count = 2000, requests = [], heaps = [];
  for (let i = 0; i < 300; i++) {
    const unit = layout.capture.units[i % 4];
    requests.push({op: "context", id: i + 1, ctx: unit});
  }
  for (let i = 0; i < count; i++) {
    requests.push({op: "compile", req: i + 1, ctx: i % 300 + 1, source: samples[i % 4]});
    if (i === 99 || (i + 1) % 500 === 0) requests.push({op: "ping"});
  }
  requests.push({op: "shutdown"});
  const box = mailbox(), logs = [];
  const live = await engine(res, {"live.tex": liveDriver(pre)}, line => logs.push(line),
    {REX_REQ: "/rex-input", REX_RESP: "/rex-output"});
  let results = 0;
  wireDevices(live, box, bytes => {
    const response = decodeFrame(bytes);
    if (response.header.op === "result") {
      assert.equal(response.header.status, "ok");
      assert.ok(equivalent(decodeDisplayList(response.binary), layout.capture.units[results % 4], layout.pages));
      results++;
    } else if (response.header.op === "pong") heaps.push(response.header.heap_kib);
    const next = requests.shift(); if (next) send(box, encodeRequest(next));
  });
  assert.equal(run(live, "live.tex"), 0, logs.join("\n"));
  assert.equal(results, count);
  assert.equal(heaps.length, 5);
  assert.ok(heaps.every(Number.isFinite));
  assert.ok(heaps.at(-1) < heaps[0] * 1.5 + 4096, `Lua heap kept growing: ${heaps}`);
});
test("edits stay paragraph-local and unsafe state changes use the full pass", () => {
  const changed = changedSpan(
    source,
    source.replace("quick brown", "quick red"),
  );
  assert.equal(changed.index, 0);
  assert.equal(changedSpan(source, source.replace("quick brown", "quick\n\nbrown")).provisional, true);
  assert.equal(safe(String.raw`\gdef\foo{bar}`), false);
  assert.equal(safe(String.raw`\thepage`), false);
  assert.equal(safe(samples[1]), true);
  assert.equal(paragraphs(source).length, samples.length);
});

test("bundle progress messages cannot clear a running background job", async () => {
  const s = Object.create(Session.prototype);
  s.busy = true;
  s.revision = 1;
  s.schedule = () => assert.fail("progress scheduled a compile");
  await s.onBackground({ event: "progress", data: { phase: "fetching" } });
  assert.equal(s.busy, true);
});
test("obsolete project results cannot change the current compilation state", async () => {
  const s = Object.create(Session.prototype);
  s.projectId = 2; s.busy = true;
  s.status = s.log = s.schedule = () => assert.fail("Obsolete project result was applied");
  for (const type of ["layout", "failure", "standby-ready"])
    await s.onBackground({type, projectId: 1});
  assert.equal(s.busy, true);
  assert.equal(s.layout, undefined);
  assert.equal(s.standbyReady, undefined);
});
