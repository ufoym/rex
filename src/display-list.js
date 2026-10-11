const text = new TextDecoder();
export function decodeDisplayList(bytes, fontsOnly = false) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    text.decode(bytes.subarray(0, 4)) !== "RTDL" ||
    v.getUint16(4, true) !== 1
  )
    throw Error("Unsupported display list");
  const dl = { fonts: {}, flags: {}, lines: [], other: [], images_info: {} };
  let pos = 16,
    line = null;
  while (pos < bytes.length) {
    const tag = v.getUint8(pos),
      len = v.getUint32(pos + 1, true),
      end = pos + 5 + len;
    if (fontsOnly && tag !== 2 && tag !== 39) { pos = end; continue; }
    let p = pos + 5;
    const i = () => {
        let n = v.getInt32(p, true);
        p += 4;
        return n;
      },
      u = () => {
        let n = v.getUint32(p, true);
        p += 4;
        return n;
      },
      b = () => v.getUint8(p++),
      str = () => {
        let n = v.getUint16(p, true);
        p += 2;
        let s = text.decode(bytes.subarray(p, p + n));
        p += n;
        return s;
      };
    const add = (x) => (line ? line.items : dl.other).push(x);
    if (tag === 1) {
      [
        dl.width,
        dl.height,
        dl.depth,
        dl.page,
        dl.page_width,
        dl.page_height,
        dl.origin_x,
        dl.inserts,
      ] = Array.from({ length: 8 }, i);
      dl.glyphs = u();
      dl.images = u();
    } else if (tag === 2) {
      let id = u(),
        size = i(),
        kind = b();
      b();
      let subfont = v.getUint16(p, true);
      p += 2;
      dl.fonts[id] = {
        id,
        size,
        kind,
        subfont,
        slant: i(),
        extend: i(),
        squeeze: i(),
        designsize: i(),
        filename: str(),
        psname: str(),
        name: str(),
        fullname: str(),
        format: str(),
      };
    } else if (tag === 3) dl.flags[str()] = i();
    else if (tag === 16) {
      line = {
        par: i(),
        i: i(),
        x: i(),
        y: i(),
        w: i(),
        h: i(),
        d: i(),
        items: [],
      };
      line.gs = v.getFloat64(p, true);
      p += 8;
      line.gsign = b();
      line.gorder = b();
      dl.lines.push(line);
    } else if (tag === 18) {
      line.unit = i();
      line.row = i();
    } else if (tag === 17) line = null;
    else if (tag === 32) {
      const f = u(),
        y = i(),
        exp = i(),
        n = u();
      for (let k = 0; k < n; k++) {
        let c = u(),
          g = u();
        add(["g", f, c, g === 0xffffffff ? null : g, i(), y, i(), exp]);
      }
    } else if (tag === 33) add(["r", i(), i(), i(), i()]);
    else if (tag === 34) {
      let cmd = b();
      b();
      let stack = v.getUint16(p, true);
      p += 2;
      add(["c", stack, cmd, str()]);
    } else if (tag === 35) add(["l", i(), str()]);
    else if (tag === 36) add(["u", str(), str()]);
    else if (tag === 37) add(["m", b() ? "on" : "off", i()]);
    else if (tag === 38) add(["i", i(), i(), i(), i(), i()]);
    else if (tag === 39) {
      let id = u();
      dl.images_info[id] = { page: u(), pages: u(), file: str() };
    } else if (tag === 40) add(["M", ["save", "set", "restore"][b()], i(), i(), str()]);
    pos = end;
    if (tag === 255) break;
  }
  return dl;
}
// Compare live rows against full-pass rows after removing only their page translation.
export function equivalent(live, unit, pages) {
  if (live.lines.length !== unit.placements.length) return false;
  const key = (f) =>
    [
      f.filename || f.name,
      f.size,
      f.slant || 0,
      f.extend || 0,
      f.squeeze || 0,
      f.subfont || 0,
    ].join("|");
  for (let r = 0; r < live.lines.length; r++) {
    const a = live.lines[r],
      place = unit.placements[r],
      page = pages[place.page - 1];
    const b = page.lines.find(
      (l) => l.unit === unit.uid && l.row === place.row,
    );
    if (
      !b ||
      a.w !== b.w ||
      a.h !== b.h ||
      a.d !== b.d ||
      a.items.length !== b.items.length
    )
      return false;
    for (let j = 0; j < a.items.length; j++) {
      let x = a.items[j].slice(),
        y = b.items[j].slice();
      if (x[0] !== y[0]) return false;
      if (x[0] === "g") {
        x[1] = key(live.fonts[x[1]]);
        y[1] = key(page.fonts[y[1]]);
        x[4] -= a.x;
        x[5] -= a.y;
        y[4] -= b.x;
        y[5] -= b.y;
      } else if (x[0] === "r") {
        x[1] -= a.x;
        x[2] -= a.y;
        y[1] -= b.x;
        y[2] -= b.y;
      } else if (x[0] === "m") {
        x[2] -= a.x;
        y[2] -= b.x;
      } else if (x[0] === "i") {
        const identity = info => info && [info.file.replace(/^\/work\//, ""), info.page];
        x[1] = identity(live.images_info[x[1]]); y[1] = identity(page.images_info?.[y[1]]);
        if (!x[1] || !y[1]) return false;
        x[2] -= a.x; x[3] -= a.y; y[2] -= b.x; y[3] -= b.y;
      } else if (x[0] === "M") {
        x[2] -= a.x; x[3] -= a.y; y[2] -= b.x; y[3] -= b.y;
      } else if (!["c"].includes(x[0])) return false;
      if (JSON.stringify(x) !== JSON.stringify(y)) return false;
    }
  }
  return true;
}
