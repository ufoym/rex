// Real VS Code document-change callback -> native SDL drawing-command submission.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const positional=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const root=path.resolve(positional[0] || 'artifacts/benchmarks/texpresso-preview/upstream');
const plugin=path.resolve(positional[1] || 'artifacts/benchmarks/texpresso-preview/plugin');
const runtime=path.resolve('artifacts/benchmarks/realtime-preview/plugin');
const requireRuntime=createRequire(path.join(runtime,'package.json'));
const {build}=requireRuntime('esbuild');
const {runTests}=requireRuntime('@vscode/test-electron');
const quick=process.argv.includes('--quick');
const output=path.resolve(process.argv.find(s=>s.startsWith('--output='))?.slice(9) || 'artifacts/benchmarks/texpresso-preview/results.json');
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const sha=s=>createHash('sha256').update(s).digest('hex');
assert.equal(git(plugin,'status','--porcelain'),'','Use a clean plugin checkout');
const patch=await fs.readFile(new URL('texpresso-observer.patch',import.meta.url),'utf8');
assert.equal(git(root,'diff'),patch.trim(),'Apply exactly the supplied observer patch');
const source=await fs.readFile(path.join(plugin,'src/extension.ts'),'utf8');
const marker='vscode.workspace.onDidChangeTextDocument(event => {';
assert.equal(source.split(marker).length,2);
let observed=source.replace(marker,marker+'\n\t\tbenchmarkChanged?.(event);');
const receiveMarker="texpresso.stdout.on('data', data => {\n\t\t\t\t\tconst message = JSON.parse(data.toString());";
assert.equal(observed.split(receiveMarker).length,2,'Protocol receiver changed');
observed=observed.replace(receiveMarker,"require('node:readline').createInterface({input:texpresso.stdout}).on('line', (line: string) => {\n\t\t\t\t\tconst message = JSON.parse(line);");
observed=observed.replace('texpresso = spawn(command, args);','texpresso = spawn(command, args, {detached:true});');
observed=observed.replace('export function activate(', 'let benchmarkChanged: ((event: vscode.TextDocumentChangeEvent) => void) | undefined;\nexport function activate(');
const tail="\n}\n\n// This method is called when your extension is deactivated";
assert.equal(observed.split(tail).length,2);
observed=observed.replace(tail,"\n\treturn {get process() {return texpresso;}, setObserver(fn: any) {benchmarkChanged=fn;}};"+tail);
await build({stdin:{contents:observed,resolveDir:path.join(plugin,'src'),sourcefile:'extension.ts',loader:'ts'},bundle:true,outfile:path.join(plugin,'dist/extension.js'),platform:'node',format:'cjs',external:['vscode'],target:'node22'});
const scratch=await fs.realpath(await fs.mkdtemp('/tmp/rex-txp-'));
const project=path.join(scratch,'project');
await fs.mkdir(project);
await fs.mkdir(path.join(scratch,'profile/User'),{recursive:true});
await fs.writeFile(path.join(scratch,'profile/User/settings.json'),JSON.stringify({
  'texpresso.command':path.join(root,'build/texpresso'),
  'texpresso.syncTeXForwardOnSelection':false,'texpresso.useEditorTheme':false,
  'texpresso.useChangeRangeMode':false,'security.workspace.trust.enabled':false,
  'workbench.startupEditor':'none','editor.minimap.enabled':false,'files.autoSave':'off','chat.disableAIFeatures':true,
}));
const suiteFile=path.join(scratch,'suite.cjs'),runFile=path.join(scratch,'run.json');
await fs.writeFile(suiteFile,`exports.run=${suite.toString()};\n`);
const files=['src/frontend/main.c','src/frontend/driver.c','src/frontend/renderer.c','build/texpresso','build/texpresso-xetex','Makefile.config'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await fs.readFile(path.join(root,f)))])));
const before=await hashes();
try {
  await runTests({cachePath:path.resolve('artifacts/benchmarks/realtime-preview/vscode-cache'),version:'1.141.0',
    extensionDevelopmentPath:plugin,extensionTestsPath:suiteFile,
    launchArgs:[project,'--user-data-dir',path.join(scratch,'profile'),'--extensions-dir',path.join(scratch,'extensions'),'--disable-extensions','--disable-extension=github.copilot-chat','--skip-welcome','--skip-release-notes','--force-device-scale-factor=1'],
    extensionTestsEnv:{REX_TXP_OUT:runFile,REX_TXP_QUICK:quick?'1':'',REX_TXP_ROOT:root},
  });
  assert.deepEqual(await hashes(),before,'Native sources/build changed during measurement');
  const report=JSON.parse(await fs.readFile(runFile,'utf8'));
  Object.assign(report,{date:new Date().toISOString(),quick,environment:{cpu:os.cpus()[0].model,os:os.release(),node:process.version,
    tex:execFileSync('kpsewhich',['--version'],{encoding:'utf8'}).split('\n')[0],sdl:execFileSync('pkg-config',['--modversion','sdl2'],{encoding:'utf8'}).trim(),mupdf:'1.28.5',compiler:'Apple clang 17.0.0, -O2'},
    upstream:{engine:git(root,'rev-parse','HEAD'),plugin:git(plugin,'rev-parse','HEAD')},
    boundary:'Actual VS Code plugin document-change listener entry -> txp_renderer_render return, before SDL_RenderPresent; excludes edit triggering, readback/validation, acknowledgement, GPU completion and screen presentation',
    conditions:{paper:'A4',viewport:[640,600],pageWidthPixels:794,dpr:1,zoom:'100% CSS-equivalent (794 px A4 width)',cadence:'Absolute scheduled starts, deterministic 60–100 ms intervals',order:'TeXpresso measured subsequently; three rounds, 10/100/300 pages per round',viewer:'Headed native SDL, default accelerated Metal backend with production vsync; only viewport/DPR/zoom configured'},
    instrumentation:{nativePatch:patch,pluginSourceSha256:sha(source),pluginObservedSource:observed,pluginInsertion:'Observer at document-change callback entry; readline framing compatibility repair; return process handle and observer setter; detached process group solely for owned-process cleanup',driver:await fs.readFile(new URL(import.meta.url),'utf8'),sourceHashes:before,buildConfig:await fs.readFile(path.join(root,'Makefile.config'),'utf8')}});
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report)+'\n');
  console.log(JSON.stringify({output,summary:report.summary},null,2));
} finally {await fs.rm(scratch,{recursive:true,force:true});}

