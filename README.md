# Rex

**Write LaTeX without losing your train of thought.**

Rex brings live LaTeX preview and PDF export to your browser, with typesetting that runs on your device.

- **See changes as you type.** Supported edits appear instantly, so you can keep your train of thought.
- **Skip the setup.** Open your browser and write—no multi-gigabyte TeX installation.
- **Write anytime, anywhere.** Revise on your laptop, tablet or phone.
- **Keep your drafts private.** Compile on your device and work offline once resources are loaded.
- **Turn ideas into a PDF.** Equations, tables, citations and TikZ diagrams, ready to export.
- **Stop worrying about saving.** Drafts autosave in your browser; `.rex` backups let you take projects with you.

## Why Rex?

**Among the tools below, only Rex combines all six advantages:**

| Feature / benchmark | **Rex** | [TeXstudio](https://www.texstudio.org/) | [VS Code + LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop) | [TeXlyre](https://texlyre.github.io/docs/latex-compilation/overview) | [TeXbrain](https://github.com/swimmingbrain/texbrain) | [Overleaf](https://docs.overleaf.com/getting-started/recompiling-your-project) | [texlode](https://www.texlode.com/features/) | [Texifier](https://www.texifier.com/docs/tutorials/tex/typesetters) | [realtime-tex](https://github.com/HenryXiaoYang/realtime-tex/tree/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1) | [TeXpresso](https://github.com/let-def/texpresso) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Browser editor | **✓** | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Phone / tablet editing | **✓** | ✗ | ✗ | ✓¹ | ? | ✓¹ | ? | ✓ iOS | ✗ | ✗ |
| No native TeX install | **✓** | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Local compilation | **✓** | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Offline use | **✓** | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Paragraph-level preview updates² | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ |
| Warm browser API → Canvas submission³ | **~1.2 ms** | — | — | — | — | — | — | — | — | — |
| Warm VS Code change event → Canvas replacement³ | — | — | — | — | — | — | — | — | 14.3–14.4 ms | — |
| Warm native viewer → verified pixels³ | — | — | — | — | — | — | — | — | — | ~3.0 ms |
| One-paragraph compilation (native)³ | **0.585–1.675 ms** | — | — | — | — | — | — | — | 0.604–1.789 ms | — |
| Short / medium sample compilation (different machines)⁴ | **0.082 / 0.565 ms** | — | — | — | — | — | 0.79 / 6.11 ms | — | — | — |

- ✓ supported; ✗ unavailable in the compared workflow; ? unverified; — no matching timing.
- Offline browser use requires cached resources. [Full comparison, scope and sources](docs/comparison.md#feature-comparison).
- ¹ Mobile editing has platform limitations.
- ² An edited paragraph updates independently in the document's typeset pages; global layout may need a full pass. Texifier and TeXpresso provide incremental preview with broader update units. [Preview scope](docs/comparison.md#desktop-writing-tools).
- ³ Apple M4 measurements at 10 / 100 / 300 pages. Preview rows measure different workflows and are not a speed ranking: Rex calls `Session.edit()` directly in headless Chromium and ends at Canvas submission; realtime-tex starts at a real VS Code change event and includes its Rust / webview pipeline and animation-frame wait; TeXpresso includes pixel readback / verification. None measures physical keystroke → visible screen pixels. Native paragraph: compiler round trip, excluding editors, WASM and drawing. [Timing methodology and results](docs/comparison.md#performance-coverage-and-gaps).
- ⁴ Different-machine references: Rex on Apple M4; texlode author-reported on Intel i7-1355U. Excludes drawing; not a product speed ranking. [Sample methodology](docs/performance.md#texlode-public-sample-measurements).

## Get started

Requires Node.js 24+, Python 3 with venv / pip, curl, tar and unzip. Setup supports macOS and Linux.

```sh
npm ci
npm run setup
npm run dev
```

Open [localhost:8080](http://127.0.0.1:8080). Rex shows the built-in document by default; reopen saved projects from **Open → Recent**, or enable **Open → Recent → Open last project on startup**. Import a project with **Open → File…** or try [examples/](examples/). **Open → Folder…** preserves nested paths; the file selector edits imported source files. **Download → Project (.rex)** saves a portable file containing every source and asset. The preview updates as you type; use **Recompile** or ⌘/Ctrl + Enter for a full compilation. End users need no native TeX installation.

To publish, run `npm run build` and deploy the entire `dist/` directory to a static HTTPS host. Use `npm run preview` to inspect the build locally.

You can also run `npm run build` and open `dist/index.html` directly in a browser, without a local server or network connection. Keep the entire `dist/` folder together. The editor starts while workers load compiler resources; bundled font tables reduce first-run font processing. Local file mode keeps a paragraph compiler running for live edits and recompiles the full document after typing pauses.

Use the sun / moon icon to switch between light and dark themes. The choice survives refresh; before a theme is selected, Rex follows the device theme. PDF pages retain their original colours in every theme.

For GitHub Pages, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** in your repository. The [Pages workflow](.github/workflows/pages.yml) builds and verifies the site, then publishes `dist/` on every push to `main`. Once deployment succeeds, open the site URL shown in **Settings → Pages**. You can also run **Deploy GitHub Pages** manually from the Actions tab on `main`.

## Development

```sh
npx playwright install chromium webkit
npm run build
npm run test:all
npm run bench  # requires native lualatex
```

| Directory | Contents |
| --- | --- |
| `src/` | UI, project model, compiler, protocols, workers and TeX modules |
| `public/` | HTML, CSS, service worker and hosting headers |
| `tests/` | Unit, integration and browser regressions; shared helpers and frozen fixtures |
| `benchmarks/` | Browser and native performance drivers |
| `scripts/` | Setup, build, server and checks |
| `examples/` | Small projects to import and compile |
| `docs/` | User guide, architecture, comparisons and benchmark evidence |

Downloaded assets (`vendor/`), builds (`dist/`) and test output (`artifacts/`) are ignored by Git. Hosted application ES modules are served directly; the editor dependency and local file mode are bundled during build, with no application backend.

Read the [user guide](docs/guide.md), [project structure](docs/architecture.md), [feature and performance comparisons](docs/comparison.md), [benchmark methodology](docs/performance.md) and [contribution guidelines](CONTRIBUTING.md).

Rex ships selected TeX packages rather than a complete TeX Live installation. Unsupported live edits and changed vector drawings use full compilation. Projects, including dependencies and the active file, survive refresh in IndexedDB. Source / preview navigation operates at paragraph granularity. Broader package coverage, finer navigation and shared editing remain areas for development.

Rex code is [MIT licensed](LICENSE). Bundled components retain their own licenses; see [third-party notices](THIRD_PARTY.md).

## Thanks

- [Clemens Lode](https://github.com/ClemensLode), for publishing [Real-Time LuaTeX: Recompiling Large Documents in 1 ms](https://www.tug.org/tug2026/preprints/lode-realtime.pdf) and the resident-engine approach to paragraph typesetting.
- [HenryXiaoYang](https://github.com/HenryXiaoYang) and [realtime-tex](https://github.com/HenryXiaoYang/realtime-tex), for their work on incremental LuaLaTeX and the open implementation used in Rex's compiler benchmarks.
- The [LuaTeX](https://www.luatex.org/), [LaTeX](https://www.latex-project.org/) and [TeX Live](https://www.tug.org/texlive/) developers and package and font maintainers, for the typesetting foundation.
- [jmckalex](https://github.com/jmckalex) and [mp-tikz-wasm](https://github.com/jmckalex/mp-tikz-wasm), for the LuaTeX WebAssembly engine and TeX bundles that Rex runs in the browser.
- [TeXlyre](https://github.com/TeXlyre/texlyre-busytex-build) and [BusyTeX](https://github.com/busytex/busytex), for the WebAssembly builds behind Rex's bibliography and indexing tools.
- The maintainers of [PDF.js](https://github.com/mozilla/pdf.js), [pdf-lib](https://github.com/Hopding/pdf-lib), [opentype.js](https://github.com/opentypejs/opentype.js) and [FontTools](https://github.com/fonttools/fonttools), for PDF rendering, picture caching and font support.
