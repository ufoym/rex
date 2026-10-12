import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { LiveEngine } from "../../src/compiler/live-engine.js";

test("slow paragraph compilation survives five seconds and still has a bounded timeout", async t => {
  t.mock.timers.enable({apis: ["setTimeout"]});
  const originalWorker = globalThis.Worker;
  t.after(() => {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  });
  globalThis.Worker = class {
    postMessage() { queueMicrotask(() => this.onmessage({data: {type: "frame", header: {op: "ready"}}})); }
    terminate() {}
  };
  const live = new LiveEngine({}, "", {}, () => {});
  try {
    const pending = live.request({op: "compile", req: 1, ctx: 1, source: "中文"});
    pending.catch(() => {});
    await setImmediate();
    t.mock.timers.tick(6000);
    assert.equal(live.closed, false, "Cold CJK compilation must not close the live engine after five seconds");
    live.worker.onmessage({data: {type: "frame", header: {op: "result", req: 1, status: "ok"}}});
    assert.equal((await pending).header.status, "ok");

    Atomics.store(new Int32Array(live.box, 0, 2), 0, 0);
    const stalled = live.request({op: "compile", req: 2, ctx: 1, source: "中文"});
    const rejected = assert.rejects(stalled, /Paragraph compilation timed out/);
    await setImmediate();
    t.mock.timers.tick(30000);
    await rejected;
    assert.equal(live.closed, true);
  } finally { live.close(); }
});
