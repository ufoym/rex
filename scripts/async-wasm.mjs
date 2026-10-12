import binaryen from "binaryen";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";

// Asyncify is a build-time transform for the local stdin transport. Keep the
// original module for full passes and the shared-memory hosted live compiler.
export async function asyncWasm(bytes) {
  const key = createHash("sha256").update(bytes)
    .update(await readFile(new URL(import.meta.url)))
    .update(await readFile(new URL("../package-lock.json", import.meta.url))).digest("hex");
  const file = new URL(`../artifacts/async-wasm/${key}.wasm`, import.meta.url);
  try { return await readFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const module = binaryen.readBinary(bytes);
  try {
    module.setFeatures(binaryen.Features.BulkMemory | binaryen.Features.BulkMemoryOpt |
      binaryen.Features.NontrappingFPToInt | binaryen.Features.MutableGlobals | binaryen.Features.SignExt);
    binaryen.setPassArgument("asyncify-imports", "wasi_snapshot_preview1.fd_read,env.invoke_*");
    module.runPasses(["asyncify"]);
    if (!module.validate()) throw Error("Invalid Asyncify LuaTeX module");
    const output = module.emitBinary();
    await mkdir(new URL("../artifacts/async-wasm/", import.meta.url), {recursive: true});
    await writeFile(file, output);
    return output;
  } finally { module.dispose(); }
}
