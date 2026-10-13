import {unpackFiles} from '../protocol/snapshot.js';
import {notifyResourceProgress} from './resource-io.js';
import {InputPending} from './async-runtime.js';

export function createLocalResources(catalog, loadScript) {
  const files = Object.create(null), pending = new Map(), tools = Object.create(null);
  const local = {files, tools, progress: notifyResourceProgress};
  async function readChunk(name) {
    const id = catalog.files[name], chunk = catalog.chunks[id];
    if (!chunk) throw Error('Missing packaged resource: ' + name);
    const progress = local.progress;
    progress({resource: chunk.label, loadedBytes: 0, totalBytes: chunk.bytes});
    const payload = await loadScript(chunk.script);
    if (payload?.id !== id) throw Error('Invalid packaged resource: ' + chunk.label);
    const text = payload.data;
    const size = text.length * 3 / 4 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);
    const bytes = new Uint8Array(size); let offset = 0;
    for (let i = 0; i < text.length; i += 65536) {
      const part = atob(text.slice(i, i + 65536));
      for (let j = 0; j < part.length; j++) bytes[offset++] = part.charCodeAt(j);
    }
    const stream = new ReadableStream({start(controller) { controller.enqueue(bytes); controller.close(); }})
      .pipeThrough(new DecompressionStream('gzip'));
    const unpacked = unpackFiles(new Uint8Array(await new Response(stream).arrayBuffer()));
    if (Object.keys(unpacked).length !== chunk.entries || !Object.hasOwn(unpacked, name))
      throw Error('Incomplete packaged resource: ' + chunk.label);
    for (const key of Object.keys(unpacked))
      if (catalog.files[key] !== id) throw Error('Unlisted packaged resource: ' + key);
    Object.assign(files, unpacked);
    progress({resource: chunk.label, loadedBytes: chunk.bytes, totalBytes: chunk.bytes, assets: Object.keys(unpacked)});
  }
  local.loadAsync = async name => {
    if (Object.hasOwn(files, name)) return files[name];
    const id = catalog.files[name];
    if (!pending.has(id)) pending.set(id, readChunk(name));
    const job = pending.get(id);
    try { await job; }
    finally { if (pending.get(id) === job) pending.delete(id); }
    if (!Object.hasOwn(files, name)) throw Error('Incomplete packaged resource: ' + name);
    return files[name];
  };
  local.load = name => {
    if (!Object.hasOwn(files, name)) {
      if (!catalog.files[name]) throw Error('Missing packaged resource: ' + name);
      throw new InputPending(local.loadAsync(name));
    }
    return files[name];
  };
  local.tool = async name => {
    if (!tools[name]) {
      const tool = catalog.tools[name];
      if (!tool) throw Error('Missing packaged tool: ' + name);
      local.progress({resource: tool.label, loadedBytes: 0, totalBytes: tool.bytes});
      const source = await loadScript(tool.script);
      // WebKit file-origin workers reject even worker-created Blob imports.
      // The document supplies only catalogued, build-generated tool factories.
      new Function(source)();
      if (!tools[name]) throw Error('Incomplete packaged tool: ' + name);
      local.progress({resource: tool.label, loadedBytes: tool.bytes, totalBytes: tool.bytes, assets: ['vendor/bibliography/' + name + '.mjs']});
    }
    return {default: tools[name]};
  };
  return local;
}
