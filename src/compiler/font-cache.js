import { digest, packFiles, unpackFiles } from "../protocol/snapshot.js";

const root = "/texmf-var/";
const cacheName = "rex-fonts-v1";
// Keep parsed fonts and LuaTeX-ja tables, excluding project-dependent name lookups.
const reusable = path => /^\/texmf-var\/(?:luatex-cache\/generic\/fonts\/otl\/|luatexja\/)[^/]+\.luc$/.test(path);

export function fontCacheKey(res, wasm) {
  return digest(packFiles({
    wasm,
    manifests: JSON.stringify(res.set.manifests.map(({manifest}) => manifest)),
    ...res.scripts,
  }));
}

export async function loadFontCache(res, wasm, base) {
  res.fontCache = {};
  const packaged = globalThis.rexLocal?.files;
  const seed = packaged?.["vendor/engine/font-cache.bin"];
  if (!globalThis.caches && !seed) return;
  let key;
  try {
    // Bytecode and font metadata are valid only for this exact engine/resource set.
    key = await fontCacheKey(res, wasm);
    if (seed && JSON.parse(new TextDecoder().decode(packaged["vendor/engine/font-cache.json"])).key === key) {
      const files = unpackFiles(seed);
      if (Object.keys(files).every(reusable)) res.fontCache = files;
    }
  } catch { /* Invalid packaged tables fall back to cold font processing. */ }
  if (!globalThis.caches || !key) return;
  try {
    res.fontCacheUrl = new URL("engine/font-cache/" + key, base).href;
    const cache = await caches.open(cacheName), hit = await cache.match(res.fontCacheUrl);
    if (hit) {
      const files = unpackFiles(new Uint8Array(await hit.arrayBuffer()));
      if (Object.keys(files).every(reusable)) res.fontCache = {...res.fontCache, ...files};
    }
  } catch { /* Storage is optional; a cold engine rebuilds its font tables. */ }
}

export function collectFontCache(res, FS) {
  const files = {...res.fontCache};
  function walk(dir) {
    for (const name of FS.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const path = dir + name;
      if (FS.isDir(FS.stat(path).mode)) walk(path + "/");
      else if (reusable(path)) files[path] = FS.readFile(path);
    }
  }
  walk(root);
  res.fontCache = files;
  return files;
}

export async function saveFontCache(res) {
  if (!res.fontCacheUrl || !Object.keys(res.fontCache || {}).length) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(res.fontCacheUrl, new Response(packFiles(res.fontCache)));
    // Only the current resource version is retained; user projects have their own store.
    for (const request of await cache.keys())
      if (request.url !== res.fontCacheUrl) await cache.delete(request);
  } catch { /* Quota/private-mode failures must not prevent compilation. */ }
}
