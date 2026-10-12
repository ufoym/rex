# Rex

**Real-time LaTeX editing, right in your browser.**

Rex keeps LuaTeX running in a WebAssembly worker and typesets verified paragraphs as you edit. A full compilation after you pause updates pagination, references and the exported PDF. Your project stays in the browser.

- Precise TeX glyph positioning, including OpenType and Type 1 math fonts.
- A [multilingual starter](src/core/starter.js) with Chinese, Japanese, Korean and English, complex mathematics, tables and TikZ.
- Persistent paragraph compilation and preloaded preambles.
- PDF preview and export, TikZ caching, BibTeX, Biber and MakeIndex.
- Editable multi-file projects, complete local storage and paragraph navigation.
- Light and dark themes, with a saved preference and automatic system matching.
- Static hosting and offline use of previously loaded resources.

## Performance

**Warm browser previews take about 1.2 ms on 10–300-page documents.** On Apple M4, the recorded median timings give these overall results:

| Baseline | Measured workflow | Rex overall |
| --- | --- | --- |
| TeXpresso | Warm preview updates, 3 document sizes | **149.1% faster (2.49×)**† |
| realtime-tex | Native paragraph compiler, 10 validated text / math cases | **3.2% faster (1.03×)** |
| Preceding Rex build | Warm browser preview updates, 3 document sizes | **51.6% faster (1.52×)** |

Overall speed is the equally weighted geometric mean of baseline / Rex median ratios. † TeXpresso includes rendered-pixel readback and verification; Rex ends at Canvas submission. The realtime-tex comparison excludes both editors, WASM and rendering. These results describe the tested warm workloads; startup, full-document compilation and individual cases differ. See the [comparison](docs/comparison.md) and [methodology, raw data and aggregation](docs/performance.md#overall-speed-summary).

## Get started

Requires Node.js 24+, Python 3 with venv / pip, curl, tar and unzip. Setup supports macOS and Linux.

```sh
npm ci
npm run setup
npm run dev
```

Open [localhost:8080](http://127.0.0.1:8080). Edit the built-in document or import a project from [examples/](examples/). **Open folder** preserves nested paths; the file selector edits imported source files. **Save project** downloads a portable `.rex` file containing every source and asset. Use **Compile** or ⌘/Ctrl + Enter for a full compilation. End users need no native TeX installation.

To publish, run `npm run build` and deploy the entire `dist/` directory to a static HTTPS host. Use `npm run preview` to inspect the build locally.

Use **Theme** in the toolbar to choose **System**, **Light** or **Dark**. The choice survives refresh; **System** follows your device's appearance. PDF pages retain their original colours in every theme.

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

Downloaded assets (`vendor/`), builds (`dist/`) and test output (`artifacts/`) are ignored by Git. ES modules are served directly, with no bundler or application backend.

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
