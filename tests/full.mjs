import {openBrowser} from './browser-helper.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {browser, page, close} = await openBrowser({basePath: "/rex/"});
try {
await page.waitForFunction(() => window.rex?.session.warmed, {}, {timeout:120000});
await page.evaluate(() => rex.session.warmed);
// Test the full coordinator directly so PDF comparisons include the cache's actual rendered output.
await page.evaluate(() => {
  rex.session.background.terminate(); rex.session.live.close();
  window.rev = 0;
  window.resetFull = () => {
    window.full?.terminate();
    window.full = new Worker('./assets/background-worker.js', {type:'module'});
    window.results = []; window.standby = false;
    full.onmessage = ({data}) => {
      if(data.type === 'standby-ready') window.standby = true;
      if(data.type === 'layout') {results.push(data); window.resolveCompile(data);}
      if(data.type === 'failure') window.rejectCompile(Error(data.message));
    };
  };
  resetFull();
  window.compile = (files, options = {}) => new Promise((resolve,reject) => {
    window.resolveCompile=resolve; window.rejectCompile=reject; window.standby=false;
    full.postMessage({files,main:'main.tex',revision:++rev,aux:results.at(-1)?.aux,options});
  });
  window.metrics = d => ({passes:d.passes,converged:d.converged,ms:d.ms,bodyMs:d.bodyMs,pictureHits:d.pictureHits,bibliographyRuns:d.bibliographyRuns,usedStandby:d.usedStandby});
});
const tikz = String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
A plain paragraph before the diagram.

\begin{tikzpicture}
\foreach \x in {1,...,600} {\draw[gray] (0,0) -- (\x/200,2);}
\draw[red,thick] (0,0) rectangle (3,2);
\draw[blue] (0,0) -- (3,2);
\node at (1.5,1) {Exact TeX};
\end{tikzpicture}

A paragraph after the diagram.
\end{document}`;
const cold=await page.evaluate(async source => {
  const d = await compile({'main.tex':source},{pictureCache:false,standby:false});
  window.uncachedPDF = d.pdf.slice();
  window.lineGeometry = output => output.pages.map(page => page.lines.map(({x,y,w,h,d}) => ({x,y,w,h,d})));
  window.uncachedLines = lineGeometry(d);
  return metrics(d);
},tikz);
await page.evaluate(() => {window.results=[];});
const seeded=await page.evaluate(async source => metrics(await compile({'main.tex':source})),tikz);
await page.waitForFunction(() => window.standby);
const cached=await page.evaluate(async source => metrics(await compile({'main.tex':source})),tikz);
assert.ok(cached.usedStandby,'preloaded preamble was not consumed');
assert.ok(cached.pictureHits>0,'TikZ was not reused: '+JSON.stringify(await page.evaluate(()=>results.map(r=>({pics:r.capture.pics,hits:r.capture.pic_hits,mismatches:r.capture.pic_mismatch})))));
assert.ok(cached.converged);
const geometry = await page.evaluate(() => ({uncached:uncachedLines, cached:lineGeometry(results.at(-1))}));
assert.deepEqual(geometry.cached, geometry.uncached, 'Picture reuse changed TeX line geometry');
const pixels=await page.evaluate(async () => {
  const pdfjs=await import('./vendor/pdfjs/pdf.mjs');
  async function raster(data) {
    const doc = await pdfjs.getDocument({data:data.slice()}).promise;
    try {
      const p = await doc.getPage(1), v = p.getViewport({scale:1.5});
      const canvas = document.createElement('canvas');
      canvas.width = v.width; canvas.height = v.height;
      // Readback comparisons need a fixed Canvas backend: GPU/CPU stroke antialiasing differs.
      const context = canvas.getContext('2d', {willReadFrequently:true});
      await p.render({canvasContext:context, viewport:v}).promise;
      return context.getImageData(0,0,canvas.width,canvas.height).data;
    } finally { await doc.destroy(); }
  }
  function compare(a, b) {
    if (a.length !== b.length) throw Error('PDF raster dimensions changed');
    let different = 0, maxDelta = 0;
    for (let i=0;i<a.length;i++) {
      const delta = Math.abs(a[i]-b[i]);
      if (delta>1) different++;
      maxDelta = Math.max(maxDelta,delta);
    }
    return {different,maxDelta};
  }
  const a = await raster(uncachedPDF), b = await raster(results.at(-1).pdf);
  const repeatedRaster = compare(a, await raster(uncachedPDF));
  return {...compare(a,b), repeatedRaster};
});
assert.deepEqual(pixels.repeatedRaster,{different:0,maxDelta:0},'PDF raster readback is nondeterministic');
assert.ok(pixels.different<20,JSON.stringify(pixels));
const edited=await page.evaluate(async source => metrics(await compile({'main.tex':source.replace('plain paragraph','edited paragraph')})),tikz);
assert.ok(edited.pictureHits>0,'prose edit invalidated diagram');
const changed=await page.evaluate(async source => metrics(await compile({'main.tex':source.replace('rectangle (3,2)','rectangle (4,2)')})),tikz);
assert.equal(changed.pictureHits,0,'changed picture was reused');
const invalidated=await page.evaluate(async source => metrics(await compile({'main.tex':source.replace('\\usepackage{tikz}', '\\usepackage{tikz}\n\\tikzset{every picture/.style={scale=2}}')})),tikz);
assert.equal(invalidated.usedStandby,false,'old preamble standby was used');
assert.equal(invalidated.pictureHits,0,'old preamble picture was reused');
const bib='@book{knuth, author={Donald E. Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}';
const bibliographyResults=[];
for(const backend of ['bibtex','biber','biblatex-bibtex']) {
  await page.evaluate(() => resetFull());
  const source=String.raw`\documentclass{article}`+'\n'+(backend!=='bibtex'?String.raw`\usepackage[backend=`+(backend==='biber'?'biber':'bibtex')+String.raw`]{biblatex}
\addbibresource{refs/books.bib}`:'')+'\n'+String.raw`\begin{document}
Test citation \cite{knuth}.

`+(backend!=='bibtex'?String.raw`\printbibliography`:String.raw`\bibliographystyle{plain}\bibliography{refs/books}`)+String.raw`
\end{document}`;
  const result=await page.evaluate(async ({source,bib})=>{const d=await compile({'main.tex':source,'refs/books.bib':bib});return {...metrics(d),bbl:new TextDecoder().decode(d.aux['capture.bbl']),logs:d.logs};},{source,bib});
  console.log(backend,result.passes,result.ms);
  assert.ok(result.converged,backend+' did not converge');
  assert.equal(result.bibliographyRuns,1);
  assert.ok(result.bbl.includes('TeXbook'));
  const reused=await page.evaluate(async ({source,bib})=>metrics(await compile({'main.tex':source.replace('Test citation','New citation'),'refs/books.bib':bib})),{source,bib});
  assert.equal(reused.bibliographyRuns,0);
  const changed=await page.evaluate(async ({source,bib})=>{const d=await compile({'main.tex':source,'refs/books.bib':bib.replace('The TeXbook','Changed Title')});return {...metrics(d),bbl:new TextDecoder().decode(d.aux['capture.bbl'])};},{source,bib});
  assert.equal(changed.bibliographyRuns,1);
  assert.ok(changed.bbl.includes('Changed Title'));
  let offline;
  if (backend === 'biber') {
    await page.context().setOffline(true);
    try { offline = await page.evaluate(async ({source,bib}) => {
      const d = await compile({'main.tex':source,'refs/books.bib':bib.replace('The TeXbook','Offline Bibliography')});
      return {...metrics(d), bbl:new TextDecoder().decode(d.aux['capture.bbl'])};
    }, {source,bib}); } finally { await page.context().setOffline(false); }
    assert.equal(offline.bibliographyRuns,1); assert.ok(offline.bbl.includes('Offline Bibliography'));
  }
  bibliographyResults.push({backend,initial:result.ms,reused,changed:metricsNode(changed),offline:offline && metricsNode(offline)});
  await page.evaluate(({source,bib})=>{full.terminate();rex.session.createBackground();rex.session.setFiles({'main.tex':source,'refs/books.bib':bib});},{source,bib});
  await page.waitForFunction(()=>rex.session.warmed,{}, {timeout:120000});
  await page.evaluate(()=>rex.session.warmed);
  const liveCitation=await page.evaluate(async()=>{const s=rex.session;await s.edit(s.source.replace('Test citation','New citation'));clearTimeout(s.timer);return {patches:rex.renderer.patches.size,timing:s.lastTiming,converged:s.layout.converged,log:document.querySelector('#log').textContent.slice(-1500)};});
  assert.ok(liveCitation.converged);
  assert.equal(liveCitation.patches,1,backend+' citation could not update live: '+liveCitation.log);
  // Restore the coordinator-only harness for the next backend.
  await page.evaluate(()=>{rex.session.background.terminate();rex.session.live.close();});

}
const examples = [];
// Index entries and style changes regenerate the index; unrelated edits reuse it.
await page.evaluate(() => resetFull());
const indexed = String.raw`\documentclass{article}
\usepackage{imakeidx}
\makeindex[options=-s local.ist]
\makeindex[name=names,title=Names]
\begin{document}
An indexed paragraph.\index{Alpha}\index[names]{Ada}
\printindex
\printindex[names]
\end{document}`;
const style = 'heading_prefix "\\\\textbf{"\nheading_suffix "}\\\\nopagebreak\\n"\nheadings_flag 1\n';
const indexing = await page.evaluate(async ({source, style}) => {
  const data = await compile({'main.tex':source, 'local.ist':style});
  return {converged:data.converged, runs:data.indexRuns, pages:data.capture.pages, index:new TextDecoder().decode(data.aux['capture.ind']), names:new TextDecoder().decode(data.aux['names.ind'])};
}, {source:indexed,style});
assert.ok(indexing.converged && indexing.pages >= 3); assert.equal(indexing.runs,2);
assert.ok(indexing.index.includes('Alpha') && indexing.names.includes('Ada'));
const reusedIndex = await page.evaluate(async ({source,style}) => {
  const data = await compile({'main.tex':source.replace('indexed paragraph','ordinary paragraph'), 'local.ist':style}); return data.indexRuns;
}, {source:indexed,style});
assert.equal(reusedIndex,0);
const changedStyle = await page.evaluate(async ({source,style}) => {
  const data = await compile({'main.tex':source, 'local.ist':style.replace('headings_flag 1','headings_flag 0')});
  return {runs:data.indexRuns, converged:data.converged, index:new TextDecoder().decode(data.aux['capture.ind'])};
}, {source:indexed,style});
assert.ok(changedStyle.converged && !changedStyle.index.includes('\\textbf{A}')); assert.equal(changedStyle.runs,1);
await page.context().setOffline(true);
let offlineIndex;
try { offlineIndex = await page.evaluate(async ({source,style}) => {
  const data = await compile({'main.tex':source.replace('Alpha','Beta'), 'local.ist':style});
  return {runs:data.indexRuns, converged:data.converged, index:new TextDecoder().decode(data.aux['capture.ind'])};
}, {source:indexed,style}); } finally { await page.context().setOffline(false); }
assert.ok(offlineIndex.converged && offlineIndex.index.includes('Beta') && !offlineIndex.index.includes('Alpha'));
assert.equal(offlineIndex.runs,1);
const removedIndex = await page.evaluate(async ({source,style}) => {
  const data = await compile({'main.tex':source.replace('\\index{Alpha}',''), 'local.ist':style});
  return {converged:data.converged, index:new TextDecoder().decode(data.aux['capture.ind'])};
}, {source:indexed,style});
assert.ok(removedIndex.converged && !removedIndex.index.includes('Alpha') && !removedIndex.index.includes('Beta'), 'Removed index entries survived the standby release');
console.log('Named indexes, local style, cache reuse, removed entries and offline MakeIndex passed.');
for (const [name, files] of [
  ['math', {'main.tex': await fs.readFile(new URL('../examples/math.tex', import.meta.url), 'utf8')}],
  ['pictures', {'main.tex': await fs.readFile(new URL('../examples/pictures.tex', import.meta.url), 'utf8')}],
  ['bibliography', {
    'main.tex': await fs.readFile(new URL('../examples/bibliography/main.tex', import.meta.url), 'utf8'),
    'references.bib': await fs.readFile(new URL('../examples/bibliography/references.bib', import.meta.url), 'utf8'),
  }],
  ['project', {
    'main.tex': await fs.readFile(new URL('../examples/project/main.tex', import.meta.url), 'utf8'),
    'chapters/introduction.tex': await fs.readFile(new URL('../examples/project/chapters/introduction.tex', import.meta.url), 'utf8'),
  }],
]) {
  await page.evaluate(() => resetFull());
  const result = await page.evaluate(async files => {
    const d = await compile(files);
    return {...metrics(d), pdfBytes:d.pdf.length};
  }, files);
  assert.ok(result.converged && result.pdfBytes > 1000, name + ' example failed');
  examples.push({name, ...result});
}
function metricsNode(x){const {bbl,...rest}=x;return rest;}
const result={date:new Date().toISOString(),browser:browser.version(),cold,seeded,cached,pixels,lineGeometryMatches:true,edited,changed,invalidated,bibliography:bibliographyResults,indexing:{initial:indexing,reusedRuns:reusedIndex,changedStyle,offline:offlineIndex,removed:removedIndex},examples};
await fs.mkdir('artifacts/tests',{recursive:true});await fs.writeFile('artifacts/tests/full.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));} finally { await close(); }