async function suite() {
  const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
  const {spawn}=require('node:child_process'),{performance}=require('node:perf_hooks'),{createHash}=require('node:crypto');
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(test,label)=>{const start=performance.now();while(!test()){if(performance.now()-start>120000)throw Error(label);await delay(20);}};
  const quick=!!process.env.REX_TXP_QUICK,warmups=quick?2:20,samples=quick?5:300;
  const api=await vscode.extensions.getExtension('DominikPeters.texpresso-basic').activate();
  const project=vscode.workspace.workspaceFolders[0].uri.fsPath;
  const results=[],protocolErrors=[];let currentCase=null;
  const monitor=error=>{if(error instanceof SyntaxError && error.stack?.includes('texpresso-preview/plugin/dist/extension.js'))protocolErrors.push({case:currentCase,at:performance.now(),message:error.message});};
  process.on('uncaughtExceptionMonitor',monitor);
  function observe(proc) {
    const messages=[],waiters=[];let buffer='',log='';
    proc.stderr.on('data',chunk=>{
      log+=chunk.toString();buffer+=chunk.toString();
      while(buffer.includes('\n')) {
        const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);
        if(!line.startsWith('REX_BENCH '))continue;
        const m=JSON.parse(line.slice(10));messages.push(m);
        const i=waiters.findIndex(w=>w.test(m));if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}
      }
    });
    proc.once('exit',(code)=>{for(const w of waiters){clearTimeout(w.timer);w.reject(Error(`TeXpresso exited ${code}`));}});
    return {messages,get log(){return log;},next(test){return new Promise((resolve,reject)=>{const w={test,resolve,reject,timer:setTimeout(()=>reject(Error('No native response; '+log.slice(-2000))),120000)};waiters.push(w);});},send(cmd){proc.stdin.write(JSON.stringify(cmd)+'\n');}};
  }
  async function snapshot(o) {const done=o.next(m=>m.type==='snapshot');o.send(['rex-snapshot']);return done;}
  async function stop(proc) {if(proc.exitCode!==null)return;const done=new Promise(r=>proc.once('exit',r));const kill=signal=>{try{process.kill(-proc.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}};kill('SIGTERM');const timer=setTimeout(()=>kill('SIGKILL'),3000);await done;clearTimeout(timer);kill('SIGKILL');}
  async function reference(source,pages,word,round) {
    const folder=path.join(project,`reference-${round}-${pages}-${word}`);fs.mkdirSync(folder);
    const file=path.join(folder,'main.tex');fs.writeFileSync(file,source.replace('brown fox','brown '+word));
    const proc=spawn(path.join(process.env.REX_TXP_ROOT,'build/texpresso'),['-texlive','-json',file],{detached:true});
    const o=observe(proc);proc.stdout.resume();
    try {await delay(1500);const value=await snapshot(o);fs.writeFileSync(path.join(folder,'stderr.log'),o.log);return value;}
    finally {await stop(proc);}
  }
  for(let round=0;round<(quick?1:3);round++)for(const pages of [10,100,300]) {
    const paragraph='The quick brown fox jumps over the lazy dog. Each edit re-typesets only this paragraph, preserving precise glyph positions and line breaking. '.repeat(3);
    const source='\\documentclass[a4paper]{article}\n\\usepackage{amsmath}\n\\AtBeginDvi{\\special{pdf:pagesize width 210mm height 297mm}}\n\\begin{document}\n'+Array.from({length:pages},(_,i)=>paragraph+'\n\n'+(i+1<pages?'\\newpage\n\n':'')).join('')+'\\end{document}\n';
    currentCase={round,pages,phase:'setup'};
    const references={};for(const word of ['cat','dog'])references[word]=await reference(source,pages,word,round);
    assert.notEqual(references.cat.trace,references.dog.trace,'Reference glyphs do not differ');
    assert.notEqual(references.cat.pixels,references.dog.pixels,'Reference pixels do not differ');
    const file=path.join(project,`main-${round}-${pages}.tex`);fs.writeFileSync(file,source);
    const doc=await vscode.workspace.openTextDocument(file),editor=await vscode.window.showTextDocument(doc);
    assert.equal(doc.getText(),source);
    await vscode.commands.executeCommand('texpresso.startDocument');
    await wait(()=>api.process,'No native process');const proc=api.process,o=observe(proc);
    let pending=null;
    api.setObserver(event=>{if(pending && event.document===doc && event.contentChanges.length)pending.eventAt=performance.now();});
    try {
      await delay(1500);await snapshot(o);
      const calibrations=[];
      async function clock(atEdit) {
        const pings=[];
        for(let j=0;j<5;j++){const done=o.next(m=>m.type==='clock'),sent=performance.now();o.send(['rex-clock']);const m=await done,received=performance.now();pings.push({sent,received,native:m.now,offsetMs:m.now-(sent+received)/2,halfRttMs:(received-sent)/2});}
        const best=[...pings].sort((a,b)=>a.halfRttMs-b.halfRttMs)[0];calibrations.push({atEdit,best,pings});return best;
      }
      let calibration=await clock(0),schedule=performance.now()+50,lastRevision=0;
      const values=[];currentCase={round,pages,phase:'edits'};
      const at=source.indexOf('brown fox')+6;
      for(let i=0;i<warmups+samples;i++) {
        if(i && i%20===0)calibration=await clock(i);
        await delay(Math.max(0,schedule-performance.now()));
        const word=i%2?'cat':'dog';assert.notEqual(doc.getText().slice(at,at+3),word,'No-op edit');
        pending={id:i,triggerAt:performance.now()};
        const done=o.next(m=>m.type==='draw' && m.revision>lastRevision);
        assert(await editor.edit(b=>b.replace(new vscode.Range(doc.positionAt(at),doc.positionAt(at+3)),word)));
        const m=await done;lastRevision=m.revision;
        assert(Number.isFinite(pending.eventAt),'No editor-change timestamp');
        assert.deepEqual(m.viewport,[640,600]);assert(Math.abs(m.pagePixels[0]-794)<.01,'Wrong page scale');
        assert(Math.abs(m.pagePixels[1]-1123)<1,'Wrong A4 page height: '+JSON.stringify(m));assert.equal(m.renderer,'metal');
        const elapsed=m.now-calibration.offsetMs-pending.eventAt;assert(elapsed>0,'Invalid clock alignment');
        if(i>=warmups)values.push({...m,id:i,word,editToDrawMs:elapsed,eventAt:pending.eventAt,clockCalibration:calibrations.length-1,clockUncertaintyMs:calibration.halfRttMs,scheduleLateMs:Math.max(0,pending.triggerAt-schedule)});
        pending=null;schedule+=60+((Math.imul(i+1,1103515245)>>>0)%41);
      }
      currentCase={round,pages,phase:'validation'};const snapshots={};
      for(const word of ['cat','dog']) {
        if(doc.getText().slice(at,at+3)!==word){const done=o.next(m=>m.type==='draw' && m.revision>lastRevision);await editor.edit(b=>b.replace(new vscode.Range(doc.positionAt(at),doc.positionAt(at+3)),word));lastRevision=(await done).revision;}
        snapshots[word]=await snapshot(o);
        assert.equal(snapshots[word].trace,references[word].trace,'Live display list differs from independent fresh compilation');
        assert.equal(snapshots[word].traceBytes,references[word].traceBytes);
        assert.equal(snapshots[word].pixels,references[word].pixels,'Live pixels differ from independent fresh compilation');
      }
      const ordered=values.map(v=>v.editToDrawMs).sort((a,b)=>a-b),medianMs=ordered[Math.ceil(ordered.length*.5)-1],p95Ms=ordered[Math.ceil(ordered.length*.95)-1];
      const result={round,pages,sourceSha256:createHash('sha256').update(source).digest('hex'),warmups,samples,values,calibrations,references,snapshots,medianMs,p95Ms};results.push(result);
      fs.writeFileSync(path.join(project,`stderr-${round}-${pages}.log`),o.log);
      fs.writeFileSync(process.env.REX_TXP_OUT,JSON.stringify({rounds:results}));
      console.log(`[matched] TeXpresso round ${round+1}, ${pages} pages: ${medianMs.toFixed(3)} ms median, ${p95Ms.toFixed(3)} ms P95; validated native frames`);
    } finally {api.setObserver(null);await stop(proc);await vscode.commands.executeCommand('texpresso.stop');}
  }
  const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
  const summary=[10,100,300].map(pages=>{const runs=results.filter(r=>r.pages===pages);return {tool:'texpresso',pages,medianMs:percentile(runs.map(r=>r.medianMs),.5),p95Ms:percentile(runs.map(r=>r.p95Ms),.5),measuredEdits:runs.reduce((n,r)=>n+r.samples,0)};});
  process.off('uncaughtExceptionMonitor',monitor);
  fs.writeFileSync(process.env.REX_TXP_OUT,JSON.stringify({rounds:results,summary,vscodeVersion:vscode.version,protocolErrors}));
}
