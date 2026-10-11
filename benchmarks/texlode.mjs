// Run Rex's native resident compiler on texlode's pinned public paper samples.
// The upstream checkout supplies workloads, not a texlode product implementation.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { liveDriver } from "../src/compiler/runtime.js";
import { decodeFrame, encodeRequest } from "../src/protocol/transport.js";
import { decodeDisplayList, equivalent } from "../src/protocol/display-list.js";

const revision = "9b86f576ed977853d6a36c0f41b14a037297b150";
const upstream = path.resolve(process.argv[2] || "../texlode-benchmark");
const quick = process.argv.includes("--quick");
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || "artifacts/benchmarks/texlode-workloads.json";
const rounds = quick ? 1 : 3, batches = quick ? 2 : 30, warmupBatches = quick ? 1 : 5, batchSize = quick ? 3 : 100;
const hash = value => createHash("sha256").update(value).digest("hex");
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
function git(...args) {
  const result = spawnSync("git", ["-C", upstream, ...args], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
assert.equal(git("rev-parse", "HEAD"), revision, "Use the documented texlode benchmark revision");
assert.equal(git("status", "--porcelain"), "", "Use an unmodified upstream checkout");
const systematic = await fs.readFile(path.join(upstream, "systematic-benchmark.tex"), "utf8");
const statistics = await fs.readFile(path.join(upstream, "bench-lib.lua"), "utf8");
const categories = ["Short", "Medium", "Long", "Inline math", "Display math"];
// Read the balanced TeX arguments verbatim; nested Lua / math braces are retained.
function sample(name) {
  const marker = `\\benchcategory{${name}}{`;
  const start = systematic.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length, `Missing public sample: ${name}`);
  let depth = 1, end = start;
  for (; depth && end < systematic.length; end++) {
    if (systematic[end] === "{") depth++;
    if (systematic[end] === "}") depth--;
  }
  assert.equal(depth, 0);
  return systematic.slice(start, end - 1);
}
const preamble = String.raw`\documentclass{book}
\usepackage{microtype}
\usepackage{amsmath}
\setlength{\textwidth}{345pt}`;
const engine = spawnSync("lualatex", ["--version"], {encoding: "utf8"});
assert.equal(engine.status, 0, "Native LuaLaTeX is required");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "rex-texlode-"));
const children = new Set();
const env = dir => ({...process.env, TEXINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":",
  LUAINPUTS: path.resolve("src/tex") + "//:" + path.resolve("vendor") + ":", REX_CAPTURE_DIR: dir,
  REX_RESP: "/dev/fd/3", openout_any: "a"});
