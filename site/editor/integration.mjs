// Map editor, dev only: adds the /editor page and a small API to read and save
// site/scenes/*.json. Nothing here is part of the production build.
//
//   GET /__scenes          → { scenes: { name: scene, ... } }
//   PUT /__scenes/<name>   ← scene JSON; saves it and rebuilds the map PNGs
//   GET /__library         → editor library: patch sets and presets (library.json)
//   PUT /__library         ← the whole library

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildUi } from '../scripts/build-ui.mjs';
import { NAME, listScenes, readScene, writeScene } from '../scripts/scene-io.mjs';
import { layoutWorld, LIGHT_TYPES } from '../scripts/world.mjs';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Basic shape check, so a bad save cannot break the site build.
function check(scene) {
  const int = (n) => Number.isInteger(n) && n > 0 && n <= 200;
  if (!scene || !['section', 'texture', 'world'].includes(scene.kind)) return 'kind must be "section", "texture" or "world"';
  if (!int(scene.cols) || !int(scene.rows)) return 'cols and rows must be whole numbers from 1 to 200';
  if (!Array.isArray(scene.layers)) return 'layers must be a list';
  for (const layer of scene.layers) {
    if (typeof layer.name !== 'string' || !Array.isArray(layer.tiles)) return 'each layer needs a name and tiles';
    for (const t of layer.tiles) {
      if (!Array.isArray(t) || t.length !== 4 || !['town', 'farm', 'dungeon'].includes(t[2])) return `bad tile ${JSON.stringify(t)}`;
      if (!Number.isInteger(t[3]) || t[3] < 0 || t[3] > 131) return `bad tile index in ${JSON.stringify(t)}`;
    }
  }
  if (scene.kind === 'world') {
    const { errors } = layoutWorld(scene);
    if (errors.length) return errors[0];
    if (scene.lights !== undefined && !Array.isArray(scene.lights)) return 'lights must be a list';
    for (const l of scene.lights ?? []) {
      const bad = !(l?.type in LIGHT_TYPES) || !Number.isInteger(l.col) || !Number.isInteger(l.row)
        || (l.color !== undefined && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(l.color))
        || (l.radius !== undefined && !(l.radius > 0 && l.radius <= 12))
        || (l.intensity !== undefined && !(l.intensity >= 0 && l.intensity <= 1))
        || (l.flicker !== undefined && ![true, false, 'breathe'].includes(l.flicker));
      if (bad) return `bad light ${JSON.stringify(l)}`;
    }
  }
  return null;
}

const LIBRARY = fileURLToPath(new URL('./library.json', import.meta.url));

function checkLibrary(lib) {
  const tile = (t) => t === null || (Array.isArray(t) && ['town', 'farm', 'dungeon'].includes(t[0]) && Number.isInteger(t[1]));
  if (!lib || !Array.isArray(lib.patchSets) || !Array.isArray(lib.presets)) return 'library needs patchSets and presets';
  for (const p of lib.patchSets) {
    const [w, h] = [p.w ?? 3, p.h ?? 3];
    const sizeOk = [1, 2, 3].includes(w) && [1, 2, 3].includes(h);
    if (typeof p.name !== 'string' || !sizeOk || !Array.isArray(p.slots) || p.slots.length !== w * h || !p.slots.every(tile)) return `bad patch set "${p.name}"`;
  }
  for (const p of lib.presets) if (typeof p.name !== 'string' || !Array.isArray(p.tiles)) return `bad preset "${p.name}"`;
  for (const p of lib.scatterSets ?? []) {
    const item = (i) => Number.isFinite(i?.weight) && i.weight >= 0 && ((Array.isArray(i.tile) && tile(i.tile)) || typeof i.preset === 'string');
    if (typeof p.name !== 'string' || !Number.isFinite(p.density) || !Array.isArray(p.items) || !p.items.every(item)) return `bad scatter set "${p.name}"`;
  }
  return null;
}

// Same idea as formatScene: one slot or tile per line.
function formatLibrary(lib) {
  return (
    JSON.stringify(lib, null, 2)
      .replace(/\[\s+("\w+"),\s+(\d+)\s+\]/g, '[$1, $2]')
      .replace(/\{\s+"tile": (\[[^\]]*\]),\s+"weight": ([\d.]+)\s+\}/g, '{ "tile": $1, "weight": $2 }')
      .replace(/\{\s+"preset": ("[^"]*"),\s+"weight": ([\d.]+)\s+\}/g, '{ "preset": $1, "weight": $2 }')
      .replace(/\[\s+(-?\d+),\s+(-?\d+),\s+("\w+"),\s+(\d+),\s+("[^"]*")\s+\]/g, '[$1, $2, $3, $4, $5]') + '\n'
  );
}

export default function mapEditor() {
  return {
    name: 'map-editor',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/editor', entrypoint: fileURLToPath(new URL('./editor.astro', import.meta.url)) });
      },
      'astro:server:setup': ({ server, logger }) => {
        server.middlewares.use(async (req, res, next) => {
          const path = req.url?.split('?')[0] ?? '';
          if (/\/__library\/?$/.test(path)) {
            try {
              if (req.method === 'GET') return send(res, 200, JSON.parse(readFileSync(LIBRARY, 'utf8')));
              if (req.method === 'PUT') {
                const lib = JSON.parse(await readBody(req));
                const problem = checkLibrary(lib);
                if (problem) return send(res, 400, { error: problem });
                writeFileSync(LIBRARY, formatLibrary(lib));
                return send(res, 200, { ok: true });
              }
              return send(res, 405, { error: 'method not allowed' });
            } catch (e) {
              return send(res, 500, { error: String(e?.message ?? e) });
            }
          }
          const match = path.match(/\/__scenes(?:\/([^/]+))?\/?$/);
          if (!match) return next();
          const name = match[1];
          try {
            if (req.method === 'GET' && !name) {
              const scenes = Object.fromEntries(listScenes().map((n) => [n, readScene(n)]));
              return send(res, 200, { scenes });
            }
            if (req.method === 'PUT' && name) {
              if (!NAME.test(name)) return send(res, 400, { error: 'name must be kebab-case, like "projects" or "forest-left"' });
              const scene = JSON.parse(await readBody(req));
              const problem = check(scene);
              if (problem) return send(res, 400, { error: problem });
              writeScene(name, scene);
              const message = buildUi({ mapsOnly: true });
              logger.info(`saved scenes/${name}.json · ${message}`);
              return send(res, 200, { ok: true, message });
            }
            return send(res, 405, { error: 'method not allowed' });
          } catch (e) {
            return send(res, 500, { error: String(e?.message ?? e) });
          }
        });
      },
    },
  };
}
