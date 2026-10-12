// One bounded request mailbox. Engine stdin sleeps in its Worker; UI never blocks.
export const CAPACITY = 2 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder();
export function encodeRequest(message) {
  if (message.op !== "compile") return encoder.encode(JSON.stringify(message) + "\n");
  const source = encoder.encode(message.source), header = encoder.encode(`C ${message.req} ${message.ctx} ${source.length}\n`);
  const bytes = new Uint8Array(header.length + source.length);
  bytes.set(header); bytes.set(source, header.length);
  return bytes;
}
export function mailbox() {
  return new SharedArrayBuffer(CAPACITY + 8);
}
export function send(buffer, bytes) {
  const state = new Int32Array(buffer, 0, 2);
  if (bytes.length > CAPACITY) throw Error("Paragraph exceeds 2 MiB; waiting for full compilation");
  if (Atomics.load(state, 0) !== 0) throw Error("Engine is still processing the previous request");
  new Uint8Array(buffer, 8, bytes.length).set(bytes);
  Atomics.store(state, 1, bytes.length);
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
}
export function wireDevices(M, buffer, onFrame) {
  const FS = M.FS;
  const state = typeof buffer === "function" ? null : new Int32Array(buffer, 0, 2);
  const readChunk = typeof buffer === "function" ? buffer : () => {
    while (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0);
    const bytes = new Uint8Array(buffer, 8, Atomics.load(state, 1)).slice();
    Atomics.store(state, 0, 0);
    Atomics.notify(state, 0);
    return bytes;
  };
  let chunk = new Uint8Array(),
    offset = 0;
  const lengthBytes = new Uint8Array(4), lengthView = new DataView(lengthBytes.buffer);
  let lengthUsed = 0, frame, frameUsed = 0;
  const input = {
    open: (s) => {
      s.seekable = false;
    },
    read(_s, dst, start, n) {
      if (offset === chunk.length) {
        chunk = readChunk();
        offset = 0;
      }
      const count = Math.min(n, chunk.length - offset);
      dst.set(chunk.subarray(offset, offset + count), start);
      offset += count;
      return count;
    },
  };
  FS.registerDevice(FS.makedev(80, 0), input);
  FS.mkdev("/rex-input", FS.makedev(80, 0));
  FS.registerDevice(FS.makedev(80, 1), {
    open: (s) => {
      s.seekable = false;
    },
    write(_s, src, start, n) {
      const end = start + n;
      while (start < end) {
        if (!frame) {
          const count = Math.min(4 - lengthUsed, end - start);
          lengthBytes.set(src.subarray(start, start + count), lengthUsed);
          lengthUsed += count; start += count;
          if (lengthUsed < 4) break;
          frame = new Uint8Array(lengthView.getUint32(0, true));
          lengthUsed = 0; frameUsed = 0;
        }
        const count = Math.min(frame.length - frameUsed, end - start);
        frame.set(src.subarray(start, start + count), frameUsed);
        frameUsed += count; start += count;
        if (frameUsed === frame.length) {
          const complete = frame;
          frame = undefined;
          onFrame(complete);
        }
      }
      return n;
    },
  });
  FS.mkdev("/rex-output", FS.makedev(80, 1));
}
export function decodeFrame(bytes) {
  if (bytes[0] === 0)
    return { header: JSON.parse(decoder.decode(bytes.subarray(1))) };
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(1, true);
  return {
    header: JSON.parse(decoder.decode(bytes.subarray(5, 5 + len))),
    binary: bytes.subarray(5 + len),
  };
}
