// Gera os ícones PNG do PWA (sem dependências): rasteriza o desenho com
// supersampling e grava PNG via zlib. Roda antes de `dev` e `build`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const BG = [11, 13, 16];
const TRACK = [38, 45, 54];
const GOOD = [61, 220, 151];
const AMBER = [245, 165, 36];

// Geometria no espaço 512×512 (mesma de public/favicon.svg)
const CX = 256, CY = 340, R = 160, W = 28;
const deg = (d) => (d * Math.PI) / 180;

function sample(x, y, { rounded, scale, offset }) {
  // x,y em pixels do espaço 512; aplica escala (maskable) em torno do centro
  const px = (x - 256 - offset) / scale + 256;
  const py = (y - 256 - offset) / scale + 256;
  let color = null;
  if (rounded) {
    // retângulo arredondado rx=112
    const dx = Math.max(Math.abs(x - 256) - (256 - 112), 0);
    const dy = Math.max(Math.abs(y - 256) - (256 - 112), 0);
    if (dx * dx + dy * dy <= 112 * 112) color = BG;
    else return null;
  } else color = BG;

  const dx = px - CX, dy = py - CY;
  const dist = Math.hypot(dx, dy);
  const ang = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0° = para cima
  if (Math.abs(dist - R) <= W / 2 && Math.abs(ang) <= 70) color = TRACK;
  if (Math.abs(dist - R) <= W / 2 && Math.abs(ang) <= 10) color = GOOD;
  // ponteiro (cápsula vertical)
  const t = Math.min(Math.max(CY - py, 0), CY - 172);
  if (Math.hypot(px - 256, CY - py - t) <= 11) color = AMBER;
  if (Math.hypot(dx, dy) <= 30) color = AMBER;
  return color;
}

function render(size, opts) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(((x + (sx + 0.5) / SS) * 512) / size, ((y + (sy + 0.5) / SS) * 512) / size, opts);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      px[i] = a ? r / a : 0; px[i + 1] = a ? g / a : 0; px[i + 2] = a ? b / a : 0; px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const jobs = [
  ['icon-192.png', 192, { rounded: true, scale: 1, offset: 0 }],
  ['icon-512.png', 512, { rounded: true, scale: 1, offset: 0 }],
  ['apple-touch-icon.png', 180, { rounded: false, scale: 1, offset: 0 }],
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.8, offset: 0 }],
];
for (const [name, size, opts] of jobs) writeFileSync(join(out, name), png(size, render(size, opts)));
console.log('ícones gerados em public/');
