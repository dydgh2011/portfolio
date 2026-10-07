// Tints Kenney's white Fantasy UI Borders sprites to the site palette.
// Output goes to src/assets/ui/ (generated, not committed). Runs before dev and build.
// Pick a different sprite or color here; the CSS only knows the output names.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { COLS, ROWS, layers } from './scene.mjs';

const { PNG } = pngjs;
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../assets/kenney/fantasy-ui-borders');
const out = join(here, '../src/assets/ui');

const sprites = [
  { name: 'panel.png', from: 'Panel/panel-011.png', color: '#f3e9d2' },
  { name: 'card.png', from: 'Border/panel-border-015.png', color: '#5d4a3a' },
  { name: 'button.png', from: 'Panel/panel-015.png', color: '#8c2f1b' },
  { name: 'tag.png', from: 'Panel/panel-015.png', color: '#f3e9d2' },
  { name: 'divider.png', from: 'Divider/divider-003.png', color: '#f5d547' },
];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

mkdirSync(out, { recursive: true });
for (const s of sprites) {
  const png = PNG.sync.read(readFileSync(join(src, s.from)));
  const [r, g, b] = hex(s.color);
  for (let i = 0; i < png.data.length; i += 4) {
    // Multiply: white becomes the tint, grays become darker tints.
    png.data[i] = (png.data[i] * r) / 255;
    png.data[i + 1] = (png.data[i + 1] * g) / 255;
    png.data[i + 2] = (png.data[i + 2] * b) / 255;
  }
  writeFileSync(join(out, s.name), PNG.sync.write(png));
}
// Header scene: one PNG from the tile layers in scene.mjs.
const TILE = 16;
const SHEET_COLUMNS = 12;
const sheets = Object.fromEntries(
  ['dungeon', 'town', 'farm'].map((p) => [
    p,
    PNG.sync.read(readFileSync(join(here, `../../assets/kenney/tiny-${p}/tilemap_packed.png`))),
  ]),
);
const scene = new PNG({ width: COLS * TILE, height: ROWS * TILE });
for (const layer of layers) {
  for (const [col, row, pack, index] of layer) {
    const sheet = sheets[pack];
    const sx = (index % SHEET_COLUMNS) * TILE;
    const sy = Math.floor(index / SHEET_COLUMNS) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const si = ((sy + y) * sheet.width + sx + x) * 4;
        const di = ((row * TILE + y) * scene.width + col * TILE + x) * 4;
        const a = sheet.data[si + 3] / 255;
        if (a === 0) continue;
        for (let k = 0; k < 3; k++) scene.data[di + k] = sheet.data[si + k] * a + scene.data[di + k] * (1 - a);
        scene.data[di + 3] = Math.max(scene.data[di + 3], sheet.data[si + 3]);
      }
    }
  }
}
writeFileSync(join(out, 'scene.png'), PNG.sync.write(scene));

console.log(`build-ui: ${sprites.length} sprites + scene → src/assets/ui/`);
