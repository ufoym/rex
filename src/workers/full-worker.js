import { resources, restoreResources, engine, writeFiles } from "../compiler/runtime.js";
import { captureFiles, compile } from "../compiler/full-pass.js";
import { unpackFiles } from "../protocol/snapshot.js";
import { collectFontCache } from "../compiler/font-cache.js";

onmessage = async ({data}) => {
  try {
    const res = data.resources ? restoreResources(data.resources) : await resources();
    const logs = [], state = new Int32Array(data.gate, 0, 2), known = new Set(res.set.cache.keys());
    const files = captureFiles({...data.files, ...data.aux}, data.main,
      "local f=io.open('/rex-standby','r') f:read('*a') f:close()");
    const M = await engine(res, files, line => logs.push(line), {}, data.wasmModule), FS = M.FS;
    let released = false, start;
    FS.registerDevice(FS.makedev(81, 0), {
      open(s) { s.seekable = false; },
      read() {
        if (released) return 0;
        postMessage({type: 'ready'});
        while (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0);
        start = performance.now();
        writeFiles(FS, unpackFiles(new Uint8Array(data.gate, 8, Atomics.load(state, 1))));
        released = true;
        return 0;
      }
    });
    FS.mkdev('/rex-standby', FS.makedev(81, 0));
    const output = compile(M, logs);
    const loadedResources = [...res.set.cache].filter(([key]) => !known.has(key));
    postMessage({type: 'pass', ...output, loadedResources, fontCache: collectFontCache(res, FS), logs, bodyMs: performance.now() - start}, [output.pdf.buffer]);
  } catch (e) { postMessage({type: 'failure', message: String(e)}); }
};
