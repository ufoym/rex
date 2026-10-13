import { build } from "esbuild";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packFiles } from "../src/protocol/snapshot.js";
import { asyncWasm } from "./async-wasm.mjs";


const root = fileURLToPath(new URL("../", import.meta.url));

export async function buildStandalone(stage) {
  const inputs = new Set(["scripts/standalone.mjs", "scripts/build.mjs", "scripts/copy-assets.mjs", "scripts/prune-assets.mjs", "scripts/async-wasm.mjs", "scripts/startup-fonts.mjs", "scripts/font-assets.mjs", "scripts/install-tools.mjs", "runtime/busytex/manifest.json", "package-lock.json"]);
  const bundle = async (entryPoints, contents) => {
    const result = await build({
      absWorkingDir: root, ...(contents ? {stdin: {contents, resolveDir: root, sourcefile: "standalone-entry.js"}} : {entryPoints}),
      bundle: true, write: false, format: "iife", minify: true, legalComments: "eof", target: "es2022", metafile: true,
      // All application modules have the same depth; packaged I/O resolves their
      // relative resource paths against this virtual URL without making requests.
      define: {"import.meta.url": '"https://rex.local/assets/ui/app.js"'},
      external: ["node:*", "fs"],
      plugins: [{name: "local-tools", setup(builder) {
        builder.onLoad({filter: /bibliography\/(?:busytex|biber)\.mjs$/}, async ({path: file}) => {
          let source = await readFile(file, "utf8");
          source = source.replace(/^const require = .*\n/, "const require = undefined;\n");
          if (file.endsWith("biber.mjs")) {
            if (!source.includes("var db = await openDatabase();")) throw Error("Unsupported Biber loader");
            source = source.replace("var db = await openDatabase();", `
              if (globalThis.rexLocal) {
                const bytes = globalThis.rexLocal.load("vendor/bibliography/biber.data");
                processPackageData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
                return;
              }
              var db = await openDatabase();`);
            source = source.replace("async function preloadFallback(error) {", "async function preloadFallback(error) { if (globalThis.rexLocal) throw error;");
          }
          return {contents: source, loader: "js"};
        });
      }}],
    });
    for (const file of Object.keys(result.metafile.inputs))
      if (file !== "standalone-entry.js") inputs.add(file);
    return result.outputFiles[0].text;
  };
  const assets = {};
  async function collect(dir) {
    for (const entry of (await readdir(path.join(stage, dir), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = dir + "/" + entry.name;
      if (entry.isDirectory()) await collect(name);
      else { assets[name] = await readFile(path.join(stage, name)); inputs.add(name); }
    }
  }
  await collect("vendor/engine/bundles");
  for (const name of ["vendor/engine/luatex.wasm", "vendor/ctablestack.sty", "vendor/bibliography/busytex.wasm", "vendor/bibliography/biber.wasm", "vendor/bibliography/biber.data"]) {
    assets[name] = await readFile(path.join(stage, name)); inputs.add(name);
  }
  // The build packages resources once; a Blob worker expands them without local
  // fetch/XHR, and the same BundleSet/compiler handles all document operations.
  await collect("assets/tex");
  await collect("vendor/type1");
  await collect("vendor/engine/font-cache");
  assets["vendor/engine/font-cache.json"] = await readFile(path.join(stage, "vendor/engine/font-cache.json"));
  inputs.add("vendor/engine/font-cache.json");
  assets["vendor/engine/luatex-async.wasm"] = await asyncWasm(assets["vendor/engine/luatex.wasm"]);
  const groups = new Map();
  for (const [name, bytes] of Object.entries(assets)) {
    const parts = name.split('/');
    let group = name, label = name.split('/').at(-1);
    if (name.endsWith('manifest.json') || name.endsWith('hot.json') || name.endsWith('font-cache.json') || name.startsWith('assets/tex/')) {
      group = 'metadata'; label = 'engine resources';
    } else if (name.startsWith('vendor/engine/bundles/')) {
      const kind = parts[3];
      if (/\.(?:otf|ttf|ttc|pfb)$/.test(name)) label = 'font ' + parts.at(-1);
      else if (parts[5] === 'tex') { group = kind + ':' + parts.slice(5, 8).join('/'); label = 'LaTeX package ' + (parts[7] || kind); }
      else { group = kind; label = 'LaTeX ' + kind; }
    } else if (name.startsWith('vendor/bibliography/')) label = name.includes('biber') ? 'Biber bibliography' : 'BibTeX / MakeIndex';
    else if (name.startsWith('vendor/type1/')) label = 'font ' + parts.at(-1).replace(/\.json$/, '');
    else if (name.startsWith('vendor/engine/font-cache/')) label = 'font tables';
    else if (name.endsWith('.wasm')) label = 'typesetting engine';
    if (!groups.has(group)) groups.set(group, {label, files: {}});
    groups.get(group).files[name] = bytes;
  }
  const catalog = {schema: 1, files: {}, chunks: {}, tools: {}};
  await mkdir(path.join(stage, 'standalone/resources'), {recursive: true});
  await mkdir(path.join(stage, 'standalone/tools'), {recursive: true});
  for (const {label, files} of groups.values()) {
    const compressed = gzipSync(packFiles(files), {level: 9});
    const id = createHash('sha256').update(compressed).digest('hex').slice(0, 24);
    const script = 'resources/' + id + '.js';
    const source = 'globalThis.rexLocal.register(' + JSON.stringify(script) + ',' + JSON.stringify({id, data: compressed.toString('base64')}) + ');\n';
    catalog.chunks[id] = {script, label, bytes: Buffer.byteLength(source), entries: Object.keys(files).length};
    for (const name of Object.keys(files)) catalog.files[name] = id;
    await writeFile(path.join(stage, 'standalone', script), source);
  }
  for (const name of ['busytex', 'biber']) {
    const source = await bundle(null, `
      import factory from ${JSON.stringify(path.join(root, 'vendor/bibliography/' + name + '.mjs'))};
      globalThis.rexLocal.tools[${JSON.stringify(name)}] = factory;
    `);
    const script = 'tools/' + name + '.js';
    const wrapped = 'globalThis.rexLocal.register(' + JSON.stringify(script) + ',' + JSON.stringify(source) + ');\n';
    catalog.tools[name] = {script, bytes: Buffer.byteLength(wrapped), label: name === 'biber' ? 'Biber bibliography' : 'BibTeX / MakeIndex'};
    await writeFile(path.join(stage, 'standalone', script), wrapped);
  }
  const compiler = entry => bundle(null, `
    import {createLocalResources} from ${JSON.stringify(path.join(root, 'src/compiler/local-resources.js'))};
    const pending = [];
    globalThis.onmessage = ({data}) => pending.push(data);
    (async () => {
      const catalog = globalThis.rexCatalog;
      delete globalThis.rexCatalog;
      globalThis.rexLocal = createLocalResources(catalog, globalThis.rexLoadScript);
      await import(${JSON.stringify(path.join(root, entry))});
      postMessage({type: 'preloaded'});
      for (const data of pending) globalThis.onmessage({data});
    })().catch(error => {setTimeout(() => {throw error;});});
  `);
  const pdf = await bundle(["vendor/pdfjs/pdf.worker.mjs"]);
  const app = await bundle(["src/ui/app.js"]);
  const workers = {
    "/assets/workers/background-worker.js": {source: await compiler("src/workers/background-worker.js"), compiler: true},
    "/assets/workers/live-worker.js": {source: await compiler("src/workers/live-worker.js"), compiler: true},
    "/vendor/pdfjs/pdf.worker.mjs": {source: pdf},
  };
  await mkdir(path.join(stage, "standalone"), {recursive: true});
  await writeFile(path.join(stage, "standalone/workers.js"), "globalThis.rexLocal=" + JSON.stringify({workers}) +
    ";globalThis.rexLocal.resourceURL=new URL(" + JSON.stringify("./resources.js") + ",document.currentScript.src).href;\n");
  await writeFile(path.join(stage, "standalone/resources.js"), "globalThis.rexCatalog=" + JSON.stringify(catalog) + ";\n");
  await writeFile(path.join(stage, "standalone/app.js"), app);
  const hashes = {};
  for (const name of [...inputs].sort()) {
    const source = name.startsWith("assets/") ? "src/" + name.slice(7) : name;
    hashes[source] = createHash("sha256").update(await readFile(path.join(root, source))).digest("hex");
  }
  return hashes;
}
