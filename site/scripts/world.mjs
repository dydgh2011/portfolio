// The page map (site/scenes/world.json) is one tall picture. Content zones mark the
// rows where page content sits; everything between them is a fixed scene band.
//
//   band "about"     rows before the "about" zone (the section title sits here)
//   zone "about"     content rows: top part, repeat rows, bottom part
//   band "projects"  rows between the "about" and "projects" zones
//   ...
//   band "end"       rows after the last zone
//
// A zone stretches to fit its content by repeating rows repeatFrom..repeatTo
// (whole rows only, so tiles are never cut). Shared by build-ui.mjs (to slice the
// image), the page (to lay it out) and the editor (to check and preview it).

export const TILE = 16;
export const SCALE = 2;
export const PX = TILE * SCALE; // one tile on the page

// Zones the page knows about, in page order. A zone id must be one of these.
export const ZONE_IDS = ['about', 'projects', 'experience', 'skills', 'education', 'footer'];

/**
 * Check the zones and split the map into bands and zones.
 * Never throws: bad zones are dropped and reported in `errors`.
 */
export function layoutWorld(world) {
  const errors = [];
  const rows = world?.rows ?? 0;
  const zones = [];
  const seen = new Set();
  for (const z of Array.isArray(world?.zones) ? world.zones : []) {
    const where = `zone "${z?.id}"`;
    const ints = ['from', 'to', 'repeatFrom', 'repeatTo'].every((k) => Number.isInteger(z?.[k]));
    if (!ZONE_IDS.includes(z?.id)) errors.push(`${where}: id must be one of ${ZONE_IDS.join(', ')}`);
    else if (seen.has(z.id)) errors.push(`${where}: used twice`);
    else if (!ints) errors.push(`${where}: from, to, repeatFrom, repeatTo must be whole numbers`);
    else if (z.from < 0 || z.to >= rows || z.from > z.to) errors.push(`${where}: rows ${z.from}–${z.to} are outside the map (0–${rows - 1})`);
    else if (z.repeatFrom < z.from || z.repeatTo > z.to || z.repeatFrom > z.repeatTo) errors.push(`${where}: repeat rows must be inside the zone`);
    else {
      seen.add(z.id);
      zones.push({ id: z.id, from: z.from, to: z.to, repeatFrom: z.repeatFrom, repeatTo: z.repeatTo });
    }
  }
  zones.sort((a, b) => a.from - b.from);
  // Drop zones that overlap the one before, and zones out of page order.
  const ok = [];
  for (const z of zones) {
    const prev = ok[ok.length - 1];
    if (prev && z.from <= prev.to) errors.push(`zone "${z.id}" overlaps zone "${prev.id}"`);
    else if (prev && ZONE_IDS.indexOf(z.id) < ZONE_IDS.indexOf(prev.id)) errors.push(`zone "${z.id}" must come after "${prev.id}" (page order: ${ZONE_IDS.join(', ')})`);
    else ok.push(z);
  }

  const bands = [];
  let row = 0;
  for (const z of ok) {
    bands.push({ id: z.id, from: row, to: z.from - 1 }); // may be empty (to < from)
    row = z.to + 1;
  }
  bands.push({ id: 'end', from: row, to: rows - 1 });

  return { zones: ok, bands, errors };
}

// ---------- actors ----------
//
// walk:   from → to along `row`, then up `up` rows (negative = down), then fades
// wander: back and forth between from and to along `row`
// path:   follows points [[col, row, pause?], ...] at `speed` tiles per second (default 2),
//         pausing `pause` seconds at a point; fades in at the start and out at the end,
//         then starts over. Positions are the sprite's top-left corner, in tiles.

/** The band an actor lives in (it is only drawn there), or undefined. */
export function bandOfActor(actor, bands) {
  if (actor?.type !== 'path') return bands.find((b) => actor.row >= b.from && actor.row <= b.to && b.to >= b.from);
  let best;
  let most = 0;
  for (const b of bands) {
    if (b.to < b.from) continue;
    const n = (actor.points ?? []).filter(([, r]) => r >= b.from && r <= b.to).length;
    if (n > most) (best = b), (most = n);
  }
  return best;
}

/**
 * Keyframes of a path actor: times in seconds and positions in tiles.
 * The sprite faces right; `flip` is true while it walks left (and until it turns again).
 */
