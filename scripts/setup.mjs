import {mkdir, readFile, writeFile, cp, readdir, mkdtemp, rm, copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {bundles} from '../src/compiler/assets.js';
import {buildEditor} from './editor-vendor.mjs';
import {pruneAssets} from './prune-assets.mjs';
import {installTools} from './install-tools.mjs';
import {buildFontAssets} from './font-assets.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const engineURL = 'https://github.com/jmckalex/mp-tikz-wasm/releases/download/v0.4.0/mp-tikz-wasm-0.4.0.tar.gz';
const engineHash = '6cae11a63fee19b4298e71be83f9bbfaffc5d20cae69ccd23254fe7fce369dad';
const release = 'https://github.com/TeXlyre/texlyre-busytex-build/releases/download/build_wasm_46ebb6216a5c1fe63dd1dc885831d1a8cef2dc86_31802832436_1/';
const assets = {
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
  for (const name of [...bundles.filter(name => !['bibliography', 'chinese'].includes(name)), 'hot.json'])
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
  await installTools();
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
async function setupChinese(temp) {
  // Match the bundled TeX Live 2025 kernel; newer ctex requires LaTeX 2026.
  const base = 'https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final/archive/';
  const packages = {
    'ctex': 'd2e2d951997f1db32b01e803515987a921a6f24a6326d795c42671e6a7444ac4',
    'ctex.doc': '7102c3d85e8b9269d6643f38c5019e43d5e40667f104dbcc08fd03f2dcdad1bc',
    'luatexja': '9ebfdb2cbe0200b766fb37c33f7baee19d7c6bd4c50cff51618962cedbc1afa4',
    'luatexja.doc': '889a32068d2ce440ef860683d87df59cb233759adfa1f526e6dac1c1a504c2d7',
    'chinese-jfm': 'fc27ee146296b0efadd7d50c8d3087a545021f101881507f4e83008ef125047e',
    'chinese-jfm.doc': 'd5aa369c0553c3120893b930a8086a21da93a44d49d2c34ad64cabc8ab0d6fe1',
    'zhnumber': 'dbcc134ce2f0cb8fbe9ad512e4d3a7a897a0d78201fe7568850443a65e59f15b',
    'zhnumber.doc': '0467850ef4369d75df5fcd688051822030131335cdabf1a3ba33ed44e433d1fd',
    'lua-uni-algos': 'a7f9a14f2cb5dedd3d67997d9db3de9cfdef7003a797b33892fa8728578dfb95',
    'lua-uni-algos.doc': '583f74d7e49510b0bb6518c9b4072d760eda1b579974313facb9d8788bb2bbbd',
    'fandol': '0b71eebb1c9b9fbd1eb4281f8af3f6c1a556a394ba2b6eae69ed9bb76c5fa56a',
    'fandol.doc': 'bc612f810ba56397700b678adecd43613f35a6fce9f4204c3357b874709843d0',
    'enumitem': '887fa546b820d8345d801404978a57876afe9ed22debcca736bb24d4f8338618',
    'enumitem.doc': '874350e4b309129b7df0fc1aee797b8175a9ce45b908f663e65d47be2775b937',
    'fancyhdr': '9dab3331ad37957d02875715bec27aed5fc19d3778a73600f630ec28169b950a',
    'fancyhdr.doc': '8b7de9e0aa451309b4ab956870af8f3610a84e534aec3e9c18c83e411aeeb1ef',
    'ipaex': '7db75b91663a5fa711d72fba2d1934580e0570c58d2937f5f54aa3ac7cf43e15',
    'ipaex.doc': 'fc62df329dea13ec25279afcb8676edeb2016af034a2138d8cdb2ac1982089af',
  };
  const unpacked = path.join(temp, 'chinese');
  await mkdir(unpacked, {recursive: true});
  for (const [name, hash] of Object.entries(packages)) {
    const archive = path.join(temp, name + '.tar.xz');
    await download(base + name + '.tar.xz', archive, hash);
    command('tar', ['-xJf', archive, '-C', unpacked]);
  }
  const dest = 'vendor/engine/bundles/chinese';
  await rm(dest, {recursive: true, force: true});
  await mkdir(path.join(dest, 'files'), {recursive: true});
  for (const name of ['tex', 'fonts'])
    await cp(path.join(unpacked, name), path.join(dest, 'files', name), {
      recursive: true,
      // IPAex Mincho supplies uncommon Han glyphs missing from Fandol.
      filter: file => !file.includes('/ipaex/') || file.endsWith('/ipaexm.ttf'),
    });
  // Keep package metadata and licence/readme files; PDFs aren't runtime assets.
  await cp(path.join(unpacked, 'tlpkg'), path.join(dest, 'tlpkg'), {recursive: true});
  await cp(path.join(unpacked, 'doc'), path.join(dest, 'doc'), {
    recursive: true, filter: file => !file.endsWith('.pdf'),
  });
  const koreanFonts = path.join(dest, 'files/fonts/truetype/public/nanum');
  await mkdir(koreanFonts, {recursive: true});
  const koreanSource = 'https://raw.githubusercontent.com/google/fonts/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/nanummyeongjo/';
  await download(koreanSource + 'NanumMyeongjo-Regular.ttf', path.join(koreanFonts, 'NanumMyeongjo-Regular.ttf'),
    '7ed9e8653a8ed04285d51dc343ffea6eb3d9c73afc27383ea8929ee4ffd03205');
  await mkdir(path.join(dest, 'doc/fonts/nanum'), {recursive: true});
  await download(koreanSource + 'OFL.txt', path.join(dest, 'doc/fonts/nanum/OFL.txt'),
    '8eb1c1019fe7fe6d0b6e7d7bbbba1d9cbdd969d8c5f26455708f6cfb8a77284c');
  const files = {};
  async function walk(dir, prefix = '') {
    for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name, file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, name + '/');
      else { const bytes = await readFile(file); files[name] = {size: bytes.length, sha: sha(bytes)}; }
    }
  }
  await walk(path.join(dest, 'files'));
  await writeFile(path.join(dest, 'manifest.json'), JSON.stringify({name: 'chinese', version: 'texlive-2025-final', files, eager: []}));
  console.log('CJK packages, list/header packages and Fandol, Nanum Myeongjo, IPAex Mincho fonts ready.');
}
const temp = await mkdtemp(path.join(tmpdir(), 'rex-assets-'));
try {
  const bibliographyOnly = process.argv.includes('--bibliography'), chineseOnly = process.argv.includes('--chinese');
  if (!bibliographyOnly && !chineseOnly) await setupEngine(temp);
  if (!chineseOnly) await setupBibliography(temp);
  if (!bibliographyOnly) await setupChinese(temp);
  await mkdir('vendor', {recursive:true});
  await download('https://mirrors.mit.edu/CTAN/install/macros/luatex/generic/ctablestack.tds.zip', path.join(temp, 'ctablestack.tds.zip'), 'a975aa44f20d7705b4e2d41a63008d00e4439143999cb12acce75f24d5d56943');
  command('unzip', ['-q', path.join(temp, 'ctablestack.tds.zip'), '-d', path.join(temp, 'ctablestack')]);
  await copyFile(path.join(temp, 'ctablestack/tex/luatex/ctablestack/ctablestack.sty'), 'vendor/ctablestack.sty');
  await pruneAssets(process.cwd());
  await buildEditor();
  await buildFontAssets(path.resolve('vendor/engine'));
  console.log('Ready: npm run dev, or npm run build to produce dist/.');
} finally { await rm(temp, {recursive:true, force:true}); }
