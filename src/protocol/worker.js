// Only the document loads file scripts. Workers request their payloads by message
// because current browsers reject file imports from Blob workers.
function localScript(script) {
  const local = globalThis.rexLocal;
  local.scripts ||= new Map();
  local.payloads ||= new Map();
  local.register = (name, payload) => local.payloads.set(name, payload);
  if (!local.scripts.has(script)) {
    const job = new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = new URL(script, local.resourceURL).href;
      element.onload = () => {
        element.remove();
        if (!local.payloads.has(script)) reject(Error('Invalid packaged script: ' + script));
        else resolve(local.payloads.get(script));
      };
      element.onerror = () => { element.remove(); reject(Error('Failed to load packaged script: ' + script)); };
      document.body.append(element);
    });
    local.scripts.set(script, job);
    job.catch(() => local.scripts.delete(script));
  }
  return local.scripts.get(script);
}

function scriptBridge() {
  const pending = new Map();
  let next = 0;
  globalThis.rexLoadScript = script => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, {resolve, reject});
    postMessage({type: 'local-script', id, script});
  });
  addEventListener('message', event => {
    const {data} = event;
    if (data.type !== 'local-script') return;
    event.stopImmediatePropagation();
    const job = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) job?.reject(Error(data.error));
    else job?.resolve(data.payload);
  });
}

export function moduleWorker(url) {
  if (!globalThis.rexLocal) return new Worker(url, {type: "module"});
  const packaged = globalThis.rexLocal.workers[new URL(url).pathname];
  if (!packaged) throw Error("Missing packaged worker: " + url);
  const prefix = packaged.compiler ? "globalThis.rexCatalog=" + JSON.stringify(globalThis.rexCatalog) +
    ";(" + scriptBridge.toString() + ")();\n" : "";
  const blob = URL.createObjectURL(new Blob([prefix, packaged.source], {type: "text/javascript"}));
  const worker = new Worker(blob);
  if (packaged.compiler) worker.addEventListener('message', event => {
    const {data} = event;
    if (data.type !== 'local-script') return;
    event.stopImmediatePropagation();
    // Resolve only catalogued scripts, including when a worker sends a bad path.
    const catalog = globalThis.rexCatalog;
    if (![...Object.values(catalog.chunks), ...Object.values(catalog.tools)].some(entry => entry.script === data.script)) {
      worker.postMessage({type: 'local-script', id: data.id, error: 'Unknown packaged script: ' + data.script});
      return;
    }
    localScript(data.script).then(payload => worker.postMessage({type: 'local-script', id: data.id, payload}),
      error => worker.postMessage({type: 'local-script', id: data.id, error: error.message}));
  });
  const release = () => URL.revokeObjectURL(blob);
  worker.addEventListener("message", release, {once: true});
  worker.addEventListener("error", release, {once: true});
  return worker;
}
