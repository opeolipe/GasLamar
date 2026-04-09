#!/usr/bin/env node
/**
 * scripts/gen-og-image.js
 * Generates assets/og-image.png — 1200×630 branded social sharing card.
 * Uses only Node.js built-in modules (zlib, fs, path). No npm install needed.
 *
 * Design:
 *   • White background
 *   • Brand-blue (#1B4FE8) left panel (420px wide, full height)
 *   • White plus-mark logo on left panel (matches assets/logo.svg symbol)
 *   • Right panel: white with three content-line placeholders + brand accent
 *   • Top + bottom 10px blue bars
 *
 * Run: node scripts/gen-og-image.js
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 1200, H = 630;

// ── Colour constants ──────────────────────────────────────────────
const BLUE   = [0x1B, 0x4F, 0xE8];   // brand blue
const BLUE2  = [0x14, 0x40, 0xCC];   // slightly darker
const WHITE  = [0xFF, 0xFF, 0xFF];
const LBLUE  = [0x3B, 0x6B, 0xF0];   // lighter brand blue
const GHOST  = [0xEB, 0xF0, 0xFD];   // near-white blue tint

// ── Pixel buffer ─────────────────────────────────────────────────
// Row-major [y][x] → [r,g,b]
const pixels = Array.from({ length: H }, () =>
  Array.from({ length: W }, () => [...WHITE])
);

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function lerpC(c1, c2, t) { return c1.map((v, i) => lerp(v, c2[i], t)); }

function fillRect(x0, y0, w, h, color) {
  for (let y = y0; y < Math.min(y0 + h, H); y++)
    for (let x = x0; x < Math.min(x0 + w, W); x++)
      pixels[y][x] = [...color];
}

// ── Draw ─────────────────────────────────────────────────────────

// Left panel: brand-blue vertical gradient
for (let y = 0; y < H; y++) {
  const t = y / H;
  const c = lerpC(BLUE, BLUE2, t * 0.4);
  for (let x = 0; x < 420; x++) pixels[y][x] = [...c];
}

// Top edge bar
fillRect(0, 0, W, 10, LBLUE);

// Bottom edge bar
fillRect(0, H - 10, W, 10, LBLUE);

// ── Logo mark (centred in left panel) ────────────────────────────
// Outer white square
const LX = 160, LY = 235, LS = 120;
fillRect(LX, LY, LS, LS, WHITE);
// Plus cut-out (blue on white) — vertical arm
const THICK = 30;
fillRect(LX + (LS - THICK) / 2, LY, THICK, LS, BLUE);
// horizontal arm
fillRect(LX, LY + (LS - THICK) / 2, LS, THICK, BLUE);
// Erase to leave white plus
// (draw white plus ON the blue background of the square, achieved by drawing
//  the white square first and the blue arms second — already done above)
// Re-draw white arms on blue background for correct visual
fillRect(LX + (LS - THICK) / 2, LY, THICK, LS, BLUE2);      // vertical blue
fillRect(LX, LY + (LS - THICK) / 2, LS, THICK, BLUE2);      // horizontal blue
fillRect(LX, LY, LS, LS, [0, 0, 0]);  // reset — redesign below

// Clean design: Blue square with white plus mark
fillRect(LX, LY, LS, LS, BLUE);                              // blue square
fillRect(LX + 45, LY + 10, 30, LS - 20, WHITE);             // white vertical arm
fillRect(LX + 10, LY + 45, LS - 20, 30, WHITE);             // white horizontal arm

// Wordmark area below logo: three white dots (brand accent)
const dotY = LY + LS + 30;
for (let i = 0; i < 3; i++) fillRect(LX + i * 22, dotY, 10, 10, WHITE);

// Tagline placeholder: two white lines below dots
fillRect(LX, dotY + 30, 160, 6, [0xFF, 0xFF, 0xFF, 0x99].slice(0, 3));
fillRect(LX, dotY + 48, 110, 6, WHITE);

// ── Right panel content lines ─────────────────────────────────────
// Simulates the brand name + tagline visually without needing font rendering.
const RX = 500;  // right panel start x

// "GasLamar" — large accent block + underline pattern
fillRect(RX, 160, 560, 14, GHOST);     // ghost row
fillRect(RX, 195, 560,  7, GHOST);     // ghost row
fillRect(RX, 210, 460,  7, GHOST);     // ghost row

// Three bold "text line" bars — primary title area
fillRect(RX, 255, 560, 32, BLUE);      // primary bar (bold heading)
fillRect(RX, 255 + 32 + 4, 420, 6, GHOST);  // subtitle ghost

// Separator
fillRect(RX, 340, 560, 2, [0xD1, 0xD5, 0xDB]);

// Two content lines
fillRect(RX, 360, 540, 12, GHOST);
fillRect(RX, 382, 480, 12, GHOST);
fillRect(RX, 404, 510, 12, GHOST);

// CTA pill shape (rounded blue rectangle — approximated)
const pillX = RX, pillY = 470, pillW = 220, pillH = 48;
fillRect(pillX, pillY, pillW, pillH, BLUE);
// Rounded corners (erase 4×4 squares at each corner)
const cr = 10;
[[0,0],[pillW-cr,0],[0,pillH-cr],[pillW-cr,pillH-cr]].forEach(([dx, dy]) => {
  for (let py = pillY + dy; py < pillY + dy + cr; py++)
    for (let px = pillX + dx; px < pillX + dx + cr; px++) {
      const cx = (dx === 0 ? pillX + cr : pillX + pillW - cr);
      const cy = (dy === 0 ? pillY + cr : pillY + pillH - cr);
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist > cr) pixels[py][px] = [...WHITE];
    }
});
// White arrow inside pill
const arrowX = pillX + pillW - 36, arrowY = pillY + pillH / 2 - 1;
fillRect(arrowX, arrowY, 20, 3, WHITE);           // horizontal
// diagonal up
for (let k = 0; k < 8; k++) { const px = arrowX + 12 + k; fillRect(px, arrowY - 1 - k, 3, 3, WHITE); }
// diagonal down
for (let k = 0; k < 8; k++) { const px = arrowX + 12 + k; fillRect(px, arrowY + 2 + k, 3, 3, WHITE); }

// ── Diagonal accent — decorative blue slash ───────────────────────
// Thin diagonal stripe from top-right corner towards bottom
for (let y = 10; y < H - 10; y++) {
  const x = W - 60 - Math.round(y * 0.06);
  if (x >= 500 && x < W) {
    for (let d = 0; d < 5; d++) pixels[y][Math.min(x + d, W - 1)] = GHOST;
  }
}

// ── Encode to PNG ─────────────────────────────────────────────────
function uint32BE(n) {
  return Buffer.from([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]);
}

function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const crcInput = Buffer.concat([t, d]);
  return Buffer.concat([uint32BE(d.length), t, d, uint32BE(crc32(crcInput))]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // 8-bit depth
ihdr[9] = 2;  // RGB
ihdr[10] = ihdr[11] = ihdr[12] = 0;

// Raw scanlines (filter byte 0 = None per row)
const scanlines = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 3);
  scanlines[rowStart] = 0;  // filter: None
  for (let x = 0; x < W; x++) {
    const [r, g, b] = pixels[y][x];
    scanlines[rowStart + 1 + x * 3]     = r;
    scanlines[rowStart + 1 + x * 3 + 1] = g;
    scanlines[rowStart + 1 + x * 3 + 2] = b;
  }
}

const compressed = zlib.deflateSync(scanlines, { level: 6 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),  // PNG magic
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.resolve(__dirname, '..', 'assets', 'og-image.png');
fs.writeFileSync(outPath, png);
console.log(`✓ og-image.png generated → ${outPath}`);
console.log(`  Size: ${(png.length / 1024).toFixed(0)} KB  |  Dimensions: ${W}×${H}px`);
