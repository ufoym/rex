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
| Warm preview latency³ | **4.2–4.7 ms** | — | — | — | — | — | — | — | 8.0–9.4 ms | 7.9–8.3 ms |
| Native paragraph latency⁴ | **0.59–1.57 ms** | — | — | — | — | — | — | — | 0.60–1.61 ms | — |
| Open-source code⁵ | **✓ MIT** | ✓ GPL-2.0 | ✓ MIT source | ✓ AGPL-3.0 | ✓ MIT | ✓ AGPL-3.0 Community Edition | ✗ editor core | ✗ | ✓ MIT | ✓ MIT |

- ✓ supported; ✗ unavailable in the compared workflow; ? unverified; — no matching timing.
- Offline browser use requires cached resources. [Full comparison, scope and sources](docs/comparison.md#feature-comparison).
- ¹ Mobile editing has platform limitations.
- ² An edited paragraph updates independently in the document's typeset pages; global layout may need a full pass. Texifier and TeXpresso provide incremental preview with broader update units. [Preview scope](docs/comparison.md#desktop-writing-tools).
- ³ Matched editor change → drawing submission on Apple M4, 10–300 pages; ranges show document-size medians. Same A4 layout, viewport, scale and edit cadence. TeXpresso uses native SDL with a plugin compatibility fix; excludes screen presentation. [Results and methodology](docs/comparison.md#matched-preview-measurements).
- ⁴ Matched native request → decoded paragraph display list, first-paragraph edits at 10–300 pages; ranges show document-size medians. Excludes editors and drawing. TeXpresso has a page-level update path, with no matching paragraph-interface timing. [Compiler comparison](docs/comparison.md#native-compiler-comparison).
- ⁵ Licenses describe project-owned code; bundled components retain their own licenses. [VS Code's Code - OSS source](https://code.visualstudio.com/docs/supporting/faq#licensing) and [LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop) are MIT licensed; Microsoft's VS Code distribution has a separate product license. Overleaf's open-source entry refers to its [Community Edition](https://github.com/overleaf/overleaf). texlode's editor core is not public. [License scope and sources](docs/comparison.md#feature-comparison); [TeXstudio license](https://www.texstudio.org/#about).

## Get started

Requires Node.js 24+, Python 3 with venv / pip, curl, tar and unzip. Setup supports macOS and Linux.

```sh
npm ci
npm run setup
npm run dev
```

Open [localhost:8080](http://127.0.0.1:8080). Rex shows the built-in document by default; reopen saved projects from **Open → Recent**, or enable **Open → Recent → Open last project on startup**. Import a project with **Open → File…** or try [examples/](examples/). **Open → Folder…** preserves nested paths; the file selector edits imported source files. **Download → Project (.rex)** saves a portable file containing every source and asset. The preview updates as you type; use **Recompile** or ⌘/Ctrl + Enter for a full compilation. End users need no native TeX installation.

For local distribution, run `npm run release`. Share the entire `artifacts/releases/rex-local/` folder and open its `index.html` directly. This includes the complete local runtime, fonts, Chinese support, bibliography/index tools and startup caches, without duplicate website assets. No server, installation or internet connection is required. The release command outputs a folder, without creating a compressed archive; the existing local resource format is unchanged.

To publish a website, run `npm run build:hosted` and deploy the entire `dist/` directory to a static HTTPS host. Use `npm run preview` to inspect the build locally.

The website build omits the duplicate local-file resource archive; hosted compilation and cached offline use are unchanged. Use `npm run build` for a combined distribution that supports both website hosting and opening `dist/index.html` directly. Local runtime resources are split under `standalone/resources/` and `standalone/tools/`; keep those folders with the HTML. The local release folder is intended for direct opening; use the website build for HTTP hosting.

You can also run `npm run build` and open `dist/index.html` directly in a browser, without a local server or network connection. Keep the entire `dist/` folder together. The editor starts while workers load compiler resources. Both website and local-file builds load fonts and auxiliary tools on demand, with resource names, byte progress and a loading indicator. A bundled font-name index avoids scanning every font; parsed font tables load only when needed. The complete local release remains offline, including Chinese fonts, BibTeX, Biber and MakeIndex. Local file mode keeps a paragraph compiler running for live edits and recompiles the full document after typing pauses.

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

Downloaded assets (`vendor/`), builds (`dist/`) and test output (`artifacts/`) are ignored by Git. A small verified two-tool WASM runtime is kept in `runtime/busytex/`; `npm run build:tools` reproduces it from pinned source using Emscripten 4.0.23. Setup installs this runtime instead of the complete BusyTeX engine collection. Hosted application ES modules are served directly; the editor dependency and local file mode are bundled during build, with no application backend.

Builds use copy-on-write file copies where supported (APFS on macOS, reflinks on supported Linux filesystems), with normal copies elsewhere. `vendor/` and `dist/vendor/` keep independent files while sharing unchanged disk data; editing either copy cannot change the other. The distribution remains self-contained and keeps direct local-file support. Logical folder sizes and exported archive sizes still count both copies; filesystem sharing reduces their combined storage on supported disks.

`npm ci` automatically trims installed dependencies to the distributions Rex uses. It retains the Binaryen JavaScript API, esbuild platform binary, Playwright, Node test APIs, setup inputs and licences; unused native WASM CLIs, Node Canvas, alternative library builds and other language modes are removed. Run `npm run clean:deps` to apply the same trim to an existing install. This changes development dependencies only; the complete local-file and hosted application resources are preserved.

Run `npm run clean` to remove downloaded package archives and external benchmark dependencies, build products and application caches. It preserves Rex's dependencies, runtime assets, distribution, reports, experimental source edits and latest font / Asyncify build caches. External comparison benchmarks need their dependencies rebuilt or downloaded after cleaning.

Setup and build remove unused alternate TeX formats, a build-only TikZ format snapshot, shadowed bundle files, LuaTeX-ja's documentation source and Biber's C/XS/object files and test fixtures. Run `npm run clean:assets` to apply the same trim directly. Biber's retained data blocks are copied unchanged, with no recompression. Complete font glyphs, runtime packages, Unicode/locale data, WASM code, Type 1 outlines and startup caches are kept.

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
