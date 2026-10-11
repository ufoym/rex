import { mailbox, send, encodeRequest } from "./transport.js";
import { decodeDisplayList, equivalent } from "./display-list.js";
import { preamble, paragraphs, changedSpan, safe } from "./document.js";
export class LiveEngine {
  constructor(files, preambleText, aux, onLog) {
    this.worker = new Worker(new URL("./live-worker.js", import.meta.url), {
      type: "module",
    });
    this.box = mailbox();
    this.queue = Promise.resolve();
    this.contexts = new Set();
    this.verified = new Set();
    this.closed = false;
    this.req = 0;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.onmessage = ({ data }) => {
      if (data.type === "log") {
        onLog?.(data.line);
        return;
      }
      if (data.type === "failure" || data.type === "stopped") {
        const e = Error(data.message || "Engine stopped");
        this.rejectReady(e);
        this.reject?.(e);
        return;
      }
      if (data.type !== "frame") return;
      if (data.header.op === "ready") this.resolveReady();
      else if (data.header.op === "fatal") {
        this.reject?.(Error("Engine state changed; waiting for full compilation"));
        this.close();
      } else this.resolve?.(data);
    };
    this.worker.onerror = (e) => {
      this.rejectReady(Error(e.message));
      this.reject?.(Error(e.message));
    };
    this.worker.postMessage({
      files,
      preamble: preambleText,
      aux,
      mailbox: this.box,
    });
  }
  request(message) {
    const job = this.queue
      .then(() => this.ready)
      .then(
        () =>
          new Promise((resolve, reject) => {
            if (this.closed) {
              reject(Error("Engine closed"));
              return;
            }
            const timer = setTimeout(() => {
              reject(Error("Paragraph compilation timed out"));
              this.close();
            }, 5000);
            this.resolve = (data) => {
              clearTimeout(timer);
              resolve(data);
            };
            this.reject = (e) => {
              clearTimeout(timer);
              reject(e);
            };
            try {
              send(
                this.box,
                encodeRequest(message),
              );
            } catch (e) {
              this.reject(e);
            }
          }),
      );
    this.queue = job.catch(() => {});
    return job;
  }
  async compile(unit, source) {
    if (!this.contexts.has(unit.uid)) {
      await this.request({ op: "context", id: unit.uid, ctx: unit });
      this.contexts.add(unit.uid);
    }
    const t = performance.now();
    const data = await this.request({
      op: "compile",
      req: ++this.req,
      ctx: unit.uid,
      source,
    });
    const h = data.header;
    if (
      h.status !== "ok" ||
      h.leaks?.length ||
      h.internal ||
      !data.binary?.length
    )
      throw Error(h.errors?.[0]?.message || "This paragraph requires full compilation");
    const dl = decodeDisplayList(data.binary);
    if (
      Object.keys(dl.flags).length ||
      dl.other.some((i) => !["c", "m"].includes(i[0])) ||
      dl.lines.some((l) =>
        l.items.some((i) => !["g", "r", "m", "c", "i", "M"].includes(i[0])),
      )
    )
      throw Error("This paragraph contains content that requires full compilation");
    return {
      dl,
      fonts: data.fonts,
      assets: data.assets,
      ms: performance.now() - t,
      engineMs: (h.t_tex_us + h.t_traverse_us + h.t_pack_us) / 1000,
      advanced: h.counters,
    };
  }
  close() {
    this.closed = true;
    this.rejectReady(Error("Engine closed"));
    this.reject?.(Error("Engine closed"));
    this.worker.terminate();
  }
}
export class Session {
  constructor(renderer, onStatus, onLog) {
    this.renderer = renderer;
    this.status = onStatus;
    this.log = onLog;
    this.revision = 0;
    this.generation = 0;
    this.projectId = 0;
    this.files = {};
    this.main = "main.tex";
    this.createBackground();
  }
  createBackground() {
    this.background?.terminate();
    this.background = new Worker(
      new URL("./background-worker.js", import.meta.url),
      { type: "module" },
    );
    this.backgroundFailed = false;
    this.background.onmessage = ({ data }) => this.onBackground(data);
    const worker = this.background;
    worker.onerror = e => {
      if (worker !== this.background) return;
      this.backgroundFailed = true;
      this.busy = false;
      this.log(e.message);
      this.status("Engine error · previous preview retained");
    };
  }
  setFiles(files, main = "main.tex") {
    // Each project resets compiler state while retaining immutable engine resources.
    if (this.source !== undefined) {
      if (this.backgroundFailed) this.createBackground();
      else this.background.postMessage({type: "reset"});
    }
    this.projectId++;
    this.busy = false;
    this.wantFull = false;
    this.main = main;
    this.renderer.resetAssets?.();
    this.files = files;
    this.currentSpans = new Map();
    this.source = files[main];
    this.revision++;
    this.warmed = null;
    this.contextDirty = true;
    this.generation++;
    this.live?.close();
    this.live = null;
    this.layout = null;
    this.lastTiming = null;
    this.full();
  }
  full() {
    clearTimeout(this.timer);
    if (this.busy) {
      this.wantFull = true;
      return;
    }
    this.wantFull = false;
    this.busy = true;
    this.standbyReady = false;
    this.status("Typesetting…");
    this.background.postMessage({
      files: { ...this.files, [this.main]: this.source },
      main: this.main,
      revision: this.revision,
      projectId: this.projectId,
      aux: this.layout?.aux,
      options: this.options,
    });
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.full(), 650);
  }
  async onBackground(data) {
    if (data.projectId !== undefined && data.projectId !== this.projectId) return;
    if (data.type === "standby-ready") { this.standbyReady = true; return; }
    if (data.type !== "layout" && data.type !== "failure") return;
    this.busy = false;
    if (data.type === "failure") {
      if (data.revision !== this.revision) { this.schedule(); return; }
      this.log(data.message);
      this.status("Compilation failed · previous preview retained");
      if (this.wantFull) this.full();
      return;
    }
    if (data.revision !== this.revision) {
      this.schedule();
      return;
    }
    this.layout = data;
    const captured = new Map();
    for (const unit of data.capture.units) {
      if (!["par", "heading", "env"].includes(unit.kind) || ["paragraph", "subparagraph", "maketitle"].includes(unit.name)) continue;
      const key = `${unit.file?.replace(/^\/work\//, "")}:${unit.begin_line}`;
      if (!captured.has(key)) captured.set(key, []);
      captured.get(key).push(unit);
    }
    this.layoutFiles = {};
    for (const [file, source] of Object.entries(this.files)) {
      if (!file.endsWith(".tex") || typeof source !== "string") continue;
      try {
        const spans = paragraphs(source, file !== this.main);
        const units = spans.map(span => { const matches = captured.get(`${file}:${span.line}`); return matches?.length === 1 ? matches[0] : null; });
        this.layoutFiles[file] = {spans, units, blocks: units.map((unit, index) => [{unit, source: spans[index].text}])}; this.currentSpans.set(file, spans);
      } catch { /* Independent documents and preamble fragments wait for full compilation. */ }
    }
    this.layoutSpans = this.layoutFiles[this.main]?.spans || [];
    this.units = this.layoutFiles[this.main]?.units || [];
    this.contextDirty = false;
    const generation = ++this.generation;
    this.live?.close();
    this.live = new LiveEngine(
      { ...this.files, [this.main]: this.source },
      preamble(this.source),
      data.aux,
      this.log,
    );
    this.live.ready.catch((e) => {
      if (generation === this.generation) {
        this.log(String(e));
        this.status("Live engine unavailable");
      }
    });
    const aux = new TextDecoder().decode(
      data.aux?.["capture.aux"] || new Uint8Array(),
    );
    const labels = [];
    for (const m of aux.matchAll(
      /\\(newlabel|bibcite)\{([^}]+)\}\{([^\n]*)\}/g,
    ))
      labels.push([(m[1] === "newlabel" ? "r@" : "b@") + m[2], m[3]]);
    this.live
      .request({ op: "labels", labels })
      .catch((e) => this.log(String(e)));
    try {
      await this.renderer.layout(data);
      if (generation !== this.generation) return;
      this.warmed = this.warm(this.live, generation);
      await this.warmed;
      if (data.revision === this.revision)
        this.status(
          `${data.capture.pages} ${data.capture.pages === 1 ? "page" : "pages"} · full compilation ${data.ms.toFixed(0)} ms${data.converged ? "" : " · not yet converged"}`,
        );
    } catch (e) {
      if (generation !== this.generation) return;
      this.log(String(e));
      this.status("Preview failed");
    }
    if (this.wantFull) this.full();
  }
  async warm(live, generation) {
    await live.ready;
    for (const {spans, units} of Object.values(this.layoutFiles)) for (let index = 0; index < units.length; index++) {
      const unit = units[index];
      if (
        !unit ||
        !unit.placements?.some((p) => p.page <= 2) ||
        !safe(spans[index].text)
      )
        continue;
      if (generation !== this.generation) return;
      try {
        await this.verify(live, unit, spans[index].text);
      } catch (e) {
        this.log(String(e));
      }
    }
  }
  async verify(live, unit, source) {
    const layout = this.layout;
    const probe = await live.compile(unit, source);
    if (live !== this.live) return false;
    this.renderer.addFonts(probe.fonts);
    await this.renderer.loadType1(probe.dl);
    if (live !== this.live) return false;
    await this.renderer.loadAssets(probe.dl, probe.assets);
    if (live !== this.live || !equivalent(probe.dl, unit, layout.pages)) return false;
    live.verified.add(unit.uid);
    return true;
  }
  async edit(source, file = this.main) {
    const before = this.files[file];
    if (before === source) return;
    if (file === this.main) this.source = source;
    this.files[file] = source;
    const revision = ++this.revision;
    this.schedule();
    let delta;
    try {
      if (!file.endsWith(".tex") || (file === this.main && preamble(before) !== preamble(source))) {
        this.contextDirty = true;
        this.live?.close();
        this.standbyReady = false;
        this.background.postMessage({type: "prepare", files: {...this.files}, main: this.main, aux: this.layout?.aux, projectId: this.projectId});
        return;
      }
      delta = changedSpan(before, source, file !== this.main, this.currentSpans.get(file));
      if (delta) this.currentSpans.set(file, delta.spans);
    } catch {
      this.contextDirty = true;
      return;
    }
    if (!delta || !safe(delta.next.text)) {
      this.contextDirty = true;
      return;
    }
    if (this.contextDirty || !this.layout || !this.live) return;
    const index = delta.index, mapping = this.layoutFiles[file], live = this.live;
    const block = mapping?.blocks.slice(index, index + delta.removed).flat();
    if (!block?.length || block.some(origin => !origin.unit?.placements?.length)) return;
    mapping.blocks.splice(index, delta.removed, block);
    const unit = {...block[0].unit, origins: block.map(origin => origin.unit.uid),
      placements: block.flatMap(origin => origin.unit.placements)};
    if (
      !unit ||
      !unit.placements?.length
    )
      return;
    const t = performance.now();
    try {
      for (const origin of block) if (!live.verified.has(origin.unit.uid)) {
        if (!await this.verify(live, origin.unit, origin.source))
          throw Error("Paragraph verification failed; waiting for full compilation");
      }
      if (revision !== this.revision || live !== this.live) return;
      const result = await live.compile(unit, delta.next.text);
      if (revision !== this.revision || live !== this.live) return;
      await this.renderer.patch(unit, result.dl, result.fonts, () => revision === this.revision && live === this.live, result.assets);
      const counters = (x) =>
        Object.entries(x || {}).sort((a, b) => a[0].localeCompare(b[0]));
      if (
        JSON.stringify(counters(result.advanced)) !==
        JSON.stringify(counters(unit.advanced))
      )
        this.contextDirty = true;
      if (revision !== this.revision) return;
      this.lastTiming = {
        roundtrip: result.ms,
        engine: result.engineMs,
        paint: performance.now() - t,
      };
      this.status(
        `Live update ${this.lastTiming.paint.toFixed(2)} ms · paragraph compilation ${result.ms.toFixed(2)} ms${delta.provisional || result.dl.lines.length !== unit.placements.length ? " · provisional layout" : ""}${result.dl.inserts ? " · footnote bodies update after full compilation" : ""}`,
      );
    } catch (e) {
      if (revision !== this.revision || live !== this.live) return;
      this.log(String(e));
      this.status("Waiting for full compilation");
    }
  }
}
