// Read and write the map files in site/scenes/. Shared by build-ui.mjs and the editor.
//
// A map file:
// {
//   "kind": "section" | "texture",   section → scene-<name>.png (a section header),
//                                     texture → <name>.png (repeated by CSS)
//   "note": "...",                    what it is for
//   "cols": 28, "rows": 6,            size in 16 px tiles
//   "layers": [{ "name": "grass", "tiles": [[col, row, pack, tile], ...] }, ...],
//   "actors": [...]                   sections only, see SectionScene.astro
// }
// Layers draw in order, later ones on top. pack is "town" | "farm" | "dungeon".

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCENES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../scenes');
export const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function listScenes() {
  return readdirSync(SCENES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function readScene(name) {
  return JSON.parse(readFileSync(join(SCENES_DIR, `${name}.json`), 'utf8'));
}

// Pretty JSON, but one tile or actor per line, so diffs stay small.
export function formatScene(scene) {
  return (
    JSON.stringify(scene, null, 2)
      .replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+("\w+"),\s+(\d+)\s+\]/g, '[$1, $2, $3, $4]')
      .replace(/"sprite": \[\s+("\w+"),\s+(\d+)\s+\]/g, '"sprite": [$1, $2]')
      // one light per line
      .replace(/\{\s+("type": [^{}[\]]*?)\s+\}/g, (_, body) => `{ ${body.replace(/,\s+/g, ', ')} }`) + '\n'
  );
}

export function writeScene(name, scene) {
  if (!NAME.test(name)) throw new Error(`bad scene name "${name}"`);
  mkdirSync(SCENES_DIR, { recursive: true });
  writeFileSync(join(SCENES_DIR, `${name}.json`), formatScene(scene));
}
