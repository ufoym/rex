# Benchmark methodology

The [comparison document](comparison.md) contains the [feature matrix](comparison.md#feature-comparison) and [performance summary](comparison.md#performance-comparison). This document retains the detailed results, measurement scope, reproduction and evidence. Features were checked against primary documentation and source on 2026-10-11; documented support is distinguished from locally tested behavior.

## Reading the percentages

Results use **% faster / % slower**, calculated from unrounded summary values in the [raw report](performance.json) and rounded to one decimal. Faster percentages use `(baseline / Rex − 1) * 100`; slower percentages use `(Rex / baseline − 1) * 100`. **25% faster** means 20% less elapsed time; **25% slower** means 25% more elapsed time. Differences that round to zero are shown as less than 0.1%. Median and P95 changes are calculated separately from their respective three-run summaries; they are not percentiles of per-edit changes.

Rex versus realtime-tex at the shared native compiler boundary and Rex versus its preceding browser build have matching timers. TeXpresso preview and native LuaLaTeX full-pass timers include different work from Rex; their faster / slower percentages describe recorded timings rather than directly comparable product speeds. Measurements cover these configurations only. Texifier, TeXlyre, Overleaf, Typst and pdfLaTeX have no same-machine timing here, so no percentage comparison is assigned to them.

## Auditing the comparison summary

The comparison summary displays Rex median, baseline median, Rex P95, baseline P95 and the median percentage in separate columns, with one row per baseline and document size. The summary uses the first text paragraph consistently; the full native table below also retains middle / last edits, math and styles. Its data come from these paths in the [raw report](performance.json):

- Browser Rex: `final.summary`; individual samples and the three runs are in `final.rounds[].results[]`.
- TeXpresso: `comparison.texpresso.summary` and `comparison.texpresso.rounds[]`, including pixel verification and source hashes.
- Native Rex / realtime-tex: `comparison.realtimeTex.results[]` where `kind = text` and `position = first`; each contains `summary`, `rounds` and reference hashes.
- Preceding browser build: `parity.before.browser.summary` and `parity.before.browser.rounds[].results[]`.
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

The checkout must be clean. No Rust build is required because the common host drives each native Lua / TeX server directly. Default output goes to ignored `artifacts/benchmarks/comparison.json`; temporary compilation directories and owned child processes are cleaned up. The external checkout remains outside Rex and is not a runtime or distribution dependency. Default-policy results live at `comparison.realtimeTex`; burst results live at `comparison.realtimeTexBurst` in the [raw report](performance.json). The prior utility-QoS experiment and its original source hashes remain under `responsiveness.before.utility`; it is historical evidence, not a measurement of the current source.

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

The [raw report](texlode-workloads.json) records the exact sample text, context, upstream / Rex source hashes, reference hashes, environment, author baselines, individual timings and batch statistics. Reproduction requires native LuaLaTeX with microtype and amsmath, plus the clean pinned public checkout:

```sh
git clone https://github.com/texlode/luatex-benchmark ../texlode-benchmark
git -C ../texlode-benchmark checkout 9b86f576ed977853d6a36c0f41b14a037297b150
npm run bench:texlode -- ../texlode-benchmark
# Optional smoke run: append --quick; never use smoke results for the table.
```

Default output is ignored `artifacts/benchmarks/texlode-workloads.json`. To replace the published raw report, append `--output=docs/texlode-workloads.json` and regenerate the displayed timings / ratios from it. Temporary compilation directories and owned processes are cleaned up; the public checkout is external and is not a runtime dependency.

## Product preview measurements

Rex and TeXpresso use the same text corpus, first-paragraph edits, 20 warmups and 300 measured edits over three runs on Apple M4. Their timer endpoints differ, so these rows establish responsiveness in the tested configurations rather than relative speed. Texifier, TeXlyre, Overleaf and the complete realtime-tex editor pipeline have no same-corpus product measurement here.

Rex uses Chromium 134.0.6998.35, Node.js 24.6.0 and LuaTeX 1.21.0. Its `Session.edit` timer includes source processing, engine execution, worker communication, revision checks and Canvas submission; browser compositing is excluded. A warm full pass starts after `standby-ready`, with its preamble already loaded. Cold setup, preview and live-engine warmup take 1633.325 / 2235.370 / 3568.140 ms on this corpus; those values include substantially more work than a warm pass.

TeXpresso uses commit `e8df7709077b2f86f6e16e6c86ceefb86de06f8d`, Apple clang 17.0.0 at `-O2`, TeX Live 2025, MuPDF 1.28.5 and SDL 2.32.8 on macOS 26.6.2. The viewer uses SDL's dummy video driver and a 700 × 900 software surface. An instrumentation patch reads the rendered pixels and emits their CRC32 after `SDL_RenderPresent`; the driver waits for a hash matching an independently compiled fox / dog / cat reference. All 2,880 warmup and measured edits pass this check. No typesetting or caching algorithm is changed. Readback and validation overhead remain inside the timer. First-page readiness with populated resource caches takes about 82 ms; this viewport result does not include full-document compilation or aux convergence and is not comparable to Rex's cold setup timer.

The native LuaLaTeX reference uses LuaHBTeX 1.22.0 from TeX Live 2025, with the same document and capture modules as Rex. Its warm timer starts when stdin releases the preloaded preamble and ends at process completion, including capture output. Different engine versions and measurement boundaries limit interpretation.

The [raw report](performance.json) retains Rex product results under `final`, the shared compiler results under `comparison.realtimeTex`, and TeXpresso samples, source hashes, independent pixel references, the measurement patch and Python driver under `comparison.texpresso`. The pre-addition browser and shared compiler reports remain under `improvements.before`; the preceding build and intermediate measurements for the new live paths remain under `parity`. The previous published product and compiler reports remain under `responsiveness.before`. The driver can be reproduced outside the Rex tree using the pinned checkout and its [build instructions](https://github.com/let-def/texpresso/blob/e8df7709077b2f86f6e16e6c86ceefb86de06f8d/INSTALL.md). Texifier, TeXlyre and Overleaf have no measurements in this report; their design descriptions are not substituted for timings.

A broader product benchmark should match the rendering boundary and viewport, pin all versions, separate initial downloads from warm execution, test edits near the beginning and end, and verify complete output. The shared native comparison covers text, math and style; complete editor pipelines, TikZ, tables, bibliographies and cascading pagination still need performance cases. The recorded timing percentages below retain the boundary differences; they do not establish a universal speed ranking.

### Detailed product results

| Product / tested configuration | 10 pages | 100 pages | 300 pages | Timer endpoint / evidence gap |
| --- | ---: | ---: | ---: | --- |
| Rex, browser editor | 1.210 / 1.870 | 1.215 / 1.885 | 1.205 / 1.860 | `Session.edit` through Canvas submission; excludes browser compositing |
| realtime-tex, complete editor pipeline | Not measured | Not measured | Not measured | Shared native compiler results above exclude Rust session and VS Code rendering |
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

The [full compilation report](full-compilation.json) includes picture reuse compared with an uncached PDF, exact TeX box geometry, standby use, BibTeX, BibLaTeX / BibTeX, Biber, offline Biber and MakeIndex. Functional-suite timings are diagnostic records. Before these additions, an independently installed clean checkout passed the full suite with 4,342 distribution entries matching the workspace build byte for byte. The current build has 4,343 entries; checks verify every published byte against its source. The new functionality uses the existing engine / tool resources and adds no runtime dependency.

Internal refactoring and directory measurements remain under `refactor` and `organization` in the raw report. Historical results keep their original source hashes and measurement boundaries. Small differences remain subject to system load.
