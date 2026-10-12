# Rex

**Real-time LaTeX editing, right in your browser.**

Rex keeps LuaTeX running in a WebAssembly worker and typesets verified paragraphs as you edit. A full compilation after you pause updates pagination, references and the exported PDF. Your project stays in the browser.

- Precise TeX glyph positioning, including OpenType and Type 1 math fonts.
- Persistent paragraph compilation and preloaded preambles.
- PDF preview and export, TikZ caching, BibTeX, Biber and MakeIndex.
- Editable multi-file projects, complete local storage and paragraph navigation.
- Static hosting and offline use of previously loaded resources.

## Get started

Requires Node.js 24+, Python 3 with venv / pip, curl, tar and unzip. Setup supports macOS and Linux.

```sh
npm ci
npm run setup
npm run dev
```

Open [localhost:8080](http://127.0.0.1:8080). Edit the built-in document or import a project from [examples/](examples/). **Open folder** preserves nested paths; the file selector edits imported source files. **Save project** downloads a portable `.rex` file containing every source and asset. Use **Compile** or ⌘/Ctrl + Enter for a full compilation. End users need no native TeX installation.

To publish, run `npm run build` and deploy the entire `dist/` directory to a static HTTPS host. Use `npm run preview` to inspect the build locally.

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
| `third_party/` | Retained ctablestack source |

Downloaded assets (`vendor/`), builds (`dist/`) and test output (`artifacts/`) are ignored by Git. ES modules are served directly, with no bundler or application backend.

Read the [user guide](docs/guide.md), [project structure](docs/architecture.md), [feature and performance comparisons](docs/comparison.md), [benchmark methodology](docs/performance.md) and [contribution guidelines](CONTRIBUTING.md).

Rex ships selected TeX packages rather than a complete TeX Live installation. Unsupported live edits and changed vector drawings use full compilation. Projects, including dependencies and the active file, survive refresh in IndexedDB. Source / preview navigation operates at paragraph granularity. Broader package coverage, finer navigation and shared editing remain areas for development.

Rex code is [MIT licensed](LICENSE). Bundled components retain their own licenses; see [third-party notices](THIRD_PARTY.md).
