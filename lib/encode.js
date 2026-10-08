// Dependency-free encoders for exports: ZIP (stored), animated GIF, APNG and animated WebP.
// GIF works from raw RGBA frames anywhere; APNG and WebP repackage still PNG/WebP frames
// (e.g. from canvas.toBlob in the browser) into one animated file.

// ---------- CRC32 / bytes ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
const enc = new TextEncoder();
const toBytes = (d) => (typeof d === "string" ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));
function concat(chunks) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const u16le = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const u32le = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const u24le = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);
const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16be = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);

// ---------- ZIP (no compression; fine for SVG/JSON and already-compressed images) ----------
export function zip(files) {
  const local = [], central = [];
  let offset = 0;
  const date = new Date();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = toBytes(f.data), crc = crc32(data);
    const head = concat([u32le(0x04034b50), u16le(20), u16le(0x0800), u16le(0), u16le(dosTime), u16le(dosDate), u32le(crc), u32le(data.length), u32le(data.length), u16le(name.length), u16le(0), name]);
    local.push(head, data);
    central.push(concat([u32le(0x02014b50), u16le(20), u16le(20), u16le(0x0800), u16le(0), u16le(dosTime), u16le(dosDate), u32le(crc), u32le(data.length), u32le(data.length), u16le(name.length), u16le(0), u16le(0), u16le(0), u16le(0), u32le(0), u32le(offset), name]));
    offset += head.length + data.length;
  }
  const cd = concat(central);
  return concat([...local, cd, u32le(0x06054b50), u16le(0), u16le(0), u16le(files.length), u16le(files.length), u32le(cd.length), u32le(offset), u16le(0)]);
}

// ---------- GIF ----------
// Icons are one colour with antialiased edges, so each frame is reduced to coverage (alpha) and mapped
// onto a 255-step ramp from the background (or matte) to the icon colour. Index 0 is transparent.
function lzw(indices, minSize) {
  const out = [minSize];
  let block = [], cur = 0, bits = 0;
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1, table = new Map();
  const emit = (code) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { block.push(cur & 255); cur >>>= 8; bits -= 8; if (block.length === 255) { out.push(255, ...block); block = []; } }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); table = new Map(); size = minSize + 1; next = eoi + 1; }
    else { if (next >= 1 << size) size++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) { block.push(cur & 255); }
  if (block.length) out.push(block.length, ...block);
  out.push(0);
  return new Uint8Array(out);
}

// frames: [{ rgba: Uint8ClampedArray, delayMs }], color/background: "#rrggbb"; background null = transparent.
export function encodeGif(frames, w, h, { color = "#000000", background = null, matte = "#ffffff", loop = true } = {}) {
  const hex = (c) => { const v = c.replace("#", ""); const f = v.length === 3 ? v.split("").map((x) => x + x).join("") : v; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
  const fg = hex(color), bg = hex(background || matte);
  const palette = new Uint8Array(256 * 3);
  for (let i = 1; i < 256; i++) {
    const t = (i - 1) / 254;
    for (let c = 0; c < 3; c++) palette[i * 3 + c] = Math.round(bg[c] + (fg[c] - bg[c]) * t);
  }
  palette.set(bg, 0);
  const transparent = !background;
  const parts = [enc.encode("GIF89a"), u16le(w), u16le(h), new Uint8Array([0xf7, 0, 0]), palette];
  if (loop) parts.push(new Uint8Array([0x21, 0xff, 0x0b]), enc.encode("NETSCAPE2.0"), new Uint8Array([3, 1, 0, 0, 0]));
  for (const f of frames) {
    const idx = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const a = f.rgba[p * 4 + 3] / 255;
      idx[p] = transparent && a < 0.12 ? 0 : 1 + Math.round(a * 254);
    }
    const delay = Math.max(2, Math.round(f.delayMs / 10));
    // Disposal 2 (restore to background) so transparent frames don't pile up.
    parts.push(new Uint8Array([0x21, 0xf9, 4, (2 << 2) | (transparent ? 1 : 0)]), u16le(delay), new Uint8Array([0, 0]));
    parts.push(new Uint8Array([0x2c]), u16le(0), u16le(0), u16le(w), u16le(h), new Uint8Array([0]), lzw(idx, 8));
  }
  parts.push(new Uint8Array([0x3b]));
  return concat(parts);
}

// ---------- APNG ----------
function pngChunks(bytes) {
  const out = [];
  let p = 8;
  while (p < bytes.length) {
    const len = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    out.push({ type, data: bytes.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}
function pngChunk(type, data) {
  const t = enc.encode(type);
  return concat([u32be(data.length), t, data, u32be(crc32(concat([t, data])))]);
}
// pngs: [{ bytes: Uint8Array (a PNG file), delayMs }]
export function encodeApng(pngs, { loop = true } = {}) {
  const first = pngChunks(pngs[0].bytes);
  const ihdr = first.find((c) => c.type === "IHDR").data;
  const w = (ihdr[0] << 24) | (ihdr[1] << 16) | (ihdr[2] << 8) | ihdr[3], h = (ihdr[4] << 24) | (ihdr[5] << 16) | (ihdr[6] << 8) | ihdr[7];
  const out = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("acTL", concat([u32be(pngs.length), u32be(loop ? 0 : 1)]))];
  let seq = 0;
  pngs.forEach((f, i) => {
    out.push(pngChunk("fcTL", concat([u32be(seq++), u32be(w), u32be(h), u32be(0), u32be(0), u16be(Math.max(1, Math.round(f.delayMs))), u16be(1000), new Uint8Array([1, 0])])));
    for (const c of pngChunks(f.bytes).filter((c) => c.type === "IDAT")) {
      out.push(i === 0 ? pngChunk("IDAT", c.data) : pngChunk("fdAT", concat([u32be(seq++), c.data])));
    }
  });
  out.push(pngChunk("IEND", new Uint8Array(0)));
  return concat(out);
}

// ---------- Animated WebP ----------
function riffChunks(bytes) {
  const out = [];
  let p = 12;
  while (p + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(p, p + 4));
    const len = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
    out.push({ type, data: bytes.subarray(p + 8, p + 8 + len) });
    p += 8 + len + (len & 1);
  }
  return out;
}
const riffChunk = (type, data) => concat([enc.encode(type), u32le(data.length), data, data.length & 1 ? new Uint8Array([0]) : new Uint8Array(0)]);
// webps: [{ bytes: Uint8Array (a still WebP), delayMs }]
export function encodeWebp(webps, w, h, { loop = true } = {}) {
  const frames = webps.map((f) => {
    const body = riffChunks(f.bytes).filter((c) => c.type === "ALPH" || c.type === "VP8 " || c.type === "VP8L").map((c) => riffChunk(c.type, c.data));
    // Blending off (bit 1) and dispose to background (bit 0): each frame replaces the last.
    return riffChunk("ANMF", concat([u24le(0), u24le(0), u24le(w - 1), u24le(h - 1), u24le(Math.max(1, Math.round(f.delayMs))), new Uint8Array([0b11]), ...body]));
  });
  const vp8x = riffChunk("VP8X", concat([new Uint8Array([0x12, 0, 0, 0]), u24le(w - 1), u24le(h - 1)]));
  const anim = riffChunk("ANIM", concat([u32le(0), u16le(loop ? 0 : 1)]));
  const payload = concat([enc.encode("WEBP"), vp8x, anim, ...frames]);
  return concat([enc.encode("RIFF"), u32le(payload.length), payload]);
}