async function capture(source, dir) {
  await fs.mkdir(dir, {recursive: true});
  const document = preamble + "\n\\begin{document}\n" + source + "\n\\par\n\\end{document}\n";
  await fs.writeFile(path.join(dir, "main.tex"), document);
  await fs.writeFile(path.join(dir, "capture.tex"), "\\RequirePackage{rex-capture}\\input{main.tex}");
  const result = spawnSync("lualatex", ["-interaction=batchmode", "-halt-on-error", "capture.tex"],
    {cwd: dir, env: env(dir), encoding: "utf8"});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const journal = JSON.parse(await fs.readFile(path.join(dir, "capture.rex.json"), "utf8"));
  assert.equal(journal.units.length, 1, "A sample must be a single captured unit");
  const pages = await Promise.all(Array.from({length: journal.pages}, async (_, i) =>
    JSON.parse(await fs.readFile(path.join(dir, `capture.rex-page${i + 1}.json`), "utf8"))));
  return {document, unit: journal.units[0], pages};
}
async function server(dir) {
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, "live.tex"), liveDriver(preamble));
  const child = spawn("lualatex", ["-interaction=batchmode", "-halt-on-error", "live.tex"],
    {cwd: dir, env: env(dir), stdio: ["pipe", "ignore", "pipe", "pipe"]});
  children.add(child);
  let pending = Buffer.alloc(0), waiter, failure, stderr = "";
  const queue = [];
  function fail(error) {failure = error; waiter?.reject(error); waiter = null;}
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stderr.on("data", bytes => {stderr += bytes;});
  const closed = new Promise(resolve => child.on("close", code => {
    children.delete(child); fail(Error(`Rex exited ${code}: ${stderr}`)); resolve(code);
  }));
  child.stdio[3].on("data", bytes => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
      const length = pending.readUInt32LE(0), frame = decodeFrame(pending.subarray(4, 4 + length));
      pending = pending.subarray(4 + length);
      if (waiter) {const current = waiter; waiter = null; current.resolve(frame);} else queue.push(frame);
    }
  });
  function next() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {waiter = null; reject(Error("Rex response timeout"));}, 30000);
      waiter = {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}};
    });
  }
  assert.equal((await next()).header.op, "ready");
  return {
    async request(message) {
      const response = next();
      child.stdin.write(encodeRequest(message));
      return response;
    },
    async close() {
      if (!failure) {await this.request({op: "shutdown"}); child.stdin.end();}
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {assert.equal(await closed, 0);} finally {clearTimeout(timer);}
    },
  };
}
const report = {
  date: new Date().toISOString(), quick,
  upstream: {url: "https://github.com/texlode/luatex-benchmark", revision,
    systematicSha256: hash(systematic), statisticsSha256: hash(statistics)},
  environment: {cpu: os.cpus()[0].model, os: `${os.type()} ${os.release()}`, node: process.version,
    engine: engine.stdout.split("\n")[0]},
  method: {rounds, batches, warmupBatches, batchSize, pauseMs: 0,
    settings: "book default 10pt Latin Modern, microtype defaults, amsmath, 345pt column",
    workload: "Verbatim public samples repeatedly compiled without text changes or memoization; one paragraph, no document-size experiment",
    roundtrip: "Host request encoding/write through complete response and display-list decoding; excludes validation, startup, capture, editor, WASM, network and Canvas",
    typeset: "Rex t_tex_us: grouped vbox typesetting after context replay; not an isolated Knuth–Plass timer",
    traversal: "Rex t_traverse_us includes node traversal and binary display-list encoding",
    statistics: "Each sample is the mean of 100 individual timings; 30 measured batch means after 5 warmup batches per fresh engine; floor(n*p) percentile index, matching upstream; summary is median of 3 run-level values",
    validation: "Every response, including warmups, compared with full native LuaLaTeX capture; glyphs, font identity, coordinates, line boxes and rules; translation only removed",
    limits: "Different hardware and timer implementations; author pipeline statistics are unspecified; batch P95 is not per-edit P95; no texlode code is executed"},
  author: {source: "https://www.tug.org/tug2026/preprints/lode-realtime.pdf", date: "2026-06-13",
    cpu: "Intel Core i7-1355U", engine: "TeX Live 2025", pipelinePercentile: "Not stated",
    vanillaLinebreakMedianMs: {Short: 0.17, Medium: 0.70, Long: 1.99, "Inline math": 0.20, "Display math": 0.11},
    vanillaLinebreakP95Ms: {Short: 0.96, Medium: 0.89, Long: 2.41, "Inline math": 0.27, "Display math": 0.13},
    pipelineRoundtripMs: {Short: 0.79, Medium: 6.11},
    linebreakAndTraversalMs: {Short: 0.65, Medium: 4.99}},
  sourceHashes: {}, results: [], checks: {validatedUpdates: 0},
};
try {
  for (const file of ["benchmarks/texlode.mjs", "src/compiler/runtime.js", "src/protocol/transport.js", "src/protocol/display-list.js",
    ...await fs.readdir("src/tex").then(names => names.map(name => path.join("src/tex", name)))])
    report.sourceHashes[file] = hash(await fs.readFile(file));
  for (const [index, name] of categories.entries()) {
    const source = sample(name), reference = await capture(source, path.join(root, `${index}-reference`));
    assert.equal(reference.unit.dims.hsize, 345 * 65536);
    assert.equal(reference.unit.nfss.size, "10");
    const row = {name, source, sourceSha256: hash(source), documentSha256: hash(reference.document),
      referenceSha256: hash(JSON.stringify(reference)), context: reference.unit, rounds: []};
    console.log(`Public sample ${index + 1}/${categories.length}: ${name}`);
    for (let round = 0; round < rounds; round++) {
      const live = await server(path.join(root, `${index}-${round}`));
      try {
        assert.equal((await live.request({op: "context", id: reference.unit.uid, ctx: reference.unit})).header.op, "context");
        const batchMeans = [], samples = [];
        let request = 0, glyphs, lines;
        for (let batch = 0; batch < warmupBatches + batches; batch++) {
          const timings = [];
          for (let n = 0; n < batchSize; n++) {
            const start = performance.now();
            const response = await live.request({op: "compile", req: ++request, ctx: reference.unit.uid, source});
            const display = decodeDisplayList(response.binary), elapsed = performance.now() - start;
            assert.equal(response.header.status, "ok", JSON.stringify(response.header));
            assert.ok(equivalent(display, reference.unit, reference.pages), `${name}: output mismatch at ${round}/${batch}/${n}`);
            report.checks.validatedUpdates++;
            glyphs = display.glyphs; lines = display.lines.length;
            timings.push([elapsed, response.header.t_tex_us / 1000, response.header.t_traverse_us / 1000]);
          }
          if (batch >= warmupBatches) {
            samples.push(...timings);
            batchMeans.push([0, 1, 2].map(i => mean(timings.map(t => t[i]))));
          }
        }
        row.rounds.push({glyphs, lines, samplesMs: samples, batchMeansMs: batchMeans,
          summary: Object.fromEntries(["roundtrip", "typeset", "traversal"].map((metric, i) => [metric,
            {medianMs: percentile(batchMeans.map(t => t[i]), .5), p95Ms: percentile(batchMeans.map(t => t[i]), .95)}]))});
      } finally {await live.close();}
    }
    row.summary = Object.fromEntries(["roundtrip", "typeset", "traversal"].map(metric => [metric,
      Object.fromEntries(["medianMs", "p95Ms"].map(stat => [stat, percentile(row.rounds.map(run => run.summary[metric][stat]), .5)]))]));
    const authorMs = report.author.pipelineRoundtripMs[name];
    if (authorMs !== undefined) row.crossMachineRoundtripRatio = authorMs / row.summary.roundtrip.medianMs;
    row.crossMachineTypesetRatio = report.author.vanillaLinebreakMedianMs[name] / row.summary.typeset.medianMs;
    report.results.push(row);
    console.log(JSON.stringify({name, ...row.summary, crossMachineRoundtripRatio: row.crossMachineRoundtripRatio}));
  }
  for (const [file, expected] of Object.entries(report.sourceHashes))
    assert.equal(hash(await fs.readFile(file)), expected, `Source changed during measurement: ${file}`);
  await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.writeFile(output, JSON.stringify(report));
  console.log(`Validated ${report.checks.validatedUpdates} updates. Report: ${output}`);
} finally {
  for (const child of children) child.kill("SIGKILL");
  await fs.rm(root, {recursive: true, force: true});
}
