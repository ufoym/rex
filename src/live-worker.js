import { resources, engine, run, liveDriver } from "./runtime.js";
import { decodeDisplayList } from "./display-list.js";
import { wireDevices, decodeFrame } from "./transport.js";
let res;
const sent = new Set();
onmessage = async ({ data }) => {
  try {
    res = await resources();
    const files = { ...data.files, ...data.aux, "live.tex": liveDriver(data.preamble) };
    if (data.aux?.["capture.aux"]) files["live.aux"] = data.aux["capture.aux"];
    if (data.aux?.["capture.bbl"]) files["live.bbl"] = data.aux["capture.bbl"];
    if (data.aux?.["capture.ind"]) files["live.ind"] = data.aux["capture.ind"];
    const M = await engine(
      res,
      files,
      (line) => postMessage({ type: "log", line }),
      { REX_REQ: "/rex-input", REX_RESP: "/rex-output" },
    );
    wireDevices(M, data.mailbox, (frame) => {
      const { header, binary } = decodeFrame(frame);
      // Fonts are collected while the runtime is alive. Font IDs vary per engine.
      const fonts = {}, assets = {};
      if (binary?.length) {
        const metadata = decodeDisplayList(binary, true);
        for (const f of Object.values(metadata.fonts))
          if (f.filename && !sent.has(f.filename)) {
            fonts[f.filename] = M.FS.readFile(f.filename);
            sent.add(f.filename);
          }
        for (const image of Object.values(metadata.images_info))
          if (!sent.has(image.file)) {
            assets[image.file] = M.FS.readFile(image.file);
            sent.add(image.file);
          }
      }
      postMessage(
        { type: "frame", header, binary, fonts, assets },
        binary ? [binary.buffer] : [],
      );
    });
    // All context requests are sent through stdin by the host after the ready frame.
    run(M, "live.tex");
    postMessage({ type: "stopped" });
  } catch (e) {
    postMessage({ type: "failure", message: String(e) });
  }
};
