import assert from 'node:assert/strict';
import {chromium, webkit} from 'playwright';
import {startServer} from '../../scripts/serve.mjs';

// Exercise the local runtime over HTTP while enforcing file-origin worker
// restrictions, including WebKit rejecting imports of worker-created Blob URLs.
for (const browserType of [chromium, webkit]) {
  const server = await startServer({isolation: false});
  const browser = await browserType.launch(browserType === chromium && process.env.REX_BROWSER_CHANNEL
    ? {channel: process.env.REX_BROWSER_CHANNEL} : {});
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(120000);
  await page.route(server.url, async route => {
    const response = await route.fetch();
    await route.fulfill({response, body: (await response.text()).replace('location.protocol === "file:"', 'true')});
  });
  await page.addInitScript(() => {
    const NativeBlob = Blob;
    window.Blob = class extends NativeBlob {
      constructor(parts, options) {
        super(options?.type === 'text/javascript' ? [
          `globalThis.importScripts = () => {
             throw new DOMException('Worker cannot import resource scripts', 'NetworkError');
           };`, ...parts,
        ] : parts, options);
      }
    };
  });
  const ready = async () => {
    await page.waitForFunction(() => /full compilation|failed|error|unavailable/i.test(document.querySelector('#status').textContent));
    assert.ok(await page.evaluate(() => !!rex.session.warmed), await page.locator('#log').textContent());
    await page.evaluate(() => rex.session.warmed);
    assert.ok(await page.evaluate(() => rex.session.layout.pdf.length > 1000));
  };
  try {
    await page.goto(server.url);
    await ready();
    await page.evaluate(async () => {
      await rex.session.edit(rex.session.source.replace('Edit this paragraph', 'Edit this local paragraph'));
      clearTimeout(rex.session.timer);
    });
    assert.ok(await page.evaluate(() => rex.session.lastTiming), 'Local paragraph editing failed');
    const bib = '@book{knuth,author={Donald E. Knuth},title={The TeXbook},year={1984},publisher={Addison-Wesley}}';
    for (const backend of ['bibtex', 'biber']) {
      await page.evaluate(({backend, bib}) => rex.session.setFiles({
        'main.tex': String.raw`\documentclass{article}
\usepackage{array}\usepackage{makeidx}\makeindex
${backend === 'biber' ? String.raw`\usepackage[backend=biber]{biblatex}\addbibresource{books.bib}` : ''}
\begin{document}Citation \cite{knuth}.\index{Ada}
${backend === 'biber' ? String.raw`\printbibliography` : String.raw`\bibliographystyle{plain}\bibliography{books}`}
\printindex\end{document}`,
        'books.bib': bib,
      }), {backend, bib});
      await ready();
      assert.equal(await page.evaluate(() => rex.session.layout.bibliographyRuns), 1);
      assert.ok(await page.evaluate(() => rex.session.layout.indexRuns > 0));
    }
    assert.deepEqual(errors, []);
    console.log(browserType.name() + ': restricted local workers compile, edit, and run bibliography/index tools.');
  } finally { await browser.close(); await server.close(); }
}
