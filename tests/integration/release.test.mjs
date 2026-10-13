import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {releaseLocal} from "../../scripts/release.mjs";

test("local folder preserves standalone bytes and notices, excludes hosted duplicates and rejects stale inputs", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "rex-release-"));
  try {
    const dist = path.join(scratch, "dist"), output = path.join(scratch, "rex-local"), files = {};
    for (const name of ["index.html", "style.css", "assets/ui/theme.js", "standalone/app.js", "standalone/workers.js", "standalone/resources.js", "standalone/resources/test.js", "standalone/tools/biber.js", "LICENSE", "THIRD_PARTY.md", "vendor/engine/licenses/font.txt", "vendor/bibliography/TeXlyre-NOTICE", "vendor/engine/bundles/chinese/doc/OFL.txt", "vendor/engine/luatex.wasm", "assets/ui/app.js"]) {
      const bytes = Buffer.from(name === "standalone/resources.js" ? "globalThis.rexCatalog=" + JSON.stringify({schema: 1,
        chunks: {test: {script: "resources/test.js"}}, tools: {biber: {script: "tools/biber.js"}}}) + ";\n" : name + "\n");
      await mkdir(path.dirname(path.join(dist, name)), {recursive: true});
      await writeFile(path.join(dist, name), bytes);
      files[name] = {bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
    }
    await writeFile(path.join(dist, "manifest.json"), JSON.stringify({schema: 1, files, generatedInputs: {}}));
    await releaseLocal(dist, output);
    const extracted = output;
    const manifest = JSON.parse(await readFile(path.join(extracted, "manifest.json"), "utf8"));
    assert.equal(manifest.distribution, "local");
    await assert.rejects(readFile(output + ".zip"), {code: "ENOENT"});
    assert.ok(manifest.files["vendor/bibliography/TeXlyre-NOTICE"]);
    assert.ok(manifest.files["vendor/engine/bundles/chinese/doc/OFL.txt"]);
    assert.ok(manifest.files["vendor/engine/licenses/font.txt"]);
    assert.equal(manifest.files["vendor/engine/luatex.wasm"], undefined);
    assert.equal(manifest.files["assets/ui/app.js"], undefined);
    for (const name of Object.keys(manifest.files))
      assert.deepEqual(await readFile(path.join(extracted, name)), await readFile(path.join(dist, name)));
    await writeFile(path.join(dist, "standalone/workers.js"), "stale");
    await assert.rejects(releaseLocal(dist, output), /does not match build manifest/);
    assert.equal(await readFile(path.join(output, "standalone/workers.js"), "utf8"), "standalone/workers.js\n");
    delete files["standalone/resources/test.js"];
    await writeFile(path.join(dist, "manifest.json"), JSON.stringify({schema: 1, files}));
    await assert.rejects(releaseLocal(dist, output), /Incomplete local resource inventory/);
    delete files["standalone/resources.js"];
    await writeFile(path.join(dist, "manifest.json"), JSON.stringify({schema: 1, files}));
    await assert.rejects(releaseLocal(dist, output), /complete build/);
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
});
