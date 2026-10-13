import { resources, restoreResources, engine, run, liveDriver } from "../compiler/runtime.js";
import { decodeDisplayList } from "../protocol/display-list.js";
import { wireDevices, decodeFrame } from "../protocol/transport.js";
import { InputPending } from "../compiler/async-runtime.js";
let res;
let wake;
const requests = [];
const sent = new Set();
onmessage = async ({ data }) => {
  if (data.type === "request") { requests.push(data.bytes); wake?.(); return; }
  try {
    res = data.resources ? restoreResources(data.resources) : await resources();
    const local = !!globalThis.rexLocal;
    const wasmModule = res.wasmModule;
    const files = { ...data.files, ...data.aux, "live.tex": liveDriver(data.preamble) };
    if (data.aux?.["capture.aux"]) files["live.aux"] = data.aux["capture.aux"];
    if (data.aux?.["capture.bbl"]) files["live.bbl"] = data.aux["capture.bbl"];
    if (data.aux?.["capture.ind"]) files["live.ind"] = data.aux["capture.ind"];
    const M = await engine(
      res,
      files,
      (line) => postMessage({ type: "log", line }),
      { REX_REQ: "/rex-input", REX_RESP: "/rex-output", ...(local ? {REX_ASYNC_INPUT: "1"} : {}) },
      wasmModule,
    );
    const input = data.mailbox || (() => {
      if (requests.length) return requests.shift();
      throw new InputPending(new Promise(resolve => { wake = resolve; }));
    });
    wireDevices(M, input, async (frame) => {
      try {
        const { header, binary } = decodeFrame(frame);
        // Fonts are collected while the runtime is alive. Font IDs vary per engine.
        const fonts = {}, assets = {}, type1 = {};
        if (binary?.length) {
          const metadata = decodeDisplayList(binary, true);
          for (const f of Object.values(metadata.fonts)) {
            if (f.filename && !sent.has(f.filename)) {
              fonts[f.filename] = M.FS.readFile(f.filename);
              sent.add(f.filename);
            } else if (local && !f.filename && !sent.has("type1:" + f.name)) {
              const bytes = await globalThis.rexLocal.loadAsync("vendor/type1/" + f.name + ".json");
              if (!bytes) throw Error("Missing packaged font: " + f.name);
              type1[f.name] = JSON.parse(new TextDecoder().decode(bytes));
              sent.add("type1:" + f.name);
            }
          }
          for (const image of Object.values(metadata.images_info))
            if (!sent.has(image.file)) {
              assets[image.file] = M.FS.readFile(image.file);
              sent.add(image.file);
            }
        }
        postMessage(
          { type: "frame", header, binary, fonts, assets, type1 },
          binary ? [binary.buffer] : [],
        );
      } catch (e) { postMessage({type: 'failure', message: String(e)}); }
    });
    // All context requests are sent through stdin by the host after the ready frame.
    await run(M, "live.tex");
    postMessage({ type: "stopped" });
  } catch (e) {
    postMessage({ type: "failure", message: String(e) });
  }
};
