// Real VS Code editor -> unmodified rtex -> upstream Canvas renderer.
// External checkouts and their dependencies are not shipped with Rex.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const plugin = path.resolve(process.argv[2] || "../realtime-tex-vsc-plugin");
const engine = path.resolve(process.argv[3] || "../realtime-tex");
const quick = process.argv.includes("--quick");
const matched = process.argv.includes("--matched");
const selectedRound = process.argv.find(x => x.startsWith("--round="))?.slice(8);
const output = path.resolve(process.argv.find(x => x.startsWith("--output="))?.slice(9) || "artifacts/benchmarks/realtime-preview.json");
const requirePlugin = createRequire(path.join(plugin, "package.json"));
const { build } = requirePlugin("esbuild");
const { runTests } = requirePlugin("@vscode/test-electron");
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
for (const dir of [plugin, engine]) assert.equal(git(dir, "status", "--porcelain"), "", "Use clean external checkouts");
const server = path.join(engine, "target/release/rtex");
await fs.access(server);
execFileSync(process.execPath, ["esbuild.mjs"], { cwd: plugin, stdio: "inherit" });

// Instrument only the browser bundle. Preserve the real animation-frame scheduling,
// page drawing and canvas replacement. Hash readback/acknowledgement is included.
const source = await fs.readFile(path.join(plugin, "webview/main.ts"), "utf8");
const marker = "  const badge = el.querySelector<HTMLElement>('.badge')!;";
assert.equal(source.split(marker).length, 2, "Upstream render endpoint changed");
const instrumentation = `
  const pending = (window as any).__rexBenchmark;
  if (n === 1 && pending && overlays.some(o => o.overlay.revision === pending.revision)) {
    (window as any).__rexBenchmark = undefined;
    const canvasSubmittedAt = performance.timeOrigin + performance.now();
    const pixels = ctx.getImageData(0, 0, w, h).data;
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    (vscode as any).postMessage({type: 'rexBenchmarkDrawn', id: pending.id,
      revision: pending.revision, hash, width: w, height: h, reason: reason ?? null,
      usedPdf: usePdf, userAgent: navigator.userAgent, dpr, canvasSubmittedAt,
      viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight,
      zoom: zoomPercent() / 100,
      innerWidth, innerHeight,
      previewReceiveToReadbackMs: performance.now() - pending.received});
  }
`;
const matchedInstrumentation=instrumentation.replace(
  "    const pixels = ctx.getImageData(0, 0, w, h).data;\n    let hash = 2166136261;\n    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;\n", "    const hash = null;\n").replace("previewReceiveToReadbackMs:","previewReceiveToDrawMs:");
const observation=matched?matchedInstrumentation:instrumentation;
let instrumented = source.replace(marker, observation + marker).replace(
  "    case 'paragraph':\n",
  "    case 'paragraph':\n      if ((m as any).rexBenchmark) (window as any).__rexBenchmark = { ...(m as any).rexBenchmark, revision: m.revision, received: performance.now() };\n",
).replace("  const m = ev.data;\n", `  const m = ev.data;
  if ((m as any).type === 'rexBenchmarkClock') {
    (vscode as any).postMessage({type: 'rexBenchmarkClock', now: performance.timeOrigin + performance.now()});
    return;
  }
  if ((m as any).type === 'rexBenchmarkSnapshot') {
    const canvas = pageEls()[0].querySelector('canvas')!;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    (vscode as any).postMessage({type: 'rexBenchmarkSnapshot', hash, overlays: model.overlays.size,
      width: canvas.width, height: canvas.height});
    return;
  }
`);
assert.notEqual(instrumented, source);
if (matched) instrumented += `\nObject.assign(viewport.style, {width:'640px',height:'600px',right:'auto',bottom:'auto'});\n`;
await build({ stdin: { contents: instrumented, resolveDir: path.join(plugin, "webview"), sourcefile: "main.ts", loader: "ts" }, bundle: true, outfile: path.join(plugin, "dist/webview.js"), platform: "browser", format: "esm", target: "chrome114" });

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "rex-preview-"));
const project = path.join(scratch, "project");
// macOS Unix sockets require a short path on a filesystem supporting sockets.
const userData = await fs.mkdtemp("/tmp/rex-preview-profile-");
await fs.mkdir(project, { recursive: true });
await fs.mkdir(path.join(userData, "User"), { recursive: true });
await fs.writeFile(path.join(project, "main.tex"), "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n");
await fs.writeFile(path.join(userData, "User/settings.json"), JSON.stringify({
  "realtimeTex.serverPath": server,
  "realtimeTex.texDir": path.join(engine, "tex"),
  "realtimeTex.texliveBin": path.dirname(execFileSync("which", ["lualatex"], { encoding: "utf8" }).trim()),
  "realtimeTex.updateCheck": "off",
  "realtimeTex.syncCursor": false,
  "realtimeTex.preview.zoom": "100",
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none",
  "workbench.colorTheme": "Default Light Modern",
  "editor.minimap.enabled": false,
  "files.autoSave": "off",
  "chat.disableAIFeatures": true,
}));
const suiteFile = path.join(scratch, "suite.cjs");
const runFile = path.join(scratch, "run.json");
await fs.writeFile(suiteFile, `exports.run = ${suite.toString()};\n`);
await runTests({
  cachePath: path.join(plugin, "../vscode-cache"),
  version: "1.141.0",
  extensionDevelopmentPath: plugin,
  extensionTestsPath: suiteFile,
  launchArgs: [project, "--user-data-dir", userData, "--extensions-dir", path.join(scratch, "extensions"), "--disable-extensions", "--disable-extension=github.copilot-chat", "--skip-welcome", "--skip-release-notes", "--force-device-scale-factor=1"],
  extensionTestsEnv: { REX_PREVIEW_OUT: runFile, REX_PREVIEW_QUICK: quick ? "1" : "", REX_PREVIEW_MATCHED: matched ? "1" : "", REX_PREVIEW_ROUND: selectedRound ?? "", REX_PREVIEW_EQUIVALENT: new URL("../src/protocol/display-list.js",import.meta.url).href },
});
const report = JSON.parse(await fs.readFile(runFile, "utf8"));
report.date = new Date().toISOString();
report.environment = { platform: process.platform, arch: process.arch, os: os.release(), cpu: os.cpus()[0].model,
  node: process.version, tex: execFileSync("lualatex", ["--version"], { encoding: "utf8" }).split("\n")[0] };
