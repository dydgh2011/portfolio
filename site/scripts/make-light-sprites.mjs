// Draws the light-source sprites that the Kenney packs don't have (made for this repo),
// in the Tiny packs' palette, into assets/custom/lights.png (16 px tiles, 12 per row):
//   0–2  wall torch (3 flame frames)      3–5  brazier (3 frames)      6–8  campfire (3 frames)
//   9    street lamp, top                 10   street lamp, bottom
//   11   lit window (brown wall, from Tiny Town 84)   12  lit window (gray wall, from Tiny Town 88)
// Run: node scripts/make-light-sprites.mjs  (the PNG is committed; rerun only to change the art)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../assets/custom/lights.png');

// Palette sampled from the Tiny packs.
const P = {
  O: '#3f2631', // outline
  W: '#bd6c4a', w: '#763b36', h: '#eaa56c', // wood
  S: '#c0cbdc', s: '#8b9bb4', d: '#52607c', // stone / metal
  R: '#e84537', r: '#ff706d', Y: '#feae34', y: '#fee761', // fire
};

const flame = {
  a: ['................', '.......OO.......', '......OyyO......', '......OyyO......', '.....OyyyYO.....', '.....OYyyYO.....', '....ORYyyYRO....', '....ORRYYRRO....'],
  b: ['................', '......OO........', '.....OyyO.......', '......OyyO......', '.....OyyyYO.....', '.....OYyyYO.....', '....ORYyyYRO....', '....ORRYYRRO....'],
  c: ['................', '........OO......', '.......OyyO.....', '......OyyO......', '.....OyYyyO.....', '.....OYyyYO.....', '....ORYyyYRO....', '....ORRYYRRO....'],
};
const torchBase = ['....OOOOOOOO....', '....OSSSSSSO....', '.....OssssO.....', '......OWwO......', '......OWwO......', '......OWwO......', '......OWwO......', '.......OO.......'];
const brazierBase = ['..OOOOOOOOOOOO..', '..OYRRYYRRYRRO..', '..OssssssssssO..', '...OsSSSSSSsO...', '....OOOOOOOO....', '.....Od..dO.....', '....Od....dO....', '...OO......OO...'];
const campBase = ['..OOWOOOOOOWOO..', '.OWWhWWOOWWhWWO.', '.OwWWwOOOOwWWwO.', '..OOOOO..OOOOO..', '................', '................', '................', '................'];
const lampTop = ['................', '......OOOO......', '.....OddddO.....', '....OOOOOOOO....', '....OsyyyysO....', '....OsyYYysO....', '....OsyYYysO....', '....OsyyyysO....', '....OOOOOOOO....', '.....OddddO.....', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......'];
const lampBottom = ['......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '......OdsO......', '.....OOOOOO.....', '.....OsSSsO.....', '....OOOOOOOO....', '................', '................', '................', '................'];

const sprites = [
  [...flame.a, ...torchBase], [...flame.b, ...torchBase], [...flame.c, ...torchBase],
  [...flame.a, ...brazierBase], [...flame.b, ...brazierBase], [...flame.c, ...brazierBase],
  ...['a', 'b', 'c'].map((f) => [...Array(4).fill('................'), ...flame[f], ...campBase.slice(0, 4)]),
  lampTop, lampBottom,
];

const COLS = 12;
const png = new PNG({ width: COLS * 16, height: 2 * 16 });
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function put(index, rows) {
  const ox = (index % COLS) * 16, oy = Math.floor(index / COLS) * 16;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const [r, g, b] = hex(P[ch]);
    const k = ((oy + y) * png.width + ox + x) * 4;
    png.data[k] = r; png.data[k + 1] = g; png.data[k + 2] = b; png.data[k + 3] = 255;
  }));
}
sprites.forEach((rows, i) => put(i, rows));

// Lit windows: Tiny Town 84 and 88 with the glass made warm (rows 5–10, cols 5–6 and 9–10).
const town = PNG.sync.read(readFileSync(join(here, '../../assets/kenney/tiny-town/tilemap_packed.png')));
[[84, 11], [88, 12]].forEach(([src, dst]) => {
  const sx = (src % 12) * 16, sy = Math.floor(src / 12) * 16;
  const ox = (dst % COLS) * 16, oy = Math.floor(dst / COLS) * 16;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const si = ((sy + y) * town.width + sx + x) * 4, di = ((oy + y) * png.width + ox + x) * 4;
    let [r, g, b, a] = town.data.slice(si, si + 4);
    if (y >= 5 && y <= 10 && [5, 6, 9, 10].includes(x)) [r, g, b] = hex(y <= 7 ? P.y : P.Y);
    png.data[di] = r; png.data[di + 1] = g; png.data[di + 2] = b; png.data[di + 3] = a;
  }
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, PNG.sync.write(png));
console.log('wrote', out);
