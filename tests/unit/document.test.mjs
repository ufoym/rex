import test from "node:test";
import assert from "node:assert/strict";
import { paragraphs, changedSpan } from "../../src/core/document.js";

test("long-document changes preserve offsets across chunk boundaries and Unicode", () => {
  const before = "\\begin{document}\n" + Array.from({length: 12}, (_, i) =>
    `${i}: ` + "字😀 alpha beta ".repeat(600)).join("\n\n") + "\n\\end{document}";
  const cached = paragraphs(before);
  for (const offset of [0, 4095, 4096, 4097, 8191, 8192, before.length - 40]) {
    const start = Math.max(cached[0].start, offset);
    for (const [removed, inserted] of [[0, "added"], [1, ""], [3, "字😀"], [7, "replacement"]]) {
      const after = before.slice(0, start) + inserted + before.slice(start + removed);
      const delta = changedSpan(before, after, false, cached);
      assert.ok(delta);
      assert.equal(delta.provisional, false);
      assert.deepEqual(delta.spans, paragraphs(after));
    }
  }
});
