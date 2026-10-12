// Matched editor-document-change -> first-page Canvas-update measurements.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { _electron } from "playwright";
import { startServer } from "../scripts/serve.mjs";

const plugin = path.resolve(process.argv[2] || "../realtime-tex-vsc-plugin");
const engine = path.resolve(process.argv[3] || "../realtime-tex");
const runtime = path.resolve(process.argv.find(x=>x.startsWith("--electron="))?.slice(11) || "artifacts/benchmarks/realtime-preview/electron-runtime/node_modules/electron");
const electronPath = createRequire(path.join(runtime,"package.json"))(runtime);
const quick = process.argv.includes("--quick");
const only = process.argv.find(x=>x.startsWith("--tool="))?.slice(7);
const output = path.resolve(process.argv.find(x=>x.startsWith("--output="))?.slice(9) || "artifacts/benchmarks/preview-comparison.json");
const artifacts = path.resolve("artifacts/benchmarks/matched-preview");
await fs.mkdir(artifacts,{recursive:true});
const fingerprintFiles=["src/ui/app.js","src/ui/editor.js","src/ui/renderer.js","src/compiler/session.js","dist/manifest.json"];
const fingerprints=()=>Promise.all(fingerprintFiles.map(async file=>[file,createHash("sha256").update(await fs.readFile(file)).digest("hex")]));
const initialHashes=await fingerprints();
const rounds = quick ? 1 : 3;
const reports = {rex:[],"realtime-tex":[]};
for(let round=0;round<rounds;round++) {
  const order = round%2 ? ["realtime-tex","rex"] : ["rex","realtime-tex"];
  for(const tool of order) {
    if(only && only!==tool) continue;
    if(tool==="rex") reports.rex.push(await rexRound(round));
    else {
      const file=path.join(artifacts,`realtime-${round}${quick?"-quick":""}.json`);
      const log=await fs.open(path.join(artifacts,`realtime-${round}${quick?"-quick":""}.log`),"w");
      try {
        const args=["benchmarks/realtime-preview.mjs",plugin,engine,"--matched",`--round=${round}`,`--output=${file}`];
        if(quick) args.push("--quick");
        await new Promise((resolve,reject)=>{
          const child=spawn(process.execPath,args,{stdio:["ignore",log.fd,log.fd]});
          child.once("error",reject);
          child.once("exit",code=>code===0?resolve():reject(Error(`realtime-tex exited ${code}; see ${log.path ?? file.replace('.json','.log')}`)));
        });
      } finally {await log.close();}
      reports[tool].push(JSON.parse(await fs.readFile(file,"utf8")));
      console.log(`[matched] realtime-tex round ${round+1} complete`);
    }
  }
}
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const summary=[];
for(const [tool,rr] of Object.entries(reports)) {
  if(!rr.length) continue;
  for(const pages of [10,100,300]) {
    const runs=rr.flatMap(x=>x.rounds).filter(x=>x.pages===pages);
    summary.push({tool,pages,
      medianMs:percentile(runs.map(r=>percentile(r.values.map(v=>v.editToCanvasMs),.5)),.5),
      p95Ms:percentile(runs.map(r=>percentile(r.values.map(v=>v.editToCanvasMs),.95)),.5)});
  }
}
if(!only) {
  const versions=Object.values(reports).flat().flatMap(r=>r.rounds).flatMap(r=>r.values).map(v=>v.userAgent.match(/Chrome\/([^ ]+)/)?.[1]);
  assert.equal(new Set(versions).size,1,"Browser versions must match");
}
const report={date:new Date().toISOString(),quick,roundCount:rounds,environment:{cpu:os.cpus()[0].model,os:os.release(),node:process.version},
  boundary:"Actual editor document-change listener entry -> first-page Canvas drawing submission complete; excludes triggering the synthetic editor edit, verification/readback, acknowledgement and screen compositing",
  conditions:{paper:"A4",viewport:[640,600],canvas:[794,1123],dpr:1,zoom:"100%",cadence:"Absolute scheduled starts, deterministic 60–100 ms intervals",order:"Rex/realtime-tex, realtime-tex/Rex, Rex/realtime-tex"},
  reports,summary,driver:await fs.readFile(new URL(import.meta.url),"utf8"),
  rexSourceHashes:Object.fromEntries(initialHashes)};
assert.deepEqual(await fingerprints(),initialHashes,"Rex source/build changed during measurement");
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(report)+"\n");
console.log(JSON.stringify({output,summary},null,2));

