import test from "node:test";
import assert from "node:assert/strict";
import { load } from "../helpers/runtime-helper.mjs";
import { coldPass } from "../../src/compiler/full-pass.js";

test("imported Chinese documents compile configurable lists and page headers", async () => {
  const source = String.raw`\documentclass[fontset=fandol]{ctexart}
\usepackage{enumitem,fancyhdr}
\setlist[itemize]{leftmargin=2em,itemsep=.2em,topsep=.3em}
\setlist[enumerate]{leftmargin=2.2em,itemsep=.2em,topsep=.3em}
\pagestyle{fancy}\fancyhf{}\fancyhead[L]{中文纪要}\fancyfoot[C]{\thepage}
\begin{document}
\section{纪要}中文正文。
\begin{itemize}\item 中文列表\end{itemize}
\begin{enumerate}\item 编号列表\end{enumerate}
\end{document}`;
  const result = await coldPass(await load(), {files: {"main.tex": source}, main: "main.tex"}, {}, {});
  assert.equal(new TextDecoder().decode(result.pdf.slice(0, 4)), "%PDF");
  assert.ok(!result.logs.some(line => line.includes("Missing character:")), result.logs.join("\n"));
});
