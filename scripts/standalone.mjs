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
  const inputs = new Set(["scripts/standalone.mjs", "scripts/build.mjs", "scripts/async-wasm.mjs", "package-lock.json"]);
  const bundle = async (entryPoints, contents) => {
    const result = await build({
      absWorkingDir: root, ...(contents ? {stdin: {contents, resolveDir: root, sourcefile: "standalone-entry.js"}} : {entryPoints}),
      bundle: true, write: false, format: "iife", minify: true, legalComments: "eof", target: "es2022", metafile: true,
      // All application modules have the same depth; packaged I/O resolves their
      // relative resource paths against this virtual URL without making requests.
      define: {"import.meta.url": '"https://rex.local/assets/ui/app.js"'},
      external: ["node:*", "fs"],
      plugins: [{name: "local-tools", setup(builder) {
        builder.onLoad({filter: /(?:tools\.js|bibliography\/(?:busytex|biber)\.mjs)$/}, async ({path: file}) => {
          let source = await readFile(file, "utf8");
          if (file.endsWith("tools.js")) {
            source = source.replace("import(new URL(name + '.mjs', base).href)",
              `(name === "biber" ? import(${JSON.stringify(path.join(root, "vendor/bibliography/biber.mjs"))}) : import(${JSON.stringify(path.join(root, "vendor/bibliography/busytex.mjs"))}))`);
          } else {
            source = source.replace(/^const require = .*\n/, "const require = undefined;\n");
            if (file.endsWith("biber.mjs")) {
              source = source.replace("var db = await openDatabase();", `
                if (globalThis.rexLocal) {
                  const bytes = globalThis.rexLocal.files["vendor/bibliography/biber.data"];
                  processPackageData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
                  return;
                }
                var db = await openDatabase();`);
            }
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
  assets["vendor/engine/luatex-async.wasm"] = await asyncWasm(assets["vendor/engine/luatex.wasm"]);
  const archive = gzipSync(packFiles(assets), {level: 9}).toString("base64");
  const compiler = entry => bundle(null, `
    import {unpackFiles} from ${JSON.stringify(path.join(root, "src/protocol/snapshot.js"))};
    const pending = [];
    globalThis.onmessage = ({data}) => pending.push(data);
    (async () => {
      const base64 = globalThis.rexArchive;
      delete globalThis.rexArchive;
      const size = base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
      const compressed = new Uint8Array(size);
      let offset = 0;
      for (let i = 0; i < base64.length; i += 65536) {
        const chunk = atob(base64.slice(i, i + 65536));
        for (let j = 0; j < chunk.length; j++) compressed[offset++] = chunk.charCodeAt(j);
      }
      const stream = new ReadableStream({start(controller) {
        controller.enqueue(compressed); controller.close();
      }}).pipeThrough(new DecompressionStream("gzip"));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      globalThis.rexLocal = {files: unpackFiles(bytes)};
      await import(${JSON.stringify(path.join(root, entry))});
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
  const type1 = {};
  for (const name of (await readdir(path.join(stage, "vendor/type1"))).sort()) {
    if (!name.endsWith(".json")) continue;
    type1[name.slice(0, -5)] = JSON.parse(await readFile(path.join(stage, "vendor/type1", name), "utf8"));
    inputs.add("vendor/type1/" + name);
  }
  await mkdir(path.join(stage, "standalone"), {recursive: true});
  await writeFile(path.join(stage, "standalone/workers.js"), "globalThis.rexLocal=" + JSON.stringify({workers, type1,
    archive: "globalThis.rexArchive=" + JSON.stringify(archive) + ";\n"}) + ";\n");
  await writeFile(path.join(stage, "standalone/app.js"), app);
  const hashes = {};
  for (const name of [...inputs].sort()) {
    const source = name.startsWith("assets/") ? "src/" + name.slice(7) : name;
    hashes[source] = createHash("sha256").update(await readFile(path.join(root, source))).digest("hex");
  }
  return hashes;
}
