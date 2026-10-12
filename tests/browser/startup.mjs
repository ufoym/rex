import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { openBrowser } from "../helpers/browser-helper.mjs";

for (const browserType of [webkit, chromium]) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({acceptDownloads: true});
    // WebKit's automation offline switch also rejects file:// navigation.
    // Block the network explicitly in both browsers; Chromium also goes offline.
    await context.route(/^https?:\/\//, route => route.abort("internetdisconnected"));
    if (browserType === chromium) await context.setOffline(true);
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    const errors = [], network = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text().slice(0, 1000)); });
    page.on("request", request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.goto(new URL("../../dist/index.html", import.meta.url).href);
    assert.ok(await page.evaluate(() => !!globalThis.rexLocal), "File launch must load its packaged runtime");
    const ready = async () => {
      await page.waitForFunction(() => window.rex?.session.warmed || /error|failed/i.test(document.querySelector("#status").textContent));
      assert.ok(await page.evaluate(() => !!rex.session.warmed), await page.locator("#log").textContent());
      await page.evaluate(() => rex.session.warmed);
    };
    await ready();
    await page.waitForFunction(() => rex.renderer.views.get(1)?.ready);
    assert.ok(await page.evaluate(() => rex.session.layout.pdf.length > 1000));
    assert.equal(await page.evaluate(() => rex.session.live), null);
    const revision = await page.evaluate(() => rex.session.revision);
    await page.evaluate(() => {
      const text = rex.editor.state.doc.toString();
      const next = text.replace("Edit this paragraph", "Edit this local paragraph");
      if (next === text) throw Error("Missing starter paragraph");
      rex.editor.dispatch({changes: {from: 0, to: text.length, insert: next}});
    });
    await page.waitForFunction(previous => rex.session.layout?.revision > previous && !rex.session.busy, revision);
    await page.waitForFunction(() => rex.renderer.views.get(1)?.ready);
    const download = page.waitForEvent("download");
    await page.locator("#download-menu summary").click();
    await page.locator("#export").click();
    assert.match((await download).suggestedFilename(), /\.pdf$/);
    await page.waitForFunction(() => document.querySelector("#storage-status").textContent === "Saved in this browser");
    await page.reload();
    await ready();
    assert.match(await page.evaluate(() => rex.editor.state.doc.toString()), /Edit this paragraph/);
    await page.locator("#open-menu > summary").click();
    await page.locator("#recent-projects button").click();
    await page.waitForFunction(() => rex.editor.state.doc.toString().includes("Edit this local paragraph"));
    await ready();
    assert.match(await page.evaluate(() => rex.editor.state.doc.toString()), /Edit this local paragraph/);
    await page.locator("#help-menu > summary").click();
    await page.locator("#restore-project").check();
    await page.reload();
    await ready();
    assert.match(await page.evaluate(() => rex.editor.state.doc.toString()), /Edit this local paragraph/);
    const projectId = await page.evaluate(() => rex.session.projectId);
    await page.locator("#open").setInputFiles([
      new URL("../../examples/bibliography/main.tex", import.meta.url).pathname,
      new URL("../../examples/bibliography/references.bib", import.meta.url).pathname,
    ]);
    await page.waitForFunction(previous => rex.session.projectId > previous &&
      (rex.session.warmed || document.querySelector("#status").textContent.includes("failed")), projectId);
    assert.ok(await page.evaluate(() => rex.session.layout?.converged), await page.locator("#log").textContent());
    assert.equal(await page.evaluate(() => rex.session.layout.bibliographyRuns), 1);
    assert.match(await page.evaluate(() => new TextDecoder().decode(rex.session.layout.aux["capture.bbl"])), /TeXbook/);
    const nextProject = await page.evaluate(() => rex.session.projectId);
    await page.locator("#open").setInputFiles([
      {name: "main.tex", mimeType: "text/plain", buffer: Buffer.from(String.raw`\documentclass{article}
\usepackage{makeidx}\makeindex
\begin{document}
A local citation \cite{knuth} and index entry.\index{Local entry}
\bibliographystyle{plain}\bibliography{references}
\printindex
\end{document}`)},
      {name: "references.bib", mimeType: "text/plain", buffer: Buffer.from("@book{knuth, author={Donald E. Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}")},
    ]);
    await page.waitForFunction(previous => rex.session.projectId > previous &&
      (rex.session.warmed || document.querySelector("#status").textContent.includes("failed")), nextProject);
    assert.ok(await page.evaluate(() => rex.session.layout?.converged), await page.locator("#log").textContent());
    assert.equal(await page.evaluate(() => rex.session.layout.bibliographyRuns), 1);
    assert.ok(await page.evaluate(() => rex.session.layout.indexRuns > 0));
    assert.match(await page.evaluate(() => new TextDecoder().decode(rex.session.layout.aux["capture.ind"])), /Local entry/);
    assert.deepEqual(network, [], "Direct file startup, editing and reload must work entirely offline");
    assert.deepEqual(errors, [], "Direct file mode must avoid CORS and uncaught errors");
    console.log(`${browserType.name()}: direct file startup, offline editing, PDF export, restore, Biber, BibTeX and MakeIndex passed.`);
  } finally {
    await browser.close();
  }
}

const {page, close} = await openBrowser({basePath: "/rex/"});
try {
  await page.waitForFunction(() => window.rex?.session.warmed);
  assert.ok(await page.evaluate(() => rex.session.layout.pdf.length > 1000));
  assert.ok(await page.evaluate(() => !!rex.session.live));
  console.log("HTTP subpath startup retains the live compiler.");
} finally {
  await close();
}
