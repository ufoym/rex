import { resources, resourceState } from './runtime.js';
import { FullPass, standbyKey, bodySnapshot, coldPass } from './full-pass.js';
import { PictureCache, scanPictures } from './picture-cache.js';
import { AuxiliaryTools } from './tools.js';
import { digest, packFiles } from './snapshot.js';
let res, wasmModule, standby, warmKey, cache = new PictureCache(), tools = new AuxiliaryTools();
let running = false, pendingPreparation, pendingCompilation, activePass;
let preparations = Promise.resolve();
let epoch = 0;
const signatureOf = aux => digest(packFiles(Object.fromEntries(Object.entries(aux).sort(([a], [b]) => a.localeCompare(b)))));
function prepare(data, aux = data.aux || {}) {
  const generation = epoch;
  const job = preparations.catch(() => {}).then(() => prepareInner(data, aux, generation));
  preparations = job;
  return job;
}
async function prepareInner(data, aux, generation) {
  const key = await standbyKey(data.files, data.main) + await signatureOf(aux);
  if (generation !== epoch) return;
  if (standby && warmKey === key) return;
  standby?.close();
  // Cache PDFs are installed before blocking; release carries only the latest manifest and sources.
  const pdfs = Object.fromEntries([...cache.pdfs].map(([name, bytes]) => [name.replace('/work/', ''), bytes]));
  standby = new FullPass({...data.files, ...pdfs}, data.main, aux, wasmModule, res && resourceState(res));
  warmKey = key;
  const worker = standby;
  worker.ready.then(() => { if (worker === standby) postMessage({type: 'standby-ready', projectId: data.projectId}); }).catch(() => {});
}
onmessage = async ({data}) => {
  if (data.type === 'reset') {
    epoch++; activePass?.close(); standby?.close(); standby = null; warmKey = null; pendingPreparation = null; pendingCompilation = null;
    cache = new PictureCache(); tools = new AuxiliaryTools();
    return;
  }
  if (data.type === 'prepare') {
    pendingPreparation = data;
    if (!running) { try { await prepare(data); } catch { /* full compile reports syntax errors */ } }
    return;
  }
  if (running) { pendingCompilation = data; return; }
  running = true;
  const generation = epoch;
  const current = () => { if (generation !== epoch) throw Error('Compilation cancelled'); };
  try {
    res ||= await resources();
    current();
    const t = performance.now(), initialStandby = standby, wasReady = standby?.isReady;
    wasmModule ||= await res.set.io.fetch(new URL('../vendor/engine/luatex.wasm', import.meta.url).href).then(WebAssembly.compile);
    current();
    if (data.options?.standby === false) { standby?.close(); standby = null; warmKey = null; }
    let aux = data.aux || {}, output, previous = await signatureOf(aux), converged = false;
    let passes = 0, bibliographyRuns = 0, indexRuns = 0, pictureHits = 0, bodyMs = 0, usedStandby = false;
    const pictures = data.options?.pictureCache === false ? [] : await scanPictures(data.files, data.main);
    for (; passes < 5;) {
      await preparations.catch(() => {});
      current();
      const key = await standbyKey(data.files, data.main) + await signatureOf(aux);
      current();
      if (standby && warmKey !== key) { standby.close(); standby = null; warmKey = null; }
      const manifest = cache.manifest(pictures);
      const snapshot = {[data.main]: bodySnapshot(data.files, data.main)[data.main], 'pic-manifest.json': manifest.files['pic-manifest.json']};
      if (standby && packFiles({...snapshot, ...aux}).length > standby.gate.byteLength - 8) {
        standby.close(); standby = null; warmKey = null;
      }
      const worker = standby;
      activePass = worker;
      standby = null; warmKey = null;
      try {
        usedStandby ||= passes === 0 && !!worker && worker === initialStandby && !!wasReady && data.options?.standby !== false;
        output = worker ? await worker.run(snapshot, aux) : await coldPass(res, data, aux, manifest.files, wasmModule);
      } finally { worker?.close(); if (activePass === worker) activePass = null; }
      current();
      passes++; 
      for (const [key, bytes] of output.loadedResources || []) res.set.cache.set(key, bytes);
      delete output.loadedResources;
      bodyMs += output.bodyMs;
      pictureHits += output.capture.pic_hits || 0;
      await cache.absorb(pictures, output);
      current();
      const generated = await tools.run(res, {...data.files, ...output.generated}, output.aux);
      current();
      bibliographyRuns += generated.bibliographyRuns; indexRuns += generated.indexRuns;
      output.logs.push(...generated.logs);
      aux = generated.aux;
      const signature = await signatureOf(aux);
      const rerun = output.logs.some(l => /Rerun to|undefined references|undefined citations|Citation.*undefined|Label.*changed|rerun LaTeX|Please.*(?:re.?run|rerun).*Biber/i.test(l));
      if (signature === previous && !rerun && !output.capture.pic_mismatch?.length) { converged = true; break; }
      previous = signature;
    }
    output.aux = aux;
    current();
    delete output.type;
    postMessage({type: 'layout', revision: data.revision, projectId: data.projectId, ...output, converged, passes,
      bibliographyRuns, indexRuns, pictureHits, usedStandby, bodyMs, ms: performance.now() - t}, [output.pdf.buffer]);
    const next = pendingPreparation || data; pendingPreparation = null;
    if (data.options?.standby !== false) await prepare(next, aux);
  } catch (e) {
    if (generation === epoch) { standby?.close(); standby = null; warmKey = null; }
    if (generation === epoch) postMessage({type: 'failure', revision: data.revision, projectId: data.projectId, message: String(e)});
  } finally {
    running = false;
    const next = pendingCompilation; pendingCompilation = null;
    if (next) onmessage({data: next});
  }
};
