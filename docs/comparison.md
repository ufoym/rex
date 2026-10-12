# Feature and performance comparison

Detailed comparisons and recorded measurements for Rex. Start with the [README](../README.md) for setup and the [benchmark methodology](performance.md) for reproduction.

## Feature comparison

Checked on **2026-10-11**. The comparison covers incremental LaTeX tools and browser editors with automatic compilation. texlode entries reflect its paper and product documentation; its editor has not been tested locally.

**Legend:** ✓ supported; ✗ not supported in the compared workflow; ? not verified. A qualified ✓ has the limitation stated in its cell or the notes below. For features labeled **Live**, ✓ means an incremental update without waiting for a full document compilation; ✗ can still mean the feature works after a full compilation. Editor features attributed to realtime-tex refer to its separate [VS Code extension](https://github.com/HenryXiaoYang/realtime-tex-vsc-plugin), while compiler features refer to the library.

Features are ordered by runtime and deployment, incremental preview, typesetting and output, then project editing. The bold first row highlights Rex’s distinctive ability to run the incremental compiler itself in the browser; browser editors with full compilation and native incremental tools are compared separately in the rows below.

| Feature | Rex | [realtime-tex](https://github.com/HenryXiaoYang/realtime-tex/tree/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1) | [TeXpresso](https://github.com/let-def/texpresso) | [texlode](https://www.texlode.com/) | [Texifier](https://www.texifier.com/) | [TeXlyre](https://texlyre.github.io/docs/latex-compilation/overview) | [Overleaf](https://docs.overleaf.com/getting-started/recompiling-your-project/selecting-a-tex-live-version-and-latex-compiler) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **In-browser incremental LaTeX compilation** | ✓ verified paragraphs | ✗ | ✗ | ✗ server | ✗ | ✗ | ✗ |
| Browser editor without a desktop app / extension | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ |
| No native TeX distribution required | ✓ | ✗ auto-install available | ✗ TeX Live / Tectonic resources | ✓ server engine | ✓ integrated engine | ✓ | ✓ server engine |
| Local compilation without project upload | ✓ browser | ✓ native | ✓ native | ✗ server | ✓ local typesetter | ✓ browser | ✗ server |
| Offline compilation | ✓ cached resources | ✓ | ✓ | ✗ hosted service | ✓ | ✓ cached resources | ✗ hosted service |
| Static web deployment without an application backend | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ solo use | ✗ |
| Open-source code for customization | ✓ MIT | ✓ MIT library | ✓ MIT | ✗ editor core not public | ✗ commercial app | ✓ AGPL-3.0 | ✓ AGPL-3.0 Community Edition |
| Live: Text and formatting | ✓ verified paragraphs | ✓ verified units | ✓ | ✓ body paragraphs | ✓ visible region | ✗ | ✗ |
| Live: Mathematical expressions | ✓ verified paragraphs | ✓ | ✓ | ? incremental scope | ✓ | ✗ | ✗ |
| Cache reuse of unchanged pictures | ✓ | ✓ | ? | ? | ✓ fragment cache | ? | ? |
| Live: Image changes | ✓ PNG / JPEG / PDF references, scaling and rotation | ✓ | ✓ XeTeX-compatible | ? | ✓ package-dependent | ✗ | ✗ |
| Live: TikZ / vector drawing changes | ✗ | ✗ PDF fallback | ✓ XeTeX-compatible | ? | ✓ package-dependent | ✗ | ✗ |
| Live: Table changes | ✓ verified tables / floats | ✓ | ✓ XeTeX-compatible | ? incremental scope | ✓ package-dependent | ✗ | ✗ |
| Live: Paragraph splits and line-count changes | ✓ provisional; includes merges / insertions | ✓ provisional | ✓ | ? | ✓ | ✗ | ✗ |
| Live: Document pagination | ✗ | ✗ | ✓ | ✗ background convergence | ✓ | ✗ | ✗ |
| Live: Footnotes | ✓ markers only | ✓ markers only | ✓ | ? background convergence | ✓ | ✗ | ✗ |
| Live: Reference value updates | ✗ | ✗ | ? aux workflow | ✗ background convergence | ✓ | ✗ | ✗ |
| Live: Table of contents updates | ✗ | ✗ | ? aux workflow | ? incremental scope | ✓ | ✗ | ✗ |
| LuaLaTeX engine | ✓ | ✓ | ✗ | ✓ server | ? fallback | ✓ | ✓ |
| XeLaTeX / XeTeX engine | ✗ | ✗ | ✓ modified XeTeX | ? | ? fallback | ✓ | ✓ |
| pdfLaTeX engine | ✗ | ✗ | ✗ | ? | ? fallback | ✓ | ✓ |
| LaTeX engine | ✗ | ✗ | ✗ | ? | ? fallback | ✗ | ✓ |
| TexpadTeX engine | ✗ | ✗ | ✗ | ? | ✓ | ✗ | ✗ |
| LaTeX package support | ✓ selected bundle / imports | ✓ installed packages | ✓ XeTeX-compatible packages | ✓ server packages | ✓ engine exceptions | ✓ on demand | ✓ server packages |
| TeX font resources | ✓ OpenType / Type 1 | ✓ native fonts | ✓ native XeTeX fonts | ✓ OpenType | ✓ typesetter fonts | ✓ TeX Live / project fonts | ✓ TeX Live / uploaded fonts |
| Full-document PDF export | ✓ | ✓ | ? | ✓ | ✓ | ✓ | ✓ |
| Bibliography processing | ✓ BibTeX / Biber | ✓ automatic BibTeX / Biber | ? | ✓ BibLaTeX; backend ? | ✓ BibTeX live; Biber fallback | ✓ BibTeX / Biber | ✓ BibTeX / Biber |
| Index generation | ✓ MakeIndex / named indexes / local styles | ✓ MakeIndex | ? | ✓ documented | ✓ live indexer | ✓ MakeIndex | ✓ MakeIndex / latexmk |
| Multi-file projects | ✓ folder / portable import; live child-file edits | ✓ native files | ✓ external editor | ? | ✓ workspace | ✓ browser projects | ✓ hosted workspace |
| Project persistence (source and dependencies) | ✓ IndexedDB / portable export | ✓ disk | ✓ disk | ✓ Git-backed projects | ✓ app storage | ✓ IndexedDB | ✓ server storage |
| Source ↔ preview navigation | ✓ paragraphs | ✓ VS Code | ✓ editor integration | ? | ✓ sync / scroll lock | ✓ SyncTeX | ✓ SyncTeX |
| Compilation diagnostics | ✓ log | ✓ events / VS Code | ✓ live errors | ? | ✓ app diagnostics | ✓ editor / compiler | ✓ editor / compiler |
| Built-in shared editing | ✗ | ✗ | ✗ external editor only | ✓ CRDTs | ? Connect retiring | ✓ Yjs / WebRTC | ✓ collaboration / review |

- realtime-tex needs native TeX plus a library host or its VS Code extension. TeXpresso uses a native viewer and external editor on Linux / macOS. Texifier is a commercial macOS / iOS app with external / cloud typesetter fallback; the fallback engine list is not established here. TeXlyre collaboration also needs signaling. Overleaf uses server compilation and is available as a hosted service or server installation.
- Package support depends on the engine and available resources. Rex ships selected packages; the other tools use installed TeX packages, integrated typesetters or TeX Live resources as indicated above.
- Rex applies verified glyph, rule and image patches and runs a full compilation after idle. realtime-tex updates paragraphs and environments with a background full pass. TeXpresso uses checkpoint / rollback and viewport rendering; Texifier typesets the visible region incrementally. texlode uses a resident server-side LuaTeX process and sends display lists to browser Canvas, with background layout convergence. TeXlyre uses full compilation with optional compile on save; Overleaf uses automatic server compilation.
- Rex and realtime-tex use references from the last full layout during live edits. Both settle provisional paragraph layout, float movement and footnote bodies / placement after a full pass. New or merged Rex paragraphs borrow the first captured context; growing lines remain anchored to the last full layout. Neighbouring text and page breaks settle after the full pass. TeXpresso propagates incremental layout changes, but its auxiliary-file workflow is not verified here. A live paragraph update does not imply that the entire document has repaginated.
- TeXpresso documents a viewer-focused workflow; PDF export and bibliography / index orchestration are not verified here. Texifier's live indexer is MakeIndex-compatible. Rex's document-level tools run through full compilation.
- Rex supports live edits in uniquely captured main-file and child-file paragraphs. Splits, merges and line-count changes can update provisionally; ambiguous repeated inputs use full compilation. Imported asset-byte changes, unsupported image clipping / PDF options and vector drawings use full compilation. All project files persist locally and export together. realtime-tex tracks `input`, `include` and `subfile` dependencies. TeXpresso relies on its external editor for project editing and any shared editing. Texifier Connect is being retired; see the notice below for its availability.
- Installation rows describe end-user requirements after deployment, rather than developer setup. realtime-tex's extension can install native TeX automatically; TeXpresso needs installed TeX Live or Tectonic resources. Texifier's local typesetter avoids project uploads, while its cloud fallback does not. TeXlyre can compile and edit alone without an application backend; collaboration needs signaling, and uncached packages need a download source. Overleaf compiles on a server even when self-hosted. License labels describe project-owned code, not all bundled engines, fonts or dependencies; those retain their own licenses.

Sources: texlode's [TUG 2026 preprint](https://www.tug.org/tug2026/preprints/lode-realtime.pdf), [product documentation](https://www.texlode.com/features/) and [author's clarification of code availability and benchmarks](https://github.com/texlode/luatex-benchmark/issues/1); realtime-tex's [live-editing scope](https://github.com/HenryXiaoYang/realtime-tex/blob/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1/docs/live-editing.md) and extension documentation; TeXpresso's linked project documentation; Texifier's [package coverage](https://www.texifier.com/docs/tutorials/tex/typesetters/texpadtex/package-coverage), [source navigation](https://www.texifier.com/docs/apps/workspace/pdf-viewer/syncing-with-editor?platform=ios) and [Connect notice](https://www.texifier.com/connect); TeXlyre's linked compiler documentation and [project documentation](https://github.com/TeXlyre/texlyre); Overleaf's linked engine documentation, [bibliographies](https://www.overleaf.com/learn/latex/Bibliography_management_with_biblatex), [indexing](https://www.overleaf.com/learn/latex/Indices), [source navigation](https://docs.overleaf.com/navigating-in-the-editor/working-with-the-pdf-viewer/moving-between-the-editor-and-pdf) and [collaboration](https://www.overleaf.com/for/authors).

Installation, deployment and licensing sources: Rex's [guide](guide.md), [MIT license](../LICENSE) and [third-party notices](../THIRD_PARTY.md); realtime-tex's [installation instructions](https://github.com/HenryXiaoYang/realtime-tex/blob/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1/README.md) and [MIT license](https://github.com/HenryXiaoYang/realtime-tex/blob/210312967d9b90ecbe4c2ee502d78d5bb0d8c5e1/LICENSE); TeXpresso's [package providers](https://github.com/let-def/texpresso/blob/main/INSTALL.md#package-providers) and [MIT license](https://github.com/let-def/texpresso/blob/main/LICENSE); Texifier's [built-in typesetter](https://www.texifier.com/docs/tutorials/tex/typesetters), [local / cloud typesetters](https://www.texifier.com/docs/tutorials/tex/typesetters/external) and [commercial licenses](https://www.texifier.com/docs/web/account/licences); TeXlyre's [architecture, privacy and license](https://github.com/TeXlyre/texlyre); Overleaf's [Community Edition deployment and license](https://github.com/overleaf/overleaf).

Rex offers local paragraph preview, complete project persistence, paragraph navigation and document-level indexing with static deployment. Broader editors provide more complete package coverage, finer source navigation and collaboration. Live paragraph output does not imply that the entire document has already repaginated.

## Performance comparison

Local measurements use **Apple M4**. Document rows use 10 / 100 / 300 pages; **§ texlode-paper rows** use the original single-paragraph samples and Rex’s native resident compiler. Times and P95s are in separate columns. **‡ Baseline values** are author-reported on other hardware. Local percentages and cross-machine ratios use unrounded Rex timings. **—** means no measured page count or no reported P95.

| Baseline / timed workflow | Pages | Rex median, ms | Baseline time, ms | Rex P95, ms | Baseline P95, ms | Rex median vs baseline / cross-machine time ratio |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| [TeXpresso preview](performance.md#product-preview-measurements)† | 10 | 1.210 | 2.982 | 1.870 | 4.608 | 146.4% faster |
| [TeXpresso preview](performance.md#product-preview-measurements)† | 100 | 1.215 | 3.005 | 1.885 | 4.777 | 147.3% faster |
| [TeXpresso preview](performance.md#product-preview-measurements)† | 300 | 1.205 | 3.055 | 1.860 | 4.600 | 153.5% faster |
| [realtime-tex compiler](performance.md#shared-native-compiler-comparison) | 10 | 0.590 | 0.604 | 0.650 | 0.684 | 2.4% faster |
| [realtime-tex compiler](performance.md#shared-native-compiler-comparison) | 100 | 1.566 | 1.610 | 2.428 | 2.394 | 2.8% faster |
| [realtime-tex compiler](performance.md#shared-native-compiler-comparison) | 300 | 1.484 | 1.602 | 2.365 | 2.526 | 8.0% faster |
| [Native LuaLaTeX full pass](performance.md#detailed-product-results)† | 10 | 73.820 | 83.940 | — | — | 13.7% faster |
| [Native LuaLaTeX full pass](performance.md#detailed-product-results)† | 100 | 387.425 | 309.756 | — | — | 25.1% slower |
| [Native LuaLaTeX full pass](performance.md#detailed-product-results)† | 300 | 1031.865 | 834.078 | — | — | 23.7% slower |
| [texlode paper: short, vanilla line breaking](performance.md#texlode-public-sample-measurements)‡§ | — | 0.030 | 0.170 | 0.032 | 0.960 | 5.67× cross-machine (typesetting) |
| [texlode paper: medium, vanilla line breaking](performance.md#texlode-public-sample-measurements)‡§ | — | 0.371 | 0.700 | 0.385 | 0.890 | 1.89× cross-machine (typesetting) |
| [texlode paper: long, vanilla line breaking](performance.md#texlode-public-sample-measurements)‡§ | — | 1.077 | 1.990 | 1.149 | 2.410 | 1.85× cross-machine (typesetting) |
| [texlode paper: inline math, vanilla line breaking](performance.md#texlode-public-sample-measurements)‡§ | — | 0.115 | 0.200 | 0.121 | 0.270 | 1.74× cross-machine (typesetting) |
| [texlode paper: display math, vanilla line breaking](performance.md#texlode-public-sample-measurements)‡§ | — | 0.072 | 0.110 | 0.077 | 0.130 | 1.52× cross-machine (typesetting) |
| [texlode paper: short-paragraph round trip](performance.md#texlode-public-sample-measurements)‡§ | — | 0.082 | 0.790 | 0.100 | — | 9.67× cross-machine (round trip) |
| [texlode paper: medium-paragraph round trip](performance.md#texlode-public-sample-measurements)‡§ | — | 0.565 | 6.110 | 0.587 | — | 10.82× cross-machine (round trip) |
| [texlode: six-line paragraph, before drawing](https://www.texlode.com/features/)‡ | 300 | — | ~8 | — | — | Not comparable |

**Local evidence:** Each document-edit workload has **900 measured updates per tool and document size** (three runs, each with 20 warmups and 300 samples). Values are medians of the three run-level medians / P95s; no outliers are removed. Full-pass results instead use **three timed passes per tool and size**, so no P95 is reported. Native paragraph outputs are checked against fresh full captures; TeXpresso updates against independently rendered pixel hashes. Three runs do not establish statistical significance, especially for small differences.

† Different timer boundaries: Rex preview ends at Canvas submission; TeXpresso includes pixel readback and verification. Native LuaLaTeX full passes include capture output and process completion, with a different engine version. These percentages compare recorded timings and do not establish a direct product ranking. The realtime-tex row measures both native compilers through response decoding, excluding their editors, WASM and rendering.

‡ The author’s [preprint, Table 1](https://www.tug.org/tug2026/preprints/lode-realtime.pdf) reports vanilla LuaLaTeX line-breaking medians / P95s on **Intel Core i7-1355U / TeX Live 2025**; Table 3 reports texlode short / medium pipeline round trips of 0.79 / 6.11 ms without a stated percentile. Rex runs on **Apple M4 / LuaHBTeX 1.22.0 / TeX Live 2025**. **Cross-machine time ratio = author-reported time ÷ Rex measured median**; these are neither hardware-normalized speedups nor a same-machine texlode product benchmark. Rex’s typesetting timer includes grouped-vbox work and is not an isolated Knuth–Plass timer; its native round trip includes request encoding, IPC, traversal, display-list serialization and decoding, excluding the editor, WASM, network and drawing. The [current product report](https://www.texlode.com/features/) separately gives ~8 ms for a six-line paragraph in 300 pages on **AMD EPYC**, before drawing; that exact workload is unavailable here, so it has no Rex ratio.

§ Rex uses all five [verbatim public samples](https://github.com/texlode/luatex-benchmark/blob/9b86f576ed977853d6a36c0f41b14a037297b150/systematic-benchmark.tex): book defaults (**10pt Latin Modern**), **345pt** column, **microtype** and **amsmath**. Each sample has three fresh-engine runs, each with 5 warmup batches and 30 measured batches of 100 identical compilations. These rows show medians / P95s of **batch means**, summarized across the three runs; their P95s are not individual-edit P95s. All **52,500 responses**, including warmups, match full-compilation glyph, coordinate and line-box references. No outliers are removed. [Raw samples and source hashes](texlode-workloads.json), [methodology and reproduction](performance.md#texlode-public-sample-measurements).

[Full results and methodology](performance.md) retain every median / P95, middle / last edits, math, styles, cold startup and validation limits. Default native runs have no slower median in 9/10 cases and no slower P95 in 8/10; remaining default gaps are at most 2.9%, while burst text P95 gaps reach 12.5%. Strict median / P95 parity is not established; realtime-tex's colour-validation failure has no reported latency. Texifier, TeXlyre, Overleaf, Typst and pdfLaTeX have no same-machine timings here. Percentages use unrounded [raw samples](performance.json); **25% faster** means 20% less time.

Rex code is [MIT licensed](../LICENSE). Engine, font, PDF and document-tool components keep their own licenses; see [third-party notices](../THIRD_PARTY.md).
