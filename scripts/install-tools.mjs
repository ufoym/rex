import {readFile, copyFile, mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

export async function verifyTools(root = fileURLToPath(new URL("../", import.meta.url))) {
  const source = path.join(root, "runtime/busytex");
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  if (manifest.schema !== 1 || manifest.applets?.join(",") !== "bibtex8,makeindex" || ["busytex.wasm", "busytex.mjs", "LICENSE", "NOTICE"].some(name => !manifest.files?.[name])) throw Error("Invalid auxiliary tools inventory");
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (path.basename(name) !== name) throw Error("Invalid auxiliary tools path");
    const bytes = await readFile(path.join(source, name));
    if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
      throw Error("Auxiliary tools integrity mismatch: " + name);
  }
  const dispatcher = await readFile(path.join(source, "busytex.c"));
  if (createHash("sha256").update(dispatcher).digest("hex") !== manifest.source.dispatcherSha256)
    throw Error("Auxiliary tools dispatcher integrity mismatch");
  return {source, manifest};
}
export async function installTools(root = fileURLToPath(new URL("../", import.meta.url))) {
  const {source, manifest} = await verifyTools(root);
  const destination = path.join(root, "vendor/bibliography");
  await mkdir(destination, {recursive: true});
  for (const name of Object.keys(manifest.files))
    await copyFile(path.join(source, name), path.join(destination, name === "LICENSE" || name === "NOTICE" ? "BusyTeX-" + name : name));
}
