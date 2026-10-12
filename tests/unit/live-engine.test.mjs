import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { LiveEngine } from "../../src/compiler/live-engine.js";
import { encodeRequest, CAPACITY } from "../../src/protocol/transport.js";

test("local requests use messages without shared memory and retain the paragraph size limit", async t => {
  const previousWorker = globalThis.Worker, previousLocal = globalThis.rexLocal;
  t.after(() => {
    if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;
    if (previousLocal === undefined) delete globalThis.rexLocal; else globalThis.rexLocal = previousLocal;
  });
  const path = new URL("../../src/workers/live-worker.js", import.meta.url).pathname, sent = [];
  globalThis.rexLocal = {workers: {[path]: {source: "// packaged worker"}}};
  globalThis.Worker = class {
    addEventListener() {}
    postMessage(data, transfers) {
      if (data.type === "request") {
        sent.push(data.bytes);
        assert.deepEqual(transfers, [data.bytes.buffer]);
      }
      queueMicrotask(() => this.onmessage({data: {type: "frame", header: {op: data.type === "request" ? "result" : "ready"}}}));
    }
    terminate() {}
  };
  const live = new LiveEngine({}, "", {}, () => {});
  try {
    assert.equal(live.box, null);
    const request = {op: "compile", req: 1, ctx: 2, source: "你好\n$E=mc^2$"};
    await live.request(request);
    assert.deepEqual(sent[0], encodeRequest(request));
    await assert.rejects(live.request({...request, source: "a".repeat(CAPACITY)}), /exceeds 2 MiB/);
    assert.equal(sent.length, 1);
  } finally { live.close(); }
});

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
