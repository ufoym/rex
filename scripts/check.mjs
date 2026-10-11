import { access, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(name);
    else if (entry.isFile()) files.push(name);
  }
}
for (const dir of ["src", "scripts", "tests", "benchmarks", "docs", "public", ".github"]) await walk(dir);
files.push("README.md", "CONTRIBUTING.md", "THIRD_PARTY.md", "package.json", "package-lock.json");
for (const file of files) {
  const text = await readFile(path.join(root, file), "utf8");
  if (/\.(m?js)$/.test(file)) {
    const checked = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    if (checked.status !== 0) throw Error(checked.stderr);
    const references = text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bnew URL\(\s*)["'](\.[^"']+)["']/g);
    for (const [, reference] of references) {
      const browserAsset = (file.startsWith("tests/browser/") || file.startsWith("benchmarks/")) && /^\.\/(?:assets|vendor)\//.test(reference);
      const target = browserAsset ? path.resolve(root, "dist", reference) : path.resolve(root, path.dirname(file), reference);
      await access(target).catch(() => { throw Error(`Broken module/worker path: ${file} → ${reference}`); });
    }
  }
  if (file.endsWith(".json")) JSON.parse(text);
  if (file.endsWith(".md")) {
    for (const [, target] of text.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const local = decodeURIComponent(target.split("#")[0]);
      await access(path.resolve(root, path.dirname(file), local)).catch(() => { throw Error(`Broken documentation link: ${file} → ${target}`); });
    }
  }
}
const manifest = JSON.parse(await readFile(path.join(root, "dist/manifest.json"), "utf8"));
if (manifest.schema !== 1 || !manifest.files) throw Error("Unsupported distribution manifest");
const sourceCount = files.length;
await walk("dist");
const actual = files.slice(sourceCount).map(file => file.slice(5).split(path.sep).join("/"));
const expectedFiles = new Set([...Object.keys(manifest.files), "manifest.json"]);
if (actual.length !== expectedFiles.size || actual.some(file => !expectedFiles.has(file)))
  throw Error("Distribution has unlisted or missing files. Run npm run build.");
for (const [name, expected] of Object.entries(manifest.files)) {
  if (name.startsWith("/") || name.split("/").includes("..")) throw Error("Invalid manifest path: " + name);
  const source = name.startsWith("assets/") ? "src/" + name.slice(7)
    : name.startsWith("vendor/") ? name
    : ["LICENSE", "THIRD_PARTY.md"].includes(name) ? name : "public/" + name;
  for (const file of [source, "dist/" + name]) {
    const bytes = await readFile(path.join(root, file));
    if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
      throw Error(`Build is missing or stale: ${file}. Run npm run build.`);
  }
}
console.log(`Checked syntax, module paths, documentation links and ${Object.keys(manifest.files).length} published assets against source.`);
