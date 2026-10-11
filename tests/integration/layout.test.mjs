import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {load} from '../helpers/runtime-helper.mjs';
import {engine,run,collect,liveDriver} from '../../src/compiler/runtime.js';
import {mailbox,send,wireDevices,decodeFrame} from '../../src/protocol/transport.js';
import {decodeDisplayList,equivalent} from '../../src/protocol/display-list.js';
import {preamble} from '../../src/core/document.js';
import {PDFDocument, rgb} from 'pdf-lib';
import {changedSpan, paragraphs} from '../../src/core/document.js';
const reference=JSON.parse(await fs.readFile(new URL('../fixtures/layout-baseline.json',import.meta.url),'utf8'));
const res=await load();
function canonical(page) {
  const items=a=>a.map(item=>{
    const v=item.slice();
    if(v[0]==='g') {
      const f=page.fonts[v[1]];
      v[1]=[f.filename||f.name,f.size,f.slant||0,f.extend||0,f.squeeze||0,f.subfont||0];
    }
    return v;
  });
  return {page_width:page.page_width,page_height:page.page_height,
    lines:page.lines.map(l=>({x:l.x,y:l.y,w:l.w,h:l.h,d:l.d,items:items(l.items)})),other:items(page.other)};
}
for(const fixture of reference.cases) test('frozen layout parity: '+fixture.name,async()=>{
  const logs=[];
  const M=await engine(res,{'main.tex':fixture.source,'capture.tex':'\\RequirePackage{rex-capture}\\input{main.tex}'},l=>logs.push(l));
  assert.equal(run(M,'capture.tex'),0,logs.join('\n'));
  assert.deepEqual(collect(M).pages.map(canonical),fixture.pages);
});
test('live transactions replay body macros, math version and counters',async()=>{
  const pre=String.raw`\documentclass{article}\usepackage{amsmath}\newcommand{\word}[1]{Original #1}`;
  const spans=['\\section{First}','\\word{choice} with ordinary words.',
    '\\word{choice} with ordinary words.','A bold formula $\\alpha+\\beta=\\gamma$.',
    '\\begin{figure}\\centering Text in a float.\\caption{Caption}\\end{figure}',
    'A shaped paragraph with different skips and line widths. '.repeat(8), 'An ordinary paragraph after restoring the skips and shape.'];
  const source=pre+'\n\\begin{document}\n'+spans[0]+'\n\n'+spans[1]+ '\n\n\\renewcommand{\\word}[1]{Changed #1}\n\n'+spans[2]+
    '\n\n\\boldmath\n\n'+spans[3]+'\n\n'+spans[4]+
    '\n\n\\leftskip=3pt plus 1pt\\parshape=2 5pt 90pt 10pt 80pt\n\n'+spans[5]+
    '\n\n\\leftskip=0pt\\parshape=0\n\n'+spans[6]+'\n\\end{document}';
  const logs=[];
  const M=await engine(res,{'main.tex':source,'capture.tex':'\\RequirePackage{rex-capture}\\input{main.tex}'},l=>logs.push(l));
  assert.equal(run(M,'capture.tex'),0,logs.join('\n'));
  const layout=collect(M);
  const units=spans.map(s=>layout.capture.units.find(u=>u.begin_line===source.slice(0,source.indexOf(s)).split('\n').length));
  // The repeated paragraph has its own body definition snapshot.
  units[2]=layout.capture.units.find(u=>u.begin_line===source.slice(0,source.lastIndexOf(spans[2])).split('\n').length);
  assert.ok(units.every(Boolean));
  const requests=units.flatMap((u,i)=>[{op:'context',id:u.uid,ctx:u},{op:'compile',ctx:u.uid,req:i+1,source:spans[i]}]);
  requests.push({op:'shutdown'});
  const box=mailbox(),frames=[];
  const live=await engine(res,{'live.tex':liveDriver(pre)},l=>logs.push(l),{REX_REQ:'/rex-input',REX_RESP:'/rex-output'});
  wireDevices(live,box,bytes=>{frames.push(decodeFrame(bytes));const next=requests.shift();if(next)send(box,new TextEncoder().encode(JSON.stringify(next)+'\n'));});
  assert.equal(run(live,'live.tex'),0,logs.join('\n'));
  const results=frames.filter(f=>f.header.op==='result');
  assert.equal(results.length,spans.length,JSON.stringify(frames.map(f=>f.header)));
  results.forEach((r,i)=>{
    assert.equal(r.header.status,'ok'); assert.equal(r.header.leaks,undefined);
    assert.ok(equivalent(decodeDisplayList(r.binary),units[i],layout.pages),
      'context rows differ: '+i+' '+JSON.stringify({context:units[i].macros,live:decodeDisplayList(r.binary).lines.map(l=>l.items.filter(x=>x[0]==='g').map(x=>String.fromCodePoint(x[2])).join('')),
        expected:units[i].placements.map(p=>layout.pages[p.page-1].lines.find(l=>l.unit===units[i].uid&&l.row===p.row)?.items.filter(x=>x[0]==='g').map(x=>String.fromCodePoint(x[2])).join(''))}));
  });
});
for (const assignment of [String.raw`\global\hsize=1pt`, String.raw`\global\output{}`, String.raw`\newcounter{hidden}`, String.raw`\global\parshape=1 2pt 4pt`]) test('hidden global writes stop the resident engine: ' + assignment,async()=>{
  const pre=String.raw`\documentclass{article}\newcommand{\poison}{` + assignment + '}';
  const source=pre+'\n\\begin{document}\nA paragraph.\n\\end{document}';
  const M=await engine(res,{'main.tex':source,'capture.tex':'\\RequirePackage{rex-capture}\\input{main.tex}'});
  assert.equal(run(M,'capture.tex'),0); const unit=collect(M).capture.units[0];
  const requests=[{op:'context',id:unit.uid,ctx:unit},{op:'compile',req:1,ctx:unit.uid,source:'\\poison Hidden write.'}];
  const box=mailbox(),frames=[];
  const live=await engine(res,{'live.tex':liveDriver(preamble(source))},()=>{},{REX_REQ:'/rex-input',REX_RESP:'/rex-output'});
  wireDevices(live,box,bytes=>{frames.push(decodeFrame(bytes));const next=requests.shift();if(next)send(box,new TextEncoder().encode(JSON.stringify(next)+'\n'));});
  assert.equal(run(live,'live.tex'),0);
  assert.equal(frames.at(-1).header.op,'fatal');
});
test('live tables, footnote markers and transformed PDF images match fresh full output', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([30, 20]).drawRectangle({x: 0, y: 0, width: 15, height: 20, color: rgb(1, 0, 0)});
  pdf.addPage([30, 20]).drawRectangle({x: 0, y: 0, width: 30, height: 20, color: rgb(0, 1, 0)});
  const asset = await pdf.save(), pre = String.raw`\documentclass{article}\usepackage{graphicx}\usepackage{booktabs}`;
  const original = [String.raw`\begin{tabular}{ll}\toprule One & Two\\\midrule A & B\\\bottomrule\end{tabular}`,
    String.raw`Text with a footnote\footnote{Footnote body.} and more text.`,
    String.raw`\includegraphics[width=18pt,angle=15]{image.pdf}`,
    String.raw`\begin{table}\centering\begin{tabular}{ll}One & Two\\A & B\end{tabular}\caption{Sample}\end{table}`];
  const edited = original.map(text => text.replace('One', 'Three').replace('more text', 'changed text').replace('18pt', '23pt').replace('angle=15', 'angle=15,page=2').replace('Sample', 'Changed'));
  async function full(spans) {
    const source = pre + '\n\\begin{document}\n' + spans.join('\n\n') + '\n\n\\end{document}';
    const logs = [], M = await engine(res, {'main.tex': source, 'image.pdf': asset, 'capture.tex': '\\RequirePackage{rex-capture}\\input{main.tex}'}, line => logs.push(line));
    assert.equal(run(M, 'capture.tex'), 0, logs.join('\n'));
    const layout = collect(M);
    layout.units = spans.map(span => layout.capture.units.find(unit => unit.begin_line === source.slice(0, source.indexOf(span)).split('\n').length));
    assert.ok(layout.units.every(unit => unit?.placements.length)); return layout;
  }
  const base = await full(original), reference = await full(edited);
  assert.equal(base.units[1].placements.length, 1, 'Footnote body must not belong to its source paragraph');
  const requests = base.units.flatMap((unit, i) => [{op: 'context', id: unit.uid, ctx: unit},
    {op: 'compile', req: i * 2 + 1, ctx: unit.uid, source: original[i]}, {op: 'compile', req: i * 2 + 2, ctx: unit.uid, source: edited[i]}]);
  requests.push({op: 'shutdown'});
  const box = mailbox(), frames = [], logs = [];
  const live = await engine(res, {'live.tex': liveDriver(pre), 'image.pdf': asset}, line => logs.push(line), {REX_REQ: '/rex-input', REX_RESP: '/rex-output'});
  wireDevices(live, box, bytes => {frames.push(decodeFrame(bytes)); const next = requests.shift(); if (next) send(box, new TextEncoder().encode(JSON.stringify(next) + '\n'));});
  assert.equal(run(live, 'live.tex'), 0, logs.join('\n'));
  const results = frames.filter(frame => frame.header.op === 'result'); assert.equal(results.length, 8);
  results.forEach((frame, i) => {
    assert.equal(frame.header.status, 'ok', JSON.stringify(frame.header));
    const layout = i % 2 ? reference : base, dl = decodeDisplayList(frame.binary);
    assert.ok(equivalent(dl, layout.units[Math.floor(i / 2)], layout.pages), 'Live output differs: ' + i);
    if (Math.floor(i / 2) === 2) assert.equal(Object.values(dl.images_info)[0].file, '/work/image.pdf');
  });
});
test('cached edit blocks support repeated splits, merges and neighbouring edits', () => {
  let before = '\\documentclass{article}\n\\begin{document}\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\\end{document}';
  let cached = paragraphs(before);
  for (const [from, to, index, removed] of [['First paragraph.', 'First\n\nparagraph.', 0, 1],
    ['paragraph.', 'expanded paragraph.', 0, 1], ['expanded paragraph.\n\nSecond', 'expanded paragraph. Second', 0, 2],
    ['Third', 'Final', 1, 1]]) {
    const after = before.replace(from, to), delta = changedSpan(before, after, false, cached);
    assert.ok(delta); assert.equal(delta.index, index); assert.equal(delta.removed, removed);
    assert.equal(delta.next.text, after.slice(delta.next.start, delta.next.end));
    cached = delta.spans; before = after;
  }
});
test('edit blocks retain whitespace insertions and deletions at paragraph boundaries', () => {
  const before = '\\documentclass{article}\n\\begin{document}\nFirst paragraph. \n\nSecond paragraph.\n\\end{document}';
  for (const [from, to] of [['First paragraph.', 'First paragraph with more words. '], [' \n\nSecond', '  Second'],
    ['Second paragraph.', 'Second paragraph.\n\nA new paragraph.'], ['Second paragraph.', '']]) {
    const after = before.replace(from, to), delta = changedSpan(before, after, false, paragraphs(before));
    assert.ok(delta, JSON.stringify({from, to})); assert.equal(delta.next.text, after.slice(delta.next.start, delta.next.end));
    if (from === ' \n\nSecond') assert.equal(delta.removed, 2);
  }
});
