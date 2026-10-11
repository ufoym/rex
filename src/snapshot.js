// Binary snapshots avoid JSON-expanding PDFs and project images across the standby gate.
const encoder = new TextEncoder(), decoder = new TextDecoder();
export function packFiles(files) {
  const entries = Object.entries(files).map(([name, data]) => [name, typeof data === 'string' ? encoder.encode(data) : data]);
  const header = encoder.encode(JSON.stringify(entries.map(([name, data]) => [name, data.length])));
  const bytes = new Uint8Array(4 + header.length + entries.reduce((n, [, data]) => n + data.length, 0));
  new DataView(bytes.buffer).setUint32(0, header.length, true);
  bytes.set(header, 4); let offset = 4 + header.length;
  for (const [, data] of entries) { bytes.set(data, offset); offset += data.length; }
  return bytes;
}
export function unpackFiles(bytes) {
  if (bytes.length < 4) throw Error('Truncated file snapshot');
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  if (n > bytes.length - 4) throw Error('Truncated file header');
  const entries = JSON.parse(decoder.decode(bytes.slice(4, 4 + n)));
  const files = {}; let offset = 4 + n;
  for (const [name, length] of entries) {
    if (typeof name !== 'string' || Object.hasOwn(files, name) || !Number.isSafeInteger(length) || length < 0 || length > bytes.length - offset)
      throw Error('Invalid file snapshot');
    Object.defineProperty(files, name, {value: bytes.slice(offset, offset + length), enumerable: true, configurable: true, writable: true});
    offset += length;
  }
  if (offset !== bytes.length) throw Error('Unexpected data after file snapshot');
  return files;
}
export async function digest(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
