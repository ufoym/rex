import { digest, packFiles } from '../protocol/snapshot.js';
import { writeFiles } from './runtime.js';
const decoder = new TextDecoder(), compiled = new Map();
async function tool(type, res, log) {
  const base = new URL('../../vendor/bibliography/', import.meta.url);
  const name = type === 'biber' ? 'biber' : 'busytex';
  res.set.io.progress?.({resource: type === 'biber' ? 'Biber bibliography' : type === 'bibtex' ? 'BibTeX bibliography' : 'MakeIndex'});
  let assets = compiled.get(name);
  if (!assets) {
    assets = Promise.all([globalThis.rexLocal ? globalThis.rexLocal.tool(name) : import(new URL(name + '.mjs', base).href), res.set.io.fetch(new URL(name + '.wasm', base).href).then(WebAssembly.compile)]);
    compiled.set(name, assets);
    assets.catch(() => compiled.delete(name));
  }
  const [factory, module] = await assets;
  // These tools use the original synchronous WASM. Their small TeX/bibliography
  // bundle is loaded only when needed, before entering native filesystem calls.
  if (type !== 'biber' && globalThis.rexLocal) await res.set.prefetchAll(file => file.bundle === 'bibliography');
  if (type === 'biber' && globalThis.rexLocal) await res.set.io.fetch(new URL('biber.data', base).href);
  const M = await factory.default({noInitialRun: true, thisProgram: '/bin/busytex', print: log, printErr: log,
    ...(type === 'biber' ? {setStatus: text => {
      if (!text) return;
      const bytes = text.match(/\((\d+)\/(\d+)\)/);
      res.set.io.progress?.({resource: type === 'biber' ? 'Biber bibliography' : 'BibTeX / MakeIndex',
        ...(bytes ? {loadedBytes: Number(bytes[1]), totalBytes: Number(bytes[2])} : {})});
    }} : {}),
    locateFile: path => { const u = new URL(path, base); return u.protocol === 'file:' ? decodeURIComponent(u.pathname) : u.href; },
    instantiateWasm(imports, ready) { WebAssembly.instantiate(module, imports).then(instance => ready(instance, module)); return {}; },
    ...(type !== 'biber' ? {preRun: [m => Object.assign(m.ENV, {TEXMFCNF: '/texmf/web2c', BIBINPUTS: '/work//:/texmf/bibtex/bib//', BSTINPUTS: '/work//:/texmf/bibtex/bst//', INDEXSTYLE: '/work//', HOME: '/home'})]} : {})});
  if (type !== 'biber') { res.set.install(M.FS); M.FS.mkdirTree('/work'); M.FS.mkdirTree('/bin'); M.FS.writeFile('/bin/busytex', ''); M.FS.chdir('/work'); }
  return M;
}
export class AuxiliaryTools {
  constructor() { this.cache = new Map(); }
  async bibliography(res, files, aux) {
    const bcf = aux['capture.bcf'];
    const auxText = Object.entries(aux).filter(([n]) => n.endsWith('.aux')).map(([, b]) => decoder.decode(b)).join('\n');
    const type = bcf ? 'biber' : /\\bibdata\{/.test(auxText) ? 'bibtex' : null;
    if (!type) return {aux, runs: 0};
    const control = bcf || auxText.split('\n').filter(l => /\\(?:citation|bibdata|bibstyle|@input)\b/.test(l)).join('\n');
    const inputs = Object.fromEntries(Object.entries(files).filter(([n]) => /\.(bib|bst|bbx|cbx|dbx|lbx)$/.test(n)));
    const key = await digest(packFiles({...inputs, control}));
    const cached = this.cache.get(key);
    if (cached) return {aux: {...aux, 'capture.bbl': cached}, runs: 0, type};
    const logs = [], M = await tool(type, res, line => logs.push(line));
    // Preserve directories; Biber resolves nested data sources relative to its control file.
    writeFiles(M.FS, {...files, ...aux});
    if (type === 'biber') M.FS.chdir('/work');
    const argv = type === 'biber' ? ['/opt/perl-wasm/bin/biber', '--output-format=bbl', '--nolog', 'capture.bcf'] : ['bibtex8', '--8bit', 'capture'];
    let code;
    try { code = M.callMain(argv); } catch (e) { if (typeof e.status === 'number') code = e.status; else throw e; }
    if (code !== 0 || !M.FS.analyzePath('/work/capture.bbl').exists) throw Error(type + ' failed\n' + logs.join('\n'));
    const bbl = M.FS.readFile('/work/capture.bbl');
    this.cache.set(key, bbl);
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    return {aux: {...aux, 'capture.bbl': bbl}, runs: 1, type, logs};
  }
  async run(res, files, aux) {
    const bib = await this.bibliography(res, files, aux);
    aux = bib.aux;
    let indexRuns = 0;
    const logs = [...(bib.logs || [])], source = Object.entries(files).filter(([name, value]) => name.endsWith('.tex') && typeof value === 'string')
      .map(([, value]) => value.replace(/\\[%\\]|%[^\n]*/g, text => text.startsWith('%') ? '' : text)).join('\n');
    const configurations = new Map();
    for (const match of source.matchAll(/\\makeindex\s*(?:\[([^\]]*)\])?/g)) {
      const options = match[1] || '', name = options.match(/\bname\s*=\s*([^,}\s]+)/)?.[1] || 'capture';
      if (!Object.hasOwn(aux, name + '.idx')) continue;
      const program = options.match(/\bprogram\s*=\s*([^,}\s]+)/)?.[1];
      if (program && program !== 'makeindex') throw Error('Unsupported index program: ' + program);
      const args = ((options.match(/\boptions\s*=\s*(?:\{([^}]*)\}|([^,]*))/)?.slice(1).find(Boolean) || '').match(/"[^"]*"|'[^']*'|\S+/g) || [])
        .map(value => value.replace(/^(["'])(.*)\1$/, '$2'));
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-s' && args[i + 1] && !args[i + 1].startsWith('-')) { i++; continue; }
        if (!['-c', '-g', '-l', '-r'].includes(args[i])) throw Error('Unsupported MakeIndex option: ' + args[i]);
      }
      configurations.set(name + '.idx', args);
    }
    for (const [name, input] of Object.entries(aux).filter(([name]) => name.endsWith('.idx'))) {
      const args = configurations.get(name) || [], output = name.replace(/\.idx$/, '.ind');
      const selected = args.flatMap((arg, i) => arg === '-s' ? [args[i + 1]] : []);
      const styles = Object.fromEntries(Object.entries(files).filter(([name]) => selected.some(style => name === style || name === style + '.ist')));
      const key = await digest(packFiles({...styles, input, options: JSON.stringify(args)}));
      let index = this.cache.get(key);
      if (!index) {
        if (!decoder.decode(input).trim()) index = new Uint8Array();
        else {
          const M = await tool('makeindex', res, line => logs.push(line));
          writeFiles(M.FS, {...files, ...aux});
          if (M.FS.analyzePath('/work/' + output).exists) M.FS.unlink('/work/' + output);
          let code;
          try { code = M.callMain(['makeindex', ...args, '-o', output, name]); }
          catch (error) { if (typeof error.status === 'number') code = error.status; else throw error; }
          if (code !== 0 || !M.FS.analyzePath('/work/' + output).exists) throw Error('MakeIndex failed\n' + logs.join('\n'));
          index = M.FS.readFile('/work/' + output); indexRuns++;
        }
        this.cache.set(key, index);
        if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
      }
      aux = {...aux, [output]: index};
    }
    return {aux, bibliographyRuns: bib.runs, indexRuns, logs};
  }
}
