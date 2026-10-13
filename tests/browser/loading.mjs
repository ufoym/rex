import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium, webkit} from 'playwright';
import {startServer} from '../../scripts/serve.mjs';
const localBase = process.env.REX_LOCAL_DIST ? pathToFileURL(path.resolve(process.env.REX_LOCAL_DIST) + path.sep) : new URL('../../dist/', import.meta.url);
const catalogText = await fs.readFile(new URL('standalone/resources.js', localBase), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const catalog = catalogText ? JSON.parse(catalogText.slice('globalThis.rexCatalog='.length).trim().replace(/;$/, '')) : {files: {}};
const english = String.raw`\documentclass{article}
\usepackage{fontspec}\setmainfont{Latin Modern Roman}
\begin{document}Lazy English preview. $E=mc^2$ \textbf{Bold} \textit{Italic}.\end{document}`;
const chinese = String.raw`\documentclass[fontset=fandol]{ctexart}
\begin{document}中文与English。\textbf{粗体}\textit{楷体}。\end{document}`;
const bibliography = String.raw`\documentclass{article}
\usepackage{imakeidx}\makeindex[name=names,title=Names]
\begin{document}Citation \cite{knuth}.\index[names]{Ada}
\bibliographystyle{plain}\bibliography{refs/books}\printindex[names]\end{document}`;
const biber = String.raw`\documentclass{article}
\usepackage[backend=biber]{biblatex}\addbibresource{refs/books.bib}
\begin{document}Citation \cite{knuth}.\printbibliography\end{document}`;
const bib = '@book{knuth,author={Donald E. Knuth},title={The TeXbook},year={1984},publisher={Addison-Wesley}}';
const reports = [];
for (const browserType of [chromium, webkit]) for (const mode of ['hosted', 'local']) {
  const name = browserType.name() + ':' + mode;
  if (process.env.REX_LOADING_MODE && process.env.REX_LOADING_MODE !== name) continue;
  const server = mode === 'hosted' ? await startServer() : null;
  const url = server?.url || new URL('index.html', localBase).href;
  const browser = await browserType.launch(), context = await browser.newContext({serviceWorkers: 'block'});
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  if (mode === 'local') await context.route(/^https?:\/\//, route => route.abort('internetdisconnected'));
  await page.addInitScript(() => {
    window.loadingHistory = [];
    window.loadedResources = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          if (data.type === 'progress' && data.assets) loadedResources.push(...data.assets);
        });
      }
    };
    new MutationObserver(() => {
      const status = document.querySelector('#status'), bar = document.querySelector('#loading-progress');
      if (status?.textContent.startsWith('Loading ') && loadingHistory.at(-1)?.text !== status.textContent)
        loadingHistory.push({text: status.textContent, bar: !!bar && !bar.hidden});
    }).observe(document, {childList: true, subtree: true, characterData: true});
  });
  const forbidden = ['vendor/bibliography/biber.data', 'vendor/bibliography/biber.wasm', 'vendor/bibliography/busytex.wasm', 'vendor/bibliography/biber.mjs', 'vendor/bibliography/busytex.mjs',
    ...Object.keys(catalog.files).filter(path => /(?:fandol|ipaex|nanum)/i.test(path) && /\.(?:otf|ttf)$/.test(path))];
  const used = async (path, urls = requests) => mode === 'local'
    ? page.evaluate(path => loadedResources.includes(path), path)
    : urls.some(url => new URL(url).pathname.endsWith('/' + path));
  const ready = async () => {
    await page.waitForFunction(() => rex.session.warmed || (!rex.session.busy && document.querySelector('#status').textContent.includes('failed')), {}, {timeout: 120000});
    assert.ok(await page.evaluate(() => !!rex.session.warmed), await page.locator('#log').textContent());
    await page.evaluate(() => rex.session.warmed);
  };
  const compile = async files => {
    await page.evaluate(files => rex.session.setFiles(files, 'main.tex'), files);
    await ready();
    return page.evaluate(() => ({converged: rex.session.layout.converged, ms: rex.session.layout.ms,
      bibliographyRuns: rex.session.layout.bibliographyRuns, indexRuns: rex.session.layout.indexRuns,
      logs: document.querySelector('#log').textContent}));
  };
  try {
    // Seed the app's real recent-project store before loading any application code.
    await page.route(url, route => route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Seed</title>'}));
    await page.goto(url);
    await page.evaluate(async source => {
      localStorage.setItem('rex-restore-project', 'true');
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('rex', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('projects');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite');
        const project = {schema: 1, id: 'loading-test', main: 'main.tex', active: 'main.tex', files: {'main.tex': source}, updated: Date.now()};
        tx.objectStore('projects').put(project, 'current'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, english);
    await page.unroute(url); requests.length = 0;
    const start = performance.now(); await page.goto(url); await ready();
    const startupMs = performance.now() - start;
    assert.equal(await page.evaluate(() => rex.editor.state.doc.toString()), english);
    for (const path of forbidden) assert.equal(await used(path), false, name + ': English loaded ' + path);
    if (mode === 'hosted') assert.ok(!requests.some(url => /(?:fandol|ipaex|nanum).*\.(?:otf|ttf)/i.test(url)), 'English fetched CJK fonts');
    if (mode === 'local') assert.ok(!requests.some(url => /\/tools\/(biber|busytex)\.js$/.test(url)), 'Local tools must stay deferred');
    const initialRequests = [...requests];
    const cjk = await compile({'main.tex': chinese});
    assert.ok(cjk.converged); assert.ok(!cjk.logs.includes('Missing character:'));
    assert.ok(await used('vendor/engine/bundles/chinese/files/fonts/opentype/public/fandol/FandolSong-Regular.otf'), 'CJK font did not load on demand');
    const indexed = await compile({'main.tex': bibliography, 'refs/books.bib': bib});
    assert.equal(indexed.bibliographyRuns, 1); assert.equal(indexed.indexRuns, 1);
    assert.equal(await used('vendor/bibliography/busytex.wasm'), true);
    assert.equal(await used('vendor/bibliography/biber.wasm'), false);
    const modern = await compile({'main.tex': biber, 'refs/books.bib': bib});
    assert.equal(modern.bibliographyRuns, 1); assert.equal(await used('vendor/bibliography/biber.wasm'), true);
    const history = await page.evaluate(() => loadingHistory);
    assert.ok(history.some(event => /font/i.test(event.text) && event.bar), 'Font loading progress was not visible');
    assert.ok(history.some(event => /Biber/.test(event.text) && event.bar), 'Biber loading progress was not visible');
    assert.deepEqual(errors, []);
    const result = {name, startupMs, englishRequests: initialRequests.length, cjkMs: cjk.ms, bibtexIndexMs: indexed.ms, biberMs: modern.ms, loadingUpdates: history.length};
    reports.push(result); console.log(JSON.stringify(result));
  } finally { await browser.close(); await server?.close(); }
}
await fs.mkdir('artifacts/tests', {recursive: true});
await fs.writeFile('artifacts/tests/resource-loading.json', JSON.stringify(reports, null, 2) + '\n');
