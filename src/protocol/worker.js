// Local files load classic scripts; their workers run the packaged code from Blobs.
export function moduleWorker(url) {
  if (!globalThis.rexLocal) return new Worker(url, {type: "module"});
  const packaged = globalThis.rexLocal.workers[new URL(url).pathname];
  if (!packaged) throw Error("Missing packaged worker: " + url);
  const prefix = packaged.compiler ? "globalThis.rexResourceURL=" + JSON.stringify(globalThis.rexLocal.resourceURL) + ";\n" : "";
  const blob = URL.createObjectURL(new Blob([prefix, packaged.source], {type: "text/javascript"}));
  const worker = new Worker(blob);
  const release = () => URL.revokeObjectURL(blob);
  worker.addEventListener("message", release, {once: true});
  worker.addEventListener("error", release, {once: true});
  return worker;
}
