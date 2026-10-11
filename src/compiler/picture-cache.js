import { digest, packFiles } from '../protocol/snapshot.js';
import { preamble } from '../core/document.js';
import PDFLib from '../../vendor/pdf-lib.mjs';
const envs = 'tikzpicture|circuitikz|pgfpicture';
// Stateful commands and external inputs cannot be safely replaced with a cached PDF region.
const unsafe = /\\(?:label|ref|pageref|eqref|footnotemark|footnotetext|href|hyperref|hyperlink|hypertarget|url|autoref|cref|Cref|vref|nameref|the|value|arabic|roman|Roman|alph|Alph|fnsymbol|today|newcounter|stepcounter|refstepcounter|addtocounter|setcounter|verb|input|pgfimage|includesvg|includepdf|lstinputlisting|include|footnote|index|marginpar|write|immediate|pgfmathrandom|random|pgfmathsetseed|pdfsavepos|savepos|global|xdef|gdef|savebox|sbox|pgfdeclarelayer|newbox|newsavebox|usebox|setbox|catcode|makeatletter|makeatother|ExplSyntaxOn|obeylines|obeyspaces|scantokens|lstinline|mintinline|Verb|directlua|luaexec|luadirect|if|else|fi|loop|csname|expandafter)\b|\\(?:cite|footcite|includegraphics|pgfplotstable)|\\the(?!ta\b|refore\b)[A-Za-z]+|remember\s+picture|overlay|trim (?:axis|left|right)|legend to name|\b(?:table|file)\s*[\[{]|\\begin\{(?:verbatim|lstlisting|minted|luacode\*?)\}/;
export function stripComments(text) { return text.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gm, m => m.slice(0, m.indexOf('%'))); }
export async function scanPictures(files, main) {
  const text = stripComments(files[main]), pre = preamble(text);
  // Hash complete dependency files: edits to inputs, local classes, images and data invalidate entries.
  const dependencies = await digest(packFiles({...files, [main]: pre}));
  const disabled = Object.values(files).some(x => typeof x === 'string' && /remember\s+picture/.test(stripComments(x))) || unsafe.test(pre) ||
    Object.entries(files).some(([name, x]) => name !== main && /\.(sty|cls|tex)$/.test(name) && typeof x === 'string' && unsafe.test(stripComments(x)));
  const pictures = [], visits = new Map();
  let prefix = '', statementDepth = 0;
  async function walk(name, startLine = 0, stack = []) {
    if (stack.includes(name) || stack.length > 8 || typeof files[name] !== 'string') return;
    visits.set(name, (visits.get(name) || 0) + 1);
    const lines = stripComments(files[name]).split('\n');
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(new RegExp('^\\s*\\\\begin\\{(' + envs + ')\\}'));
      if (!m) {
        if (line.includes('\\') || statementDepth > 0) {
          prefix += line + '\n';
          for (const c of line.replace(/\\[{}]/g, '')) { if (c === '{') statementDepth++; if (c === '}') statementDepth--; }
          statementDepth = Math.max(0, statementDepth);
        }
        for (const input of line.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) {
          const target = input[1].endsWith('.tex') ? input[1] : input[1] + '.tex';
          const relative = name.split('/').slice(0, -1).concat(target).join('/');
          await walk(Object.hasOwn(files, target) ? target : relative, 0, [...stack, name]);
        }
        continue;
      }
      const env = m[1]; let j = i, nesting = 0;
      for (; j < lines.length; j++) {
        nesting += (lines[j].match(new RegExp('\\\\begin\\{' + env + '\\}', 'g')) || []).length;
        nesting -= (lines[j].match(new RegExp('\\\\end\\{' + env + '\\}', 'g')) || []).length;
        if (nesting === 0) break;
      }
      if (j === lines.length) break;
      const source = lines.slice(i, j + 1).join('\n');
      let depth = 0, balanced = true;
      for (const c of source.replace(/\\[{}]/g, '')) { if (c === '{') depth++; if (c === '}' && --depth < 0) balanced = false; }
      const inheritedUnsafe = unsafe.test(prefix.replace(/\\(?:input|include)\s*\{[^}]+\}/g, ''));
      pictures.push({key: '/work/' + name + ':' + (i + 1), file: name, env, end_line: j + 1,
        hash: await digest(dependencies + '\0' + prefix + '\0' + source),
        cacheable: !disabled && !inheritedUnsafe && !unsafe.test(source) && balanced && depth === 0 && nesting === 0 &&
          (source.match(new RegExp('\\\\begin\\{' + env + '\\}', 'g')) || []).length === 1});
      i = j;
    }
  }
  await walk(main, pre.split('\n').length - 1);
  // A repeated source has ambiguous file:line keys. Macro executions likewise lack unique source lines.
  for (const p of pictures) if (visits.get(p.file) > 1) p.cacheable = false;
  return pictures;
}
export class PictureCache {
  constructor() { this.entries = new Map(); this.pdfs = new Map(); this.bad = new Map(); this.serial = 0; this.nextPDF = 0; }
  manifest(pictures) {
    this.serial++;
    const manifest = {}, files = {};
    for (const p of pictures) {
      const e = this.entries.get(p.hash);
      if (!p.cacheable || !e || this.bad.has(p.key)) continue;
      e.used = this.serial;
      manifest[p.key] = {...e, end_line: p.end_line};
      files[e.pdf.replace('/work/', '')] = this.pdfs.get(e.pdf);
    }
    files['pic-manifest.json'] = JSON.stringify(manifest);
    return {files, hits: Object.keys(manifest).length};
  }
  async absorb(pictures, output) {
    for (const [key, until] of this.bad) if (until < this.serial) this.bad.delete(key);
    for (const key of output.capture.pic_mismatch || []) {
      const p = pictures.find(p => p.key === key);
      if (p) this.entries.delete(p.hash);
      this.bad.set(key, this.serial + 4);
    }
    const fresh = pictures.filter(p => p.cacheable && !this.bad.has(p.key)).map(p => [p, output.capture.pics?.[p.key]])
      .filter(([p, r]) => r && r.env === p.env && r.w > 0 && r.h + r.d > 0 && this.entries.get(p.hash)?.state !== r.state);
    if (fresh.length) {
      const pages = [...new Set(fresh.map(([, r]) => r.page))].sort((a, b) => a - b);
      const src = await PDFLib.PDFDocument.load(output.pdf), doc = await PDFLib.PDFDocument.create();
      for (const page of await doc.copyPages(src, pages.map(p => p - 1))) doc.addPage(page);
      const pdf = '/work/pic-cache/p' + (++this.nextPDF) + '.pdf';
      this.pdfs.set(pdf, await doc.save({useObjectStreams: false}));
      // Include a 1 pt border so PDF clipping does not cut off stroke antialiasing at the box edge.
      const padding = 65536;
      for (const [p, r] of fresh) this.entries.set(p.hash, {env: p.env, state: r.state, pdf, padding,
        page: pages.indexOf(r.page) + 1, bbox: [r.x - padding, r.page_height - r.y - r.d - padding,
          r.x + r.w + padding, r.page_height - r.y + r.h + padding],
        w: r.w, h: r.h, d: r.d, used: this.serial});
    }
    for (const [hash, e] of this.entries) if (e.used + 4 < this.serial) this.entries.delete(hash);
    const wanted = new Set([...this.entries.values()].map(e => e.pdf));
    for (const name of this.pdfs.keys()) if (!wanted.has(name)) this.pdfs.delete(name);
    // A bounded cache also protects long sessions with very large imported diagrams.
    while ([...this.pdfs.values()].reduce((n, p) => n + p.length, 0) > 64 * 1024 * 1024) {
      const name = this.pdfs.keys().next().value; this.pdfs.delete(name);
      for (const [hash, e] of this.entries) if (e.pdf === name) this.entries.delete(hash);
    }
    return fresh.length;
  }
}
