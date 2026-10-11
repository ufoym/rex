// Optional native compiler comparison; the external checkout is never shipped with Rex.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { liveDriver } from "../src/runtime.js";
import { decodeFrame, encodeRequest } from "../src/transport.js";
import { decodeDisplayList, equivalent } from "../src/display-list.js";

const upstream = path.resolve(process.argv[2] || "../realtime-tex");
const quick = process.argv.includes("--quick");
const selection = process.argv.find(arg => arg.startsWith("--case="))?.slice(7);
const position = process.argv.find(arg => arg.startsWith("--position="))?.slice(11);
const rexTex = path.resolve(process.argv.find(arg => arg.startsWith("--rex-tex="))?.slice(10) || "src/tex");
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || "artifacts/tests/comparison.json";
const numberOption = (name, fallback) => {
  const value = process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1];
  if (value === undefined) return fallback;
  assert.match(value, /^\d+$/);
  return Number(value);
};
const samples = numberOption("samples", quick ? 5 : 300), warmup = numberOption("warmup", quick ? 2 : 20),
  rounds = numberOption("rounds", quick ? 1 : 3), pauseMs = numberOption("pause", 2),
  memoryInterval = numberOption("memory-interval", 0);
const pageCount = numberOption("pages", 0);
assert.ok(samples > 0 && rounds > 0);
assert.ok(!pageCount || [10, 100, 300].includes(pageCount));
assert.ok(!position || ["first", "middle", "last"].includes(position));
const hash = value => createHash("sha256").update(value).digest("hex");
const pre = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{xcolor}`;
const bodies = {
  text: "The quick brown fox jumps over the lazy dog. Each edit re-typesets only this paragraph, preserving precise glyph positions and line breaking. ".repeat(3),
  math: String.raw`The brown fox studies $E=mc^2$ and $\int_0^1 x^2\,dx=\frac{1}{3}$. An equation follows. \[ e^{i\pi}+1=0 \] Fractions such as $\frac{a}{b}$ have exact rules and positions.`,
  style: String.raw`The brown fox uses \textbf{bold}, \textit{italic}, and {\color{red}red text}. Different font families, ligatures and colours should survive each edit.`,
};
const envFor = (dir, external = false) => {
  const search = `${external ? path.join(upstream, "tex") : rexTex}//:${path.resolve("vendor")}:`;
  return {...process.env, TEXINPUTS: search, LUAINPUTS: search, openout_any: "a",
    REX_CAPTURE_DIR: dir, REX_RESP: "/dev/fd/3", RTEX_RESP: "/dev/fd/3"};
};
function git(...args) {
  const result = spawnSync("git", ["-C", upstream, ...args], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const revision = git("rev-parse", "HEAD");
assert.equal(git("status", "--porcelain"), "", "Use an unmodified upstream checkout");
await fs.access(path.join(upstream, "tex/rtex-serve.lua"));
const engine = spawnSync("lualatex", ["--version"], {encoding: "utf8"});
assert.equal(engine.status, 0, "Native LuaLaTeX is required");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "rex-compare-"));
const children = new Set();
const driver = pre + String.raw`
\newbox\rtexbox\newcount\rtexcontinue\rtexcontinue=1
\edef\rtexcountnum{\number\allocationnumber}
\newcatcodetable\rtexcct{\makeatletter\savecatcodetable\rtexcct}
\begin{document}
\input{rtex-serve-patches}
\directlua{rtex_serve=dofile(kpse.find_file("rtex-serve.lua","lua")) rtex_serve.init(\number\rtexbox,\rtexcountnum,\number\rtexcct)}
\loop\rtexstep\ifnum\rtexcontinue>0\repeat
\end{document}
`;
async function server(name, dir) {
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, "live.tex"), name === "rex" ? liveDriver(pre) : driver);
  const child = spawn("lualatex", ["-interaction=batchmode", "-halt-on-error", "live.tex"],
    {cwd: dir, env: envFor(dir, name !== "rex"), stdio: ["pipe", "ignore", "pipe", "pipe"]});
  children.add(child);
  let pending = Buffer.alloc(0), waiter, failure, stderr = "";
  const queue = [];
  const fail = error => {failure = error; waiter?.reject(error); waiter = null;};
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stderr.on("data", bytes => {stderr += bytes;});
  const closed = new Promise(resolve => child.on("close", code => {
    children.delete(child); fail(Error(`${name} exited ${code}: ${stderr}`)); resolve(code);
  }));
  child.stdio[3].on("data", bytes => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
      const length = pending.readUInt32LE(0);
      const frame = decodeFrame(pending.subarray(4, 4 + length));
      pending = pending.subarray(4 + length);
      if (waiter) {const current = waiter; waiter = null; current.resolve(frame);} else queue.push(frame);
    }
  });
  function next() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {waiter = null; reject(Error(`${name}: response timeout`));}, 30000);
      waiter = {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}};
    });
  }
  assert.equal((await next()).header.op, "ready");
  return {
    async request(value) {
      const response = next();
      child.stdin.write(ArrayBuffer.isView(value) || typeof value === "string" ? value : JSON.stringify(value) + "\n");
      return response;
    },
    async close() {
      if (!failure) {await this.request({op: "shutdown"}); child.stdin.end();}
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {assert.equal(await closed, 0);} finally {clearTimeout(timer);}
    },
  };
}
function context(unit, external) {
  const fields = ["kind", "name", "ints", "dims", "glues", "parshape", "everypar", "nobreak", "afterindent", "noskipsec", "counters", "thefmt", "macros", "mathversion", "nfss", "color"];
  const ctx = Object.fromEntries(fields.filter(key => key in unit).map(key => [key, unit[key]]));
  if (external) {
    ctx.begin = {nfss: {...unit.nfss, enc: unit.nfss.encoding}, color: unit.color};
    ctx.macros = Object.fromEntries(Object.entries(unit.macros || {}).map(([key, value]) => [key, value.meaning]));
    delete ctx.nfss; delete ctx.color;
  }
  return ctx;
}
async function capture(source, dir, pages) {
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, "main.tex"), source);
  await fs.writeFile(path.join(dir, "capture.tex"), "\\RequirePackage{rex-capture}\\input{main.tex}");
  const result = spawnSync("lualatex", ["-interaction=batchmode", "-halt-on-error", "capture.tex"],
    {cwd: dir, env: envFor(dir), encoding: "utf8"});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const journal = JSON.parse(await fs.readFile(path.join(dir, "capture.rex.json"), "utf8"));
  assert.equal(journal.pages, pages);
  assert.equal(journal.units.length, pages);
  return {journal, pages: await Promise.all(Array.from({length: pages}, async (_, index) =>
    JSON.parse(await fs.readFile(path.join(dir, `capture.rex-page${index + 1}.json`), "utf8"))))};
}
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const cases = [];
for (const pages of quick && !selection ? [10] : [10, 100, 300])
  for (const position of ["first", "middle", "last"]) cases.push({pages, position, kind: "text"});