report.upstream = { plugin: git(plugin, "rev-parse", "HEAD"), engine: git(engine, "rev-parse", "HEAD") };
report.instrumentation = { rendererSourceSha256: createHash("sha256").update(source).digest("hex"), insertion: observation,
  driver: await fs.readFile(new URL(import.meta.url), "utf8") };
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report) + "\n");
console.log(JSON.stringify({ output, summary: report.summary }, null, 2));
await fs.rm(scratch, { recursive: true, force: true });
await fs.rm(userData, { recursive: true, force: true });

async function suite() {
  const vscode = require("vscode");
  const fs = require("node:fs");
  const path = require("node:path");
  const assert = require("node:assert/strict");
  const { performance } = require("node:perf_hooks");
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const quick = Boolean(process.env.REX_PREVIEW_QUICK);
  const matched = Boolean(process.env.REX_PREVIEW_MATCHED);
  const equivalent = matched ? (await import(process.env.REX_PREVIEW_EQUIVALENT)).equivalent : null;
  const selectedRound = process.env.REX_PREVIEW_ROUND === "" ? null : Number(process.env.REX_PREVIEW_ROUND);
  const warmups = quick ? 2 : 20, samples = quick ? 5 : 300, rounds = quick ? 1 : 3;
  const wait = async (label, predicate) => {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > 120000) throw Error(`Timed out: ${label}`);
      await delay(50);
    }
  };
  const api = await vscode.extensions.getExtension("henryxiaoyang.realtime-tex").activate();
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const file = path.join(folder, "main.tex");
  const results = [];
  if (matched) {
    for (const command of ["workbench.action.closeSidebar", "workbench.action.closeAuxiliaryBar", "workbench.action.closePanel"]) await vscode.commands.executeCommand(command);
    await vscode.commands.executeCommand("vscode.setEditorLayout", {orientation:0,groups:[{size:0.2},{size:0.8}]});
  }
  for (const round of selectedRound === null ? Array.from({length:rounds},(_,i)=>i) : [selectedRound]) {
    for (const pages of [10, 100, 300]) {
      const paragraph = "The quick brown fox jumps over the lazy dog. Each edit re-typesets only this paragraph, preserving precise glyph positions and line breaking. ".repeat(3);
      const pre = matched ? "\\documentclass[a4paper]{article}\n\\usepackage{amsmath}\n" : "\\documentclass{article}\n\\usepackage{amsmath}\n";
      const source = pre + "\\begin{document}\n" + Array.from({length: pages}, (_, i) => paragraph + "\n\n" + (i + 1 < pages ? "\\newpage\n\n" : "")).join("") + "\\end{document}\n";
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("realtimeTex.stop");
      api.panel()?.panel.dispose();
      fs.writeFileSync(file, source);
      const doc = await vscode.workspace.openTextDocument(file);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      if (doc.getText() !== source) assert.ok(await editor.edit(edit=>edit.replace(new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),source)));
      assert.equal(doc.getText(),source,"Editor did not load the current corpus");
      await vscode.commands.executeCommand("realtimeTex.openPreview");
      if (matched) await vscode.commands.executeCommand("vscode.setEditorLayout", {orientation:0,groups:[{size:0.2},{size:0.8}]});
      await wait("session", () => api.session()?.running);
      const s = api.session();
      await wait("layout", () => s.model.pagesTotal === pages && s.status.convergence?.state === "Converged" && !s.status.pending);
      await delay(1500);
      const webview = api.panel().panel.webview;
      const send = webview.postMessage.bind(webview);
      const change = s.onDidChangeDocument.bind(s);
      let pending;
      let snapshotResolve;
      let clockResolve;
      s.onDidChangeDocument = event => {
        if (pending && event.document===doc && event.contentChanges.length) {
          pending.eventAt = performance.now();
          pending.eventEpoch = performance.timeOrigin + pending.eventAt;
        }
        return change(event);
      };
      webview.postMessage = message => {
        if (message.type === "paragraph" && pending) message = {...message, rexBenchmark: {id: pending.id}};
        return send(message);
      };
      const subscription = webview.onDidReceiveMessage(message => {
        if (message.type === "error") console.log("[preview-error]", message.message);
        if (message.type === "rexBenchmarkSnapshot") { snapshotResolve?.(message); return; }
        if (message.type === "rexBenchmarkClock") { clockResolve?.(message.now); return; }
        if (message.type !== "rexBenchmarkDrawn" || !pending || message.id !== pending.id) return;
        const ended = performance.now();
        pending.resolve({...message, eventEpoch: pending.eventEpoch, clock: pending.clock,
          editToCanvasMs: message.canvasSubmittedAt + pending.clock.offsetMs - pending.eventEpoch,
          editToAckMs: ended - pending.eventAt, triggerToAckMs: ended - pending.triggerAt});
      });
      // Clock origins from separate Node/Chromium processes can drift. Bound the offset
      // with a five-message exchange and use the shortest round trip; recalibrate often.
      const calibrate = async () => {
        const exchanges = [];
        for (let n = 0; n < 5; n++) {
          const reply = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error("No clock reply")), 30000);
            clockResolve = value => {clearTimeout(timeout); resolve(value);};
          });
          const start = performance.timeOrigin + performance.now();
          await send({type: "rexBenchmarkClock"});
          const browser = await reply;
          const end = performance.timeOrigin + performance.now();
          exchanges.push({start, browser, end, offsetMs: (start + end) / 2 - browser,
            uncertaintyMs: (end - start) / 2});
        }
        return exchanges.sort((a,b) => a.uncertaintyMs - b.uncertaintyMs)[0];
      };
      const values = [];
      const hashes = {};
      const liveLists = {};
      const fingerprints = {};
      let lastRevision = -1;
      let clock;
      const at = source.indexOf("brown fox") + "brown ".length;
      let schedule = performance.now() + 50;
      try {
        for (let i = 0; i < warmups + samples; i++) {
          if (i % 20 === 0) clock = await calibrate();
          if (matched) await delay(Math.max(0, schedule - performance.now()));
          const word = i % 2 ? "cat" : "dog";
          assert.notEqual(doc.getText().slice(at,at+3),word,"Scheduled edit would be a no-op");
          let finish;
          const done = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error(`No drawn paragraph: ${pages} pages, edit ${i}, status ${JSON.stringify(s.status)}`)), 30000);
            finish = value => {clearTimeout(timeout); resolve(value);};
          });
          pending = {id: i, resolve: finish, triggerAt: performance.now(), eventAt: NaN, clock};
          assert.ok(await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(at), doc.positionAt(at + 3)), word)));
          const result = await done;
          assert.ok(result.editToAckMs > 0 && result.editToAckMs <= result.triggerToAckMs);
          assert.ok(result.editToCanvasMs > 0 && result.editToCanvasMs <= result.editToAckMs, "Cross-process clocks must bound the drawing endpoint");
          assert.ok(result.revision > lastRevision);
          lastRevision = result.revision;
          assert.equal(result.usedPdf, false, "Expected exact Canvas rendering");
          assert.equal(result.reason, null, "Missing resources or approximate output");
          if (matched) {
            assert.equal(result.viewportWidth,640); assert.equal(result.viewportHeight,600);
            assert.ok(result.innerWidth>=640 && result.innerHeight>=636,"Preview viewport is clipped by the host window");
            assert.equal(result.dpr,1); assert.equal(result.width,794); assert.equal(result.height,1123);
            assert.equal(result.zoom,1,"Preview is not at 100% zoom");
          }
          if (matched) {
            liveLists[word] = [...s.model.overlays.values()].find(x=>x.revision===result.revision).dl;
            const fingerprint=JSON.stringify(liveLists[word]);
            if(fingerprints[word]!==undefined) assert.equal(fingerprint,fingerprints[word],"Unstable compiled output");
            fingerprints[word]=fingerprint;
          } else {
            if (hashes[word] !== undefined) assert.equal(result.hash, hashes[word], "Pixels changed for an identical edit");
            hashes[word] = result.hash;
            assert.notEqual(hashes.cat, hashes.dog, "Preview did not change");
          }
          result.engineMs = s.status.lastFastMs;
          result.scheduledAt = schedule;
          result.scheduleLateMs = matched ? Math.max(0, pending.triggerAt - schedule) : null;
          if (i >= warmups) values.push(result);
          pending = undefined;
          if (matched) schedule += 60 + ((Math.imul(i + 1, 1103515245) >>> 0) % 41);
          else await delay(2);
        }
        // Independent full-document layout and drawing, outside the measured loop.
        const referenceHashes = {};
        const referenceValidation = {};
        for (const word of ["cat", "dog"]) {
          if (doc.getText().slice(at, at + 3) !== word) {
            let drawn;
            if(matched) drawn=new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error("No post-run draw")),30000);pending={id:-1,resolve:r=>{clearTimeout(timer);yes(r);},triggerAt:performance.now(),clock};});
            assert.ok(await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(at), doc.positionAt(at + 3)), word)));
            if(matched){await drawn;pending=undefined;}
          }
          if(matched) {
            const snapshot=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("No post-run snapshot")),30000);snapshotResolve=r=>{clearTimeout(timer);resolve(r);};});
            await send({type:"rexBenchmarkSnapshot"});
            hashes[word]=(await snapshot).hash;
          }
          s.recompile();
          await wait("full reference", () => !s.status.pending && s.status.convergence?.state === "Converged" && s.model.overlays.size === 0);
          await delay(800);
          const snapshot = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error("No reference snapshot")), 30000);
            snapshotResolve = value => { clearTimeout(timeout); resolve(value); };
          });
          await send({type: "rexBenchmarkSnapshot"});
          const reference = await snapshot;
          assert.equal(reference.overlays, 0, "Full reference still contains live overlays");
          if (matched) {
            const page=s.model.pages.get(1).dl;
            const uid=page.lines[0].unit;
            const lines=page.lines.filter(l=>l.unit===uid);
            const unit={uid,placements:lines.map(l=>({page:1,row:l.row}))};
            assert.ok(equivalent(liveLists[word],unit,[...s.model.pages.values()].sort((a,b)=>a.page-b.page).map(p=>p.dl)),"Live glyphs/positions differ from full compilation");
            referenceValidation[word]={equivalent:true,pixelEqual:reference.hash===hashes[word],unit,fullPage:page};
          } else assert.equal(reference.hash, hashes[word], "Live pixels differ from independently compiled full-page reference");
          referenceHashes[word] = reference.hash;
        }
        if(matched) assert.notEqual(hashes.cat,hashes.dog,"Post-run preview pixels did not change");
        results.push({round, pages, warmups, samples, pixelHashes: hashes, referenceHashes, referenceValidation, compiledLists:matched?liveLists:undefined, values});
        fs.writeFileSync(process.env.REX_PREVIEW_OUT, JSON.stringify({quick, rounds: results}));
        console.log(`[preview] round ${round + 1}, ${pages} pages: ${values.length} verified draws`);
      } finally {
        subscription.dispose();
        s.onDidChangeDocument = change;
        webview.postMessage = send;
        await s.stop();
        api.panel()?.panel.dispose();
        // Discard synthetic edits before replacing the on-disk corpus.
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      }
    }
  }
  const percentile = (xs, q) => [...xs].sort((a,b) => a-b)[Math.max(0, Math.ceil(xs.length * q) - 1)];
  const summary = [10,100,300].map(pages => {
    const runs = results.filter(x => x.pages === pages);
    const stats = field => ({medianMs: percentile(runs.map(r => percentile(r.values.map(v => v[field]), .5)), .5),
      p95Ms: percentile(runs.map(r => percentile(r.values.map(v => v[field]), .95)), .5)});
    return {pages, ...stats("editToCanvasMs"), [matched?"acknowledgedUpdate":"acknowledgedReadback"]: stats("editToAckMs")};
  });
  fs.writeFileSync(process.env.REX_PREVIEW_OUT, JSON.stringify({quick, warmups, samples, roundCount: rounds,
    boundary: matched ? "Editor document-change callback -> first-page Canvas replacement; no pixel readback in warmups or timed samples; secondary timer includes message acknowledgement only" : "VS Code document-change callback through native rtex and upstream webview animation-frame drawing to Canvas replacement; excludes editor applyEdit trigger, cold setup, pixel verification and screen compositing. Secondary timer includes pixel readback/hash and acknowledgement.",
    matched, selectedRound, cadence: matched ? "Absolute scheduled starts, deterministic 60–100 ms intervals" : "2 ms after verified acknowledgement",
    rounds: results, summary, vscodeVersion: vscode.version}, null, 2));
}
