import * as opentype from "../../vendor/opentype.js";
import * as pdfjs from "../../vendor/pdfjs/pdf.mjs";
import { moduleWorker } from "../protocol/worker.js";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "../../vendor/pdfjs/pdf.worker.mjs",
  import.meta.url,
).href;
if (globalThis.rexLocal)
  pdfjs.GlobalWorkerOptions.workerPort = moduleWorker(pdfjs.GlobalWorkerOptions.workerSrc);
const SP = (65536 * 72.27) / 96;
export class Renderer {
  constructor(container) {
    this.container = container;
    this.fonts = new Map();
    this.fontBytes = new Map();
    this.type1 = new Map();
    this.paths = new WeakMap();
    this.views = new Map();
    this.epoch = 0;
    this.pdf = null;
    this.patches = new Map();
    this.baseInk = new Map();
    this.assets = new Map();
    this.images = new Map();
    this.assetEpoch = 0;
    this.resizeObserver = new ResizeObserver(() => this.fitPages());
    this.resizeObserver.observe(container);
    container.addEventListener("dblclick", event => {
      const host = event.target.closest(".page");
      if (!host || !this.capture) return;
      const page = this.pages[Number(host.dataset.page) - 1], rect = host.getBoundingClientRect();
      const x = (event.clientX - rect.left) * page.page_width / rect.width;
      const y = (event.clientY - rect.top) * page.page_height / rect.height;
      let nearest, distance = Infinity;
      for (const line of page.lines) {
        if (!line.unit) continue;
        const dx = Math.max(line.x - x, 0, x - line.x - line.w), dy = Math.max(line.y - line.h - y, 0, y - line.y - line.d);
        if (dx * dx + dy * dy < distance) { distance = dx * dx + dy * dy; nearest = line; }
      }
      if (nearest) this.onSource?.(this.capture.units.find(unit => unit.uid === nearest.unit));
    });
  }
  resetAssets() {
    this.epoch++;
    this.patches.clear(); this.baseInk.clear();
    this.assetEpoch++;
    for (const image of this.images.values()) image.then(value => value.close?.()).catch(() => {});
    this.assets.clear(); this.images.clear();
  }
  async loadAssets(dl, assets) {
    const epoch = this.assetEpoch;
    for (const [file, bytes] of Object.entries(assets || {})) {
      const old = this.assets.get(file);
      if (old && (old.length !== bytes.length || bytes.some((byte, i) => byte !== old[i])))
        for (const [key, image] of this.images) if (key.startsWith(file + ':')) {
          image.then(value => value.close?.()).catch(() => {}); this.images.delete(key);
        }
      this.assets.set(file, bytes);
    }
    for (const info of Object.values(dl.images_info || {})) {
      const key = `${info.file}:${info.page}`;
      if (!this.images.has(key)) this.images.set(key, (async () => {
        const bytes = this.assets.get(info.file);
        if (!bytes) throw Error("Missing image " + info.file);
        if (new TextDecoder().decode(bytes.subarray(0, 4)) === "%PDF") {
          const pdf = await pdfjs.getDocument({data: bytes.slice(), isEvalSupported: false}).promise;
          try {
            const page = await pdf.getPage(info.page), viewport = page.getViewport({scale: 2 * 96 / 72 * (devicePixelRatio || 1)});
            const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await page.render({canvasContext: canvas.getContext("2d"), viewport}).promise;
            return canvas;
          } finally { await pdf.destroy(); }
        }
        return createImageBitmap(new Blob([bytes]));
      })());
      const pending = this.images.get(key);
      let bitmap;
      try { bitmap = await pending; }
      catch (error) { if (this.images.get(key) === pending) this.images.delete(key); throw error; }
      if (epoch !== this.assetEpoch) return;
      info.bitmap = bitmap;
    }
  }
  addFonts(fonts) {
    for (const [name, data] of Object.entries(fonts || {})) {
      const old = this.fontBytes.get(name);
      if (old && old.length === data.length && old.every((byte, i) => byte === data[i])) continue;
      this.fonts.delete(name);
      this.fontBytes.delete(name);
      try {
        this.fonts.set(name, opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
        this.fontBytes.set(name, data);
      } catch {}
    }
  }
  glyphPath(font, glyph) {
    let paths = this.paths.get(font);
    if (!paths) { paths = new Map(); this.paths.set(font, paths); }
    const key = typeof glyph === "number" ? glyph : glyph.index;
    if (!paths.has(key)) {
      if (typeof glyph === "number") paths.set(key, new Path2D(font.glyphs[glyph] || ""));
      else {
        const path = new Path2D();
        for (const command of glyph.getPath(0, 0, font.unitsPerEm).commands) {
          if (command.type === "M") path.moveTo(command.x, command.y);
          else if (command.type === "L") path.lineTo(command.x, command.y);
          else if (command.type === "Q") path.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
          else if (command.type === "C") path.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
          else if (command.type === "Z") path.closePath();
        }
        paths.set(key, path);
      }
    }
    return paths.get(key);
  }
  async loadType1(dl) {
    for (const f of Object.values(dl.fonts || {}))
      if (!f.filename && !this.type1.has(f.name)) {
        if (globalThis.rexLocal) {
          const font = globalThis.rexLocal.type1[f.name];
          if (!font) throw Error("Missing packaged font: " + f.name);
          this.type1.set(f.name, font);
          continue;
        }
        const response = await fetch(
          new URL("../../vendor/type1/" + encodeURIComponent(f.name) + ".json", import.meta.url),
        );
        if (!response.ok) throw Error("Font cannot be rendered live: " + f.name);
        this.type1.set(f.name, await response.json());
      }
  }
  async layout(data) {
    const epoch = ++this.epoch;
    this.addFonts(data.fonts);
    const pdf = await pdfjs.getDocument({
      data: data.pdf.slice(),
      disableFontFace: false,
      isEvalSupported: false,
    }).promise;
    if (epoch !== this.epoch) { await pdf.destroy(); return; }
    const previous = this.pdf;
    this.pdf = pdf; this.pages = data.pages; this.capture = data.capture;
    this.patches.clear(); this.baseInk.clear();
    await previous?.destroy();
    if (epoch !== this.epoch) return;
    this.container.replaceChildren();
    this.views.clear();
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            this.renderPage(Number(entry.target.dataset.page));
      },
      { rootMargin: "1000px" },
    );
    for (let n = 1; n <= this.pdf.numPages; n++) {
      const dl = data.pages[n - 1],
        host = document.createElement("div");
      host.className = "page";
      host.dataset.page = n;
      host.style.width = dl.page_width / SP + "px";
      host.style.height = dl.page_height / SP + "px";
      const canvas = document.createElement("canvas");
      host.append(canvas);
      this.container.append(host);
      this.views.set(n, { host, canvas, ready: false });
      this.observer.observe(host);
    }
    this.fitPages();
    await this.renderPage(1);
    return this.pdf.numPages;
  }
  fitPages() {
    const style = getComputedStyle(this.container);
    const width = this.container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (width <= 0) return;
    for (const {host} of this.views.values()) host.style.zoom = Math.min(1, width / parseFloat(host.style.width));
  }
  async renderPage(n) {
    const v = this.views.get(n);
    if (!v || v.ready || v.loading) return;
    v.loading = true;
    const epoch = this.epoch;
    try {
      const page = await this.pdf.getPage(n);
      const viewport = page.getViewport({ scale: 96 / 72 });
      const dpr = devicePixelRatio || 1;
      const base = document.createElement("canvas");
      base.width = Math.ceil(viewport.width * dpr);
      base.height = Math.ceil(viewport.height * dpr);
      await page.render({
        canvasContext: base.getContext("2d"),
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      }).promise;
      if (epoch !== this.epoch) return;
      v.base = base;
      v.canvas.width = base.width;
      v.canvas.height = base.height;
      v.canvas.style.width = viewport.width + "px";
      v.canvas.style.height = viewport.height + "px";
      v.ready = true;
      this.repaint(n);
    } finally {
      v.loading = false;
    }
  }
  repaint(n, dirty) {
    const v = this.views.get(n);
    if (!v?.ready) return;
    const ctx = v.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dirty) {
      const dpr = devicePixelRatio || 1;
      const x = Math.max(0, Math.floor(dirty.x * dpr)), y = Math.max(0, Math.floor(dirty.y * dpr));
      const w = Math.min(v.base.width, Math.ceil((dirty.x + dirty.w) * dpr)) - x,
        h = Math.min(v.base.height, Math.ceil((dirty.y + dirty.h) * dpr)) - y;
      if (w <= 0 || h <= 0) return;
      ctx.drawImage(v.base, x, y, w, h, x, y, w, h);
    } else ctx.drawImage(v.base, 0, 0);
    ctx.save();
    ctx.scale(devicePixelRatio || 1, devicePixelRatio || 1);
    if (dirty) { ctx.beginPath(); ctx.rect(dirty.x, dirty.y, dirty.w, dirty.h); ctx.clip(); }
    // Clear all affected rows before drawing, including new provisional rows.
    for (const {erase, ink} of this.patches.values()) {
      for (const place of [...erase, ...ink]) {
        if (place.page !== n) continue;
        ctx.fillStyle = "white";
        ctx.fillRect(
          (place.x - 65536) / SP,
          (place.y - place.h - 65536) / SP,
          (place.w + 131072) / SP,
          (place.h + place.d + 131072) / SP,
        );
      }
    }
    for (const { dl, placements } of this.patches.values()) {
      const state = { stacks: new Map(), color: "#000" };
      this.drawItems(null, dl.other || [], dl.fonts, 0, 0, state);
      dl.lines.forEach((line, i) => {
        const place = placements[i];
        this.drawItems(
          place?.page === n ? ctx : null,
          line.items,
          dl.fonts,
          place ? (place.x - line.x) / SP : 0,
          place ? (place.y - line.y) / SP : 0,
          state, dl.images_info,
        );
      });
    }
    ctx.restore();
  }
  drawItems(ctx, items, fonts, dx, dy, state, images = {}) {
    let base = ctx?.getTransform(), glyphTransform = false;
    for (const item of items) {
      if (item[0] === "c") {
        const stackId = item[1],
          cmd = item[2],
          s = item[3] || "";
        const rgb = s.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/),
          gray = s.match(/([\d.]+)\s+g/),
          cmyk = s.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+k/);
        let color = "#000";
        if (rgb)
          color =
            "rgb(" +
            rgb
              .slice(1)
              .map((x) => Number(x) * 255)
              .join(",") +
            ")";
        else if (gray)
          color =
            "rgb(" + [1, 2, 3].map(() => Number(gray[1]) * 255).join(",") + ")";
        else if (cmyk) {
          const [c, m, y, k] = cmyk.slice(1).map(Number);
          color =
            "rgb(" +
            [c, m, y].map((x) => 255 * (1 - x) * (1 - k)).join(",") +
            ")";
        }
        const stack = state.stacks.get(stackId) || ["#000"];
        state.stacks.set(stackId, stack);
        if (cmd === 1) stack.push(color);
        else if (cmd === 2) stack.pop();
        else if (cmd === 0) stack[stack.length - 1] = color;
        state.color = stack.at(-1) || "#000";
        continue;
      }
      if (!ctx) continue;
      if (item[0] !== "g" && glyphTransform) {
        ctx.setTransform(base);
        glyphTransform = false;
      }
      ctx.fillStyle = state.color;
      if (item[0] === "M") {
        const [, operation, x, y, values] = item;
        if (operation === "save") ctx.save();
        else if (operation === "restore") ctx.restore();
        else {
          const [a, b, c, d] = values.trim().split(/\s+/).map(Number);
          ctx.translate(x / SP + dx, y / SP + dy); ctx.transform(a, -b, -c, d, 0, 0); ctx.translate(-x / SP - dx, -y / SP - dy);
        }
        base = ctx.getTransform();
      } else if (item[0] === "i") {
        ctx.drawImage(images[item[1]].bitmap, item[2] / SP + dx, item[3] / SP + dy, item[4] / SP, item[5] / SP);
      } else if (item[0] === "g") {
        const [, id, char, index, x, y, , exp] = item,
          f = fonts[id],
          font = this.fonts.get(f.filename);
        let path, scale, sy;
        if (font) {
          const glyph =
            index === null
              ? font.charToGlyph(String.fromCodePoint(char))
              : font.glyphs.get(index);
          scale = sy = f.size / SP / font.unitsPerEm;
          path = this.glyphPath(font, glyph);
        } else {
          const outline = this.type1.get(f.name);
          if (!outline) throw Error("Missing font " + f.name);
          if (!outline.glyphs[char]) continue;
          scale = f.size / SP / outline.unitsPerEm; sy = -scale;
          path = this.glyphPath(outline, char);
        }
        const sx = (1 + exp / 1e6) * (f.extend ? f.extend / 1000 : 1) * scale,
          skew = -(f.slant || 0) / 1000 * sy, px = x / SP + dx, py = y / SP + dy;
        // Compose the glyph matrix directly. Keep the document matrix separately
        // so a run needs no per-glyph Canvas save/translate/scale/restore stack.
        ctx.setTransform(base.a * sx, base.b * sx, base.a * skew + base.c * sy,
          base.b * skew + base.d * sy, base.a * px + base.c * py + base.e,
          base.b * px + base.d * py + base.f);
        ctx.fill(path);
        glyphTransform = true;
      } else if (item[0] === "r") {
        ctx.fillRect(
          item[1] / SP + dx,
          item[2] / SP + dy,
          item[3] / SP,
          item[4] / SP,
        );
      } else if (!["m"].includes(item[0]))
        throw Error("This paragraph contains graphics that require full compilation");
    }
    if (glyphTransform) ctx.setTransform(base);
  }
  inkBounds(line, place) {
    let left = line.x, right = line.x + line.w;
    for (const item of line.items) if (item[0] === "g") {
      left = Math.min(left, item[4]); right = Math.max(right, item[4] + item[6]);
    }
    return {...place, x: place.x + left - line.x, w: right - left};
  }
  async patch(unit, dl, fonts, isCurrent = () => true, assets) {
    this.addFonts(fonts);
    await this.loadType1(dl);
    await this.loadAssets(dl, assets);
    if (!isCurrent()) return;
    const exact = dl.lines.length === unit.placements.length && dl.lines.every((line, i) => line.h === unit.placements[i].h && line.d === unit.placements[i].d);
    const placements = exact ? unit.placements.map((place, i) => ({...place, w: dl.lines[i].w})) : dl.lines.map((line, i) => {
      const old = unit.placements[Math.min(i, unit.placements.length - 1)];
      const anchorIndex = unit.placements.findIndex(place => place.page === old.page), anchor = unit.placements[anchorIndex];
      return {...old, x: anchor.x + line.x - dl.lines[anchorIndex].x,
        y: anchor.y + line.y - dl.lines[anchorIndex].y, w: line.w, h: line.h, d: line.d};
    });
    const ink = placements.map((place, i) => this.inkBounds(dl.lines[i], place)), previous = [], erase = [];
    for (const uid of unit.origins || [unit.uid]) {
      if (!this.baseInk.has(uid)) {
        const original = this.capture.units.find(value => value.uid === uid);
        this.baseInk.set(uid, original.placements.map(place => {
          const line = this.pages[place.page - 1].lines.find(value => value.unit === uid && value.row === place.row);
          return this.inkBounds(line, place);
        }));
      }
      erase.push(...this.baseInk.get(uid));
      const patch = this.patches.get(uid);
      if (patch) previous.push(...patch.erase, ...patch.ink);
      this.patches.delete(uid);
    }
    this.patches.set(unit.uid, { unit, dl, placements, ink, erase });
    const affected = [...erase, ...ink, ...previous];
    for (const n of new Set(affected.map((p) => p.page))) {
      await this.renderPage(n);
      if (!isCurrent()) return;
      const rows = affected.filter(place => place.page === n);
      const x = Math.min(...rows.map(p => p.x)) - 65536, y = Math.min(...rows.map(p => p.y - p.h)) - 65536;
      this.repaint(n, {x: x / SP, y: y / SP, w: (Math.max(...rows.map(p => p.x + p.w)) + 65536 - x) / SP,
        h: (Math.max(...rows.map(p => p.y + p.d)) + 65536 - y) / SP});
    }
  }
  locate(unit) {
    const place = unit.placements?.[0], view = place && this.views.get(place.page);
    if (!view) return;
    this.container.querySelector(".source-marker")?.remove();
    const marker = document.createElement("div"); marker.className = "source-marker";
    const padding = 4 * SP;
    Object.assign(marker.style, {left: (place.x - padding) / SP + "px", top: (place.y - place.h - padding) / SP + "px",
      width: (place.w + 2 * padding) / SP + "px", height: (place.h + place.d + 2 * padding) / SP + "px"});
    view.host.append(marker);
    marker.scrollIntoView({block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
  }
}