if (!quick || selection) for (const kind of ["math", "style"]) cases.push({pages: 300, position: "last", kind});
if (selection) cases.splice(0, cases.length, ...cases.filter(item => item.kind === selection));
if (pageCount) cases.splice(0, cases.length, ...cases.filter(item => item.pages === pageCount));
if (position) cases.splice(0, cases.length, ...cases.filter(item => item.position === position));
assert.ok(cases.length, "No matching benchmark cases");
const report = {
  date: new Date().toISOString(), upstream: {url: "https://github.com/HenryXiaoYang/realtime-tex", revision},
  environment: {cpu: os.cpus()[0].model, os: `${os.type()} ${os.release()}`, node: process.version, engine: engine.stdout.split("\n")[0]},
  method: {samples, warmup, rounds, pauseMs, memoryInterval,
    boundary: "Host request encoding/write through complete response and display-list decoding; output validation excluded",
    scheduler: process.env.REX_BENCH_SCHEDULER || "Host defaults",
    protocol: "Each compiler's normal raw UTF-8 compile request; JSON context/control messages",
    scope: "Native resident paragraph compilers only; excludes product session, WASM, rendering, startup, full compilation and background jobs",
    order: "Rex then realtime-tex in odd rounds; reversed in even rounds; never concurrent",
    context: "All paragraph contexts preloaded from a common full native LuaLaTeX capture, translated into each protocol",
    reference: "Every live result compared with a fresh full native capture of the edited document: exact glyphs, fonts, relative coordinates, rules, colours and line boxes; page translation excluded"},
  sourceHashes: {}, results: [], checks: {validatedUpdates: 0},
  rexTex,
};
try {
  for (const file of ["tests/compare.mjs", "src/runtime.js", "src/transport.js", "src/display-list.js", ...await fs.readdir(rexTex).then(names => names.map(name => path.join(rexTex, name)))])
    report.sourceHashes[path.relative(process.cwd(), path.resolve(file))] = hash(await fs.readFile(file));
  for (const [index, item] of cases.entries()) {
    console.log(`Case ${index + 1}/${cases.length}: ${item.pages} pages, ${item.position}, ${item.kind}`);
    const target = item.position === "first" ? 0 : item.position === "last" ? item.pages - 1 : Math.floor((item.pages - 1) / 2);
    const body = Array.from({length: item.pages}, (_, i) => i === target ? bodies[item.kind] : bodies.text);
    const source = parts => pre + "\n\\begin{document}\n" + parts.join("\n\n\\newpage\n\n") + "\n\n\\end{document}\n";
    const caseDir = path.join(root, String(index));
    const base = await capture(source(body), path.join(caseDir, "base"), item.pages);
    const refs = [];
    for (const word of ["dog", "cat"]) {
      const edited = body.slice(); edited[target] = edited[target].replace("brown fox", `brown ${word}`);
      refs.push(await capture(source(edited), path.join(caseDir, word), item.pages));
    }
    const unit = base.journal.units[target];
    const row = {...item, sourceSha256: hash(source(body)), referenceHashes: refs.map(ref => hash(JSON.stringify(ref.pages[target]))),
      lines: unit.placements.length, rounds: []};
    for (let round = 0; round < rounds; round++) {
      const measured = {};
      for (const name of round % 2 ? ["realtime-tex", "rex"] : ["rex", "realtime-tex"]) {
        const external = name !== "rex";
        const live = await server(name, path.join(caseDir, `${round}-${name}`));
        try {
          for (const ctx of base.journal.units) {
            const response = await live.request({op: "context", id: ctx.uid, ctx: context(ctx, external)});
            assert.equal(response.header.op, external ? "ok" : "context");
          }
          const times = [], engineTimesUs = [], heapsKiB = [];
          const memory = async edit => {
            const response = await live.request({op: "ping"});
            assert.equal(response.header.op, "pong");
            assert.ok(Number.isFinite(response.header.heap_kib));
            heapsKiB.push({edit, heapKiB: response.header.heap_kib});
          };
          if (memoryInterval && !external) await memory(0);
          let mismatch;
          for (let edit = 0; edit < warmup + samples; edit++) {
            if (pauseMs) await pause(pauseMs);
            const text = body[target].replace("brown fox", edit % 2 ? "brown cat" : "brown dog");
            const start = performance.now();
            const response = await live.request(external ? `C ${edit + 1} ${unit.uid} ${Buffer.byteLength(text)}\n${text}` :
              encodeRequest({op: "compile", req: edit + 1, ctx: unit.uid, source: text}));
            const display = decodeDisplayList(response.binary);
            const elapsed = performance.now() - start;
            assert.equal(response.header.status, "ok", JSON.stringify(response.header));
            const ref = refs[edit % 2];
            if (!equivalent(display, ref.journal.units[target], ref.pages)) {
              await fs.mkdir("artifacts/tests", {recursive: true});
              await fs.writeFile("artifacts/tests/comparison-mismatch.json", JSON.stringify({name, item, edit, display,
                reference: ref.pages[target], unit: ref.journal.units[target], context: context(unit, external)}));
              mismatch = {status: "output-mismatch", edit,
                observedColours: display.lines.flatMap(line => line.items.filter(value => value[0] === "c")),
                expectedColours: ref.pages[target].lines.filter(line => line.unit === ref.journal.units[target].uid)
                  .flatMap(line => line.items.filter(value => value[0] === "c")),
                displaySha256: hash(JSON.stringify(display)), referenceSha256: hash(JSON.stringify(ref.pages[target]))};
              break;
            }
            report.checks.validatedUpdates++;
            if (edit >= warmup) {
              times.push(elapsed);
              engineTimesUs.push([response.header.t_tex_us, response.header.t_traverse_us, response.header.t_pack_us]);
            }
            if (memoryInterval && !external && (edit + 1) % memoryInterval === 0) await memory(edit + 1);
          }
          if (memoryInterval && !external) await memory(warmup + times.length);
          measured[name] = mismatch || {status: "ok", medianMs: quantile(times, .5), p95Ms: quantile(times, .95), samplesMs: times,
            engineTimesUs, ...(heapsKiB.length ? {heapsKiB} : {}),
            engineTimingNote: "Diagnostic only: compilers use different internal timing boundaries"};
        } finally {await live.close();}
      }
      row.rounds.push(measured);
    }
    row.summary = Object.fromEntries(["rex", "realtime-tex"].map(name => [name,
      row.rounds.some(run => run[name].status !== "ok") ? {status: "output-mismatch", failures: row.rounds.map(run => run[name]).filter(run => run.status !== "ok")} : {
      status: "ok",
      medianMs: quantile(row.rounds.map(run => run[name].medianMs), .5),
      p95Ms: quantile(row.rounds.map(run => run[name].p95Ms), .5),
      runMediansMs: row.rounds.map(run => run[name].medianMs),
    }]));
    report.results.push(row);
    await fs.mkdir("artifacts/tests", {recursive: true});
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, JSON.stringify(report));
    console.log(JSON.stringify({...item, ...row.summary}));
  }
  await fs.mkdir("artifacts/tests", {recursive: true});
  for (const [file, expected] of Object.entries(report.sourceHashes))
    assert.equal(hash(await fs.readFile(file)), expected, `Source changed during measurement: ${file}`);
  await fs.writeFile(output, JSON.stringify(report));
  console.log(`Validated ${report.checks.validatedUpdates} updates. Report: ${output}`);
} finally {
  for (const child of children) child.kill("SIGKILL");
  await fs.rm(root, {recursive: true, force: true});
}
