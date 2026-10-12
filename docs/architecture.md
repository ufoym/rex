# Project structure

Rex serves hosted application code as native ES modules. The CodeMirror dependency is bundled locally with esbuild; setup, build and the development server generate `vendor/codemirror.mjs` and its component licences. Directory names describe responsibilities; the build preserves the same layout under `dist/assets/`.

For direct `file://` opening, the build also generates `dist/standalone/`: small classic application / worker bundles and a compressed resource archive in `resources.js`. Compiler workers read the archive with `importScripts` and expand it away from the main thread; the editor starts independently. The initial paragraph worker preloads alongside the first full pass. Local file sessions retain that worker: build-time Binaryen Asyncify instrumentation lets LuaTeX pause its stdin read and resume on a worker message. The live worker receives captured resources from the full pass and sends Type 1 outlines with the first display list needing each font. Local full passes use the original engine and skip the shared-memory standby worker. Hosted sessions retain the original engine, module workers and shared-memory paragraph transport. The distribution manifest verifies generated bundle hashes and the source inputs used to produce them.

`scripts/startup-fonts.mjs` runs the bundled starter through the pinned WASM engine at build time, retaining only reusable parsed font / LuaTeX-ja tables. Cached build output under `artifacts/startup-fonts/` follows the exact engine, resource manifests, TeX scripts, starter and generator. The local archive carries these tables with their engine/resource identity; incompatible or malformed tables fall back to cold processing. Storage caches can add tables for later fonts. Startup edits may discard an obsolete PDF while keeping its auxiliary files as the next compilation's convergence seed; project switches clear that seed.

```text
src/
  ui/          Browser entry, editor actions and PDF / Canvas rendering
  core/        Project validation, import / export, storage and source parsing
  compiler/    Session orchestration, engine loading, full passes and caches
  protocol/    Display lists, file snapshots and shared-memory messaging
  workers/     Live, background and standby worker entry points
  tex/         Lua / TeX capture, state restoration and paragraph compilation
tests/
  unit/        Parsing, project formats, cache keys and message framing
  integration/ Engine, frozen layout and server boundary regressions
  browser/     Editor, static / offline hosting and full-document workflows
  helpers/     Shared browser server and filesystem-backed runtime loading
  fixtures/    Frozen layout evidence
benchmarks/    Browser, native compiler and public-workload performance drivers
scripts/       Setup, build, checks, local server and font conversion
public/        HTML, CSS, service worker and static hosting headers
examples/      Importable LaTeX projects
docs/          Guides, comparisons, methodology and recorded benchmark evidence
```

## Where to make a change

| Responsibility | Entry / owner |
| --- | --- |
| Editor actions, import / export buttons and source navigation | [ui/app.js](../src/ui/app.js) |
| Source editor configuration and shortcuts | [ui/editor.js](../src/ui/editor.js) |
| PDF pages, font outlines and paragraph patches | [ui/renderer.js](../src/ui/renderer.js) |
| Project paths, portable archives and browser storage | [core/project.js](../src/core/project.js) |
| Preamble, paragraph spans and live-edit safety | [core/document.js](../src/core/document.js) |
| Revisions, project switches and live / full scheduling | [compiler/session.js](../src/compiler/session.js) |
| Live worker lifetime and serialized paragraph requests | [compiler/live-engine.js](../src/compiler/live-engine.js) |
| Local worker stdin suspension and resumption | [compiler/async-runtime.js](../src/compiler/async-runtime.js) |
| Resource inventory, engine loading and VFS access | [compiler/assets.js](../src/compiler/assets.js), [compiler/runtime.js](../src/compiler/runtime.js) |
| Parsed font tables retained between engines and browser visits | [compiler/font-cache.js](../src/compiler/font-cache.js) |
| Full capture, standby identity and host API | [compiler/full-pass.js](../src/compiler/full-pass.js) |
| Picture identity and PDF reuse | [compiler/picture-cache.js](../src/compiler/picture-cache.js) |
| BibTeX, Biber and MakeIndex | [compiler/tools.js](../src/compiler/tools.js) |
| Binary formats and geometry verification | [protocol/](../src/protocol/) |
| Worker message handlers | [workers/](../src/workers/) |
| TeX-side behavior | [tex/](../src/tex/) |

`public/index.html` loads `assets/ui/app.js`. The UI calls the session and renderer. The session starts the live and background workers; the background worker manages convergence, auxiliary tools, picture caching and a standby worker. Worker entries install their own message handlers. Importing compiler APIs does not install a worker handler.

WASM compilation overlaps resource downloads. Full, standby and live engines share compiled WASM, loaded resources and parsed font tables through worker snapshots. Immutable bundle fonts receive timestamps derived from their content hashes so LuaTeX can reuse those tables. The `rex-fonts-v1` CacheStorage cache retains parsed font tables across visits, keyed by the exact WASM bytes, bundle manifests and TeX scripts; unavailable storage falls back to cold font processing. Project-dependent font-name lookups are excluded.

`protocol/` contains data formats shared by the project model and compiler. `core/` depends on these formats; neither directory depends on the UI or worker entries. `compiler/` uses the model, protocols and installed engine resources. Keep DOM actions in `ui/` and TeX state changes in `tex/`.

## Generated resources and publication

| Path | Producer / purpose | Tracked in Git |
| --- | --- | --- |
| `vendor/` | `npm run setup`: pinned engines, tools, fonts and libraries | No |
| `dist/` | `npm run build`: complete static site with asset hashes and licences | No |
| `artifacts/tests/` | Regression reports and screenshots | No |
| `artifacts/benchmarks/` | New benchmark reports and mismatch details | No |
| `artifacts/archive/` | Historical experiment scripts, snapshots and logs, grouped by archive date | No |
| `artifacts/build-*` | Temporary build staging, removed by the build | No |
| `docs/*.json` | Reviewed, published measurement evidence | Yes |

The development server maps `/assets/` to `src/` and `/vendor/` to `vendor/`. Production publishes `public/`, `src/` and selected vendor files as one static site. Relative URLs must work in both layouts and under a site prefix such as `/rex/`.

Archived experiment scripts are retained as records; their original relative paths may refer to an earlier source layout. Use the maintained drivers in `benchmarks/` for new measurements.

## Validation and documentation

After moving a module, update its imports, worker URLs, page-relative URLs inside browser tests, package commands and documentation links. `npm run check` recursively checks source, tooling, tests and benchmarks, then verifies the distribution inventory against source. Run `npm run build` followed by `npm run test:all` to exercise the complete published layout.

Keep the [README](../README.md) focused on setup and project navigation. Put editing and deployment instructions in the [guide](guide.md), comparison tables in [comparison.md](comparison.md), and measurement details in [performance.md](performance.md). Existing JSON reports and frozen fixtures retain their original hashes, paths and results as historical evidence.
