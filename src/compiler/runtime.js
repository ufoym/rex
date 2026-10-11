import createLuaTeX from "../../vendor/engine/luatex.mjs";
import { BundleSet, browserIO } from "../../vendor/engine/vfs/bundle.js";
import { mkdirp } from "../../vendor/engine/vfs/lazyfs.js";
import { bundles, texFiles } from "./assets.js";
export { bundles, texFiles } from "./assets.js";
export async function resources(
  io = browserIO(),
  base = new URL("../../vendor/", import.meta.url).href,
) {
  const set = new BundleSet(io);
  await set.addAll(
    bundles.map((name) => ({
      name,
      manifestUrl: base + "engine/bundles/" + name,
    })),
  );
  await set.loadHot(base + "engine/bundles/hot.json");
  await set.prefetchEager();
  const scripts = Object.fromEntries(
    await Promise.all(
      texFiles.map(async (f) => [f, await io.fetch(new URL("../tex/" + f, import.meta.url).href)]),
    ),
  );
  scripts["ctablestack.sty"] = await io.fetch(base + "ctablestack.sty");
  return { set, scripts };
}
export function resourceState(res) {
  return {manifests: res.set.manifests, cache: [...res.set.cache], scripts: res.scripts};
}
export function restoreResources(state) {
  const set = new BundleSet(browserIO());
  for (const {spec, base, manifest} of state.manifests) set.addLoaded(spec, base, manifest);
  set.cache = new Map(state.cache);
  return {set, scripts: state.scripts};
}
export async function engine(res, files, log = () => {}, env = {}, wasmModule) {
  const M = await createLuaTeX({
    ...(wasmModule ? {instantiateWasm(imports, ready) {
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
  for (const dir of ["/bin", "/work", "/rex", "/home", "/texmf-var"])
    mkdirp(FS, dir);
  FS.writeFile("/bin/luatex", "");
  for (const [name, data] of Object.entries(res.scripts))
    FS.writeFile("/rex/" + name, data);
  writeFiles(FS, files);
  FS.chdir("/work");
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
