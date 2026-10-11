function boundary(source, command, last = false) {
  // Mask comments without changing offsets, while preserving escaped percent signs.
  if (last) {
    const visible = source.replace(/\\[%\\]|%[^\n]*/g, text => text.startsWith("%") ? " ".repeat(text.length) : text);
    return visible.lastIndexOf(command);
  }
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "%") { i = source.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (depth === 0 && source.startsWith(command, i)) return i;
    if (source[i] === "\\" && /[{}%\\]/.test(source[i + 1] || "")) { i++; continue; }
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
  }
  return -1;
}
export function preamble(source) {
  const p = boundary(source, "\\begin{document}");
  if (p < 0) throw Error("Expected \\begin{document}");
  return source.slice(0, p);
}
export function paragraphs(source, fragment = false) {
  const body = fragment ? 0 : preamble(source).length + 16,
    end = fragment ? source.length : boundary(source, "\\end{document}", true);
  const spans = [];
  let start = body,
    cursor = 0,
    line = 1;
  const environments = [];
  for (const m of source
    .slice(body, end)
    .matchAll(/\\(begin|end)\s*\{([^}]+)\}|\n[ \t]*\n/g)) {
    if (m[1] === "begin") {
      environments.push(m[2]);
      continue;
    }
    if (m[1] === "end") {
      environments.pop();
      continue;
    }
    if (environments.length) continue;
    const stop = body + m.index;
    add(start, stop);
    start = stop + m[0].length;
  }
  add(start, end);
  function add(a, b) {
    while (a < b && /\s/.test(source[a])) a++;
    while (b > a && /\s/.test(source[b - 1])) b--;
    if (a < b) {
      while (cursor < a) {
        if (source[cursor++] === "\n") line++;
      }
      spans.push({ start: a, end: b, text: source.slice(a, b), line });
    }
  }
  return spans;
}
export function changedSpan(before, after, fragment = false, cached) {
  // Compare large unchanged ranges in the string engine, then resolve only the
  // boundary in JavaScript. A single-character edit otherwise scans the whole book.
  const chunk = 4096, limit = Math.min(before.length, after.length);
  let a = 0;
  while (a + chunk <= limit && before.slice(a, a + chunk) === after.slice(a, a + chunk)) a += chunk;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  let b = before.length,
    c = after.length;
  while (b - chunk >= a && c - chunk >= a && before.slice(b - chunk, b) === after.slice(c - chunk, c)) {
    b -= chunk;
    c -= chunk;
  }
  while (b > a && c > a && before[b - 1] === after[c - 1]) {
    b--;
    c--;
  }
  const old = cached || paragraphs(before, fragment);
  if (!old.length) return null;
  let index = old.findIndex((s, i) => a <= s.end && (i === 0 || a > old[i - 1].end));
  if (index < 0) index = old.length - 1;
  else if (index > 0 && a < old[index].start) index--;
  let last = index;
  while (last + 1 < old.length && b >= old[last + 1].start) last++;
  // Edits in inter-paragraph whitespace borrow the preceding captured context.
  if (a < old[0].start || b > old.at(-1).end) {
    const bodyStart = fragment ? 0 : preamble(before).length + 16, bodyEnd = fragment ? before.length : boundary(before, "\\end{document}", true);
    if (a < bodyStart || b > bodyEnd) return null;
  }
  // Only parse the touched unit; unchanged spans shift by the edit's length and line delta.
  const span = old[index], begin = Math.min(a, span.start), end = Math.max(b, old[last].end) + c - b;
  const local = paragraphs(after.slice(begin, end), true);
  const shift = c - b, lines = (after.slice(a, c).match(/\n/g) || []).length - (before.slice(a, b).match(/\n/g) || []).length;
  const start = begin + (local[0]?.start || 0), stop = begin + (local.at(-1)?.end || 0);
  const touched = {start, end: stop, text: after.slice(start, stop),
    line: begin < span.start ? before.slice(0, begin).split("\n").length : span.line + (after.slice(span.start, start).match(/\n/g) || []).length};
  const next = [...old.slice(0, index), touched, ...old.slice(last + 1).map(s =>
    ({...s, start: s.start + shift, end: s.end + shift, line: s.line + lines}))];
  return { index, removed: last - index + 1, old: old[index], next: next[index], count: next.length, spans: next,
    provisional: last !== index || local.length !== 1 };
}
export function safe(source) {
  // Structural changes, assignments, file I/O and page-sensitive output use a full pass.
  if (
    /\\(?:gdef|global|def|edef|xdef|let|newcommand|renewcommand|input|include|directlua|write|read|catcode|csname|marginpar|setcounter|addtocounter|vspace|pagebreak|clearpage|newpage|thepage|printindex|printbibliography|tableofcontents|listoffigures|listoftables|maketitle)\b/.test(
      source,
    )
  )
    return false;
  const env = [];
  for (const m of source.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    if (["document", "verbatim", "lstlisting", "minted"].includes(m[2]))
      return false;
    if (m[1] === "begin") env.push(m[2]);
    else if (env.pop() !== m[2]) return false;
  }
  if (env.length) return false;
  let depth = 0;
  for (const ch of source.replace(/\\[{}%]/g, "").replace(/%[^\n]*/g, "")) {
    if (ch === "{") depth++;
    if (ch === "}" && --depth < 0) return false;
  }
  return depth === 0;
}
