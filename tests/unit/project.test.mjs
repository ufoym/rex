import test from "node:test";
import assert from "node:assert/strict";
import { project, encodeProject, decodeProject, importProject } from "../../src/core/project.js";
import { packFiles, unpackFiles } from "../../src/protocol/snapshot.js";
import { paragraphs, changedSpan } from "../../src/core/document.js";
const main = "\\documentclass{article}\n\\begin{document}\n\\input{chapters/one}\n\\end{document}";
test("a portable project preserves nested sources, binary dependencies and active file", () => {
  const files = {"main.tex": main, "chapters/one.tex": "Café $\\alpha$.", "image.png": new Uint8Array([0, 128, 255]), "notes.md": "Project notes"};
  const restored = decodeProject(encodeProject(project(files, "main.tex", "chapters/one.tex")));
  assert.equal(restored.main, "main.tex"); assert.equal(restored.active, "chapters/one.tex");
  for (const name of Object.keys(files)) assert.deepEqual(restored.files[name], files[name]);
});
test("truncated, duplicate and unsafe project paths are rejected before import", () => {
  const packed = encodeProject(project({"main.tex": main}, "main.tex"));
  assert.throws(() => decodeProject(packed.subarray(0, packed.length - 1)), /snapshot/);
  assert.throws(() => project({"main.tex": main, "../outside.tex": "bad"}, "main.tex"), /path/);
  assert.throws(() => project({"main.tex": main, "/outside.tex": "bad"}, "main.tex"), /path/);
  const header = new TextEncoder().encode(JSON.stringify([["main.tex", 0], ["main.tex", 0]]));
  const duplicate = new Uint8Array(4 + header.length); new DataView(duplicate.buffer).setUint32(0, header.length, true); duplicate.set(header, 4);
  assert.throws(() => unpackFiles(duplicate), /Invalid/);
  const special = Object.create(null); special.__proto__ = new Uint8Array([9]);
  assert.deepEqual(unpackFiles(packFiles(special)).__proto__, new Uint8Array([9]));
});
test("incomplete LaTeX drafts survive portable round trips", () => {
  const draft = "\\documentclass{article}\n\\begin{docum";
  const restored = decodeProject(encodeProject(project({"main.tex": draft}, "main.tex")));
  assert.equal(restored.files["main.tex"], draft);
  assert.throws(() => project({"notes.txt": draft}, "notes.txt"), /main .tex/);
  assert.throws(() => project({"main.tex": new Uint8Array()}, "main.tex"), /main .tex/);
});
test("folder imports remove the picker root and prefer main.tex", async () => {
  const files = [{name: "one.tex", webkitRelativePath: "book/chapters/one.tex", text: async () => "A paragraph."},
    {name: "main.tex", webkitRelativePath: "book/main.tex", text: async () => main}];
  const p = await importProject(files);
  assert.equal(p.main, "main.tex"); assert.equal(p.files["chapters/one.tex"], "A paragraph.");
});
test("cached paragraph edits preserve fragment offsets across repeated line changes", () => {
  let source = "First paragraph.\n\nSecond paragraph.\n\nLast paragraph.", spans = paragraphs(source, true);
  for (const transform of [s => s.replace("First paragraph.", "First\nparagraph."), s => s.replace("Last paragraph.", "A much longer last paragraph.")]) {
    const next = transform(source);
    const delta = changedSpan(source, next, true, spans); assert.ok(delta);
    assert.deepEqual(delta.spans, paragraphs(next, true));
    source = next; spans = delta.spans;
  }
  assert.equal(changedSpan(source, source.replace("Second paragraph.", "Second.\n\nNew paragraph."), true, spans).provisional, true);
});