async function rexRound(round) {
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),"rex-matched-"));
  const main=path.join(scratch,"main.cjs");
  await fs.writeFile(main,`const {app,BrowserWindow}=require('electron');
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.setPath('userData',${JSON.stringify(path.join(scratch,"profile"))});
app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:1000,webPreferences:{nodeIntegration:false,contextIsolation:true}});w.loadURL('about:blank');});`);
  const server=await startServer();
  let app;
  try {
    app=await _electron.launch({executablePath:electronPath,args:["--force-device-scale-factor=1",main]});
    const page=await app.firstWindow();
    const metrics=await app.context().newCDPSession(page);
    await metrics.send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    const original=await fs.readFile("dist/assets/ui/editor.js","utf8");
    const marker="if (update.docChanged) onChange(update.state.doc.toString());";
    assert.equal(original.split(marker).length,2,"Editor callback changed");
    await page.route("**/assets/ui/editor.js",route=>route.fulfill({contentType:"text/javascript",body:original.replace(marker,"if (update.docChanged) { globalThis.rexMatchedBenchmark?.changed(); onChange(update.state.doc.toString()); }")}));
    await page.goto(server.url);
    await page.waitForFunction(()=>Boolean(window.rex?.session.warmed),{},{timeout:120000});
    await page.evaluate(()=>rex.session.warmed);
    await page.locator("#auto-locate").uncheck();
    await page.evaluate(()=>{
      Object.assign(rex.renderer.container.style,{position:"fixed",right:"0",top:"100px",width:"640px",height:"600px",padding:"16px",boxSizing:"border-box",alignItems:"flex-start"});
      const fit=rex.renderer.fitPages.bind(rex.renderer);
      rex.renderer.fitPages=()=>{fit();for(const view of rex.renderer.views.values())view.host.style.zoom="1";};
    });
    const results=[];
    for(const pages of [10,100,300]) {
      const result=await page.evaluate(async ({pages,round,quick})=>{
        const assert=(ok,message)=>{if(!ok) throw Error(message);};
        const delay=ms=>new Promise(r=>setTimeout(r,ms));
        const wait=async(test,label)=>{const t=performance.now();while(!test()){if(performance.now()-t>120000) throw Error(label);await delay(20);}};
        const paragraph="The quick brown fox jumps over the lazy dog. Each edit re-typesets only this paragraph, preserving precise glyph positions and line breaking. ".repeat(3);
        const source="\\documentclass[a4paper]{article}\n\\usepackage{amsmath}\n\\begin{document}\n"+Array.from({length:pages},(_,i)=>paragraph+"\n\n"+(i+1<pages?"\\newpage\n\n":"")).join("")+"\\end{document}\n";
        const s=rex.session, renderer=rex.renderer, editor=rex.editor;
        s.warmed=null;
        s.setFiles({"main.tex":source});
        editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:source}});
        await wait(()=>s.warmed,"Rex did not warm"); await s.warmed;
        await wait(()=>renderer.views.get(1)?.ready,"Rex page did not render");
        assert(s.layout.capture.pages===pages,"Page count differs");
        renderer.container.scrollTop=0;renderer.container.scrollLeft=0;
        renderer.fitPages();
        await delay(1500);
        const hash=()=>{
          const c=renderer.views.get(1).canvas;
          const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          let h=2166136261;for(const byte of pixels) h=Math.imul(h^byte,16777619)>>>0;
          return h;
        };
        const b=window.rexMatchedBenchmark={pending:null,changed(){if(this.pending)this.pending.eventAt=performance.now();}};
        const repaint=renderer.repaint.bind(renderer);
        const compile=s.live.compile.bind(s.live);
        s.live.compile=async(...args)=>{const r=await compile(...args);if(b.pending){b.pending.dl=r.dl;b.pending.unit=args[0];b.pending.compilerMs=r.ms;}return r;};
        renderer.repaint=(n,...args)=>{
          const r=repaint(n,...args);
          if(n===1 && b.pending && Number.isFinite(b.pending.eventAt)) {
            const pending=b.pending;
            pending.committedAt=performance.now();
            pending.resolve(pending);
          }
          return r;
        };
        const warmups=quick?2:20,samples=quick?5:300,values=[],hashes={},liveLists={},fingerprints={};
        const at=source.indexOf('brown fox')+'brown '.length;
        let schedule=performance.now()+50;
        try {
          for(let i=0;i<warmups+samples;i++) {
            await delay(Math.max(0,schedule-performance.now()));
            const word=i%2?'cat':'dog';
            const done=new Promise((resolve,reject)=>{
              const timer=setTimeout(()=>reject(Error(`No Rex Canvas update: ${pages}, ${i}`)),30000);
              b.pending={resolve:r=>{clearTimeout(timer);resolve(r);},triggerAt:performance.now()};
            });
            editor.dispatch({changes:{from:at,to:at+3,insert:word}});
            const r=await done;
            assert(r.dl && r.unit,'No paragraph compilation before drawing');
            assert(r.committedAt>r.eventAt,'Missing editor-change timestamp');
            const fingerprint=JSON.stringify(r.dl);
            if(fingerprints[word]!==undefined)assert(fingerprints[word]===fingerprint,'Unstable compiled output');
            fingerprints[word]=fingerprint;
            liveLists[word]={dl:r.dl,uid:r.unit.uid};
            const c=renderer.views.get(1).canvas;
            assert(c.width===794 && c.height===1123 && devicePixelRatio===1,'Canvas/DPR differs: '+JSON.stringify([c.width,c.height,devicePixelRatio]));
            assert(renderer.container.clientWidth===640 && renderer.container.clientHeight===600,'Viewport differs');
            assert(renderer.views.get(1).host.style.zoom==='1','Preview is not at 100% zoom');
            if(i>=warmups)values.push({id:i,revision:s.revision,editToCanvasMs:r.committedAt-r.eventAt,width:c.width,height:c.height,dpr:devicePixelRatio,
              viewportWidth:renderer.container.clientWidth,viewportHeight:renderer.container.clientHeight,userAgent:navigator.userAgent,compilerRoundtripMs:r.compilerMs,
              zoom:renderer.views.get(1).host.style.zoom,
              scheduleLateMs:Math.max(0,r.triggerAt-schedule)});
            b.pending=null;
            schedule+=60+((Math.imul(i+1,1103515245)>>>0)%41);
          }
          for(const word of ['cat','dog']) {
            if(editor.state.doc.sliceString(at,at+3)!==word) {
              const drawn=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No post-run draw')),30000);b.pending={resolve:r=>{clearTimeout(timer);resolve(r);}};});
              editor.dispatch({changes:{from:at,to:at+3,insert:word}});
              await drawn;
              b.pending=null;
            }
            hashes[word]=hash();
          }
          assert(hashes.cat!==hashes.dog,'Post-run preview did not change');
          // Validate glyph identities, positions and line boxes against independent full passes.
          renderer.repaint=repaint;
          s.live.compile=compile;
          const {equivalent}=await import('./assets/protocol/display-list.js');
          const references={};
          for(const word of ['cat','dog']) {
            if(editor.state.doc.sliceString(at,at+3)!==word) editor.dispatch({changes:{from:at,to:at+3,insert:word}});
            await delay(50);
            clearTimeout(s.timer);
            await wait(()=>s.standbyReady,'Standby not ready');
            const previous=s.layout;
            s.warmed=null;
            s.full();
            await wait(()=>s.layout!==previous && s.warmed,'Reference full pass missing');
            await s.warmed;
            const item=liveLists[word];
            const unit=renderer.capture.units.find(u=>u.uid===item.uid);
            assert(unit && equivalent(item.dl,unit,renderer.pages),'Rex live glyphs/positions differ from full compilation');
            references[word]={uid:unit.uid,rows:unit.placements.length,equivalent:true,unit,fullPage:renderer.pages[0]};
          }
          return {round,pages,warmups,samples,values,pixelHashes:hashes,references,compiledLists:liveLists};
        } finally {renderer.repaint=repaint; b.pending=null; window.rexMatchedBenchmark=null;}
      },{pages,round,quick});
      results.push(result);
      console.log(`[matched] Rex round ${round+1}, ${pages} pages: ${result.values.length} verified updates`);
    }
    assert.deepEqual(errors,[],"Rex page errors");
    return {rounds:results,electron:await app.evaluate(()=>process.versions.electron),rendererObservation:original.replace(marker,"if (update.docChanged) { globalThis.rexMatchedBenchmark?.changed(); onChange(update.state.doc.toString()); }")};
  } finally {
    await app?.close();
    await server.close();
    await fs.rm(scratch,{recursive:true,force:true});
  }
}
