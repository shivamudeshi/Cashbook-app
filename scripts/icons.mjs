// One-off generator for public/icons/icon-192.png and icon-512.png.
// Pure node (zlib) PNG encoder — draws a serif rupee mark on an olive tile.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const OLIVE = [74, 83, 32]; // #4a5320
const CREAM = [247, 244, 233]; // #f7f4e9

function crc32(buf) {
  let c,
    table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A chunky "₹"-inspired glyph drawn with rectangles and a diagonal, scaled to
// the tile. Coordinates are in a 0..1 design space.
function glyph(u, v) {
  const inBar = (y0) => v >= y0 && v <= y0 + 0.07 && u >= 0.28 && u <= 0.72;
  if (inBar(0.2) || inBar(0.34)) return true;
  // vertical spine of the loop
  if (u >= 0.28 && u <= 0.36 && v >= 0.2 && v <= 0.48) return true;
  // loop bowl
  if (u >= 0.36 && u <= 0.68 && v >= 0.41 && v <= 0.48) return true;
  // diagonal leg
  const t = (v - 0.48) / 0.32;
  if (v >= 0.48 && v <= 0.8) {
    const cx = 0.32 + t * 0.3;
    if (Math.abs(u - cx) <= 0.05) return true;
  }
  return false;
}

function makeIcon(size) {
  const r = size * 0.18; // rounded corners
  return png(size, (x, y) => {
    const dx = Math.min(x, size - 1 - x);
    const dy = Math.min(y, size - 1 - y);
    if (dx < r && dy < r) {
      const d = Math.hypot(r - dx, r - dy);
      if (d > r) return CREAM;
    }
    return glyph(x / size, y / size) ? CREAM : OLIVE;
  });
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", makeIcon(192));
writeFileSync("public/icons/icon-512.png", makeIcon(512));
console.log("icons written");