export function pathTimeline(points, speed = 2) {
  const frames = [];
  if (!Array.isArray(points) || points.length === 0) return { total: 0, frames };
  const v = Math.max(0.1, speed);
  let t = 0;
  let flip = false;
  let [x, y, pause] = points[0];
  frames.push({ t, x, y, flip });
  if (pause > 0) frames.push({ t: (t += pause), x, y, flip });
  for (const [nx, ny, np] of points.slice(1)) {
    const turn = nx < x ? true : nx > x ? false : flip;
    if (turn !== flip) frames.push({ t: t + 0.001, x, y, flip: (flip = turn) });
    t += Math.hypot(nx - x, ny - y) / v;
    [x, y] = [nx, ny];
    frames.push({ t, x, y, flip });
    if (np > 0) frames.push({ t: (t += np), x, y, flip });
  }
  return { total: Math.max(t, 0.1), frames };
}

/** Where a path actor is at time `s` (seconds), for previews. */
export function pathAt(points, speed, s) {
  const { total, frames } = pathTimeline(points, speed);
  if (!frames.length) return null;
  const t = ((s % total) + total) % total;
  let i = frames.findIndex((f) => f.t >= t);
  if (i <= 0) i = i === 0 ? 0 : frames.length - 1;
  const a = frames[Math.max(0, i - 1)];
  const b = frames[i];
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const fade = Math.min(1, t / 0.3, (total - t) / 0.3);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, flip: a.flip, alpha: Math.max(0, fade) };
}

// ---------- lights ----------
//
// A light is a soft glow (added on top of the map, never darkening it), with an optional
// sprite from assets/custom/lights.png (12 tiles per row). World data:
//   lights: [{ type, col, row, color?, radius?, intensity?, flicker? }, ...]
// col/row are the tile the light's object sits on. Lights live in bands, like actors.
export const LIGHT_TYPES = {
  torch: { frames: [0, 1, 2], color: '#ffb054', radius: 2.6, intensity: 0.85, flicker: true, glowAt: [0.5, 0.3] },
  brazier: { frames: [3, 4, 5], color: '#ff9a3c', radius: 3.2, intensity: 0.9, flicker: true, glowAt: [0.5, 0.35] },
  campfire: { frames: [6, 7, 8], color: '#ff8c3a', radius: 3.6, intensity: 0.95, flicker: true, glowAt: [0.5, 0.55] },
  lamp: { frames: [9], below: 10, color: '#ffd27a', radius: 2.6, intensity: 0.75, flicker: false, glowAt: [0.5, 0.35] },
  window: { frames: [11], color: '#ffcf6e', radius: 1.7, intensity: 0.65, flicker: false, glowAt: [0.5, 0.5] },
  'window-gray': { frames: [12], color: '#ffcf6e', radius: 1.7, intensity: 0.65, flicker: false, glowAt: [0.5, 0.5] },
  glow: { frames: [], color: '#8fd3ff', radius: 2, intensity: 0.6, flicker: false, glowAt: [0.5, 0.5] },
};
export const LIGHTS_SHEET_COLS = 12;

/** A light with its type's defaults filled in. */
export function resolveLight(light) {
  const t = LIGHT_TYPES[light?.type] ?? LIGHT_TYPES.glow;
  return { ...t, ...light, color: light.color ?? t.color, radius: light.radius ?? t.radius, intensity: light.intensity ?? t.intensity, flicker: light.flicker ?? t.flicker };
}

/** The band a light belongs to (by its row), or undefined. */
export function bandOfLight(light, bands) {
  return bands.find((b) => b.to >= b.from && light.row >= b.from && light.row <= b.to);
}

// ---------- fireflies ----------
//
// A group of fireflies wanders inside an area (in tiles) of a band:
//   fireflies: [{ col, row, w, h, count?, color?, intensity?, size?, speed?,
//                 blink?, blinkJitter?, life?, rest?, lifeJitter?, seed? }, ...]
// Each one follows its own smooth loop (from `seed`, so the site and the editor agree),
// blinks every `blink` s (± blinkJitter, a fraction), shows for `life` s and hides for
// `rest` s (both ± lifeJitter). Periods differ per firefly, so each time one comes back
// it is somewhere else on its loop.
export const FIREFLY_DEFAULTS = {
  count: 8,
  color: '#d4ff6b',
  intensity: 0.8,
  size: 0.7, // glow radius, tiles
  speed: 0.5, // tiles per second
  blink: 2.4, // seconds
  blinkJitter: 0.4,
  life: 7, // seconds shown
  rest: 4, // seconds hidden
  lifeJitter: 0.3,
  seed: 1,
};
export const FIREFLY_FADE = 0.8; // seconds to fade in or out
// Opacity over one blink: mostly a dim glow, then a short flash.
export const FIREFLY_BLINK = [[0, 0.4], [0.45, 0.4], [0.58, 1], [0.72, 0.4], [1, 0.4]];
const FIREFLY_SAMPLES = 32;

