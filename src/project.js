import { packFiles, unpackFiles } from "./snapshot.js";
const encoder = new TextEncoder(), decoder = new TextDecoder();
export const textFile = name => /\.(tex|bib|sty|cls|txt|csv|ist|cfg|def)$/i.test(name);
export function project(files, main, active = main) {
  const clean = Object.create(null);
  for (const [name, data] of Object.entries(files)) {
    if (!name || /^(?:\/|[A-Za-z]:)|\\/.test(name) || name.split("/").some(part => !part || part === "." || part === ".."))
      throw Error("Invalid project path: " + name);
    if (typeof data !== "string" && !(data instanceof Uint8Array)) throw Error("Invalid project file: " + name);
    clean[name] = data;
  }
  if (typeof clean[main] !== "string" || !/\.tex$/i.test(main)) throw Error("Choose a main .tex source file");
  return {schema: 1, files: clean, main, active: typeof clean[active] === "string" ? active : main};
}
export function encodeProject(value) {
  const p = project(value.files, value.main, value.active);
  const metadata = encoder.encode(JSON.stringify({schema: p.schema, main: p.main, active: p.active, text: Object.keys(p.files).filter(name => typeof p.files[name] === "string")}));
  const files = packFiles(p.files), bytes = new Uint8Array(8 + metadata.length + files.length);
  bytes.set(encoder.encode("REX1")); new DataView(bytes.buffer).setUint32(4, metadata.length, true);
  bytes.set(metadata, 8); bytes.set(files, 8 + metadata.length);
  return bytes;
}
export function decodeProject(bytes) {
  if (bytes.length < 12 || decoder.decode(bytes.subarray(0, 4)) !== "REX1") throw Error("Invalid Rex project");
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  if (n > bytes.length - 12) throw Error("Truncated Rex project");
  const metadata = JSON.parse(decoder.decode(bytes.subarray(8, 8 + n)));
  if (metadata.schema !== 1) throw Error("Unsupported Rex project version");
  const files = unpackFiles(bytes.subarray(8 + n));
  if (!Array.isArray(metadata.text)) throw Error("Invalid project text inventory");
  for (const name of metadata.text) {
    if (!Object.hasOwn(files, name)) throw Error("Missing project text file");
    files[name] = decoder.decode(files[name]);
  }
  return project(files, metadata.main, metadata.active);
}
export async function importProject(input) {
  if (!input.length) throw Error("Choose a main document and its dependencies");
  if (input.length === 1 && input[0].name.endsWith(".rex")) return decodeProject(new Uint8Array(await input[0].arrayBuffer()));
  const files = Object.create(null);
  const paths = [...input].map(file => file.webkitRelativePath || file.name);
  // Directory imports share a root folder; TeX paths are relative to its contents.
  const prefix = paths.every(name => name.includes("/") && name.split("/")[0] === paths[0].split("/")[0]) ? paths[0].split("/")[0] + "/" : "";
  for (const [index, file] of [...input].entries()) {
    const name = paths[index].slice(prefix.length);
    files[name] = textFile(name) ? await file.text() : new Uint8Array(await file.arrayBuffer());
  }
  const candidates = Object.keys(files).filter(name => name.endsWith(".tex") && typeof files[name] === "string" && files[name].includes("\\begin{document}"));
  const main = candidates.find(name => name === "main.tex") || candidates[0];
  return project(files, main);
}
// One durable browser project. IndexedDB stores binary dependencies without base64 expansion.
let database;
async function store(mode, value) {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("rex", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }).catch(error => { database = null; throw error; });
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("projects", mode), object = transaction.objectStore("projects");
    const request = mode === "readonly" ? object.get("current") : object.put(value, "current");
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error);
  });
}
export async function loadProject() {
  const value = await store("readonly");
  return value && project(value.files, value.main, value.active);
}
export const saveProject = async value => store("readwrite", project(value.files, value.main, value.active));
