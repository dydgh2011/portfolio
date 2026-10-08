// Draws the "under construction" art for the game-button modal (made for this repo), in the
// Tiny packs' palette: assets/custom/barricade.png (32×32, warning lamps at pixels 6–7 and
// 25–26, rows 4–5) and assets/custom/cone.png (16×16).
// Run: node scripts/make-construction-sprites.mjs  (the PNGs are committed; rerun only to change the art)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const out = join(dirname(fileURLToPath(import.meta.url)), '../../assets/custom');
const P = { O: '#3f2631', Y: '#feae34', y: '#fee761', K: '#262b44', R: '#e84537', r: '#ff706d', W: '#ffffff', w: '#c0cbdc', d: '#8b9bb4', D: '#52607c', o: '#f77622', b: '#be4a2f' };
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

// Barricade: two warning lamps, a striped board, two legs with feet.
const B = Array.from({ length: 32 }, () => Array(32).fill('.'));
const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < 32 && y < 32) B[y][x] = c; };
// lamps
for (const cx of [6, 25]) {
  [[0, 'OOOO'], [1, 'OrRO'], [2, 'ORRO'], [3, 'OOOO']].forEach(([dy, row]) => [...row].forEach((c, i) => set(cx - 1 + i, 3 + dy, c)));
  set(cx, 7, 'D'); set(cx + 1, 7, 'D');
}
// board rows 8–15, cols 1–30, diagonal stripes
for (let y = 8; y <= 15; y++) for (let x = 1; x <= 30; x++) {
  const edge = y === 8 || y === 15 || x === 1 || x === 30;
  set(x, y, edge ? 'O' : ((x + y) % 8 < 4 ? (y < 11 ? 'y' : 'Y') : 'K'));
}
// legs and feet
for (const lx of [6, 24]) {
  for (let y = 16; y <= 28; y++) { set(lx, y, 'O'); set(lx + 1, y, 'w'); set(lx + 2, y, 'd'); set(lx + 3, y, 'O'); }
  for (let x = lx - 2; x <= lx + 5; x++) { set(x, 28, 'O'); set(x, 29, x === lx - 2 || x === lx + 5 ? 'O' : 'D'); set(x, 30, 'O'); }
  for (let x = lx - 1; x <= lx + 4; x++) set(x, 29, 'D');
}
// second (lower) bar
for (let y = 19; y <= 21; y++) for (let x = 6; x <= 27; x++) {
  if (B[y][x] !== '.' && (x <= 9 || x >= 24)) continue;
  const edge = y === 19 || y === 21;
  set(x, y, edge ? 'O' : (x % 6 < 3 ? 'Y' : 'K'));
}

// Cone 16×16
const C = [
  '................',
  '.......OO.......',
  '......OooO......',
  '......OooO......',
  '.....OWWWWO.....',
  '.....OWWwWO.....',
  '....OooooboO....',
  '....OoooobbO....',
  '...OWWWWWWwWO...',
  '...OWWWWWwwWO...',
  '..OoooooooobbO..',
  '..OooooooobbbO..',
  '.OOOOOOOOOOOOOO.',
  '.ODDDDDDDDDDDDO.',
  '.OOOOOOOOOOOOOO.',
  '................',
];

function write(file, rows, w, h) {
  const png = new PNG({ width: w, height: h });
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    const [r, g, b] = hex(P[c]);
    const k = (y * w + x) * 4;
    png.data[k] = r; png.data[k + 1] = g; png.data[k + 2] = b; png.data[k + 3] = 255;
  }));
  writeFileSync(file, PNG.sync.write(png));
}
mkdirSync(out, { recursive: true });
write(join(out, 'barricade.png'), B.map((r) => r.join('')), 32, 32);
write(join(out, 'cone.png'), C, 16, 16);
console.log('wrote', join(out, 'barricade.png'), 'and cone.png');
