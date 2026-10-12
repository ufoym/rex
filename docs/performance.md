# Benchmark methodology

The [comparison document](comparison.md) contains the [feature matrix](comparison.md#feature-comparison) and [performance summary](comparison.md#performance-comparison). This document retains the detailed results, measurement scope, reproduction and evidence. Features were checked against primary documentation and source on 2026-10-11; documented support is distinguished from locally tested behavior.

Raw JSON reports are generated under ignored `artifacts/benchmarks/` and are not versioned. The historical files named below are retained locally under `artifacts/benchmarks/reports/`; a fresh checkout contains the result tables and reproduction drivers, but not those original samples. Rerunning a driver produces a new report for the current machine.

## Reading the percentages

The opening percentage summary uses historical `performance.json` measurements. Current matched preview results are in the [Rex / realtime-tex](#matched-rex--realtime-tex-preview-measurements) and [TeXpresso](#matched-texpresso-preview-measurements) sections.

Results use **% faster / % slower**, calculated from unrounded summary values in the local `performance.json` report and rounded to one decimal. Faster percentages use `(baseline / Rex − 1) * 100`; slower percentages use `(Rex / baseline − 1) * 100`. **25% faster** means 20% less elapsed time; **25% slower** means 25% more elapsed time. Differences that round to zero are shown as less than 0.1%. Median and P95 changes are calculated separately from their respective three-run summaries; they are not percentiles of per-edit changes.

Rex versus realtime-tex at the shared native compiler boundary and Rex versus its preceding browser build have matching timers. The historical TeXpresso preview and native LuaLaTeX full-pass timers include different work from Rex; their faster / slower percentages describe recorded timings rather than directly comparable product speeds. Measurements cover these configurations only. Texifier, TeXlyre, Overleaf, Typst and pdfLaTeX have no same-machine timing here, so no percentage comparison is assigned to them.

## Historical speed summary

Recorded median timings are aggregated using an equally weighted geometric mean: `ratio = exp(mean(log(baseline median / Rex median)))`, then `% faster = (ratio − 1) * 100`. Each case uses the median of its three run-level medians from the local `performance.json` report. Ratios are computed before rounding; this is a workload summary, not a pooled edit percentile or a statistical significance estimate. The separate VS Code preview measurements below do not enter the native realtime-tex aggregate.

| Competitor | Included cases | Geometric mean ratio | Overall recorded timing |
| --- | --- | ---: | --- |
| TeXpresso | First-paragraph preview edits at 10 / 100 / 300 pages | 2.49× | 149.1% faster |
| realtime-tex | All 9 text cases (first / middle / last at 10 / 100 / 300 pages), plus the 300-page math case | 1.03× | 3.2% faster |

TeXpresso uses `comparison.texpresso.summary[].medianMs / final.summary[].median` matched by page count. Its timer includes pixel readback and verification while Rex stops at Canvas submission, so the aggregate compares these recorded boundaries. realtime-tex uses `comparison.realtimeTex.results[].summary`, dividing the baseline's `medianMs` by Rex's for all ten cases where both outputs validate. This includes the case where Rex is slower; the style case is excluded because upstream output validation fails. It measures native compilers, excluding editor sessions, WASM and rendering. Burst runs, cold starts, full passes and cross-machine texlode evidence are separate and do not enter these aggregates. Individual median / P95 results remain below.

## Auditing the comparison summary

The comparison summary displays Rex median, baseline median, Rex P95, baseline P95 and the median percentage in separate columns, with one row per baseline and document size. The summary uses the first text paragraph consistently; the full native table below also retains middle / last edits, math and styles. Its data come from these paths in the local `performance.json` report:

- Browser Rex: `final.summary`; individual samples and the three runs are in `final.rounds[].results[]`.
- TeXpresso: `comparison.texpresso.summary` and `comparison.texpresso.rounds[]`, including pixel verification and source hashes.
- Native Rex / realtime-tex: `comparison.realtimeTex.results[]` where `kind = text` and `position = first`; each contains `summary`, `rounds` and reference hashes.
- Warm full passes: `final.summary[].warmBackgroundMs` and `nativeWarmBackgroundMs`; the three individual durations are in `final.rounds[].results[]`.

For example, at 100 pages the native first-paragraph medians are Rex 1.566 ms and realtime-tex 1.610 ms, giving 2.8% faster. Rex's P95 is 1.4% slower. Median and tail latency need separate assessment.

Run variability also matters. At 300 pages, first-paragraph native run medians range from 1.056–1.592 ms for Rex and 1.598–1.612 ms for realtime-tex. These are observed run ranges, not confidence intervals. The three full-pass durations per tool and size are too few to estimate a useful P95 or establish statistical significance.

## Shared native compiler comparison

`benchmarks/compare.mjs` compares Rex's resident paragraph compiler with unmodified realtime-tex 0.0.2 at commit `210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1`. This is a compiler-layer comparison: it bypasses both application sessions, Rex's WASM worker and the VS Code extension. It does not measure their end-to-end product latency.

Both use native LuaHBTeX 1.22.0 / TeX Live 2025 on Apple M4, the same Node.js 24.6.0 host, anonymous OS pipes, full-capture paragraph state and display-list decoder. Standard realtime-tex server patches remain enabled. Both use their normal raw UTF-8 compile protocol and JSON control messages, with encoding inside the timer. Source hashes and the exact environment are retained in the raw report.

Documents use the article class, amsmath, xcolor and default Latin Modern fonts. Text cases put the same six-line paragraph on every page, with explicit page breaks, and edit the first, middle or last paragraph in exactly 10, 100 or 300 pages. Two additional cases edit inline / display mathematics and bold / italic / coloured text on the last page of a 300-page document. Each edit alternates the first `brown fox` occurrence between `brown dog` and `brown cat`. This synthetic workload isolates paragraph work; explicit page breaks do not test cascading pagination.

Each case has three sequential rounds, each with a new resident engine, all paragraph contexts preloaded, 20 warmups and 300 measured edits. Order is Rex → realtime-tex, reversed for round two, then Rex → realtime-tex. Compilers never run concurrently. A 2 ms host pause precedes every edit, outside the timer. Font caches are populated during reference compilation and warmup. Results describe isolated warm edits rather than startup or sustained bursts.

Timing starts before request encoding / writing and stops after the complete framed response and display list are decoded. Reference compilation, context registration, the pause and output validation are excluded. Every warmup and measured result must match a fresh full native LuaLaTeX capture of the edited document: font identity, glyph identity, relative glyph coordinates, advances, line boxes, colours and rules. Only translation to the page is removed. The common capture adapter is Rex's journal; this verifies live paragraph output against full typesetting, but does not independently validate the capture adapter, complete PDFs, pagination or arbitrary packages. Existing frozen and native / WASM regression tests cover the adapter separately.

Median and P95 use the nearest-rank percentile within each run. Each displayed value is the median of its three run-level values, not a pooled percentile. Raw timings and run medians are preserved; no outliers are removed. A correctness failure withholds that compiler's latency for the case and retains the mismatch instead of treating an invalid update as a fast result. Three runs do not establish statistical significance or a universal ranking. Main-thread scheduling, operating-system wakeups, garbage collection and other machine activity can affect small differences.

The README's native latency row selects only the **first text paragraph at 10 / 100 / 300 pages**, reporting **0.59–1.57 ms for Rex / 0.60–1.61 ms for realtime-tex** from these existing measurements. The 10-case relative-speed aggregate above has broader coverage and is kept separately. TeXpresso's document byte-patch / checkpoint / page-output path has no corresponding resident paragraph request in this benchmark; its editor-to-SDL preview timings are not compiler-only timings. A future native page-update measurement would need its own stated endpoint and validation.

### Detailed native results

| Document | Edited unit | Rex median / P95, ms | realtime-tex median / P95, ms | Rex vs realtime-tex, median / P95 |
| --- | ---: | ---: | ---: | ---: |
| 10 pages | Text, first | 0.590 / 0.650 | 0.604 / 0.684 | 2.4% faster / 5.2% faster |
| 10 pages | Text, middle | 0.585 / 0.655 | 0.610 / 0.713 | 4.4% faster / 8.9% faster |
| 10 pages | Text, last | 1.370 / 2.351 | 1.448 / 2.443 | 5.7% faster / 3.9% faster |
| 100 pages | Text, first | 1.566 / 2.428 | 1.610 / 2.394 | 2.8% faster / 1.4% slower |
| 100 pages | Text, middle | 1.570 / 2.324 | 1.621 / 2.345 | 3.3% faster / 0.9% faster |
| 100 pages | Text, last | 1.567 / 2.335 | 1.594 / 2.348 | 1.8% faster / 0.6% faster |
| 300 pages | Text, first | 1.484 / 2.365 | 1.602 / 2.526 | 8.0% faster / 6.8% faster |
| 300 pages | Text, middle | 1.592 / 2.383 | 1.552 / 2.516 | 2.6% slower / 5.6% faster |
| 300 pages | Text, last | 1.590 / 2.444 | 1.593 / 2.679 | 0.2% faster / 9.6% faster |
| 300 pages | Inline / display math, last | 1.675 / 2.840 | 1.789 / 2.761 | 6.8% faster / 2.9% slower |
| 300 pages | Bold / italic / colour, last | 1.715 / 3.243 | Withheld: colour validation failed | — |

**20,160 valid warmup and measured updates** match the full-compilation references. Text and math pass for both compilers. The style case passes for Rex; realtime-tex emits unknown colour-stack opcodes in all three rounds on this engine version, so its latency is withheld. See the [validation details](#colour-validation-limitation). This does not establish behavior in the untested VS Code renderer or other LuaTeX versions. Run variability is retained in the raw data; no universal speed ranking or statistical significance is claimed.


### Scheduling sensitivity

The supplementary burst run removes the 2 ms host pause, keeping the source, timer, order, three rounds, 20 warmups and 300 measured edits unchanged. All 20,160 valid updates pass. Results stay separate from isolated warm edits; no samples are discarded.

| Document | Edited unit | Rex median / P95, ms | realtime-tex median / P95, ms | Rex vs realtime-tex, median / P95 |
| --- | ---: | ---: | ---: | ---: |
| 10 pages | Text, first | 0.575 / 0.639 | 0.592 / 0.662 | 2.9% faster / 3.5% faster |
| 10 pages | Text, middle | 0.592 / 0.824 | 0.615 / 0.732 | 3.8% faster / 12.5% slower |
| 10 pages | Text, last | 0.581 / 0.734 | 0.597 / 0.665 | 2.8% faster / 10.3% slower |
| 100 pages | Text, first | 0.594 / 0.663 | 0.598 / 0.693 | 0.6% faster / 4.6% faster |
| 100 pages | Text, middle | 0.587 / 0.695 | 0.602 / 0.657 | 2.5% faster / 5.8% slower |
| 100 pages | Text, last | 0.604 / 0.743 | 0.603 / 0.667 | 0.2% slower / 11.4% slower |
| 300 pages | Text, first | 0.590 / 0.643 | 0.608 / 0.788 | 3.1% faster / 22.6% faster |
| 300 pages | Text, middle | 0.606 / 0.763 | 0.606 / 0.704 | <0.1% faster / 8.5% slower |
| 300 pages | Text, last | 0.593 / 0.640 | 0.605 / 0.710 | 2.1% faster / 10.9% faster |
| 300 pages | Inline / display math, last | 0.343 / 0.393 | 0.358 / 0.463 | 4.2% faster / 17.9% faster |
| 300 pages | Bold / italic / colour, last | 0.409 / 0.491 | Withheld: colour validation failed | — |

In the default-policy report, Rex has no slower median in **9 of 10** comparable cases and no slower P95 in **8 of 10**; the largest remaining slower ratio is **2.9%**. In bursts, mathematical edits improve both median and P95, but text P95 can remain **12.5%** slower. GC work performed after a response can delay the next burst request. **Strict per-case median and P95 parity is not established.** Core placement and frequency were not measured; these samples do not establish statistical non-inferiority. A distribution build overlapped the beginning of the first default-policy case; all its samples remain in the report.

To reproduce with native LuaLaTeX installed and Rex setup complete:

```sh
git clone https://github.com/HenryXiaoYang/realtime-tex ../realtime-tex-comparison
git -C ../realtime-tex-comparison checkout 210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1
npm run bench:compare -- ../realtime-tex-comparison
npm run bench:compare -- ../realtime-tex-comparison --pause=0 --output=artifacts/benchmarks/comparison-burst.json
# Optional smoke run: append --quick (not comparable with the published results).
```

The checkout must be clean. No Rust build is required because the common host drives each native Lua / TeX server directly. Default output goes to ignored `artifacts/benchmarks/comparison.json`; temporary compilation directories and owned child processes are cleaned up. The external checkout remains outside Rex and is not a runtime or distribution dependency. Default-policy results live at `comparison.realtimeTex`; burst results live at `comparison.realtimeTexBurst` in the local `performance.json` report. The prior utility-QoS experiment and its original source hashes remain under `responsiveness.before.utility`; it is historical evidence, not a measurement of the current source.

realtime-tex's [published benchmarks](https://github.com/HenryXiaoYang/realtime-tex/blob/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1/docs/benchmarks.md) use a different machine, fonts and Rust session boundary. They are useful context, but are not inserted into the same-hardware table. Its [live-editing documentation](https://github.com/HenryXiaoYang/realtime-tex/blob/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1/docs/live-editing.md) distinguishes exact paragraph output from later global layout.

### Colour validation limitation

The style case exposes a display-list compatibility issue in the tested upstream revision with LuaHBTeX 1.22.0. Glyphs and line boxes match, but the live colour records contain opcode `255` (unknown), where the full capture contains `1` (push) and `2` (pop). The upstream [visitor](https://github.com/HenryXiaoYang/realtime-tex/blob/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1/tex/rtex-dl.lua#L507) reads the node's `cmd` field; its [encoder](https://github.com/HenryXiaoYang/realtime-tex/blob/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1/tex/rtex-dl-bin.lua#L49) writes unknown for a nonnumeric command. Rex reads the `command` field. The comparator preserves these opcodes rather than guessing the intended operation.

The detailed native results therefore withhold realtime-tex latency for this case. The raw report retains observed / expected records and hashes for each failed round. This finding concerns native display-list validation in this environment; the VS Code renderer and other LuaTeX versions were not tested. No upstream code is patched to hide the mismatch, and the feature table continues to distinguish documented colour support from local validation.

## texlode: published evidence

The comparison summary pairs Rex’s native measurements on the original public paragraph samples with the preprint’s author-reported timings. It retains the later AMD EPYC product report as an unmatched reference. Author results and local results use different machines; the ratios below are explicitly cross-machine elapsed-time ratios.

Clemens Lode's [Real-Time LuaTeX preprint](https://www.tug.org/tug2026/preprints/lode-realtime.pdf), dated 2026-06-13, describes a resident LuaTeX server, display-list extraction, browser Canvas rendering and background layout convergence. Paragraph output updates before global layout settles. The [product documentation](https://www.texlode.com/features/) confirms server compilation. This makes texlode relevant to the feature comparison; no same-machine product run is available here.

On Intel i7-1355U / TeX Live 2025, Table 1 reports vanilla paragraph line-breaking medians of 0.17 / 0.70 / 1.99 ms for short / medium / long text, using 30 samples averaging 100 compilations each after five warmups. Table 3 instead reports paragraph pipeline round trips of 0.79 / 6.11 ms for short / medium text, including traversal, IPC, serialization and decoding. These are different boundaries and workloads; neither includes a verified Rex-equivalent browser preview endpoint. No faster / slower percentage versus Rex is calculated.

The [public benchmark README](https://github.com/texlode/luatex-benchmark) distinguishes its vanilla LuaLaTeX line-breaking tests from the proprietary texlode pipeline. It also says the preprint's Typst table is not reproduced by the current script. In a [2026-09-23 correction](https://github.com/texlode/luatex-benchmark/issues/1), the author acknowledges mixed workloads and PDF-export overhead, and reports approximately 8–9 ms for texlode's six-line paragraph pipeline on AMD EPYC. The current [product page](https://www.texlode.com/features/) separately reports approximately 8 ms before drawing on EPYC. These later figures remain author-reported, with different hardware and timing boundaries. The paper's Typst comparisons are not used to rank Rex.

### texlode public-sample measurements

Measured on **2026-10-11**, using [benchmarks/texlode.mjs](../benchmarks/texlode.mjs). The driver reads the five sample bodies verbatim from [systematic-benchmark.tex at commit `9b86f576ed977853d6a36c0f41b14a037297b150`](https://github.com/texlode/luatex-benchmark/blob/9b86f576ed977853d6a36c0f41b14a037297b150/systematic-benchmark.tex), including the long paragraph’s Lua-generated sentences and the exact inline / display mathematics. It uses the public script’s book defaults, 10pt Latin Modern, microtype defaults, amsmath and 345pt column width. No samples are replaced by Rex’s usual fox / dog / cat edit corpus.

**Hardware:** Rex runs on **Apple M4**, Darwin 25.6.0, Node.js 24.6.0, native **LuaHBTeX 1.22.0 / TeX Live 2025**. The paper’s reported machine is **Intel Core i7-1355U / TeX Live 2025**; its exact engine build, OS, font files, microtype version and product implementation are not pinned in the public harness. Both use the published sample settings, but the proprietary texlode pipeline is not executed or reproduced. The later ~8 ms AMD EPYC report describes a different six-line workload and is not assigned a ratio.

**Two timing boundaries:** Rex typesetting uses `t_tex_us`, covering grouped-vbox typesetting after context replay. It includes paragraph and mathematical typesetting, not just Knuth–Plass line breaking. Table 1 in the paper measures a vanilla LuaLaTeX vbox with the public script; the typesetting ratio is an approximate stage comparison with different instrumentation. Rex’s round trip starts before request encoding / writing and ends after the complete response and display list are decoded in Node. It includes native IPC, state replay / validation inside the engine, typesetting, traversal and serialization, but excludes reference compilation, host output verification, cold startup, editors, WASM, network and Canvas. Table 3 reports texlode’s pipeline round trip with no specified percentile or reproducible implementation. Neither ratio is a same-machine product speedup.

| Original sample | Rex output rows | Rex typeset median, ms | Author vanilla line-break median, ms (Table 1) | Rex native round-trip median, ms | Author texlode round trip, ms (Table 3) | Cross-machine typesetting ratio | Cross-machine round-trip ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Short | 1 | 0.030 | 0.170 | 0.082 | 0.790 | 5.67× | 9.67× |
| Medium | 5 | 0.371 | 0.700 | 0.565 | 6.110 | 1.89× | 10.82× |
| Long | 14 | 1.077 | 1.990 | 1.527 | — | 1.85× | — |
| Inline math | 1 | 0.115 | 0.200 | 0.226 | — | 1.74× | — |
| Display math | 2 | 0.072 | 0.110 | 0.168 | — | 1.52× | — |

Every ratio is **author-reported elapsed time ÷ Rex measured median**, calculated before rounding. A ratio of **1.25×** says that the author’s reported time is 1.25 times Rex’s local measured median; it does not establish a 1.25× product speedup. Hardware, instrumentation, statistics and product boundaries differ. The line-breaking ratios compare the vanilla LuaLaTeX results reported by texlode’s author, not texlode product timings. No ratios are inferred for unreported pipeline cases.

**Sampling:** There are three independent sequential runs per sample, each with a fresh native resident engine and context from a complete document capture. Each run discards 5 warmup batches of 100 compiles, then measures 30 batches of 100 compiles: **9,000 measured and 1,500 warmup responses per category**. The sample text is identical on every request, matching the public repeated-compilation workload; the paragraph is typeset again on every request without result memoization. There is no artificial pause. Each batch mean averages its individual timed requests, excluding host validation between them. Percentiles use the public `bench-lib.lua` index rule, `floor(n*p)` in a sorted zero-indexed array. Published Rex medians / P95s are medians of the three run-level medians / P95s. Individual timings, batch means and all three runs are retained; no outliers are removed.

**P95 is a percentile of batch means, not individual edit latency.** It must not be read as the same statistic as the document-edit P95s in the comparison summary. The author’s Table 1 P95 also summarizes 30 amortized samples; the Table 3 round-trip P95 is unavailable.

| Original sample | Rex typeset batch P95, ms | Author line-break batch P95, ms | Rex native round-trip batch P95, ms | Rex round-trip run median range, ms |
| --- | ---: | ---: | ---: | ---: |
| Short | 0.032 | 0.960 | 0.100 | 0.080–0.082 |
| Medium | 0.385 | 0.890 | 0.587 | 0.563–0.570 |
| Long | 1.149 | 2.410 | 1.628 | 1.512–1.540 |
| Inline math | 0.121 | 0.270 | 0.256 | 0.226–0.228 |
| Display math | 0.077 | 0.130 | 0.195 | 0.166–0.170 |

**Validation:** All **52,500 responses** (including warmups) match full native LuaLaTeX capture references for font identity, glyphs, relative coordinates, advances, line boxes and rules. Only page translation is removed. This verifies the paragraph display list against full typesetting; it does not independently validate the shared capture adapter, rendered browser pixels or complete editor behavior. The tests operate on one paragraph, not 10 / 100 / 300-page documents, and establish no document-size scaling result. Three runs provide observed variability, not statistical significance.

The local `texlode-workloads.json` report records the exact sample text, context, upstream / Rex source hashes, reference hashes, environment, author baselines, individual timings and batch statistics. Reproduction requires native LuaLaTeX with microtype and amsmath, plus the clean pinned public checkout:

```sh
git clone https://github.com/texlode/luatex-benchmark ../texlode-benchmark
git -C ../texlode-benchmark checkout 9b86f576ed977853d6a36c0f41b14a037297b150
npm run bench:texlode -- ../texlode-benchmark
# Optional smoke run: append --quick; never use smoke results for the table.
```

Default output is ignored `artifacts/benchmarks/texlode-workloads.json`. Use the generated report to update the displayed timings / ratios; keep raw output under `artifacts/benchmarks/`. Temporary compilation directories and owned processes are cleaned up; the public checkout is external and is not a runtime dependency.

## Matched Rex / realtime-tex preview measurements

The [matched preview driver](../benchmarks/preview-comparison.mjs) runs both real editor pipelines with one timing contract: **the application's document-change listener starts → the first page's Canvas drawing submission completes**. Rex starts at CodeMirror's document-change listener, before source-string conversion, and ends after `Renderer.repaint()` returns. realtime-tex starts at the VS Code plugin's document-change listener and ends after the renderer replaces its page Canvas. Both include their normal compiler, communication and drawing paths; realtime-tex retains its normal animation-frame scheduling. Neither includes the synthetic edit command before the change callback, pixel verification, acknowledgement, GPU completion or physical screen presentation.

The test fixes **Apple M4**, **Electron 43.7.7 / Chromium 150.0.7871.250**, visible application windows, **A4**, **100% preview zoom**, **device pixel ratio 1**, a **640 × 600 CSS-pixel preview area**, and a **794 × 1123 pixel first-page Canvas**. Every sampled update checks the zoom, viewport and backing-store dimensions. Rex runs its publishable build in a stock Electron browser window; realtime-tex runs its real VS Code extension host / native Rust / webview pipeline. Each app retains its own compiler and font pipeline. The browser version and measurement boundary match; this is an application-pipeline comparison, not a shared-engine compiler benchmark.

The corpus uses `article` with explicit `a4paper`, `amsmath`, one repeated text paragraph per page and explicit page breaks at **10 / 100 / 300 pages**. Edits alternate the first `brown fox` occurrence between `brown dog` and `brown cat`. Both tools use the same deterministic **60–100 ms varying interval sequence**, scheduled from absolute target start times rather than from the previous acknowledgement. Actual scheduling lateness is retained. Three rounds alternate application order: **Rex → realtime-tex**, **realtime-tex → Rex**, **Rex → realtime-tex**. Each application / size / round has 20 warmups and 300 measured updates, giving **900 measured updates per application and size**.

Measured on **2026-10-12**. Each cell shows **median / P95 in ms**:

| Application | 10 pages | 100 pages | 300 pages |
| --- | ---: | ---: | ---: |
| Rex | 4.660 / 5.205 | 4.175 / 5.195 | 4.270 / 5.500 |
| realtime-tex | 9.369 / 16.720 | 8.006 / 16.555 | 8.951 / 16.643 |

The equally weighted geometric mean of realtime-tex / Rex per-size median ratios is **2.006716×**, reported as **2.01× / 100.7% faster** in this edit-to-Canvas metric. This is not an aggregation of individual-edit percentiles. Three rounds provide observed variability rather than statistical significance or a universal performance claim. Maximum recorded scheduling lateness is **3.285 / 6.418 ms** for Rex / realtime-tex; realtime-tex's maximum calibration half-round-trip is **0.331 ms**. All samples remain in the report.

**Observation and validation:** warmups and timed samples perform no Canvas pixel readback. Observation hooks record the completed drawing submission, while every compiler response is checked for a stable display list for the same edited text. After each measured sequence, pixel snapshots must change between dog and cat. The saved live display lists are checked against independent full compilations for font identity, relative glyph positions, line widths and line boxes, removing only page translation. Complete reference data are retained. Exact full-page raster equality is diagnostic rather than a pass criterion: an incremental preview can retain the preceding global placement until a full pass settles it. This does not independently certify the renderer or physical screen pixels.

Rex's start / end timestamps are in one renderer clock. realtime-tex's extension-host / renderer clocks are calibrated every 20 edits using the shortest of five round-trip exchanges; calibration samples and uncertainty are retained. Per-run median / P95 use nearest-rank statistics; the reported per-size values are the medians of the three run-level values. No measured updates are discarded. The local `preview-comparison.json` report retains both applications' per-edit samples, full-compile references, post-run pixel hashes, versions, source / build fingerprints and instrumentation. The driver checks that Rex's source and build fingerprints did not change during the experiment. Previous API-only and fixed-after-readback measurements below remain historical references.

Reproduction uses the clean engine / plugin checkouts and native LuaLaTeX from the preceding benchmark. Install the matching Electron runtime outside Rex's runtime dependencies, then run:

```sh
npm install --prefix ../rex-preview-runtime --no-audit --no-fund electron@43.7.7
node ../rex-preview-runtime/node_modules/electron/install.js
node benchmarks/preview-comparison.mjs ../realtime-tex-vsc-plugin ../realtime-tex --electron=../rex-preview-runtime/node_modules/electron
# Smoke only: append --quick. Output: artifacts/benchmarks/preview-comparison.json
```

The default report is ignored `artifacts/benchmarks/preview-comparison.json`. This workflow is verified on macOS and opens isolated test windows. `docs/comparison.md` summarizes the completed matched results; the older timings below are not substituted for this run.

## Matched TeXpresso preview measurements

The [TeXpresso driver](../benchmarks/texpresso-preview.mjs) uses the same logical boundary as the matched Rex / realtime-tex run: **the real editor's document-change callback starts → first-page drawing commands have been submitted**. It starts at the pinned VS Code plugin's `onDidChangeTextDocument` callback and stops immediately after native `txp_renderer_render()` returns, before `SDL_RenderPresent()`. It includes the plugin's byte-patch synchronization, IPC, checkpoint / rollback compilation, MuPDF rasterization, texture updates and SDL drawing. Synthetic edit triggering, validation / readback, acknowledgements, GPU completion and screen presentation are excluded.

This is a subsequent three-round run on the same **Apple M4 / macOS 26.6.2**, using **VS Code 1.141.0**, [TeXpresso at `e8df7709077b2f86f6e16e6c86ceefb86de06f8d`](https://github.com/let-def/texpresso/tree/e8df7709077b2f86f6e16e6c86ceefb86de06f8d), and [the VS Code plugin 1.8.0 at `a8418da8d7f307abed8bb4552ec5278b260f25a9`](https://github.com/DominikPeters/texpresso-vscode/tree/a8418da8d7f307abed8bb4552ec5278b260f25a9). The native viewer uses **SDL 2.32.8 / Metal**, **MuPDF 1.28.5**, and **TeX Live 2025**, built with Apple clang 17.0.0 / `-O2`. The browser editor uses the same Electron version as realtime-tex; the preview is native SDL. The native visible-region rasterizer and the browser full-page Canvas renderers retain their own algorithms, so matching the logical endpoint does not make their rendering workloads or engines identical.

Each round tests **10 / 100 / 300 pages**, with **20 warmups + 300 measured updates per size**. Text, A4 `article` layout, `amsmath`, first-paragraph dog / cat substitutions and the absolute deterministic **60–100 ms** edit schedule match the preceding run. TeXpresso also needs `\AtBeginDvi{\special{pdf:pagesize width 210mm height 297mm}}`: its DVI viewer otherwise defaults to a Letter page box despite `a4paper`. This sets the output page box without changing the test paragraph. The observer patch configures a **640 × 600** visible native viewport, **DPR 1**, uncropped A4 page, and **794 px** full-page width (100% CSS-equivalent). Every measured draw checks the viewport, A4 aspect ratio, page scale and actual Metal backend. It preserves the production vsync setting. These are preview settings, not compiler or render-algorithm changes.

The [native observer patch](../benchmarks/texpresso-observer.patch) records a timestamp and revision after drawing, sends clock probes, and provides post-run snapshots. The plugin adds an observer at its existing change callback and exposes its process handle. Its stdout receiver is changed to Node `readline` framing: the pinned receiver parses each pipe chunk as a complete JSON message, which emits exceptions and can stall a large-document session. This compatibility repair preserves each protocol message and its existing handler; it does not change byte-patch sending, compilation, rendering or scheduling. The exact modified plugin source is retained in the report. Test processes use dedicated process groups for cleanup. No pixel readback or display-list traversal is added to warmups or timed edits. At the end of each sequence, dog / cat snapshots must match independent fresh-process compilations, both for **visible-pixel CRC32** and a **full first-page MuPDF trace CRC32 / byte count**, including glyph identities and positions. Every timed draw is associated with a new byte-patch revision; the two post-run snapshots validate the sequence's final outputs, not every individual frame or screen presentation.

On macOS the native observer uses `mach_absolute_time`; the extension host uses `performance.now`. Clocks are calibrated every 20 edits with the shortest of five round trips, preserving every probe, offset and half-round-trip uncertainty. Statistics use the same nearest-rank median / P95 and median-of-three-run aggregation as Rex / realtime-tex. No measured updates are discarded. The driver monitors protocol exceptions as `protocolErrors` in the raw report. Results describe the pinned VS Code / native-viewer pipeline with the stated receive-framing repair.

Measured on **2026-10-12**. Cells show **median / P95 in ms**, with 900 measured edits per size:

| Application | 10 pages | 100 pages | 300 pages |
| --- | ---: | ---: | ---: |
| TeXpresso | 8.338 / 10.271 | 7.895 / 9.950 | 8.108 / 10.531 |

Maximum recorded scheduling lateness is **17.593 ms**; maximum calibration half-round-trip is **0.111 ms**. The receive-framing repair leaves **zero recorded protocol exceptions** in the completed run. Per-size run medians range from **5.758–8.710 / 5.890–8.905 / 6.443–8.489 ms** at 10 / 100 / 300 pages. This variability is retained; the summary uses the middle run statistic, not the fastest run.

The local `texpresso-preview.json` report retains all 2,700 samples, clock calibrations, validation hashes, protocol diagnostics, pinned revisions, build configuration, source / binary fingerprints, observer patch and driver source. It was collected after the paired Rex / realtime-tex run; the three applications were not interleaved. Older dummy-window / readback-inclusive results below do not enter this comparison.

To reproduce, supply SDL2, MuPDF and the engine dependencies from [upstream INSTALL.md](https://github.com/let-def/texpresso/blob/e8df7709077b2f86f6e16e6c86ceefb86de06f8d/INSTALL.md), native TeX Live and the VS Code test runtime used by `benchmarks/realtime-preview.mjs`. Keep the external checkouts and build products outside Rex's shipped dependencies:

```sh
git -C ../texpresso checkout e8df7709077b2f86f6e16e6c86ceefb86de06f8d
git -C ../texpresso-vscode checkout a8418da8d7f307abed8bb4552ec5278b260f25a9
npm ci --prefix ../texpresso-vscode --ignore-scripts
git -C ../texpresso apply "$PWD/benchmarks/texpresso-observer.patch"
make -C ../texpresso config
# Adjust Makefile.config header/library paths for MuPDF if needed; retain -O2.
make -C ../texpresso -j4 all
node benchmarks/texpresso-preview.mjs ../texpresso ../texpresso-vscode
# Smoke only: --quick. Output: artifacts/benchmarks/texpresso-preview/results.json
```

The driver reuses `esbuild`, `@vscode/test-electron` and the cached VS Code 1.141.0 under `artifacts/benchmarks/realtime-preview/`; those test dependencies must already be prepared. Default output is ignored `artifacts/benchmarks/texpresso-preview/results.json`. This macOS workflow opens isolated native windows and cleans up the test directories and owned process groups.

## realtime-tex VS Code preview measurements

Historical run on **2026-10-12**, before the matched comparison above, with [benchmarks/realtime-preview.mjs](../benchmarks/realtime-preview.mjs). This runs the real VS Code extension host, native Rust session and upstream preview renderer. It uses unmodified realtime-tex **0.0.2 at `210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1`**, the [VS Code plugin at `d7a34f18c9210fd22c2e018b868b20a0495dc3c0`](https://github.com/HenryXiaoYang/realtime-tex-vsc-plugin/tree/d7a34f18c9210fd22c2e018b868b20a0495dc3c0), VS Code **1.141.0 / Electron 43.7.7 / Chromium 150.0.7871.250**, and native LuaHBTeX **1.22.0 / TeX Live 2025** on Apple M4 / macOS 26.6.2. The engine uses `cargo build --release --locked`; the plugin uses its existing build dependencies. No compiler, renderer or scheduling algorithm is changed.

**Primary timer:** starts when the extension receives a VS Code document-change event and stops immediately after the upstream renderer replaces the visible page's Canvas. It includes buffer synchronization, native `rtex serve`, paragraph compilation, resource checks, extension-host → webview messages, the renderer's existing `requestAnimationFrame` wait and page drawing. It excludes the synthetic editor-edit command before the document-change event, cold setup, pixel readback / validation, acknowledgement and screen compositing. Node and Chromium clocks are translated with `performance.timeOrigin` and calibrated every 20 edits using the shortest of five message exchanges. Clock samples and their half-round-trip uncertainty are retained; the largest observed calibration half-round-trip is 0.106 ms. This is calibration evidence, not a confidence interval for the latency.

**Workload and sampling:** the same article / amsmath text corpus and first-paragraph fox → dog / cat edits as the Rex browser benchmark, at 10 / 100 / 300 pages. Each size has three fresh sessions, each with 20 warmups and 300 measured edits: **900 measured edits per size**. The first page is visible at 100% zoom, device pixel ratio 1, with a **794 × 1123 pixel Canvas**. Edits are sequential, with a 2 ms pause after the preceding pixel-verification acknowledgement, outside the primary timer. Readback therefore affects the interval between edits even though it is excluded from the primary timing. Frame scheduling, refresh rate, viewport, zoom and edit cadence can change these results. The default eligibility probe and background layout remain enabled. Auto-save is off; the test window uses an isolated profile and extension directory.

Nearest-rank median / P95 are calculated within each run; each displayed number is the median of the three run-level statistics. Every chronological measured sample is retained and no outliers are removed. The secondary timer stays in the extension host and ends after pixel readback, FNV-1a hashing and the webview acknowledgement, avoiding cross-process clock subtraction.

| Document | Edit → Canvas median, ms | Edit → Canvas P95, ms | Through verified readback / acknowledgement median, ms | Through verified readback / acknowledgement P95, ms |
| --- | ---: | ---: | ---: | ---: |
| 10 pages | 14.321 | 15.033 | 30.613 | 31.593 |
| 100 pages | 14.361 | 15.142 | 30.583 | 31.506 |
| 300 pages | 14.384 | 14.909 | 30.540 | 31.474 |

The three Canvas-timing run medians range from **14.295–14.377 / 14.361–14.387 / 14.221–14.412 ms** at 10 / 100 / 300 pages. These are observed run ranges, not statistical confidence intervals. They describe the tested warm workflow rather than a document-size scaling law or universal product speed ranking.

### Why this differs from Rex's browser timing

The recorded realtime-tex native timing status is about **0.8 ms** in these sessions. The median per-edit difference between its Canvas timer and native status is about **13.5 ms**, combining buffer / process communication, resource checks, webview messaging, frame scheduling and drawing. These components have not been timed separately, so the remainder cannot all be assigned to any one stage. The upstream renderer waits for `requestAnimationFrame`, redraws the visible page onto a new Canvas and replaces the old Canvas. Rex's benchmark instead calls `Session.edit()` directly in headless Chromium, awaits its live worker and Canvas patch, and stops without waiting for an animation frame or screen presentation. Frame scheduling is therefore a plausible major contributor, not a measured stage-level attribution.

Both tests use the same machine and source corpus, but the entry points, editor / process paths, drawing surfaces, browser versions and edit cadence differ. The realtime-tex driver waits for pixel hashing and acknowledgement before starting its 2 ms pause; Rex's driver immediately proceeds after the previous `Session.edit()` returns and clears the background full-pass timer. Although readback is excluded from the realtime-tex primary timer, it can affect the next edit's phase relative to animation frames. Rex's 1.2 ms ends before screen presentation too: a user may still wait for the next display refresh. Dividing 14.4 by 1.2 does not establish a 12× difference in compiler speed or user-visible latency.

A comparable user-visible benchmark must start from each editor's applied document-change event, use equivalent visible viewports / zoom / pixel ratios, schedule edits independently of verification work and finish at the same verified screen-presentation boundary. Stage timers should separately capture compiler work, message transport, frame wait and drawing. Existing recorded values remain useful measurements of the named workflows; they are not substituted for that benchmark.

**Validation:** all **2,880 warmup and measured draws** have strictly advancing source revisions, no PDF fallback and no missing-resource / approximate-rendering reason. Repeated dog / cat edits produce distinct, stable first-page pixel hashes. Outside each timed loop, the plugin requests independent full-document compilation of both edited texts and draws the settled page with no live overlays. Every live hash matches the corresponding full-compile Canvas reference. This checks the edited first page and its positions; it shares the upstream renderer with the reference and does not independently validate that renderer, all document pages, physical screen output or arbitrary packages.

The local `realtime-preview.json` report preserves all nine runs, per-edit primary and secondary timings, native timing status, source revisions, pixel / reference hashes, Canvas dimensions, browser version, clock calibration records, upstream revisions, renderer source hash and the complete driver / instrumentation. The browser bundle adds observation messages and readback after drawing; the upstream source checkouts remain clean. Results with `--quick` are smoke checks and are not published.

```sh
git clone https://github.com/HenryXiaoYang/realtime-tex ../realtime-tex
git -C ../realtime-tex checkout 210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1
cargo build --release --locked -p rtex-cli --manifest-path ../realtime-tex/Cargo.toml
git clone https://github.com/HenryXiaoYang/realtime-tex-vsc-plugin ../realtime-tex-vsc-plugin
git -C ../realtime-tex-vsc-plugin checkout d7a34f18c9210fd22c2e018b868b20a0495dc3c0
npm ci --prefix ../realtime-tex-vsc-plugin
node benchmarks/realtime-preview.mjs ../realtime-tex-vsc-plugin ../realtime-tex
# Optional smoke check: append --quick. Output: artifacts/benchmarks/realtime-preview.json
```

Native LuaLaTeX is required. The driver uses the plugin's `@vscode/test-electron` to download / reuse its pinned VS Code and launch an actual test window. This measurement was run on macOS; other platforms are not verified by this driver. The default output is ignored `artifacts/benchmarks/realtime-preview.json`. External checkouts and their dependency / VS Code caches are test dependencies, not Rex runtime dependencies.

## Product preview measurements

Rex, TeXpresso and the realtime-tex VS Code preview above use the same text corpus, first-paragraph edits, 20 warmups and 300 measured edits over three runs on Apple M4. Their editor / renderer paths, viewports, browser versions and timer endpoints differ, so these rows establish responsiveness in the tested configurations rather than relative product speed. Texifier, TeXlyre and Overleaf have no same-corpus product measurement here.

Rex uses Chromium 134.0.6998.35, Node.js 24.6.0 and LuaTeX 1.21.0. Its `Session.edit` timer includes source processing, engine execution, worker communication, revision checks and Canvas submission; browser compositing is excluded. A warm full pass starts after `standby-ready`, with its preamble already loaded. Cold setup, preview and live-engine warmup take 1633.325 / 2235.370 / 3568.140 ms on this corpus; those values include substantially more work than a warm pass.

TeXpresso uses commit `e8df7709077b2f86f6e16e6c86ceefb86de06f8d`, Apple clang 17.0.0 at `-O2`, TeX Live 2025, MuPDF 1.28.5 and SDL 2.32.8 on macOS 26.6.2. The viewer uses SDL's dummy video driver and a 700 × 900 software surface. An instrumentation patch reads the rendered pixels and emits their CRC32 after `SDL_RenderPresent`; the driver waits for a hash matching an independently compiled fox / dog / cat reference. All 2,880 warmup and measured edits pass this check. No typesetting or caching algorithm is changed. Readback and validation overhead remain inside the timer. First-page readiness with populated resource caches takes about 82 ms; this viewport result does not include full-document compilation or aux convergence and is not comparable to Rex's cold setup timer.

The native LuaLaTeX reference uses LuaHBTeX 1.22.0 from TeX Live 2025, with the same document and capture modules as Rex. Its warm timer starts when stdin releases the preloaded preamble and ends at process completion, including capture output. Different engine versions and measurement boundaries limit interpretation.

The local `performance.json` report retains Rex product results under `final`, the shared compiler results under `comparison.realtimeTex`, and TeXpresso samples, source hashes, independent pixel references, the measurement patch and Python driver under `comparison.texpresso`. The pre-addition browser and shared compiler reports remain under `improvements.before`; the preceding build and intermediate measurements for the new live paths remain under `parity`. The previous published product and compiler reports remain under `responsiveness.before`. The driver can be reproduced outside the Rex tree using the pinned checkout and its [build instructions](https://github.com/let-def/texpresso/blob/e8df7709077b2f86f6e16e6c86ceefb86de06f8d/INSTALL.md). Texifier, TeXlyre and Overleaf have no measurements in this report; their design descriptions are not substituted for timings.

A broader product benchmark should match the rendering boundary and viewport, pin all versions, separate initial downloads from warm execution, test edits near the beginning and end, and verify complete output. The shared native comparison covers text, math and style; complete editor pipelines, TikZ, tables, bibliographies and cascading pagination still need performance cases. The recorded timing percentages below retain the boundary differences; they do not establish a universal speed ranking.

### Detailed product results

| Product / tested configuration | 10 pages | 100 pages | 300 pages | Timer endpoint / evidence gap |
| --- | ---: | ---: | ---: | --- |
| Rex, browser editor | 1.210 / 1.870 | 1.215 / 1.885 | 1.205 / 1.860 | `Session.edit` through Canvas submission; excludes browser compositing |
| realtime-tex, VS Code preview | 14.321 / 15.033 | 14.361 / 15.142 | 14.384 / 14.909 | Document-change callback through Rust session and animation-frame Canvas replacement; excludes readback and screen compositing |
| TeXpresso, native software viewer | 2.982 / 4.608 | 3.005 / 4.777 | 3.055 / 4.600 | Through rendered-pixel readback, CRC32 verification and acknowledgement; excludes desktop compositing |
| texlode | Not measured | Not measured | Not measured | Author-reported paragraph pipeline timings above; no same-corpus product run |
| Texifier | Not measured | Not measured | Not measured | No installed app / same-corpus run; vendor describes visible-region typesetting and Metal rendering |
| TeXlyre | Not measured | Not measured | Not measured | Browser document build / PDF pipeline not measured |
| Overleaf | Not measured | Not measured | Not measured | Hosted build / network / PDF pipeline not measured; automatic compile cadence is not latency |

| Rex full-document operation | 10 pages | 100 pages | 300 pages |
| --- | ---: | ---: | ---: |
| Cold setup through preview and live-engine warmup | 1633.325 ms | 2235.370 ms | 3568.140 ms |
| Warm full pass, preloaded preamble | 73.820 ms | 387.425 ms | 1031.865 ms |
| Native LuaLaTeX warm full-pass reference | 83.940 ms | 309.756 ms | 834.078 ms |
| Rex warm full-pass run range (3 timed passes) | 73.090–74.990 ms | 372.440–389.670 ms | 1024.325–1041.020 ms |
| Native warm full-pass run range (3 timed passes) | 76.510–264.308 ms | 300.224–326.227 ms | 830.947–834.605 ms |

| Recorded timing comparison | 10 pages | 100 pages | 300 pages |
| --- | ---: | ---: | ---: |
| Rex recorded preview timing vs TeXpresso, median / P95 | 146.4% faster / 146.4% faster | 147.3% faster / 153.4% faster | 153.5% faster / 147.3% faster |
| Rex recorded warm full-pass timing vs native LuaLaTeX, median | 13.7% faster | 25.1% slower | 23.7% slower |

TeXpresso includes rendered-pixel readback and verification; Rex stops at Canvas submission. Cold and warm timers cover different work. The native reference includes capture output and process completion; browser and native engine versions differ. These faster / slower percentages compare the recorded timer durations, not equivalent complete editor pipelines. Graphics, tables, bibliographies, pagination changes and first font loads need separate performance cases.


Design descriptions are sourced from Texifier's [typesetter article](https://www.texifier.com/blog/texpadtex-story-so-far), TeXlyre's [compile-on-save implementation](https://github.com/TeXlyre/texlyre/blob/d10e020a7c6452c83dedebf943615dcecfe65919/src/components/output/LaTeXCompileButton.tsx#L320) and Overleaf's [automatic compilation documentation](https://docs.overleaf.com/getting-started/recompiling-your-project).

### Before and after the additions

The original published build is retained under `improvements.before`; the build preceding the live-preview additions is retained under `parity.before`. Current rows use the same machine, engine, corpus, sample counts and `Session.edit` / Canvas boundary. Cached glyph outlines, dirty rectangles, incremental parsing and reduced state replay improve the measured text path. Registered Lua callbacks and raw UTF-8 requests are retained. Persistence remains outside the edit timer. All samples and intermediate reports are preserved; historical native measurements are not used to attribute a speedup because scheduling varied.

| Pages | Original edit median / P95, ms | Preceding build median / P95, ms | Current edit median / P95, ms | Rex vs preceding build, median / P95 |
| --- | ---: | ---: | ---: | ---: |
| 10 | 1.645 / 2.730 | 1.680 / 2.855 | 1.210 / 1.870 | 38.8% faster / 52.7% faster |
| 100 | 1.990 / 3.020 | 1.765 / 2.935 | 1.215 / 1.885 | 45.3% faster / 55.7% faster |
| 300 | 2.800 / 3.895 | 2.080 / 3.145 | 1.205 / 1.860 | 72.6% faster / 69.1% faster |

Warm browser full-pass medians change by 2.5 / 3.6 / 0.1% from the preceding build. These measurements cover the original text corpus; functional support for tables, images and paragraph restructuring does not establish their performance on arbitrary projects.

The application remains 23 source files (140,546 bytes, previously 137,512), with no new runtime dependency or published file. Assets and glyph outlines use the existing font / PDF libraries; changed font bytes invalidate cached outlines, and rejected fonts can be replaced with valid data. The coordinator retains engine resources across project switches while discarding stale work at asynchronous boundaries. The node visitor uses the public [LuaTeX iterator API](https://www.pragma-ade.com/general/manuals/luatex.pdf); verification and state guards remain active during measurements.

### Latest responsiveness work

The implementation was compared with realtime-tex's resident server and node walker. Context replay now passes through TeX's normal scanner once during registration, including nested parameter tokens. The visitor shares its methods and reuses numeric glyph-run storage with explicit lengths. State lookup caches token / register identities while retaining the transaction fingerprint, counter restoration and global-write guards. Response framing owns one buffer per message, and Canvas composes each glyph matrix directly. Source difference scanning compares 4 KiB chunks before resolving character boundaries.

GC is stopped only during a request when it was already running, restarted after the response, and advanced according to allocation debt before waiting for the next request. A document that disabled GC keeps that behavior. This changes when collection happens; it does not remove collection work. The 10,000-edit math experiment records 29–40 MiB sampled Lua heap after context loading, finishing below its starting heap. It uses an intermediate source snapshot retained in `responsiveness.memoryExperiment`; the final-source regression separately checks 2,000 mixed text, math, style and nested-box edits with exact output and a heap bound.

| Pages | Previous published median / P95, ms | Current median / P95, ms | Elapsed-time reduction, median / P95 |
| --- | ---: | ---: | ---: |
| 10 | 1.255 / 2.175 | 1.210 / 1.870 | 3.6% / 14.0% |
| 100 | 1.340 / 2.235 | 1.215 / 1.885 | 9.3% / 15.7% |
| 300 | 1.605 / 2.490 | 1.205 / 1.860 | 24.9% / 25.3% |

The prior published rows have three runs; a same-task, single-run starting measurement is also preserved under `responsiveness.before.taskStartBrowser`. Current browser runs retain every chronological sample and the final distribution hash. Warm full compilation was not the optimization target. No runtime dependency or source file was added. Every live request still typesets its source; no edited-output memoization is introduced.

## Regression evidence

Frozen layout data covers five cases, seven pages and 1,584 inline glyphs. Tests check coordinates, line geometry, colors, rules, state replay and isolation. All 35 automated tests pass. The final-source editor suite covers editing races, font rendering, aux convergence, preamble invalidation, busy project switches, paragraph growth / splits / merges, overfull line cleanup, table edits, PNG / JPEG replacement, transformed / selected PDF pages, numbered / aligned equations, footnote markers, same-path font replacement / recovery and safe image redraw after a failed project switch. Pixel comparisons additionally cover composed Type1 / OpenType glyph matrices, device scale, slant, expansion, clipping and PDF transforms. Fragmented 100 KiB responses and Unicode changes across 4 KiB source boundaries pass. Static hosting, offline use, bibliography backends and runnable examples also pass. Project regressions verify nested binary / text round trips, local restore including incomplete drafts, child-file live editing and paragraph navigation; index regressions verify named indexes, local styles, reuse, offline generation and removed entries.

The local `full-compilation.json` report includes picture reuse compared with an uncached PDF, exact TeX box geometry, standby use, BibTeX, BibLaTeX / BibTeX, Biber, offline Biber and MakeIndex. Functional-suite timings are diagnostic records. Before these additions, an independently installed clean checkout passed the full suite with 4,342 distribution entries matching the workspace build byte for byte. The current build has 4,343 entries; checks verify every published byte against its source. The new functionality uses the existing engine / tool resources and adds no runtime dependency.

Internal refactoring and directory measurements remain under `refactor` and `organization` in the raw report. Historical results keep their original source hashes and measurement boundaries. Small differences remain subject to system load.
