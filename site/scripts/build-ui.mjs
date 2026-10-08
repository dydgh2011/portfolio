// Builds the site's pixel images into src/assets/ui/ (generated, not committed).
// Runs before dev and build, and again whenever the map editor saves.
//
// 1. UI sprites: Kenney's white Fantasy UI Borders, tinted to the site palette.
//    Pick a different sprite or color here; the CSS only knows the output names.
// 2. Maps: every file in site/scenes/ (edit them with the map editor, /editor in dev),
//    composed tile by tile into one PNG each and tinted to dusk.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pngjs from 'pngjs';
import { listScenes, readScene } from './scene-io.mjs';
import { layoutWorld } from './world.mjs';

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
  { name: 'plate.png', from: 'Panel/panel-011.png', color: '#241f36' },
];

// Multiply: darker, a little blue. The editor's dusk preview uses the same numbers.
export const DUSK = [0.58, 0.56, 0.82];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

function buildSprites() {
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
}
// Maps: each is one PNG, tinted to dusk.
const TILE = 16;
const SHEET_COLUMNS = 12;
const sheets = Object.fromEntries(
  ['dungeon', 'town', 'farm'].map((p) => [
    p,
    PNG.sync.read(readFileSync(join(here, `../../assets/kenney/tiny-${p}/tilemap_packed.png`))),
  ]),
);

function compose({ cols, rows, layers }) {
  // Layers are drawn in order; hidden layers (editor only) are still drawn.
  const png = new PNG({ width: cols * TILE, height: rows * TILE });
  for (const layer of layers) {
    for (const [col, row, pack, index] of layer.tiles) {
      if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
      const sheet = sheets[pack];
      const sx = (index % SHEET_COLUMNS) * TILE;
      const sy = Math.floor(index / SHEET_COLUMNS) * TILE;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const si = ((sy + y) * sheet.width + sx + x) * 4;
          const di = ((row * TILE + y) * png.width + col * TILE + x) * 4;
          const a = sheet.data[si + 3] / 255;
          if (a === 0) continue;
          for (let k = 0; k < 3; k++) png.data[di + k] = sheet.data[si + k] * a + png.data[di + k] * (1 - a);
          png.data[di + 3] = Math.max(png.data[di + 3], sheet.data[si + 3]);
        }
      }
    }
  }
  for (let i = 0; i < png.data.length; i += 4) {
    for (let k = 0; k < 3; k++) png.data[i + k] *= DUSK[k];
  }
  return png;
}

// Rows r0..r1 (inclusive) of a composed map.
function cropRows(png, r0, r1) {
  const part = new PNG({ width: png.width, height: (r1 - r0 + 1) * TILE });
  png.data.copy(part.data, 0, r0 * TILE * png.width * 4, (r1 + 1) * TILE * png.width * 4);
  return part;
}

// The page map: one image per band and three per zone (top, repeat, bottom).
function buildWorld(name, scene) {
  const { zones, bands, errors } = layoutWorld(scene);
  for (const e of errors) console.warn(`build-ui: scenes/${name}.json: ${e} (ignored)`);
  const png = compose(scene);
  const write = (file, r0, r1) => {
    if (r1 >= r0) writeFileSync(join(out, file), PNG.sync.write(cropRows(png, r0, r1)));
  };
  for (const b of bands) write(`world-band-${b.id}.png`, b.from, b.to);
  for (const z of zones) {
    write(`world-zone-${z.id}-top.png`, z.from, z.repeatFrom - 1);
    write(`world-zone-${z.id}-mid.png`, z.repeatFrom, z.repeatTo);
    write(`world-zone-${z.id}-bottom.png`, z.repeatTo + 1, z.to);
  }
}

function buildMaps() {
  const names = listScenes();
  for (const name of names) {
    const scene = readScene(name);
    // Only "world" is the page map. Other world-kind files (e.g. world-draft) are drafts for the editor.
    if (scene.kind === 'world') {
      if (name === 'world') buildWorld(name, scene);
    }
    else writeFileSync(join(out, scene.kind === 'section' ? `scene-${name}.png` : `${name}.png`), PNG.sync.write(compose(scene)));
  }
  return names.length;
}

/** Build everything, or only the maps (what the editor changes). */
export function buildUi({ mapsOnly = false } = {}) {
  mkdirSync(out, { recursive: true });
  if (!mapsOnly) buildSprites();
  const maps = buildMaps();
  return `build-ui: ${mapsOnly ? '' : `${sprites.length} sprites + `}${maps} maps → src/assets/ui/`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(buildUi());
