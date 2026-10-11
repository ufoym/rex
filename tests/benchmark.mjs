import { openBrowser } from "./browser-helper.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { liveDriver } from "../src/runtime.js";
import { decodeFrame, encodeRequest } from "../src/transport.js";
const nativeDirs = [];
const {browser, page, close} = await openBrowser({ viewport: { width: 1440, height: 1000 } });
try {
await page.waitForFunction(
  () => Boolean(window.rex?.session.warmed),
  {},
  { timeout: 120000 },
);
await page.evaluate(() => rex.session.warmed);
const results = [];
const paragraph =
  "The quick brown fox jumps over the lazy dog. Each edit re-typesets only this paragraph, preserving precise glyph positions and line breaking. ".repeat(
    3,
  );
const pre = String.raw`\documentclass{article}
\usepackage{amsmath}`;
for (const pages of [10, 100, 300]) {
  const source =
    pre +
    "\n\\begin{document}\n" +
    Array.from(
      { length: pages },
      (_, i) => paragraph + "\n\n" + (i + 1 < pages ? "\\newpage\n\n" : ""),
    ).join("") +
    "\\end{document}\n";
  const result = await page.evaluate(
    async ({ source, pages }) => {
      const s = rex.session;
      s.warmed = null;
      s.setFiles({ "main.tex": source });
      const init = performance.now();
      while (!s.warmed) await new Promise((r) => setTimeout(r, 20));
      await s.warmed;
      const coldMs = performance.now() - init;
      const index = s.units.findIndex((u) => u?.placements.length),
        unit = s.units[index];
      const base = s.source,
        span = s.layoutSpans[index];
      const values = [],
        compile = [];
      let next;
      for (let i = 0; i < 320; i++) {
        next =
          base.slice(0, span.start) +
          span.text.replace("brown fox", i % 2 ? "brown cat" : "brown dog") +
          base.slice(span.end);
        const previous = s.lastTiming, t = performance.now();
        await s.edit(next);
        clearTimeout(s.timer);
        if (!s.lastTiming || s.lastTiming === previous) throw Error("No new paragraph update");
        if (i >= 20) {
          values.push(performance.now() - t);
          compile.push(s.lastTiming.roundtrip);
        }
      }
      const samplesMs = values.slice(), roundtripSamplesMs = compile.slice();
      values.sort((a, b) => a - b);
      compile.sort((a, b) => a - b);
      while (!s.standbyReady) await new Promise(r => setTimeout(r, 20));
      const oldLayout = s.layout;
      s.full();
      while (s.layout === oldLayout) await new Promise(r => setTimeout(r, 10));
      const warm = s.layout;
      await s.warmed;
      return {
        pages,
        actualPages: s.layout.capture.pages,
        coldMs,
        backgroundMs: oldLayout.ms,
        warmBackgroundMs: warm.ms,
        warmBodyMs: warm.bodyMs,
        warmPasses: warm.passes,
        usedStandby: warm.usedStandby,
        median: values[150],
        p95: values[285],
        compileMedian: compile[150],
        samplesMs,
        roundtripSamplesMs,
        unit,
        span: span.text,
      };
    },
    { source, pages },
  );
  assert.equal(result.pages, result.actualPages);
  assert.ok(result.p95 < 16.67, `typing P95 over one frame: ${result.p95}`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rex-bench-"));
  nativeDirs.push(dir);
  await fs.writeFile(path.join(dir, "live.tex"), liveDriver(pre));
  const req = [
    { op: "context", id: result.unit.uid, ctx: result.unit },
  ];
  for (let n = 0; n < 320; n++)
    req.push({
      op: "compile",
      req: n + 1,
      ctx: result.unit.uid,
      source: result.span.replace(
        "brown fox",
        n % 2 ? "brown cat" : "brown dog",
      ),
    });
  req.push({ op: "shutdown" });
  const proc = spawnSync(
    "lualatex",
    ["-interaction=batchmode", "-halt-on-error", "live.tex"],
    {
      cwd: dir,
      input: Buffer.concat(req.map(x => Buffer.from(encodeRequest(x)))),
      env: {
        ...process.env,
        REX_RESP: path.join(dir, "response.bin"),
        TEXINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":",
        LUAINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":",
        openout_any: "a",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  assert.equal(proc.status, 0, proc.stdout.toString());
  const bytes = new Uint8Array(
    await fs.readFile(path.join(dir, "response.bin")),
  );
  const native = [];
  let at = 0,
    n = 0;
  while (at < bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + at).getUint32(
      0,
      true,
    );
    const h = decodeFrame(bytes.subarray(at + 4, at + 4 + len)).header;
    at += 4 + len;
    if (h.op === "result") {
      assert.equal(h.status, "ok");
      if (n++ >= 20)
        native.push((h.t_tex_us + h.t_traverse_us + h.t_pack_us) / 1000);
    }
  }
  native.sort((a, b) => a - b);
  result.nativeEngineMedian = native[150];
  await fs.writeFile(path.join(dir, "main.tex"), source);
  await fs.writeFile(
    path.join(dir, "capture.tex"),
    "\\RequirePackage{rex-capture}\\input{main.tex}",
  );
  const fullStart = performance.now();
  for (let pass = 0; pass < 2; pass++) {
    const full = spawnSync(
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
    assert.equal(full.status, 0, full.stdout.toString());
  }
  result.nativeBackgroundMs = performance.now() - fullStart;
  // Same preloaded-preamble boundary as the browser standby, including capture output.
  await fs.writeFile(path.join(dir, "rex-preamble.tex"), pre);
  await fs.writeFile(path.join(dir, "main.tex"), "\n".repeat(pre.split("\n").length - 1) + source.slice(pre.length));
  await fs.writeFile(path.join(dir, "capture.tex"), String.raw`\RequirePackage{rex-capture}\input{rex-preamble.tex}\directlua{texio.write_nl('STANDBYREADY') io.stdout:flush() io.read('l')}\input{main.tex}`);
  const nativeWarm = await new Promise((resolve, reject) => {
    let start, stdout = "";
    const child = spawn("lualatex", ["-interaction=nonstopmode", "-halt-on-error", "capture.tex"], {
      cwd: dir,
      env: {...process.env, REX_CAPTURE_DIR: dir, TEXINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":", LUAINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":", openout_any: "a"},
    });
    child.stdout.on("data", bytes => {stdout += bytes; if (!start && stdout.includes("STANDBYREADY")) {start = performance.now(); child.stdin.end("GO\n");}});
    child.on("error", reject);
    child.on("exit", code => code ? reject(Error(stdout)) : resolve(performance.now() - start));
  });
  result.nativeWarmBackgroundMs = nativeWarm;
  assert.ok(result.usedStandby);
  assert.equal(result.warmPasses, 1);
  delete result.unit;
  delete result.span;
  results.push(result);
  console.log(JSON.stringify({...result, samplesMs: undefined, roundtripSamplesMs: undefined}));
}
assert.ok(
  results[2].median < results[0].median * 2 + 1,
  "latency scales with document length",
);
await fs.mkdir("artifacts/tests", { recursive: true });
await fs.writeFile(
  "artifacts/tests/performance.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      cpu: os.cpus()[0].model,
      browser: await browser.version(),
      samples: 300,
      warmup: 20,
      results,
    },
    null,
    2,
  ),
);
} finally {
  try { await close(); }
  finally { await Promise.all(nativeDirs.map(dir => fs.rm(dir, {recursive:true, force:true}))); }
}
