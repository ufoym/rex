import test from 'node:test';
import assert from 'node:assert/strict';
import {scanPictures} from '../src/picture-cache.js';
import {standbyKey,bodySnapshot} from '../src/full-pass.js';
import {packFiles,unpackFiles} from '../src/snapshot.js';
import {preamble,paragraphs} from '../src/document.js';
const source=String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
Plain prose.
\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}
\end{document}`;
test('picture identity survives prose and line movement but follows definitions and dependencies',async()=>{
  const scan=async (s,extras={})=>(await scanPictures({'main.tex':s,...extras},'main.tex'))[0];
  const p=await scan(source);assert.ok(p.cacheable);
  assert.equal(p.hash,(await scan(source.replace('Plain prose.','Different prose.\n'))).hash);
  assert.notEqual(p.key,(await scan(source.replace('Plain prose.','Different prose.\n'))).key);
  assert.notEqual(p.hash,(await scan(source.replace('-- (1,1)','-- (2,1)'))).hash);
  assert.notEqual(p.hash,(await scan(source.replace('Plain prose.',String.raw`\tikzset{every path/.style={red}}`))).hash);
  assert.notEqual(p.hash,(await scan(source,{'local.sty':'changed'})).hash);
});
test('position, aux, escaped assignments and data dependent pictures are drawn',async()=>{
 for(const command of [String.raw`\ref{label}`,String.raw`\today`,String.raw`\gdef\foo{bar}`,String.raw`\addplot table {data.csv}`,'remember picture',String.raw`\directlua{print('x')}`]) {
   const [p]=await scanPictures({'main.tex':source.replace('\\draw (0,0) -- (1,1);',command)},'main.tex');assert.equal(p.cacheable,false,command);
 }
 const [loop] = await scanPictures({'main.tex':source.replace('\\draw (0,0) -- (1,1);',String.raw`\foreach \x in {1,2,3} {\draw (0,0) -- (\x,1);}`)},'main.tex');
 assert.ok(loop.cacheable,'local TikZ drawing loops are reusable');
});
test('standby identity covers preamble and imported files; body padding preserves line numbers',async()=>{
 const key=await standbyKey({'main.tex':source,'preamble.tex':'original'},'main.tex');
 assert.equal(key,await standbyKey({'main.tex':source.replace('Plain prose.','Other prose.'),'preamble.tex':'original'},'main.tex'));
 assert.notEqual(key,await standbyKey({'main.tex':source,'preamble.tex':'changed'},'main.tex'));
 const body=bodySnapshot({'main.tex':source},'main.tex')['main.tex'];assert.equal(body.split('\n').findIndex(s=>s.includes('begin{tikzpicture}')),source.split('\n').findIndex(s=>s.includes('begin{tikzpicture}')));
});
test('input-chain pictures are keyed to the original file; repeated inputs are never cached',async()=>{
 const files={'main.tex':source.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/,String.raw`\input{chapter}`),'chapter.tex':String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`};
 const [p]=await scanPictures(files,'main.tex');assert.equal(p.key,'/work/chapter.tex:1');assert.ok(p.cacheable);
 files['main.tex']=files['main.tex'].replace('\\input{chapter}','\\input{chapter}\n\\input{chapter}');
 assert.ok((await scanPictures(files,'main.tex')).every(p=>!p.cacheable));
});
test('standby snapshot preserves nested binary files across shared memory',()=>{
 const files={'nested/image.pdf':new Uint8Array([0,128,255]),'main.tex':'Unicode \u4e2d\u6587'};
 const packed=packFiles(files),shared=new SharedArrayBuffer(packed.length);new Uint8Array(shared).set(packed);
 const unpacked=unpackFiles(new Uint8Array(shared));assert.deepEqual(unpacked['nested/image.pdf'],files['nested/image.pdf']);assert.equal(new TextDecoder().decode(unpacked['main.tex']),files['main.tex']);
});
test('comments and macro bodies cannot move the standby boundary',()=>{
 const s='% Example: \\begin{document}\n\\newcommand{\\example}{\\begin{document}}\n'+source+'\n% Example: \\end{document}';
 assert.ok(preamble(s).endsWith('\\usepackage{tikz}\n'));
 assert.ok(bodySnapshot({'main.tex':s},'main.tex')['main.tex'].includes('\\begin{document}\nPlain prose.'));
 assert.equal(paragraphs(s).length,1);
});
