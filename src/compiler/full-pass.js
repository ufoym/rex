import { preamble } from '../core/document.js';
import { digest, packFiles } from '../protocol/snapshot.js';
import { engine, run, collect } from './runtime.js';
// Index streams open in the preamble. Restoring old .idx bytes after that would leave stale entries.
const inputAux = aux => Object.fromEntries(Object.entries(aux).filter(([name]) => !name.endsWith('.idx')));
// Any dependency change invalidates a standby, including imported classes and preamble inputs.
export async function standbyKey(files, main) {
  return digest(packFiles({...files, [main]: preamble(files[main])}));
}
export function bodySnapshot(files, main) {
  const source = files[main], pre = preamble(source);
  return {...files, [main]: '\n'.repeat((pre.match(/\n/g) || []).length) + source.slice(pre.length)};
}
export function captureFiles(files, main, pause) {
  return {...bodySnapshot(files, main),
    'rex-preamble.tex': preamble(files[main]),
    'capture.tex': `\\RequirePackage{rex-capture}\\input{rex-preamble.tex}\\directlua{${pause}}\\input{${main}}`};
}
export function compile(M, logs) {
  if (run(M, 'capture.tex') !== 0) throw Error(logs.join('\n'));
  return collect(M);
}
// Convergence passes have no idle time to preload a preamble. Run them in the
// coordinator's retained VFS instead of paying for another Worker and resource copy.
export async function coldPass(res, data, aux, cacheFiles, wasmModule) {
  const logs = [];
  let start;
  const files = captureFiles({...data.files, ...inputAux(aux), ...cacheFiles}, data.main,
    "texio.write_nl('REX_BROWSER_BODY_START'..string.char(10))");
  const M = await engine(res, files, line => {
    if (line.trim() === 'REX_BROWSER_BODY_START') start = performance.now();
    else logs.push(line);
  }, {}, wasmModule);
  const output = compile(M, logs);
  return {...output, logs, bodyMs: performance.now() - start};
}
export class FullPass {
  constructor(files, main, aux, wasmModule, resources) {
    this.worker = new Worker(new URL('../workers/full-worker.js', import.meta.url), {type: 'module'});
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    // Only source/aux changes cross this gate. PDF cache blobs are installed before warming.
    const size = Math.max(4 * 1024 * 1024, packFiles({[main]: files[main], ...aux}).length * 2);
    this.gate = new SharedArrayBuffer(size + 8);
    this.worker.onmessage = ({data}) => {
      if (data.type === 'ready') { this.isReady = true; this.resolveReady(); }
      if (data.type === 'pass') this.resolve?.(data);
      if (data.type === 'failure') { const e = Error(data.message); this.rejectReady(e); this.reject?.(e); }
    };
    this.worker.onerror = e => { this.rejectReady(Error(e.message)); this.reject?.(Error(e.message)); };
    this.worker.postMessage({files, main, aux: inputAux(aux), wasmModule, resources, gate: this.gate});
  }
  async run(files, aux) {
    await this.ready;
    const bytes = packFiles({...files, ...inputAux(aux)});
    if (bytes.length > this.gate.byteLength - 8) throw Error('Standby snapshot grew beyond its gate');
    const result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    const state = new Int32Array(this.gate, 0, 2);
    new Uint8Array(this.gate, 8, bytes.length).set(bytes);
    Atomics.store(state, 1, bytes.length); Atomics.store(state, 0, 1); Atomics.notify(state, 0);
    return result;
  }
  close() { this.worker.terminate(); this.rejectReady(Error('Standby closed')); this.reject?.(Error('Standby closed')); }
}
