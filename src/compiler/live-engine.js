import { mailbox, send, encodeRequest, CAPACITY } from "../protocol/transport.js";
import { decodeDisplayList } from "../protocol/display-list.js";
import { moduleWorker } from "../protocol/worker.js";

export class LiveEngine {
  constructor(files, preambleText, aux, onLog, resources) {
    this.worker = moduleWorker(new URL("../workers/live-worker.js", import.meta.url));
    this.box = globalThis.rexLocal ? null : mailbox();
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
      resources,
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
            // Cold CJK font processing can exceed five seconds on slower CPUs.
            const timer = setTimeout(() => {
              reject(Error("Paragraph compilation timed out"));
              this.close();
            }, message.op === "compile" ? 30000 : 5000);
            this.resolve = (data) => {
              clearTimeout(timer);
              resolve(data);
            };
            this.reject = (e) => {
              clearTimeout(timer);
              reject(e);
            };
            try {
              const bytes = encodeRequest(message);
              if (this.box) send(this.box, bytes);
              else {
                if (bytes.length > CAPACITY) throw Error("Paragraph exceeds 2 MiB; waiting for full compilation");
                this.worker.postMessage({type: "request", bytes}, [bytes.buffer]);
              }
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
