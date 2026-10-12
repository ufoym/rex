import {mkdir, readFile, writeFile, cp, readdir, mkdtemp, rm, copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {bundles} from '../src/compiler/assets.js';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const engineURL = 'https://github.com/jmckalex/mp-tikz-wasm/releases/download/v0.4.0/mp-tikz-wasm-0.4.0.tar.gz';
const engineHash = '6cae11a63fee19b4298e71be83f9bbfaffc5d20cae69ccd23254fe7fce369dad';
const release = 'https://github.com/TeXlyre/texlyre-busytex-build/releases/download/build_wasm_46ebb6216a5c1fe63dd1dc885831d1a8cef2dc86_31802832436_1/';
const assets = {
  'busytex.js': '875b87795162cb26b15bd93cffa2e8739bcb900d623ab904029b39402508a1a4',
  'busytex.wasm': '8d1988fc58cd1611c3cbd6bd986c3e607e5ff44f1d94252207ff7aae4cee72e0',
  'biber.js': 'f097b241ec1dfaff8c43b7c3e242a85c535d4a24b6252288da869d1a8b465c08',
  'biber.wasm': '6c2ddccf3b95e06b419d4aee5f88ef10ddec658ce760fabb34d7145371ff18c5',
  'biber.data': '9ea1357e6180477479b5edfe17538ba655ebebc03142a195d85fb1d47899df21',
};
function command(cmd, args) {
  const r = spawnSync(cmd, args, {stdio:'inherit'});
  if(r.status !== 0) throw Error(cmd + ' failed');
}
const sha = b => createHash('sha256').update(b).digest('hex');
async function download(url, file, hash, prefix = '', suffix = '') {
  let bytes;
  try {
    const cached = await readFile(file);
    bytes = cached.subarray(Buffer.byteLength(prefix), cached.length - Buffer.byteLength(suffix));
  } catch {}
  if (!bytes || sha(bytes) !== hash) {
    command('curl', ['-fL', '--retry', '3', url, '-o', file]);
    bytes = await readFile(file);
  }
  if(sha(bytes) !== hash) throw Error('SHA-256 mismatch: ' + file);
  if (prefix || suffix) await writeFile(file, prefix + bytes.toString() + suffix);
}
async function setupEngine(temp) {
  console.log("Downloading pinned LuaTeX WASM and TeX bundles (45 MB)…");
  const archive = path.join(temp, "engine.tar.gz");
  await download(engineURL, archive, engineHash);
  command("tar", ["-xzf", archive, "-C", temp]);
  const source = path.join(temp, "mp-tikz-wasm-0.4.0"),
    dist = path.join(source, "dist"),
    dest = "vendor/engine";
  await rm(path.join(dest, "vfs"), {recursive: true, force: true});
  await mkdir(path.join(dest, "vfs"), { recursive: true });
  for (const file of ["luatex.mjs", "luatex.wasm", "logger.js", "vfs/bundle.js", "vfs/lazyfs.js"])
    await cp(path.join(dist, file), path.join(dest, file), { recursive: true });
  for (const name of [...bundles.filter(name => name !== 'bibliography'), 'hot.json'])
    await cp(
      path.join(dist, "bundles", name),
      path.join(dest, "bundles", name),
      { recursive: true },
    );
  for (const file of ["LICENSE", "NOTICE.md", "licenses"])
    await cp(path.join(source, file), path.join(dest, file), {
      recursive: true,
    });
  await mkdir("vendor/pdfjs", { recursive: true });
  await copyFile(
    "node_modules/opentype.js/dist/opentype.module.js",
    "vendor/opentype.js",
  );
  await copyFile(
    "node_modules/opentype.js/LICENSE",
    "vendor/opentype-LICENSE",
  );
  for (const f of ["pdf.mjs", "pdf.worker.mjs"])
    await copyFile(
      "node_modules/pdfjs-dist/build/" + f,
      "vendor/pdfjs/" + f,
    );
  await copyFile(
    "node_modules/pdfjs-dist/LICENSE",
    "vendor/pdfjs/LICENSE",
  );
  command("python3", ["-m", "venv", path.join(temp, "fonttools")]);
  const python = path.join(temp, "fonttools", "bin", "python");
  command(python, ["-m", "pip", "install", "fonttools==4.60.1"]);
  command(python, ["scripts/type1-outlines.py"]);
}
async function setupBibliography(temp) {
  const dest = 'vendor/bibliography';
  await mkdir(dest, {recursive:true});
  const compat = `const require = globalThis.process?.versions?.node ? (await import('node:module')).createRequire(import.meta.url) : undefined;\nconst __dirname = decodeURIComponent(new URL('.', import.meta.url).pathname);\n`;
  for(const [name, hash] of Object.entries(assets)) {
    const module = name.endsWith('.js') && name.slice(0, -3);
    await download(release + name, path.join(dest, module ? module + '.mjs' : name), hash,
      module ? compat : '', module ? '\nexport default ' + module + ';\n' : '');
    if (module) await rm(path.join(dest, name), {force:true});
  }
  const buildSource = 'https://raw.githubusercontent.com/TeXlyre/texlyre-busytex-build/46ebb6216a5c1fe63dd1dc885831d1a8cef2dc86/';
  await download(buildSource + 'LICENSE', path.join(dest, 'TeXlyre-LICENSE'), '8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef');
  await download(buildSource + 'NOTICE', path.join(dest, 'TeXlyre-NOTICE'), '984c51c84d462e27d93386f65a07c4e7177f18a1b2f9c8d8c4b2f343e89f0c56');
  await download('https://github.com/plk/biblatex/archive/refs/tags/v3.22.tar.gz', path.join(temp,'biblatex.tar.gz'), 'adb952420025785839aa7e67793606c24c9d9935f8b42015dffe4958515b3f04');
  // Use a fixed HTTPS mirror: automatic redirects can select a mirror with a broken certificate chain.
  await download('https://mirrors.mit.edu/CTAN/macros/latex/contrib/logreq.zip', path.join(temp,'logreq.zip'), '14b1a51c4b4204be70d78c1789a89e7d28a3ee1b43f341d0f50f606d2c97f517');
  await download('https://mirrors.mit.edu/CTAN/biblio/bibtex/base.zip', path.join(temp,'base.zip'), 'de1557d3a4b853416d4802034d1b06712e6ffe4e7b0b7aecfc13f63adf525ad1');
  command('tar',['-xzf',path.join(temp,'biblatex.tar.gz'),'-C',temp]);
  command('unzip',['-q',path.join(temp,'logreq.zip'),'-d',temp]);
  command('unzip',['-q',path.join(temp,'base.zip'),'-d',temp]);
  const bundle = 'vendor/engine/bundles/bibliography', root = path.join(bundle,'files');
  await mkdir(root,{recursive:true});
  await cp(path.join(temp,'biblatex-3.22/tex'),path.join(root,'tex'),{recursive:true});
  await cp(path.join(temp,'biblatex-3.22/bibtex'),path.join(root,'bibtex'),{recursive:true});
  await mkdir(path.join(root,'tex/latex/logreq'),{recursive:true});
  for(const f of await readdir(path.join(temp,'logreq'))) if(/\.(sty|def|dtd)$/.test(f)) await copyFile(path.join(temp,'logreq',f),path.join(root,'tex/latex/logreq',f));
  await mkdir(path.join(root,'bibtex/bst/base'),{recursive:true});
  for(const f of await readdir(path.join(temp,'base'))) if(f.endsWith('.bst')) await copyFile(path.join(temp,'base',f),path.join(root,'bibtex/bst/base',f));
  const files = {};
  async function walk(dir, rel = '') { for(const ent of await readdir(dir,{withFileTypes:true})) { const name=rel+ent.name; if(ent.isDirectory()) await walk(path.join(dir,ent.name),name+'/'); else {let bytes=await readFile(path.join(dir,ent.name)); if(name === 'tex/latex/biblatex/biblatex.sty') { bytes=Buffer.from(bytes.toString().replace('\\def\\abx@date{DATE}', '\\def\\abx@date{2026/08/13}').replace('\\def\\abx@version{VERSION}', '\\def\\abx@version{3.22}')); await writeFile(path.join(dir,ent.name),bytes); } files[name]={size:bytes.length,sha:sha(bytes)};} } }
  await walk(root);
  await writeFile(path.join(bundle,'manifest.json'),JSON.stringify({name:'bibliography',version:'biblatex-3.22',files,eager:[]}));
  await copyFile(path.join(temp,'biblatex-3.22/README.md'),path.join(dest,'biblatex-README.md'));
  await copyFile(path.join(temp,'logreq/README'),path.join(dest,'logreq-README'));
  const pdfLib = await readFile('node_modules/pdf-lib/dist/pdf-lib.min.js','utf8');
  await writeFile('vendor/pdf-lib.mjs',pdfLib.replace('}(this,','}(globalThis,')+'\nexport default globalThis.PDFLib;\n');
  await copyFile('node_modules/pdf-lib/LICENSE.md','vendor/pdf-lib-LICENSE.md');
  console.log('Bibliography WASM, BibLaTeX 3.22, styles and PDF cache tools ready.');
}
const temp = await mkdtemp(path.join(tmpdir(), 'rex-assets-'));
try {
  if (!process.argv.includes('--bibliography')) await setupEngine(temp);
  await setupBibliography(temp);
  await mkdir('vendor', {recursive:true});
  await download('https://mirrors.mit.edu/CTAN/install/macros/luatex/generic/ctablestack.tds.zip', path.join(temp, 'ctablestack.tds.zip'), 'a975aa44f20d7705b4e2d41a63008d00e4439143999cb12acce75f24d5d56943');
  command('unzip', ['-q', path.join(temp, 'ctablestack.tds.zip'), '-d', path.join(temp, 'ctablestack')]);
  await copyFile(path.join(temp, 'ctablestack/tex/luatex/ctablestack/ctablestack.sty'), 'vendor/ctablestack.sty');
  console.log('Ready: npm run dev, or npm run build to produce dist/.');
} finally { await rm(temp, {recursive:true, force:true}); }
