export function resourceLabel(url) {
  const name = decodeURIComponent(new URL(url, 'https://rex.local/').pathname).split('/').at(-1);
  if (/\.(?:otf|ttf|ttc|pfb)$/.test(name)) return 'font ' + name;
  if (/^biber\./.test(name)) return 'Biber bibliography';
  if (/^busytex\./.test(name)) return 'BibTeX / MakeIndex';
  if (name.startsWith('luatex') && name.endsWith('.wasm')) return 'typesetting engine';
  if (name === 'manifest.json') return 'LaTeX resources';
  if (name === 'font-cache.json') return 'font index';
  return name;
}
export function notifyResourceProgress(details) {
  if (typeof WorkerGlobalScope !== 'undefined') postMessage({type: 'progress', phase: 'fetching', ...details});
}

// Every worker has its own callback; snapshots contain bytes/metadata only.
export function progressIO(source, progress = notifyResourceProgress) {
  const io = {...source, progress: details => progress({phase: 'fetching', ...details}), sizes: new Map(), labels: new Map()};
  const reporter = callback => (url, loadedBytes, totalBytes) => callback({
    resource: io.labels.get(url) || resourceLabel(url), loadedBytes, totalBytes,
  });
  io.fetch = async url => {
    const report = reporter(io.progress);
    const total = io.sizes.get(url);
    if (!source.progressSelf) report(url, 0, total);
    let bytes;
    if (source.stream) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw Error(`Failed to load ${resourceLabel(url)}: HTTP ${response.status}`);
        const expected = response.headers.get('content-encoding') ? total : Number(response.headers.get('content-length')) || total;
        const reader = response.body?.getReader();
        if (reader) {
          const chunks = []; let size = 0, last = 0;
          for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value); size += value.length;
            if (performance.now() - last > 40) { report(url, size, expected); last = performance.now(); }
          }
          bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        } else bytes = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw new Error(`Failed to load engine resource ${url}: ${error}`, {cause: error});
      }
    } else bytes = await source.fetch(url);
    if (!source.progressSelf) report(url, bytes.length, bytes.length);
    return bytes;
  };
  io.fetchJson = async url => {
    const report = reporter(io.progress);
    if (!source.progressSelf) report(url, 0);
    const value = await source.fetchJson(url);
    return value;
  };
  if (source.fetchSync) io.fetchSync = url => {
    const report = reporter(io.progress);
    if (!source.progressSelf) report(url, 0, io.sizes.get(url));
    const bytes = source.fetchSync(url);
    if (!source.progressSelf) report(url, bytes.length, bytes.length);
    return bytes;
  };
  return io;
}
export function loadingStatus(data) {
  const name = data.resource || 'engine resources';
  if (data.totalBytes > 0) {
    const unit = data.totalBytes >= 1024 * 1024 ? 1024 * 1024 : 1024;
    const suffix = unit === 1024 ? 'KiB' : 'MiB';
    return `Loading ${name} · ${((data.loadedBytes || 0) / unit).toFixed(1)}/${(data.totalBytes / unit).toFixed(1)} ${suffix}…`;
  }
  return data.total ? `Loading ${name} ${data.current}/${data.total}…` : `Loading ${name}…`;
}
