import test from "node:test";
import assert from "node:assert/strict";
import { wireDevices, mailbox, decodeFrame } from "../../src/protocol/transport.js";

test("response framing survives split prefixes, large payloads and coalesced frames", () => {
  const json = new TextEncoder().encode(JSON.stringify({op: "result", status: "ok"}));
  const payload = Uint8Array.from({length: 100000}, (_, i) => i % 251);
  const frame = new Uint8Array(5 + json.length + payload.length);
  frame[0] = 1;
  new DataView(frame.buffer).setUint32(1, json.length, true);
  frame.set(json, 5); frame.set(payload, 5 + json.length);
  const wire = new Uint8Array((frame.length + 4) * 3);
  for (let i = 0; i < 3; i++) {
    const at = i * (frame.length + 4);
    new DataView(wire.buffer).setUint32(at, frame.length, true);
    wire.set(frame, at + 4);
  }
  for (const size of [1, 3, 4096, wire.length]) {
    const devices = [], received = [];
    wireDevices({FS: {makedev: (_major, minor) => minor,
      registerDevice: (id, device) => {devices[id] = device;}, mkdev() {}}},
      mailbox(), bytes => received.push(decodeFrame(bytes)));
    // Nonzero source offsets also occur in Emscripten's linear memory.
    const memory = new Uint8Array(wire.length + 19); memory.set(wire, 19);
    for (let at = 0; at < wire.length; at += size) {
      const count = Math.min(size, wire.length - at);
      assert.equal(devices[1].write(null, memory, at + 19, count), count);
    }
    assert.equal(received.length, 3);
    for (const response of received) {
      assert.deepEqual(response.header, {op: "result", status: "ok"});
      assert.deepEqual(response.binary, payload);
    }
    assert.notEqual(received[0].binary.buffer, received[1].binary.buffer);
  }
});
