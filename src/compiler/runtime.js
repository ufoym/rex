import createLuaTeX from "../../vendor/engine/luatex.mjs";
import { BundleSet, browserIO } from "../../vendor/engine/vfs/bundle.js";
import { mkdirp, createLazyFile } from "../../vendor/engine/vfs/lazyfs.js";
import { startupAssets } from "./startup-assets.js";
import { bundles, texFiles } from "./assets.js";
import { loadFontCache } from "./font-cache.js";
import { asyncRuntime } from "./async-runtime.js";
import {progressIO, notifyResourceProgress} from "./resource-io.js";
export { bundles, texFiles } from "./assets.js";
function runtimeIO() {
  const files = globalThis.rexLocal?.files;
  if (!files) {
    const io = browserIO();
    for (const method of ["fetch", "fetchJson"]) {
      const read = io[method];
      io[method] = async url => {
        try { return await read(url); }
        catch (error) { throw new Error(`Failed to load engine resource ${url}: ${error}`, {cause: error}); }
      };
    }
    return {...io, stream: true};
  }
  const read = url => {
    const key = decodeURIComponent(new URL(url).pathname).slice(1);
    return globalThis.rexLocal.load(key);
  };
  return {progressSelf: true, fetch: async url => globalThis.rexLocal.loadAsync(decodeURIComponent(new URL(url).pathname).slice(1)), fetchSync: read,
    fetchJson: async url => JSON.parse(new TextDecoder().decode(await globalThis.rexLocal.loadAsync(decodeURIComponent(new URL(url).pathname).slice(1))))};
}
export async function resources(
  io = runtimeIO(),
  base = new URL("../../vendor/", import.meta.url).href,
  progress = notifyResourceProgress,
) {
  io = progressIO(io, progress);
  if (globalThis.rexLocal?.load) globalThis.rexLocal.progress = io.progress;
  const set = new BundleSet(io);
  // Download/compile WASM while the TeX working set is loading.
  const wasm = io.fetch(base + "engine/luatex.wasm");
  // Font seeds describe the original engine; Asyncify changes control flow only.
  const executable = globalThis.rexLocal ? io.fetch(base + "engine/luatex-async.wasm") : wasm;
  const wasmModule = executable.then(bytes => WebAssembly.compile(bytes));
  wasmModule.catch(() => {});
  progress({phase: "fetching", detail: "engine manifests"});
  await set.addAll(
    bundles.map((name) => ({
      name,
      manifestUrl: base + "engine/bundles/" + name,
    })),
  );
  await set.loadHot(base + "engine/bundles/hot.json");
  for (const file of set.files.values()) io.sizes.set(file.url, file.size);
  await set.prefetchEager();
  const scripts = Object.fromEntries(
    await Promise.all(
      texFiles.map(async (f) => [f, await io.fetch(new URL("../tex/" + f, import.meta.url).href)]),
    ),
  );
  scripts["ctablestack.sty"] = await io.fetch(base + "ctablestack.sty");
  const res = { set, scripts, wasmModule: await wasmModule };
  await loadFontCache(res, await wasm, base);
  return res;
}
// Hints avoid serial network reads for common documents. The VFS remains the
// authoritative fallback for indirect packages, custom classes and font names.
export async function prefetchProject(res, files) {
  const text = Object.entries(files).filter(([name, value]) => ['.tex', '.sty', '.cls'].some(ext => name.endsWith(ext)) && typeof value === 'string').map(([, value]) => value).join(String.fromCharCode(10));
  const has = (...commands) => commands.some(command => text.includes(String.fromCharCode(92) + command));
  const cjk = /ctex|luatexja|CJKfont|Fandol/.test(text);
  const tikz = /tikz|pgfplots/.test(text);
  const math = text.includes('$') || has('frac', 'begin{align', 'begin{equation', 'begin{gather', 'begin{multline');
  const fonts = new Set(['lmroman10-regular.otf']);
  if (has('textbf', 'bfseries', 'section', 'title')) fonts.add('lmroman10-bold.otf');
  if (has('textit', 'itshape', 'emph')) fonts.add('lmroman10-italic.otf');
  if (has('textsf', 'sffamily')) fonts.add('lmsans10-regular.otf');
  if (has('texttt', 'ttfamily')) fonts.add('lmmono10-regular.otf');
  if (has('maketitle')) for (const name of ['lmroman17-regular.otf', 'lmroman12-regular.otf']) fonts.add(name);
  if (has('section', 'subsection')) fonts.add('lmroman12-bold.otf');
  if (text.includes('11pt')) for (const name of ['lmroman12-regular.otf', 'lmroman12-bold.otf', 'lmromandemi10-regular.otf']) fonts.add(name);
  if (cjk) {
    fonts.add('FandolSong-Regular.otf');
    if (has('textbf', 'bfseries', 'section')) fonts.add('FandolSong-Bold.otf');
    if (has('textit', 'itshape', 'emph', 'kaishu')) fonts.add('FandolKai-Regular.otf');
    if (has('textsf', 'sffamily', 'heiti')) fonts.add('FandolHei-Regular.otf');
    if (has('texttt', 'ttfamily', 'fangsong')) fonts.add('FandolFang-Regular.otf');
  }
  for (const match of text.matchAll(/[A-Za-z0-9_-]+[.](?:otf|ttf|ttc|pfb)/g)) fonts.add(match[0]);
  if (math || has('footnote')) for (const size of [5, 6, 8, 9]) fonts.add('lmroman' + size + '-regular.otf');
  const wanted = new Set(startupAssets.filter(name => {
    if (name.startsWith('fonts/')) return name.endsWith('.map') || name.endsWith('.tfm') || (math && name.endsWith('.pfb'));
    if (!cjk && /ctex|luatexja|chinese-jfm|zhnumber/.test(name)) return false;
    if (!tikz && name.includes('/pgf/')) return false;
    return true;
  }));
  for (const file of res.set.files.values()) {
    const name = file.path.split('/').at(-1);
    if (fonts.has(name)) wanted.add(file.path);
  }
  wanted.add(text.includes('11pt') ? 'tex/latex/base/size11.clo' : text.includes('12pt') ? 'tex/latex/base/size12.clo' : 'tex/latex/base/size10.clo');
  if (math) for (const name of ['cmr7', 'cmmi7', 'cmsy7']) { wanted.add('fonts/tfm/' + name + '.tfm'); wanted.add('fonts/type1/' + name + '.pfb'); }
  const missing = [...wanted].map(name => res.set.files.get(name)).filter(file => file && !res.set.has(file.path));
  const seedNames = new Set([...fonts].map(name => name.replace(/[.](otf|ttf|ttc)$/, '').toLowerCase()));
  if (cjk) for (const file of res.set.files.values())
    if (file.path.includes('/fandol/')) seedNames.add(file.path.split('/').at(-1).replace(/[.]otf$/, '').toLowerCase());
  const seedJobs = Object.entries(res.fontSeeds || {}).filter(([name]) => {
    if (name.includes('/generic/names/')) return !res.fontNames;
    if (Object.hasOwn(res.fontCache, name)) return false;
    return (cjk && name.includes('/luatexja/')) || seedNames.has(name.split('/').at(-1).replace(/[.]luc$/, ''));
  }).map(async ([name, info]) => {
    try {
      const bytes = await res.set.io.fetch(info.url);
      if (bytes.length !== info.bytes) throw Error('Incomplete optional font tables');
      if (name.includes('/generic/names/')) res.fontNames = bytes;
      else res.fontCache[name] = bytes;
    } catch { delete res.fontSeeds[name]; }
  });
  let next = 0;
  await Promise.all([...seedJobs, ...Array.from({length: Math.min(16, missing.length)}, async () => {
    while (next < missing.length) await res.set.fetchAsync(missing[next++]);
  })]);
}
export function setResourceProgress(res, callback) {
  res.set.io.progress = details => callback({phase: 'fetching', ...details});
  if (globalThis.rexLocal?.load) globalThis.rexLocal.progress = res.set.io.progress;
}
export function resourceState(res) {
  return {manifests: res.set.manifests, cache: [...res.set.cache], scripts: res.scripts,
    wasmModule: res.wasmModule, fontCache: res.fontCache, fontSeeds: res.fontSeeds, fontNames: res.fontNames};
}
export function restoreResources(state) {
  const io = progressIO(runtimeIO());
  if (globalThis.rexLocal?.load) globalThis.rexLocal.progress = io.progress;
  const set = new BundleSet(io);
  for (const {spec, base, manifest} of state.manifests) set.addLoaded(spec, base, manifest);
  set.cache = new Map(state.cache);
  for (const file of set.files.values()) io.sizes.set(file.url, file.size);
  for (const [name, info] of Object.entries(state.fontSeeds || {})) {
    io.sizes.set(info.url, info.bytes);
    io.labels.set(info.url, "font tables " + name.split("/").at(-1).replace(/\.luc$/, ""));
  }
  return {set, scripts: state.scripts, wasmModule: state.wasmModule, fontCache: state.fontCache, fontSeeds: state.fontSeeds || {}, fontNames: state.fontNames};
}
export async function engine(res, files, log = () => {}, env = {}, wasmModule) {
  await prefetchProject(res, files);
  res.set.io.progress?.({phase: 'typesetting'});
  wasmModule ||= res.wasmModule;
  const paused = globalThis.rexLocal || env.REX_ASYNC_INPUT ? asyncRuntime(wasmModule) : null;
  const M = await createLuaTeX({
    ...(paused ? {instantiateWasm: paused.instantiateWasm} : wasmModule ? {instantiateWasm(imports, ready) {
      WebAssembly.instantiate(wasmModule, imports).then(instance => ready(instance, wasmModule));
      return {};
    }} : {}),
    noInitialRun: true,
    thisProgram: "/bin/luatex",
    print: log,
    printErr: log,
    preRun: [
      (m) =>
        Object.assign(m.ENV, {
          TEXMFCNF: "/texmf/web2c",
          TEXINPUTS: "/work;/rex//;",
          LUAINPUTS: "/work;/rex//;",
          HOME: "/home",
          REX_CAPTURE_DIR: "/work",
          openout_any: "a",
          max_print_line: "100000",
          ...env,
        }),
    ],
  });
  const FS = M.FS;
  res.set.install(FS);
  // Immutable bundle fonts need the same timestamp in every MEMFS instance,
  // otherwise luaotfload discards perfectly valid parsed tables on each pass.
  for (const file of res.set.files.values())
    if (/\.(otf|ttf|ttc)$/i.test(file.path))
      FS.utime("/texmf/" + file.path, 0, parseInt(file.sha?.slice(0, 7) || "0", 16) * 1000);
  for (const dir of ["/bin", "/work", "/rex", "/home", "/texmf-var"])
    mkdirp(FS, dir);
  FS.writeFile("/bin/luatex", "");
  for (const [name, data] of Object.entries(res.scripts))
    FS.writeFile("/rex/" + name, data);
  if (res.fontNames) {
    const name = '/texmf-var/luatex-cache/generic/names/luaotfload-names.luc';
    FS.mkdirTree(name.slice(0, name.lastIndexOf('/'))); FS.writeFile(name, res.fontNames);
  }
  for (const [name, info] of Object.entries(res.fontSeeds || {}))
    if (!name.includes('/generic/names/') && !Object.hasOwn(res.fontCache || {}, name)) createLazyFile(FS, name, info.bytes, () => res.set.io.fetchSync(info.url));
  for (const [name, data] of Object.entries(res.fontCache || {})) {
    mkdirp(FS, name.slice(0, name.lastIndexOf("/")));
    FS.writeFile(name, data);
  }
  writeFiles(FS, files);
  FS.chdir("/work");
  if (paused) M.callMain = args => paused.callMain(M, args);
  return M;
}
export function writeFiles(FS, files) {
  for (const [name, data] of Object.entries(files)) {
    if (name.startsWith("/") || name.split("/").some(p => p === "..")) throw Error("Invalid project path: " + name);
    mkdirp(FS, "/work/" + name.split("/").slice(0, -1).join("/"));
    FS.writeFile("/work/" + name, data);
  }
}
export function run(M, file) {
  try {
    return M.callMain([
      "--fmt=dvilualatex",
      "--progname=lualatex",
      "--output-format=pdf",
      "--interaction=nonstopmode",
      "--halt-on-error",
      "--no-shell-escape",
      file,
    ]);
  } catch (e) {
    if (e.name === "ExitStatus") return e.status;
    throw e;
  }
}
export function liveDriver(preamble) {
  return `${preamble}\n\\newbox\\rexLiveBox\\newcount\\rexContinue\\rexContinue=1 \\edef\\rexCountNumber{\\number\\allocationnumber}\\newcatcodetable\\rexLiveCodes{\\makeatletter\\savecatcodetable\\rexLiveCodes}
\\errorcontextlines=100
\\AddToHook{begindocument/before}{\\directlua{dofile(kpse.find_file('rex-font-fallback.lua','lua')).install()}}
\\begin{document}
\\input{rex-live.tex}
\\directlua{rex_live = dofile(kpse.find_file("rex-live.lua", "lua")) rex_live.init(\\number\\rexLiveBox, \\rexCountNumber, \\number\\rexLiveCodes)}
\\loop\\rexStep\\ifnum\\rexContinue>0 \\repeat
\\end{document}`;
}
export function collect(M) {
  const FS = M.FS,
    read = (f) => FS.readFile("/work/" + f, { encoding: "utf8" });
  const capture = JSON.parse(read("capture.rex.json"));
  const pages = Array.from({ length: capture.pages }, (_, i) =>
    JSON.parse(read(`capture.rex-page${i + 1}.json`)),
  );
  const pdf = FS.readFile("/work/capture.pdf");
  const fonts = {};
  for (const page of pages)
    for (const font of Object.values(page.fonts || {}))
      if (font.filename && !fonts[font.filename]) {
        try {
          fonts[font.filename] = FS.readFile(font.filename);
        } catch {
          /* non-file fonts fall back to PDF */
        }
      }
  const aux = {}, generated = {};
  function walk(dir = "") {
    for (const f of FS.readdir("/work/" + dir)) {
      if (f === "." || f === "..") continue;
      const name = dir + f, stat = FS.stat("/work/" + name);
      if (FS.isDir(stat.mode)) { if (f !== "pic-cache") walk(name + "/"); }
      else if (/\.(aux|toc|out|bbl|bcf|run\.xml|lof|lot|idx|ind)$/.test(f)) aux[name] = FS.readFile("/work/" + name);
      else if (/\.(bib|bst)$/.test(f)) generated[name] = FS.readFile("/work/" + name);
    }
  }
  walk();
  return { capture, pages, pdf, fonts, aux, generated };
}