export function resolveFireflies(group) {
  const out = { ...FIREFLY_DEFAULTS };
  for (const [k, v] of Object.entries(group ?? {})) if (v !== undefined) out[k] = v;
  return out;
}

/** The band a firefly group belongs to (by the row of its area's middle), or undefined. */
export function bandOfFireflies(group, bands) {
  return bandOfLight({ row: Math.floor(group.row + (group.h ?? 1) / 2) }, bands);
}

// Small seeded random numbers (mulberry32).
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Opacity of a fade-in, stay, fade-out cycle: [fraction, opacity] stops for one cycle. */
export function fireflyLifeKeys(group) {
  const g = resolveFireflies(group);
  const cycle = g.life + g.rest;
  const fade = Math.min(FIREFLY_FADE, g.life / 2) / cycle;
  const shown = g.life / cycle;
  return [[0, 0], [fade, 1], [shown - fade, 1], [shown, 0], [1, 0]];
}

/**
 * Every firefly of a group: its loop (points in tiles, evenly timed, closed), and the
 * periods and starting offsets (seconds, ≤ 0) of its loop, blink and life cycle.
 */
export function fireflyTracks(group) {
  const g = resolveFireflies(group);
  const rand = random(g.seed * 7919 + 17);
  const around = (v, j) => v * (1 + (rand() * 2 - 1) * j);
  const tracks = [];
  for (let n = 0; n < Math.max(0, Math.min(60, g.count)); n++) {
    // x and y are each two sine waves with whole-number frequencies, so the loop closes.
    const wave = (half) => {
      const amp = half * (0.45 + rand() * 0.55);
      const k1 = 1 + Math.floor(rand() * 2);
      const k2 = k1 + 1 + Math.floor(rand() * 2);
      const p1 = rand() * Math.PI * 2;
      const p2 = rand() * Math.PI * 2;
      const mix = 0.55 + rand() * 0.25;
      return { amp, at: (t) => amp * (mix * Math.sin(2 * Math.PI * k1 * t + p1) + (1 - mix) * Math.sin(2 * Math.PI * k2 * t + p2)) };
    };
    const wx = wave(g.w / 2);
    const wy = wave(g.h / 2);
    const cx = g.col + wx.amp + rand() * Math.max(0, g.w - 2 * wx.amp);
    const cy = g.row + wy.amp + rand() * Math.max(0, g.h - 2 * wy.amp);
    const points = [];
    for (let i = 0; i <= FIREFLY_SAMPLES; i++) {
      const t = i / FIREFLY_SAMPLES;
      points.push([cx + wx.at(t), cy + wy.at(t)]);
    }
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const period = Math.max(2, length / Math.max(0.05, around(g.speed, 0.25)));
    const blink = Math.max(0.3, around(g.blink, g.blinkJitter));
    const cycle = Math.max(1, around(g.life + g.rest, g.lifeJitter));
    tracks.push({
      points,
      period,
      periodDelay: -rand() * period,
      blink,
      blinkDelay: -rand() * blink,
      cycle,
      cycleDelay: -rand() * cycle,
    });
  }
  return tracks;
}

// Linear interpolation through [fraction, value] stops.
function keysAt(keys, f) {
  const i = keys.findIndex((k) => k[0] >= f);
  if (i <= 0) return keys[Math.max(0, i)][1];
  const [a, b] = [keys[i - 1], keys[i]];
  return a[1] + ((b[1] - a[1]) * (f - a[0])) / (b[0] - a[0] || 1);
}

/** Where a firefly is and how bright (0–1) at time `s` seconds, for previews. */
export function fireflyAt(track, lifeKeys, s) {
  const frac = (period, delay) => ((((s - delay) % period) + period) % period) / period;
  const p = frac(track.period, track.periodDelay) * FIREFLY_SAMPLES;
  const i = Math.min(FIREFLY_SAMPLES - 1, Math.floor(p));
  const [a, b] = [track.points[i], track.points[i + 1]];
  const k = p - i;
  const alpha = keysAt(FIREFLY_BLINK, frac(track.blink, track.blinkDelay)) * keysAt(lifeKeys, frac(track.cycle, track.cycleDelay));
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, alpha };
}
