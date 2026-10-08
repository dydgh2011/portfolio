// Map editor client. Edits site/scenes/*.json through the dev API in integration.mjs.
import { bandOfActor, bandOfLight, layoutWorld, LIGHT_TYPES, LIGHTS_SHEET_COLS, pathAt, resolveLight, ZONE_IDS } from '../scripts/world.mjs';
// The map is drawn the same way scripts/build-ui.mjs bakes it: layers in order,
// 16 px tiles from the packed tilemaps, then the dusk tint.

type Pack = 'town' | 'farm' | 'dungeon';
type Tile = [number, number, Pack, number];
interface Layer {
  name: string;
  tiles: Tile[];
}
interface Actor {
  sprite: [Pack, number];
  type: 'walk' | 'wander' | 'path';
  row: number;
  from: number;
  to: number;
  up?: number;
  duration: number;
  points?: [number, number, number?][]; // path: [col, row, pause seconds?]
  speed?: number; // path: tiles per second
  delay?: number;
  hero?: boolean;
}

// "21,4.5  26,4.5,1  54.5,4.5" ⇄ [[21,4.5],[26,4.5,1],[54.5,4.5]]
const pointsToText = (p: Actor['points']) => (p ?? []).map((q) => q.filter((n) => n !== undefined).join(',')).join('  ');
function textToPoints(text: string): Actor['points'] | null {
  const out: [number, number, number?][] = [];
  for (const part of text.trim().split(/\s+|;/).filter(Boolean)) {
    const n = part.split(',').map(Number);
    if (n.length < 2 || n.length > 3 || n.some((x) => Number.isNaN(x))) return null;
    out.push(n.length === 3 && n[2] > 0 ? [n[0], n[1], n[2]] : [n[0], n[1]]);
  }
  return out.length ? out : null;
}
// See LIGHT_TYPES in world.mjs: type gives the sprite and the defaults.
interface Light {
  type: string;
  col: number;
  row: number;
  color?: string;
  radius?: number; // tiles
  intensity?: number; // 0–1
  flicker?: boolean | 'breathe';
}
interface Zone {
  id: string;
  from: number;
  to: number;
  repeatFrom: number;
  repeatTo: number;
}
interface Scene {
  kind: 'section' | 'texture' | 'world';
  note?: string;
  cols: number;
  rows: number;
  zones?: Zone[];
  layers: Layer[];
  actors?: Actor[];
  lights?: Light[];
}
type Tool = 'paint' | 'erase' | 'rect' | 'patch' | 'pick' | 'select' | 'stamp' | 'scatter' | 'zone';
type Slot = [Pack, number] | null;
// Patch set: w × h slots (1–3 each way), row by row. null = leave that cell empty.
// Along each axis: 1 slot = used everywhere; 2 = first cell, then the rest;
// 3 = first cell, middle (repeated), last cell.
interface PatchSet {
  name: string;
  w?: number; // default 3
  h?: number; // default 3
  slots: Slot[];
}
const setW = (p: PatchSet) => p.w ?? 3;
const setH = (p: PatchSet) => p.h ?? 3;

// Which slot along one axis a cell uses: n slots, cell i of len cells.
function axisSlot(n: number, i: number, len: number) {
  if (n === 1) return 0;
  if (n === 2) return i === 0 ? 0 : 1;
  if (len === 1) return 1;
  return i === 0 ? 0 : i === len - 1 ? 2 : 1;
}

// Resize a set, keeping each slot's role (start / middle / end) where it can.
const ROLES: Record<number, string[]> = { 1: ['mid'], 2: ['start', 'rest'], 3: ['start', 'mid', 'end'] };
const FALLBACK: Record<string, string[]> = {
  start: ['start', 'mid', 'rest'],
  mid: ['mid', 'rest', 'start'],
  end: ['end', 'rest', 'mid'],
  rest: ['rest', 'mid', 'end'],
};
function roleIndex(from: number, role: string) {
  const roles = ROLES[from];
  const hit = FALLBACK[role].find((r) => roles.includes(r));
  return hit ? roles.indexOf(hit) : 0;
}
function resizeSet(p: PatchSet, w: number, h: number) {
  const [ow, oh] = [setW(p), setH(p)];
  const slots: Slot[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = roleIndex(ow, ROLES[w][x]);
      const sy = roleIndex(oh, ROLES[h][y]);
      const s = p.slots[sy * ow + sx];
      slots.push(s ? [...s] : null);
    }
  }
  p.w = w;
  p.h = h;
  p.slots = slots;
}
// Preset: tiles relative to its top-left corner, with the layer each came from.
interface Preset {
  name: string;
  w: number;
  h: number;
  tiles: [number, number, Pack, number, string][];
}
// Scatter set: items picked at random by weight and dropped into a dragged rectangle.
// density = chance (%) that a cell gets something. Presets are referenced by name.
interface ScatterItem {
  tile?: [Pack, number];
  preset?: string;
  weight: number;
}
interface ScatterSet {
  name: string;
  density: number;
  noOverlap: boolean; // placed things never share a cell (presets keep their whole box)
  emptyOnly: boolean; // skip cells that already have a tile on the active layer (presets: all their cells)
  items: ScatterItem[];
}
interface Library {
  patchSets: PatchSet[];
  presets: Preset[];
  scatterSets?: ScatterSet[];
}
interface Rect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

const T = 16;
const SHEET_COLS = 12;
const SHEET_ROWS = 11;
const DUSK = [0.58, 0.56, 0.82]; // same as build-ui.mjs

const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const body = document.body;
const API = body.dataset.api!;

// ---------- state ----------

const sheets = {} as Record<Pack, HTMLImageElement>;
let scenes: Record<string, Scene> = {};
const saved: Record<string, string> = {}; // last saved JSON per scene (missing = never saved)
let name = '';
let scene: Scene;
let active = 0; // active layer index
let hidden = new Set<number>(); // hidden layers (editor only, not saved)
let tool: Tool = 'paint';
let selected: [Pack, number] = ['town', 0];
let palettePack: Pack | 'all' | 'lights' = 'town';
let library: Library = { patchSets: [], presets: [] };
let patchIndex = 0;
let selection: Rect | null = null; // select tool, inclusive cells
let moving: { c: number; r: number; dc: number; dr: number; copy: boolean } | null = null;
let clipboard: Preset | null = null;
let stamp: Preset | null = null; // what the stamp tool places
let zoom = 2;
let showGrid = true;
let dusk = true;
let playActors = true;
let selectedActor = -1;
let selectedLight = -1;
let placingLight: number | 'new' | null = null; // the next map click places this light
let newLightType = 'torch';
const lightSheets = {} as { raw: HTMLImageElement; dusk: HTMLImageElement };
let dirty = false;
const undoStack: string[] = [];
const redoStack: string[] = [];

// ---------- helpers ----------

// Tile lookup: an index per layer, "col,row" → position in layer.tiles. It is rebuilt when
// the layer's array is replaced, its length changes behind our back, or the epoch moves on
// (bumped after edits that change tile coordinates in place, e.g. inserting rows).
let indexEpoch = 0;
const indexes = new WeakMap<Layer, { tiles: Tile[]; length: number; epoch: number; map: Map<string, number> }>();
function layerIndex(layer: Layer) {
  let ix = indexes.get(layer);
  if (!ix || ix.tiles !== layer.tiles || ix.length !== layer.tiles.length || ix.epoch !== indexEpoch) {
    const map = new Map<string, number>();
    layer.tiles.forEach((t, i) => map.set(`${t[0]},${t[1]}`, i));
    ix = { tiles: layer.tiles, length: layer.tiles.length, epoch: indexEpoch, map };
    indexes.set(layer, ix);
  }
  return ix;
}

function tileAt(layer: Layer, c: number, r: number) {
  return layerIndex(layer).map.get(`${c},${r}`) ?? -1;
}

function setTile(layer: Layer, c: number, r: number, pack: Pack, index: number) {
  if (c < 0 || r < 0 || c >= scene.cols || r >= scene.rows) return;
  const ix = layerIndex(layer);
  const i = ix.map.get(`${c},${r}`);
  if (i !== undefined) layer.tiles[i] = [c, r, pack, index];
  else {
    layer.tiles.push([c, r, pack, index]);
    ix.map.set(`${c},${r}`, layer.tiles.length - 1);
    ix.length = layer.tiles.length;
  }
}

function eraseTile(layer: Layer, c: number, r: number) {
  const i = tileAt(layer, c, r);
  if (i >= 0) layer.tiles.splice(i, 1); // indexes after i shift: the length check rebuilds the index
}

function snapshot() {
  undoStack.push(JSON.stringify(scene));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

// Dirty = different from the last saved version (so undoing back to it is clean again).
// Comparing the whole scene is slow on a big map, so it runs once editing pauses.
let dirtyTimer = 0;
function markDirty() {
  staticDirty = true;
  dirty = true;
  status('Unsaved changes', 'dirty');
  clearTimeout(dirtyTimer);
  dirtyTimer = window.setTimeout(() => {
    dirty = JSON.stringify(scene) !== saved[name];
    if (!dirty) status('No unsaved changes');
  }, 400);
}

function status(text: string, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
}

function drawTile(ctx: CanvasRenderingContext2D, pack: Pack, index: number, x: number, y: number, size: number) {
  const sx = (index % SHEET_COLS) * T;
  const sy = Math.floor(index / SHEET_COLS) * T;
  ctx.drawImage(sheets[pack], sx, sy, T, T, x, y, size, size);
}

function spriteStyle(el: HTMLElement, [pack, index]: [Pack, number], size = 32) {
  const k = size / T;
  el.style.backgroundImage = `url(${sheets[pack].src})`;
  el.style.backgroundSize = `${SHEET_COLS * T * k}px ${SHEET_ROWS * T * k}px`;
  el.style.backgroundPosition = `-${(index % SHEET_COLS) * size}px -${Math.floor(index / SHEET_COLS) * size}px`;
}

// ---------- rendering ----------

// Two canvases: #map holds the map, grid and guides and is redrawn only when they change;
// #overlay (on top, ignores the mouse) holds actors, selection and hover and is redrawn
// up to 30 times a second.
const map = $<HTMLCanvasElement>('map');
const sctx = map.getContext('2d')!;
const overlay = $<HTMLCanvasElement>('overlay');
let mctx = overlay.getContext('2d')!;
const base = document.createElement('canvas'); // the map at 1×, tinted
const bctx = base.getContext('2d')!;
let staticDirty = true;

const DUSK_RGB = `rgb(${DUSK.map((d) => Math.round(d * 255)).join(',')})`;
// Tint a canvas region (multiply), keeping its transparency.
function tint(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  copy.getContext('2d')!.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(copy, x, y);
  ctx.globalCompositeOperation = 'source-over';
}

// Actors other than the hero are dimmed like on the site; dimmed sheets are made once.
const dimSheets: Partial<Record<Pack, HTMLCanvasElement>> = {};
function dimSheet(pack: Pack) {
  if (!dimSheets[pack]) {
    const c = document.createElement('canvas');
    c.width = sheets[pack].width;
    c.height = sheets[pack].height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(sheets[pack], 0, 0);
    tint(ctx, 0, 0, c.width, c.height, 'rgb(191,186,182)');
    dimSheets[pack] = c;
  }
  return dimSheets[pack]!;
}

// Redraw one cell of the base (fast path for painting).
function renderCell(c: number, r: number) {
  const tmp = document.createElement('canvas');
  tmp.width = T;
  tmp.height = T;
  const tctx = tmp.getContext('2d')!;
  scene.layers.forEach((layer, i) => {
    if (hidden.has(i)) return;
    const k = tileAt(layer, c, r);
    if (k >= 0) drawTile(tctx, layer.tiles[k][2], layer.tiles[k][3], 0, 0, T);
  });
  if (dusk) tint(tctx, 0, 0, T, T, DUSK_RGB);
  bctx.clearRect(c * T, r * T, T, T);
  bctx.drawImage(tmp, c * T, r * T);
  staticDirty = true;
}

function renderBase() {
  base.width = scene.cols * T;
  base.height = scene.rows * T;
  bctx.clearRect(0, 0, base.width, base.height);
  scene.layers.forEach((layer, i) => {
    if (hidden.has(i)) return;
    for (const [c, r, pack, index] of layer.tiles) drawTile(bctx, pack, index, c * T, r * T, T);
  });
  if (dusk) tint(bctx, 0, 0, base.width, base.height, DUSK_RGB); // multiply like build-ui
  staticDirty = true;
  renderRepeat();
  if (scene.kind === 'world') renderStretch();
}

let hover: { c: number; r: number } | null = null;
let drag: { c0: number; r0: number; c1: number; r1: number } | null = null;

function actorPosition(a: Actor, time: number) {
  if (a.type === 'path') return pathAt(a.points, a.speed ?? 2, time / 1000 + (a.delay ?? 0)) ?? { x: 0, y: 0, flip: false, alpha: 0 };
  const d = a.duration * 1000;
  const p = ((((time / 1000 + (a.delay ?? 0)) % a.duration) + a.duration) % a.duration) * 1000 / d;
  const lerp = (x: number, y: number, k: number) => x + (y - x) * k;
  if (a.type === 'walk') {
    const up = a.up ?? 0;
    const y0 = a.row + 0.5 - 4 / 32; // middle of a 2-row road, as in the CSS
    if (p < 0.78) return { x: lerp(a.from, a.to, p / 0.78), y: y0, flip: false, alpha: p < 0.03 ? p / 0.03 : 1 };
    if (p < 0.92) return { x: a.to, y: y0 - up * ((p - 0.78) / 0.14), flip: false, alpha: 1 };
    return { x: a.to, y: y0 - up, flip: false, alpha: p < 0.96 ? 1 - (p - 0.92) / 0.04 : 0 };
  }
  if (p < 0.46) return { x: lerp(a.from, a.to, p / 0.46), y: a.row, flip: false, alpha: 1 };
  if (p < 0.5) return { x: a.to, y: a.row, flip: p >= 0.48, alpha: 1 };
  if (p < 0.96) return { x: lerp(a.to, a.from, (p - 0.5) / 0.46), y: a.row, flip: true, alpha: 1 };
  return { x: a.from, y: a.row, flip: false, alpha: 1 };
}

// Lights as on the site: sprite (flames animate), then a soft glow added on top (screen).
const hexRgb = (hex: string) => {
  const h = hex.length === 4 ? hex.replace(/\w/g, (c) => c + c) : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
// Same shape as the CSS @keyframes flicker / breathe.
const FLICKER = [[0, 1, 1], [0.09, 0.82, 0.96], [0.17, 0.95, 1.01], [0.31, 0.78, 0.95], [0.42, 1, 1.02], [0.56, 0.88, 0.98], [0.68, 0.97, 1], [0.79, 0.8, 0.96], [0.9, 0.93, 1.01], [1, 1, 1]];
function flickerAt(t: number): [number, number] {
  const i = FLICKER.findIndex((f) => f[0] >= t);
  const a = FLICKER[Math.max(0, i - 1)], b = FLICKER[i];
  const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function drawLights(time: number) {
  const S = T * zoom;
  const sheet = dusk ? lightSheets.dusk : lightSheets.raw;
  const lights = (scene.lights ?? []).map(resolveLight);
  const phase = (l: Light) => ((l.col * 7 + l.row * 13) % 17) / 10;
  const spriteAt = (index: number, c: number, r: number) =>
    mctx.drawImage(sheet, (index % LIGHTS_SHEET_COLS) * T, Math.floor(index / LIGHTS_SHEET_COLS) * T, T, T, c * S, r * S, S, S);
  for (const l of lights) {
    if (!l.frames.length) continue;
    const f = playActors && l.frames.length > 1 ? Math.floor(((time / 1000 + phase(l)) % 0.45) / 0.15) % l.frames.length : 0;
    spriteAt(l.frames[f], l.col, l.row);
    if (l.below !== undefined) spriteAt(l.below, l.col, l.row + 1);
  }
  mctx.globalCompositeOperation = 'screen';
  for (const l of lights) {
    let [alpha, scale] = [1, 1];
    if (playActors && l.flicker === true) [alpha, scale] = flickerAt((((time / 1000 + phase(l)) % 2.3) + 2.3) % 2.3 / 2.3);
    if (playActors && l.flicker === 'breathe') {
      const k = (1 - Math.cos(((time / 1000 + phase(l)) / 4) * Math.PI)) / 2;
      [alpha, scale] = [0.7 + 0.3 * k, 0.94 + 0.09 * k];
    }
    const x = (l.col + l.glowAt[0]) * S, y = (l.row + l.glowAt[1]) * S, rad = l.radius * S * scale;
    const [r, g, b] = hexRgb(l.color);
    const c = (a: number) => `rgba(${r},${g},${b},${a * l.intensity * alpha})`;
    const grad = mctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, c(1));
    grad.addColorStop(0.35, c(0.45));
    grad.addColorStop(0.7, c(0.12));
    grad.addColorStop(1, c(0));
    mctx.fillStyle = grad;
    mctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  mctx.globalCompositeOperation = 'source-over';
  // With the Lights tab open, every light gets a faint box so they are easy to find.
  if (palettePack === 'lights') {
    mctx.strokeStyle = 'rgba(245,213,71,0.45)';
    mctx.lineWidth = 1;
    mctx.setLineDash([3, 3]);
    lights.forEach((l, i) => i !== selectedLight && mctx.strokeRect(l.col * S + 0.5, l.row * S + 0.5, S - 1, (l.below !== undefined ? 2 : 1) * S - 1));
    mctx.setLineDash([]);
  }
  const sel = lights[selectedLight];
  if (sel) {
    // Selected: a blinking box (faster right after it was picked), its glow's reach, and a label.
    const fast = time < focusFlashUntil;
    const on = Math.floor(time / (fast ? 120 : 500)) % 2 === 0;
    const h = (sel.below !== undefined ? 2 : 1) * S;
    mctx.lineWidth = 2;
    mctx.strokeStyle = on ? '#f5d547' : '#ffffff';
    mctx.strokeRect(sel.col * S - 2, sel.row * S - 2, S + 4, h + 4);
    mctx.setLineDash([4, 4]);
    mctx.beginPath();
    mctx.arc((sel.col + sel.glowAt[0]) * S, (sel.row + sel.glowAt[1]) * S, sel.radius * S, 0, Math.PI * 2);
    mctx.stroke();
    mctx.setLineDash([]);
    const label = `#${selectedLight + 1} ${sel.type}`;
    mctx.font = 'bold 11px system-ui';
    const w = mctx.measureText(label).width + 8;
    const lx = sel.col * S + S / 2 - w / 2, ly = sel.row * S - 20;
    mctx.fillStyle = '#f5d547';
    mctx.fillRect(lx, ly, w, 15);
    mctx.fillStyle = '#1b1830';
    mctx.fillText(label, lx + 4, ly + 11);
  }
}

// Select a light: highlight it in the list and on the map, and bring both into view.
let focusFlashUntil = 0;
function focusLight(i: number, { scrollMap = true, scrollList = true } = {}) {
  selectedLight = i;
  focusFlashUntil = performance.now() + 1200;
  const items = $('lights').querySelectorAll('li');
  items.forEach((x, j) => x.classList.toggle('selected', j === i));
  if (scrollList) items[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const l = scene.lights?.[i];
  if (scrollMap && l) {
    const main = document.querySelector('main')!;
    const S = T * zoom;
    const m = main.getBoundingClientRect(), c = map.getBoundingClientRect();
    const x = c.left - m.left + main.scrollLeft + (l.col + 0.5) * S;
    const y = c.top - m.top + main.scrollTop + (l.row + 0.5) * S;
    const visible = x > main.scrollLeft + 40 && x < main.scrollLeft + main.clientWidth - 40 && y > main.scrollTop + 40 && y < main.scrollTop + main.clientHeight - 40;
    if (!visible) main.scrollTo({ left: x - main.clientWidth / 2, top: y - main.clientHeight / 2, behavior: 'smooth' });
  }
}

// The light drawn on cell c, r (or the nearest one within a tile), or -1.
function lightAt(c: number, r: number) {
  let best = -1, dist = 1.5;
  (scene.lights ?? []).map(resolveLight).forEach((l, i) => {
    const d = Math.hypot(l.col - c, Math.max(0, l.row - r, r - (l.row + (l.below !== undefined ? 1 : 0))));
    if (d < dist) (best = i), (dist = d);
  });
  return best;
}

function renderStatic() {
  const S = T * zoom;
  for (const cv of [map, overlay]) {
    if (cv.width !== scene.cols * S || cv.height !== scene.rows * S) {
      cv.width = scene.cols * S;
      cv.height = scene.rows * S;
    }
  }
  const keep = mctx;
  mctx = sctx; // the guide helpers draw on mctx
  mctx.imageSmoothingEnabled = false;
  mctx.clearRect(0, 0, map.width, map.height);
  mctx.drawImage(base, 0, 0, map.width, map.height);
  if (showGrid) {
    mctx.strokeStyle = 'rgba(255,255,255,0.12)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    for (let c = 1; c < scene.cols; c++) mctx.moveTo(c * S + 0.5, 0), mctx.lineTo(c * S + 0.5, map.height);
    for (let r = 1; r < scene.rows; r++) mctx.moveTo(0, r * S + 0.5), mctx.lineTo(map.width, r * S + 0.5);
    mctx.stroke();
  }

  if (scene.kind === 'world') drawWorldGuides();
  mctx = keep;
  staticDirty = false;
}

function render(time = performance.now()) {
  const S = T * zoom;
  if (staticDirty || map.width !== scene.cols * S) renderStatic();
  mctx.imageSmoothingEnabled = false;
  mctx.clearRect(0, 0, overlay.width, overlay.height);
  if (zoneDrag?.kind === 'new') {
    const [r0, r1] = [Math.min(zoneDrag.r0, zoneDrag.r1), Math.max(zoneDrag.r0, zoneDrag.r1)];
    mctx.fillStyle = 'rgba(245, 213, 71, 0.25)';
    mctx.fillRect(0, r0 * S, map.width, (r1 - r0 + 1) * S);
  }

  // Actors and their paths.
  if (scene.kind !== 'texture') {
    (scene.actors ?? []).forEach((a, i) => {
      mctx.strokeStyle = i === selectedActor ? '#f5d547' : 'rgba(245,213,71,0.35)';
      mctx.setLineDash([4, 4]);
      mctx.beginPath();
      if (a.type === 'path') {
        (a.points ?? []).forEach(([px, py], k) => (k ? mctx.lineTo : mctx.moveTo).call(mctx, (px + 0.5) * S, (py + 0.5) * S));
      } else {
        const y = (a.type === 'walk' ? a.row + 1 - 4 / 32 : a.row + 0.5) * S; // through the sprite's middle
        mctx.moveTo((a.from + 0.5) * S, y);
        mctx.lineTo((a.to + 0.5) * S, y);
        if (a.type === 'walk' && a.up) mctx.lineTo((a.to + 0.5) * S, y - a.up * S);
      }
      mctx.stroke();
      mctx.setLineDash([]);
      if (a.type === 'path' && i === selectedActor) {
        mctx.fillStyle = '#f5d547';
        for (const [px, py, pause] of a.points ?? []) mctx.fillRect((px + 0.5) * S - 3, (py + 0.5) * S - 3, pause ? 7 : 5, pause ? 7 : 5);
      }

      const still = a.type === 'path' ? { x: a.points?.[0]?.[0] ?? 0, y: a.points?.[0]?.[1] ?? 0, flip: false, alpha: 1 } : { x: a.from, y: a.type === 'walk' ? a.row + 0.5 - 4 / 32 : a.row, flip: false, alpha: 1 };
      const pos = playActors ? actorPosition(a, time) : still;
      mctx.save();
      mctx.globalAlpha = pos.alpha;
      const sheet = a.hero ? sheets[a.sprite[0]] : dimSheet(a.sprite[0]);
      const sx = (a.sprite[1] % SHEET_COLS) * T;
      const sy = Math.floor(a.sprite[1] / SHEET_COLS) * T;
      const x = pos.x * S;
      const yy = pos.y * S;
      if (pos.flip) {
        mctx.translate(x + S, yy);
        mctx.scale(-1, 1);
        mctx.drawImage(sheet, sx, sy, T, T, 0, 0, S, S);
      } else {
        mctx.drawImage(sheet, sx, sy, T, T, x, yy, S, S);
      }
      mctx.restore();
    });
  }

  if (scene.kind === 'world') drawLights(time);

  // Selection, with the tiles being moved drawn at their new place.
  if (selection) {
    const sel = moving ? offsetRect(selection, moving.dc, moving.dr) : selection;
    if (moving) drawPreset(copySelection(selection), sel.c0, sel.r0, 0.8);
    mctx.strokeStyle = '#f5d547';
    mctx.lineWidth = 2;
    mctx.setLineDash([6, 4]);
    mctx.strokeRect(sel.c0 * S + 1, sel.r0 * S + 1, (sel.c1 - sel.c0 + 1) * S - 2, (sel.r1 - sel.r0 + 1) * S - 2);
    mctx.setLineDash([]);
  }

  // Hover / drag preview.
  if (drag) {
    const d = normal(drag);
    mctx.strokeStyle = '#f5d547';
    mctx.lineWidth = 2;
    if (tool === 'select') mctx.setLineDash([6, 4]);
    mctx.strokeRect(d.c0 * S + 1, d.r0 * S + 1, (d.c1 - d.c0 + 1) * S - 2, (d.r1 - d.r0 + 1) * S - 2);
    mctx.setLineDash([]);
  } else if (hover && tool === 'stamp' && stamp) {
    drawPreset(stamp, hover.c, hover.r, 0.6);
    mctx.strokeStyle = '#f5d547';
    mctx.lineWidth = 2;
    mctx.strokeRect(hover.c * S + 1, hover.r * S + 1, stamp.w * S - 2, stamp.h * S - 2);
  } else if (hover && tool !== 'select' && tool !== 'zone') {
    if (tool === 'paint') {
      mctx.globalAlpha = 0.6;
      drawTile(mctx, selected[0], selected[1], hover.c * S, hover.r * S, S);
      mctx.globalAlpha = 1;
    }
    mctx.strokeStyle = tool === 'erase' ? '#e4572e' : '#f5d547';
    mctx.lineWidth = 2;
    mctx.strokeRect(hover.c * S + 1, hover.r * S + 1, S - 2, S - 2);
  }
}

function drawPreset(p: Preset, c0: number, r0: number, alpha: number) {
  const S = T * zoom;
  mctx.globalAlpha = alpha;
  for (const [dc, dr, pack, index] of p.tiles) drawTile(mctx, pack, index, (c0 + dc) * S, (r0 + dr) * S, S);
  mctx.globalAlpha = 1;
}

let lastFrame = 0;
function loop(time: number) {
  if (scene && (time - lastFrame >= 33 || staticDirty)) {
    lastFrame = time;
    render(time);
  }
  requestAnimationFrame(loop);
}

// Textures repeat on the page; show how the seams meet.
const repeat = $<HTMLCanvasElement>('repeat');
function renderRepeat() {
  const isTexture = scene.kind === 'texture';
  repeat.classList.toggle('hidden', !isTexture);
  if (!isTexture) return;
  const nx = name === 'forest-left' || name === 'forest-right' ? 1 : 3;
  const ny = name === 'horizon' ? 1 : 2;
  repeat.width = base.width * nx * 2;
  repeat.height = base.height * ny * 2;
  const ctx = repeat.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#17142e';
  ctx.fillRect(0, 0, repeat.width, repeat.height);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) ctx.drawImage(base, x * base.width * 2, y * base.height * 2, base.width * 2, base.height * 2);
}

// ---------- world: zones, guides, rows, stretch preview ----------

// Problems that would make the page ignore a zone or an actor. Saving is blocked while any exist.
function worldProblems(): string[] {
  if (scene.kind !== 'world') return [];
  const { errors, zones } = layoutWorld(scene);
  const out = [...errors];
  for (const id of ZONE_IDS) if (!zones.some((z: Zone) => z.id === id)) out.push(`no "${id}" zone: that part of the page has no map`);
  const { bands } = layoutWorld(scene);
  (scene.actors ?? []).forEach((a, i) => {
    if (a.type === 'path') {
      if (!a.points?.length) out.push(`actor ${i + 1}: a path needs points`);
      else if (!bandOfActor(a, bands)) out.push(`actor ${i + 1}: its path is not in any band, so it is never shown`);
      return;
    }
    const z = zones.find((z: Zone) => a.row >= z.from && a.row <= z.to);
    if (z) out.push(`actor ${i + 1} is in the "${z.id}" zone; actors go in bands (between zones)`);
  });
  (scene.lights ?? []).forEach((l, i) => {
    if (!bandOfLight(l, bands)) out.push(`light ${i + 1} (${l.type}) is in a zone; lights go in bands (between zones)`);
  });
  return out;
}

// Page geometry in map pixels (the page shows the map at ×2, centered).
const CONTENT_HALF = 444 / 2; // content column is 888 px wide on the page
const VIEWPORTS: [string, number][] = [['phone 390', 390], ['laptop 1280', 1280], ['desktop 1920', 1920]];

function drawWorldGuides() {
  const S = T * zoom;
  const k = zoom; // map px → canvas px
  const cx = (scene.cols * T * k) / 2;
  const { zones, bands } = layoutWorld(scene);

  for (const z of zones as Zone[]) {
    mctx.fillStyle = 'rgba(245, 213, 71, 0.10)';
    mctx.fillRect(0, z.from * S, map.width, (z.to - z.from + 1) * S);
    mctx.fillStyle = 'rgba(245, 213, 71, 0.16)';
    mctx.fillRect(0, z.repeatFrom * S, map.width, (z.repeatTo - z.repeatFrom + 1) * S);
    mctx.strokeStyle = 'rgba(245, 213, 71, 0.9)';
    mctx.lineWidth = 1;
    mctx.strokeRect(0.5, z.from * S + 0.5, map.width - 1, (z.to - z.from + 1) * S - 1);
    mctx.setLineDash([2, 3]);
    mctx.strokeRect(1.5, z.repeatFrom * S + 1.5, map.width - 3, (z.repeatTo - z.repeatFrom + 1) * S - 3);
    mctx.setLineDash([]);
    label(`zone ${z.id} · repeat ${z.repeatFrom}–${z.repeatTo}`, 4, z.from * S + 2);
  }
  for (const b of bands) if (b.to >= b.from) label(`band ${b.id}`, 4, b.from * S + 2, 'rgba(201, 191, 220, 0.95)');

  // Content column and screen widths.
  mctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  mctx.setLineDash([]);
  for (const x of [cx - CONTENT_HALF * k, cx + CONTENT_HALF * k]) line(x);
  mctx.setLineDash([5, 5]);
  VIEWPORTS.forEach(([name, w], i) => {
    mctx.strokeStyle = ['rgba(228, 87, 46, 0.8)', 'rgba(76, 208, 135, 0.8)', 'rgba(46, 134, 222, 0.8)'][i];
    const half = (w / 4) * k; // page px → map px is ÷2, half of it
    line(cx - half);
    line(cx + half);
    label(name, cx + half + 3, map.height - 16 - i * 14, mctx.strokeStyle as string);
  });
  mctx.setLineDash([]);
}

function line(x: number) {
  mctx.beginPath();
  mctx.moveTo(Math.round(x) + 0.5, 0);
  mctx.lineTo(Math.round(x) + 0.5, map.height);
  mctx.stroke();
}

function label(text: string, x: number, y: number, color = 'rgba(245, 213, 71, 0.95)') {
  mctx.font = '11px system-ui';
  const w = mctx.measureText(text).width + 6;
  mctx.fillStyle = 'rgba(22, 20, 31, 0.85)';
  mctx.fillRect(x, y, w, 14);
  mctx.fillStyle = color;
  mctx.fillText(text, x + 3, y + 11);
}

// Insert n rows before row `at` (copies of the row above, so edges continue), or delete rows a..b.
// Tiles, zones and actors below move with them.
function insertRows(at: number, n: number) {
  indexEpoch++; // tile coordinates change in place
  const src = Math.max(0, at - 1);
  for (const l of scene.layers) {
    const copy = l.tiles.filter((t) => t[1] === src);
    for (const t of l.tiles) if (t[1] >= at) t[1] += n;
    if (at > 0) for (let i = 0; i < n; i++) for (const [c, , pack, index] of copy) l.tiles.push([c, at + i, pack, index]);
  }
  for (const z of scene.zones ?? []) for (const k of ['from', 'to', 'repeatFrom', 'repeatTo'] as const) if (z[k] >= at) z[k] += n;
  for (const a of scene.actors ?? []) if (a.row >= at) a.row += n;
  for (const l of scene.lights ?? []) if (l.row >= at) l.row += n;
  scene.rows += n;
}

function deleteRows(a: number, b: number) {
  indexEpoch++;
  const n = b - a + 1;
  for (const l of scene.layers) {
    l.tiles = l.tiles.filter((t) => t[1] < a || t[1] > b);
    for (const t of l.tiles) if (t[1] > b) t[1] -= n;
  }
  const start = (f: number) => (f > b ? f - n : f >= a ? a : f);
  const end = (f: number) => (f > b ? f - n : f >= a ? a - 1 : f);
  for (const z of scene.zones ?? []) {
    z.from = start(z.from);
    z.repeatFrom = start(z.repeatFrom);
    z.to = end(z.to);
    z.repeatTo = end(z.repeatTo);
  }
  scene.actors = (scene.actors ?? []).filter((x) => x.row < a || x.row > b);
  for (const x of scene.actors) if (x.row > b) x.row -= n;
  if (scene.lights) {
    scene.lights = scene.lights.filter((x) => x.row < a || x.row > b);
    for (const x of scene.lights) if (x.row > b) x.row -= n;
  }
  scene.rows -= n;
}

$('insert-rows').addEventListener('click', () => {
  if (!selection) return status('Select a row first (select tool): new rows go above it', 'error');
  const n = Math.max(1, Math.min(50, Number($<HTMLInputElement>('row-count').value) || 1));
  const at = selection.r0;
  snapshot();
  insertRows(at, n);
  if (selection) selection = offsetRect(selection, 0, n);
  $<HTMLInputElement>('rows').value = String(scene.rows);
  edited();
  status(`Inserted ${n} row(s) at row ${at}`, 'dirty');
});
$('delete-rows').addEventListener('click', () => {
  if (!selection) return status('Select the rows to delete first (select tool)', 'error');
  const [a, b] = [selection.r0, selection.r1];
  if (b - a + 1 >= scene.rows) return status('Cannot delete every row', 'error');
  if (!confirm(`Delete rows ${a}–${b} (${b - a + 1} rows) across the whole map?`)) return;
  snapshot();
  deleteRows(a, b);
  selection = null;
  $<HTMLInputElement>('rows').value = String(scene.rows);
  edited();
  status(`Deleted rows ${a}–${b}`, 'dirty');
});

function renderZones() {
  const isWorld = scene.kind === 'world';
  $('zones-panel').classList.toggle('hidden', !isWorld);
  $('world-tools').classList.toggle('hidden', !isWorld);
  document.querySelector<HTMLElement>('[data-tool="zone"]')!.classList.toggle('hidden', !isWorld);
  if (!isWorld && tool === 'zone') setTool('paint');
  renderStretch();
  if (!isWorld) return;
  const list = $('zones');
  list.innerHTML = '';
  (scene.zones ??= []).forEach((z, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="row">
        <select data-k="id">${ZONE_IDS.map((id: string) => `<option${id === z.id ? ' selected' : ''}>${id}</option>`).join('')}</select>
        <button data-act="sel" title="Use the selected rows: the zone covers them, repeat = all but the first and last">From selection</button>
        <span class="spacer"></span>
        <button data-act="del" class="danger" title="Delete zone">✕</button>
      </div>
      <div class="row"><span class="muted">rows</span> <input type="number" data-k="from" /> – <input type="number" data-k="to" /></div>
      <div class="row"><span class="muted">repeat</span> <input type="number" data-k="repeatFrom" /> – <input type="number" data-k="repeatTo" /></div>`;
    li.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((input) => {
      const k = input.dataset.k as keyof Zone;
      if (k !== 'id') input.value = String(z[k]);
      input.addEventListener('change', () => {
        snapshot();
        if (k === 'id') z.id = input.value;
        else if (Number.isInteger(Number(input.value))) (z as unknown as Record<string, number>)[k] = Number(input.value);
        edited();
      });
    });
    li.querySelector<HTMLButtonElement>('[data-act="sel"]')!.addEventListener('click', () => {
      if (!selection) return status('Select some rows first (select tool)', 'error');
      snapshot();
      z.from = selection.r0;
      z.to = selection.r1;
      z.repeatFrom = selection.r1 - selection.r0 >= 2 ? selection.r0 + 1 : selection.r0;
      z.repeatTo = selection.r1 - selection.r0 >= 2 ? selection.r1 - 1 : selection.r1;
      edited();
    });
    li.querySelector<HTMLButtonElement>('[data-act="del"]')!.addEventListener('click', () => {
      snapshot();
      scene.zones!.splice(i, 1);
      edited();
    });
    list.appendChild(li);
  });
  const problems = worldProblems();
  const box = $('zone-problems');
  box.innerHTML = problems.map((p) => `<li>${p.replace(/</g, '&lt;')}</li>`).join('');
  box.classList.toggle('hidden', !problems.length);
}

$('add-zone').addEventListener('click', () => {
  const used = new Set((scene.zones ?? []).map((z) => z.id));
  const id = ZONE_IDS.find((x: string) => !used.has(x)) ?? ZONE_IDS[0];
  const r = selection ? selection.r0 : Math.max(0, scene.rows - 3);
  const to = selection ? selection.r1 : scene.rows - 1;
  snapshot();
  (scene.zones ??= []).push({ id, from: r, to, repeatFrom: r, repeatTo: to });
  edited();
});

// Stretch preview: the page as a laptop (1280 px) would show it, with every zone's repeat
// rows tiled `extra` more rows, so you can check the seams of long sections.
const stretch = $<HTMLCanvasElement>('stretch');
function renderStretch() {
  const show = scene.kind === 'world';
  $('stretch-box').classList.toggle('hidden', !show);
  if (!show) return;
  const extra = Math.max(0, Math.min(64, Number($<HTMLInputElement>('stretch-extra').value) || 0));
  const { zones } = layoutWorld(scene);
  const order: number[] = [];
  for (let r = 0; r < scene.rows; r++) {
    order.push(r);
    const z = (zones as Zone[]).find((z) => z.repeatTo === r);
    if (z) {
      const block = z.repeatTo - z.repeatFrom + 1;
      for (let i = 0; i < extra; i++) order.push(z.repeatFrom + (i % block));
    }
  }
  const view = 640; // 1280 page px = 640 map px
  const x0 = (base.width - view) / 2;
  stretch.width = Math.min(view, base.width);
  stretch.height = order.length * T;
  const ctx = stretch.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  order.forEach((r, i) => ctx.drawImage(base, Math.max(0, x0), r * T, stretch.width, T, 0, i * T, stretch.width, T));
}
$('stretch-extra').addEventListener('input', renderStretch);

// ---------- palette ----------

const palette = $<HTMLCanvasElement>('palette');
const pctx = palette.getContext('2d')!;
const PS = 24; // palette tile size (1.5×, just for picking)
const PACKS: Pack[] = ['town', 'farm', 'dungeon'];
const LABEL = 16; // label height above each sheet in "All"
const shownPacks = (): Pack[] => (palettePack === 'all' ? PACKS : palettePack === 'lights' ? [] : [palettePack]);
const blockHeight = () => (palettePack === 'all' ? LABEL : 0) + SHEET_ROWS * PS;

// "Lights" tab: one box per light type; pick one, then click the map to place it.
const LIGHT_BOX = 48;
const LIGHT_LABEL = 14;
const lightKinds = () => Object.keys(LIGHT_TYPES);
function renderLightPalette() {
  const per = Math.floor((SHEET_COLS * PS) / LIGHT_BOX);
  const kinds = lightKinds();
  palette.width = SHEET_COLS * PS;
  palette.height = Math.ceil(kinds.length / per) * (LIGHT_BOX + LIGHT_LABEL);
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, palette.width, palette.height);
  kinds.forEach((kind, i) => {
    const x = (i % per) * LIGHT_BOX, y = Math.floor(i / per) * (LIGHT_BOX + LIGHT_LABEL);
    const l = resolveLight({ type: kind, col: 0, row: 0 });
    pctx.fillStyle = '#2a2540';
    pctx.fillRect(x + 2, y + 2, LIGHT_BOX - 4, LIGHT_BOX - 4);
    const [r, g, b] = hexRgb(l.color);
    const grad = pctx.createRadialGradient(x + 24, y + 22, 0, x + 24, y + 22, 20);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.6)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    pctx.fillStyle = grad;
    pctx.fillRect(x + 2, y + 2, LIGHT_BOX - 4, LIGHT_BOX - 4);
    const sprite = (index: number, dy: number, size: number) =>
      pctx.drawImage(lightSheets.raw, (index % LIGHTS_SHEET_COLS) * T, Math.floor(index / LIGHTS_SHEET_COLS) * T, T, T, x + (LIGHT_BOX - size) / 2, y + dy, size, size);
    if (l.below !== undefined) (sprite(l.frames[0], 4, 20), sprite(l.below, 24, 20));
    else if (l.frames.length) sprite(l.frames[0], 8, 32);
    if (placingLight === 'new' && newLightType === kind) {
      pctx.strokeStyle = '#f5d547';
      pctx.lineWidth = 2;
      pctx.strokeRect(x + 2, y + 2, LIGHT_BOX - 4, LIGHT_BOX - 4);
    }
    pctx.fillStyle = '#9a93b0';
    pctx.font = '10px system-ui';
    pctx.textAlign = 'center';
    pctx.fillText(kind === 'window-gray' ? 'win gray' : kind, x + LIGHT_BOX / 2, y + LIGHT_BOX + 10);
    pctx.textAlign = 'start';
  });
  $('selected-tile').textContent = placingLight === 'new' ? `Placing: ${newLightType} · click the map · Esc to stop` : 'Pick a light, then click the map';
  document.querySelectorAll<HTMLButtonElement>('#packs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pack === palettePack)));
}
function lightKindAt(e: MouseEvent) {
  const per = Math.floor((SHEET_COLS * PS) / LIGHT_BOX);
  const c = Math.floor(e.offsetX / LIGHT_BOX), r = Math.floor(e.offsetY / (LIGHT_BOX + LIGHT_LABEL));
  return c < per ? lightKinds()[r * per + c] : undefined;
}
function startPlacingLight(kind: string) {
  newLightType = kind;
  $<HTMLSelectElement>('new-light-type').value = kind;
  placingLight = 'new';
  status(`Click the map to place a ${kind} (on the tile it stands on) · Esc to stop`);
  if (palettePack === 'lights') renderLightPalette();
}

function renderPalette() {
  if (palettePack === 'lights') return renderLightPalette();
  const packs = shownPacks();
  palette.width = SHEET_COLS * PS;
  palette.height = packs.length * blockHeight() + (packs.length - 1) * 8;
  pctx.imageSmoothingEnabled = false;
  packs.forEach((pack, i) => {
    let y = i * (blockHeight() + 8);
    if (palettePack === 'all') {
      pctx.fillStyle = '#9a93b0';
      pctx.font = '11px system-ui';
      pctx.fillText(pack, 2, y + 12);
      y += LABEL;
    }
    pctx.drawImage(sheets[pack], 0, y, SHEET_COLS * PS, SHEET_ROWS * PS);
    if (selected[0] === pack) {
      const k = selected[1];
      pctx.strokeStyle = '#f5d547';
      pctx.lineWidth = 2;
      pctx.strokeRect((k % SHEET_COLS) * PS + 1, y + Math.floor(k / SHEET_COLS) * PS + 1, PS - 2, PS - 2);
    }
  });
  $('selected-tile').textContent = `Selected: ${selected[0]} ${selected[1]}`;
  document.querySelectorAll<HTMLButtonElement>('#packs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pack === palettePack)));
}

function paletteTile(e: MouseEvent): [Pack, number] | null {
  const packs = shownPacks();
  const block = blockHeight() + 8;
  const i = Math.floor(e.offsetY / block);
  let y = e.offsetY - i * block - (palettePack === 'all' ? LABEL : 0);
  const c = Math.floor(e.offsetX / PS);
  const r = Math.floor(y / PS);
  if (!packs[i] || y < 0 || c < 0 || c >= SHEET_COLS || r < 0 || r >= SHEET_ROWS) return null;
  return [packs[i], r * SHEET_COLS + c];
}

palette.addEventListener('click', (e) => {
  if (palettePack === 'lights') {
    const kind = lightKindAt(e);
    if (kind) startPlacingLight(kind);
    return;
  }
  const t = paletteTile(e);
  if (!t) return;
  selected = t;
  placingLight = null;
  if (tool === 'erase' || tool === 'pick' || tool === 'select' || tool === 'stamp') setTool('paint');
  renderPalette();
});
palette.addEventListener('mousemove', (e) => {
  if (palettePack === 'lights') return void ($('cursor').textContent = lightKindAt(e) ?? '');
  const t = paletteTile(e);
  $('cursor').textContent = t ? `palette: ${t[0]} ${t[1]}` : '';
});
document.querySelectorAll<HTMLButtonElement>('#packs button').forEach((b) =>
  b.addEventListener('click', () => {
    palettePack = b.dataset.pack as Pack | 'all' | 'lights';
    renderPalette();
  }),
);

// ---------- tools ----------

function setTool(t: Tool) {
  if (placingLight === 'new') placingLight = null; // choosing a tool ends light placing
  tool = t;
  if (t !== 'select') selection = null;
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  $('patch-options').classList.toggle('hidden', t !== 'patch');
  $('select-options').classList.toggle('hidden', t !== 'select');
  $('scatter-options').classList.toggle('hidden', t !== 'scatter');
  $('zone-options').classList.toggle('hidden', t !== 'zone');
  if (t !== 'zone') map.style.cursor = '';
  renderPresets();
}
document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));

function cellFromEvent(e: MouseEvent) {
  const S = T * zoom;
  return { c: Math.floor(e.offsetX / S), r: Math.floor(e.offsetY / S) };
}

const normal = (d: Rect): Rect => ({
  c0: Math.min(d.c0, d.c1),
  r0: Math.min(d.r0, d.r1),
  c1: Math.max(d.c0, d.c1),
  r1: Math.max(d.r0, d.r1),
});
const offsetRect = (d: Rect, dc: number, dr: number): Rect => ({ c0: d.c0 + dc, r0: d.r0 + dr, c1: d.c1 + dc, r1: d.r1 + dr });
const inside = (d: Rect, c: number, r: number) => c >= d.c0 && c <= d.c1 && r >= d.r0 && r <= d.r1;

function layerOrWarn() {
  const layer = scene.layers[active];
  if (!layer) status('Add a layer first', 'error');
  return layer;
}

function pickAt(c: number, r: number) {
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    if (hidden.has(i)) continue;
    const t = scene.layers[i].tiles[tileAt(scene.layers[i], c, r)];
    if (t) {
      selected = [t[2], t[3]];
      if (palettePack !== 'all') palettePack = t[2];
      active = i;
      renderPalette();
      renderLayers();
      status(`Picked ${t[2]} ${t[3]} from layer "${scene.layers[i].name}"`);
      return;
    }
  }
}

function applyAt(c: number, r: number, erase: boolean) {
  const layer = layerOrWarn();
  if (!layer) return;
  if (erase) eraseTile(layer, c, r);
  else setTile(layer, c, r, selected[0], selected[1]);
  renderCell(c, r);
  markDirty();
}

function fillRect({ c0, r0, c1, r1 }: Rect) {
  const layer = layerOrWarn();
  if (!layer) return;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) setTile(layer, c, r, selected[0], selected[1]);
}

// Patch: fill a rectangle from the chosen set (see PatchSet for how slots map to cells).
function fillPatch({ c0, r0, c1, r1 }: Rect) {
  const layer = layerOrWarn();
  const set = library.patchSets[patchIndex];
  if (!layer || !set) return;
  const [w, h] = [setW(set), setH(set)];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const y = axisSlot(h, r - r0, r1 - r0 + 1);
      const x = axisSlot(w, c - c0, c1 - c0 + 1);
      const slot = set.slots[y * w + x];
      if (slot) setTile(layer, c, r, slot[0], slot[1]);
    }
  }
}

// ---------- selection, clipboard, presets ----------

// Which layers the select tool works on: the active one, or every visible one.
function scopeLayers() {
  if ($<HTMLSelectElement>('select-scope').value === 'active') return scene.layers[active] ? [active] : [];
  return scene.layers.map((_, i) => i).filter((i) => !hidden.has(i));
}

function copySelection(d: Rect, name = 'clipboard', layers = scopeLayers()): Preset {
  const tiles: Preset['tiles'] = [];
  for (const i of layers) {
    for (const [c, r, pack, index] of scene.layers[i].tiles) {
      if (inside(d, c, r)) tiles.push([c - d.c0, r - d.r0, pack, index, scene.layers[i].name]);
    }
  }
  return { name, w: d.c1 - d.c0 + 1, h: d.r1 - d.r0 + 1, tiles };
}

function clearSelection(d: Rect) {
  for (const i of scopeLayers()) scene.layers[i].tiles = scene.layers[i].tiles.filter(([c, r]) => !inside(d, c, r));
}

// Place a preset with its top-left at (c0, r0). Tiles go back to a layer with the same
// name if there is one (and "keep layers" is on); otherwise to the active layer.
function place(p: Preset, c0: number, r0: number, keep = $<HTMLInputElement>('keep-layers').checked) {
  for (const [dc, dr, pack, index, layerName] of p.tiles) {
    let layer = keep ? scene.layers.find((l) => l.name === layerName) : undefined;
    layer ??= scene.layers[active];
    if (layer) setTile(layer, c0 + dc, r0 + dr, pack, index);
  }
}

function edited() {
  renderBase();
  renderLayers();
  renderZones();
  markDirty();
}

function copy() {
  if (!selection) return;
  clipboard = copySelection(selection);
  status(`Copied ${clipboard.tiles.length} tiles (${clipboard.w} × ${clipboard.h})`);
}
function cut() {
  if (!selection) return;
  copy();
  snapshot();
  clearSelection(selection);
  edited();
}
function paste() {
  if (!clipboard) return status('Nothing copied yet', 'error');
  stamp = clipboard;
  setTool('stamp');
  status('Click to paste · Esc to stop');
}
function deleteSelection() {
  if (!selection) return;
  snapshot();
  clearSelection(selection);
  edited();
}

let painting: false | 'paint' | 'erase' = false;

map.addEventListener('contextmenu', (e) => e.preventDefault());
// ---------- zone tool (world map): drag zone edges, move zones, draw new ones ----------

type ZoneEdge = 'from' | 'to' | 'repeatFrom' | 'repeatTo';
let zoneDrag:
  | { kind: 'edge'; zone: Zone; edge: ZoneEdge }
  | { kind: 'move'; zone: Zone; start: number; orig: Zone }
  | { kind: 'new'; r0: number; r1: number }
  | null = null;

const rowAt = (e: MouseEvent) => e.offsetY / (T * zoom); // fractional row
const EDGE_PX = 6; // how close (canvas px) counts as grabbing a line

// The zone line under the mouse. Outer edges win; Shift (or no outer edge nearby) grabs repeat edges.
function zoneHit(e: MouseEvent): { zone: Zone; edge?: ZoneEdge } | null {
  const y = rowAt(e);
  const near = (line: number) => Math.abs(y - line) * T * zoom <= EDGE_PX;
  for (const z of scene.zones ?? []) {
    const outer: [ZoneEdge, number][] = [['from', z.from], ['to', z.to + 1]];
    const inner: [ZoneEdge, number][] = [['repeatFrom', z.repeatFrom], ['repeatTo', z.repeatTo + 1]];
    for (const [edge, line] of e.shiftKey ? [...inner, ...outer] : [...outer, ...inner]) if (near(line)) return { zone: z, edge };
  }
  for (const z of scene.zones ?? []) if (y >= z.from && y < z.to + 1) return { zone: z };
  return null;
}

function setZoneEdge(z: Zone, edge: ZoneEdge, line: number) {
  const last = scene.rows - 1;
  if (edge === 'from') {
    z.from = Math.max(0, Math.min(line, z.to));
    z.repeatFrom = Math.max(z.repeatFrom, z.from);
    z.repeatTo = Math.max(z.repeatTo, z.repeatFrom);
  } else if (edge === 'to') {
    z.to = Math.max(z.from, Math.min(line - 1, last));
    z.repeatTo = Math.min(z.repeatTo, z.to);
    z.repeatFrom = Math.min(z.repeatFrom, z.repeatTo);
  } else if (edge === 'repeatFrom') {
    z.repeatFrom = Math.max(z.from, Math.min(line, z.repeatTo));
  } else {
    z.repeatTo = Math.max(z.repeatFrom, Math.min(line - 1, z.to));
  }
}

function zoneDown(e: MouseEvent) {
  if (scene.kind !== 'world' || e.button !== 0) return;
  const hit = zoneHit(e);
  snapshot();
  if (hit?.edge) zoneDrag = { kind: 'edge', zone: hit.zone, edge: hit.edge };
  else if (hit) zoneDrag = { kind: 'move', zone: hit.zone, start: Math.floor(rowAt(e)), orig: { ...hit.zone } };
  else {
    const r = Math.floor(rowAt(e));
    zoneDrag = { kind: 'new', r0: r, r1: r };
  }
}

function zoneMove(e: MouseEvent) {
  const hit = zoneDrag ? null : zoneHit(e);
  map.style.cursor = zoneDrag?.kind === 'move' || (hit && !hit.edge) ? 'move' : zoneDrag?.kind === 'edge' || hit?.edge ? 'ns-resize' : 'crosshair';
  if (!zoneDrag) return;
  staticDirty = true; // zone guides are on the static canvas
  if (zoneDrag.kind === 'edge') setZoneEdge(zoneDrag.zone, zoneDrag.edge, Math.round(rowAt(e)));
  else if (zoneDrag.kind === 'move') {
    const { zone: z, orig } = zoneDrag;
    const d = Math.max(-orig.from, Math.min(Math.floor(rowAt(e)) - zoneDrag.start, scene.rows - 1 - orig.to));
    z.from = orig.from + d;
    z.to = orig.to + d;
    z.repeatFrom = orig.repeatFrom + d;
    z.repeatTo = orig.repeatTo + d;
  } else zoneDrag.r1 = Math.max(0, Math.min(scene.rows - 1, Math.floor(rowAt(e))));
}

function zoneUp() {
  if (!zoneDrag) return;
  if (zoneDrag.kind === 'new') {
    const [r0, r1] = [Math.min(zoneDrag.r0, zoneDrag.r1), Math.max(zoneDrag.r0, zoneDrag.r1)];
    const used = new Set((scene.zones ?? []).map((z) => z.id));
    const id = ZONE_IDS.find((x: string) => !used.has(x));
    if (!id) {
      zoneDrag = null;
      undoStack.pop();
      return status('Every zone already exists: drag an existing one instead', 'error');
    }
    const inner = r1 - r0 >= 2;
    (scene.zones ??= []).push({ id, from: r0, to: r1, repeatFrom: inner ? r0 + 1 : r0, repeatTo: inner ? r1 - 1 : r1 });
    status(`New zone "${id}": rows ${r0}–${r1} (change its id under Zones)`, 'dirty');
  }
  zoneDrag = null;
  if (undoStack[undoStack.length - 1] === JSON.stringify(scene)) undoStack.pop(); // nothing changed
  edited();
}

let pickingPointFor: Actor | null = null;

map.addEventListener('mousedown', (e) => {
  if (palettePack === 'lights' && placingLight === null) {
    // Lights tab: clicking the map selects the light there (tiles are not painted).
    const { c, r } = cellFromEvent(e);
    const i = lightAt(c, r);
    if (i >= 0) {
      focusLight(i, { scrollMap: false });
      status(`Selected light #${i + 1} (${scene.lights![i].type}) at ${scene.lights![i].col},${scene.lights![i].row}`);
    } else {
      selectedLight = -1;
      $('lights').querySelectorAll('li').forEach((x) => x.classList.remove('selected'));
      status('No light here · pick a light above to place one');
    }
    return;
  }
  if (placingLight !== null) {
    const { c, r } = cellFromEvent(e);
    snapshot();
    scene.lights ??= [];
    if (placingLight === 'new') {
      scene.lights.push({ type: newLightType, col: c, row: r });
      selectedLight = scene.lights.length - 1;
      status(`Added a ${newLightType} at ${c},${r} · click again for another · Esc to stop`, 'dirty');
    } else {
      Object.assign(scene.lights[placingLight], { col: c, row: r });
      selectedLight = placingLight;
      placingLight = null;
      status(`Moved the light to ${c},${r}`, 'dirty');
    }
    renderLights();
    focusLight(selectedLight, { scrollMap: false });
    markDirty();
    return;
  }
  if (pickingPointFor) {
    const S = T * zoom;
    const x = Math.round((e.offsetX / S - 0.5) * 2) / 2; // half-tile steps, sprite top-left
    const y = Math.round((e.offsetY / S - 0.5) * 2) / 2;
    snapshot();
    (pickingPointFor.points ??= []).push([x, y]);
    status(`Added point ${x},${y} · click again for more · Esc to stop`, 'dirty');
    renderActors();
    markDirty();
    return;
  }
  if (tool === 'zone') return zoneDown(e);
  const { c, r } = cellFromEvent(e);
  if (e.altKey || tool === 'pick') return pickAt(c, r);
  if (tool === 'stamp') {
    if (e.button === 2) return setTool('paint');
    if (!stamp) return;
    snapshot();
    place(stamp, c, r);
    edited();
    return;
  }
  if (tool === 'select') {
    if (e.button === 2) return;
    // Drag inside the selection moves it (Shift: copies it); outside starts a new one.
    if (selection && inside(selection, c, r)) moving = { c, r, dc: 0, dr: 0, copy: e.shiftKey };
    else {
      selection = null;
      drag = { c0: c, r0: r, c1: c, r1: r };
    }
    return;
  }
  if (tool === 'rect' || tool === 'patch' || tool === 'scatter') {
    if (e.button === 2) return;
    drag = { c0: c, r0: r, c1: c, r1: r };
    return;
  }
  snapshot();
  painting = e.button === 2 || tool === 'erase' ? 'erase' : 'paint';
  applyAt(c, r, painting === 'erase');
});
map.addEventListener('mousemove', (e) => {
  const { c, r } = cellFromEvent(e);
  hover = { c, r };
  if (tool === 'zone') zoneMove(e);
  else map.style.cursor = '';
  if (drag) (drag.c1 = c), (drag.r1 = r);
  else if (moving) (moving.dc = c - moving.c), (moving.dr = r - moving.r);
  else if (painting) applyAt(c, r, painting === 'erase');
  const under = scene.layers
    .map((l, i) => ({ l, t: l.tiles[tileAt(l, c, r)], i }))
    .filter((x) => x.t && !hidden.has(x.i))
    .map((x) => `${x.l.name}: ${x.t![2]} ${x.t![3]}`)
    .join(' · ');
  const size = selection ? ` · selection ${selection.c1 - selection.c0 + 1} × ${selection.r1 - selection.r0 + 1}` : '';
  $('cursor').textContent = `col ${c}, row ${r}${under ? ` · ${under}` : ''}${size}`;
});
map.addEventListener('mouseleave', () => (hover = null));
window.addEventListener('mouseup', () => {
  if (zoneDrag) return zoneUp();
  if (drag) {
    const d = normal(drag);
    drag = null;
    if (tool === 'select') {
      selection = d;
      renderPresets();
      return;
    }
    if (tool === 'scatter') return runScatter(d);
    snapshot();
    if (tool === 'patch') fillPatch(d);
    else fillRect(d);
    edited();
  }
  if (moving && selection) {
    const { dc, dr, copy: keepOriginal } = moving;
    moving = null;
    if (dc || dr) {
      snapshot();
      const lifted = copySelection(selection);
      if (!keepOriginal) clearSelection(selection);
      place(lifted, selection.c0 + dc, selection.r0 + dr, true); // a move stays on its own layers
      selection = offsetRect(selection, dc, dr);
      edited();
    }
  }
  if (painting) {
    renderLayers(); // tile counts
    renderRepeat();
    if (scene.kind === 'world') renderStretch();
  }
  painting = false;
});

$('copy').addEventListener('click', copy);
$('cut').addEventListener('click', cut);
$('paste').addEventListener('click', paste);
$('delete-selection').addEventListener('click', deleteSelection);

// ---------- library: patch sets and presets (site/editor/library.json) ----------

const LIBRARY_API = API.replace(/__scenes$/, '__library');

async function saveLibrary() {
  try {
    const res = await fetch(`${LIBRARY_API}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(library),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  } catch (e) {
    status(`Could not save the library: ${(e as Error).message}`, 'error');
  }
}

function renderPatchSets() {
  const select = $<HTMLSelectElement>('patch-set');
  select.innerHTML = library.patchSets.map((p, i) => `<option value="${i}">${p.name.replace(/</g, '&lt;')}</option>`).join('');
  patchIndex = Math.min(patchIndex, library.patchSets.length - 1);
  select.value = String(patchIndex);
  const grid = $('patch-slots');
  grid.innerHTML = '';
  const set = library.patchSets[patchIndex];
  if (!set) return;
  grid.style.gridTemplateColumns = `repeat(${setW(set)}, 32px)`;
  $<HTMLSelectElement>('patch-w').value = String(setW(set));
  $<HTMLSelectElement>('patch-h').value = String(setH(set));
  set.slots.forEach((slot, i) => {
    const b = document.createElement('button');
    b.className = 'sprite';
    b.title = slot ? `${slot[0]} ${slot[1]} · click: use the selected tile · right-click: empty` : 'empty · click: use the selected tile';
    if (slot) spriteStyle(b, slot);
    b.addEventListener('click', () => {
      set.slots[i] = [...selected];
      renderPatchSets();
      saveLibrary();
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      set.slots[i] = null;
      renderPatchSets();
      saveLibrary();
    });
    grid.appendChild(b);
  });
}

for (const id of ['patch-w', 'patch-h']) {
  $<HTMLSelectElement>(id).addEventListener('change', () => {
    const set = library.patchSets[patchIndex];
    if (!set) return;
    resizeSet(set, Number($<HTMLSelectElement>('patch-w').value), Number($<HTMLSelectElement>('patch-h').value));
    renderPatchSets();
    saveLibrary();
  });
}
$<HTMLSelectElement>('patch-set').addEventListener('change', (e) => {
  patchIndex = Number((e.target as HTMLSelectElement).value);
  renderPatchSets();
});
$('patch-new').addEventListener('click', () => {
  const input = $<HTMLInputElement>('patch-name');
  const n = input.value.trim();
  if (!n) return input.focus();
  const from = library.patchSets[patchIndex];
  library.patchSets.push(
    from
      ? { name: n, w: setW(from), h: setH(from), slots: from.slots.map((s) => (s ? [...s] : null)) as Slot[] }
      : { name: n, w: 3, h: 3, slots: Array(9).fill(null) },
  );
  patchIndex = library.patchSets.length - 1;
  input.value = '';
  renderPatchSets();
  saveLibrary();
});
$('patch-delete').addEventListener('click', () => {
  const set = library.patchSets[patchIndex];
  if (!set || !confirm(`Delete patch set "${set.name}"?`)) return;
  library.patchSets.splice(patchIndex, 1);
  patchIndex = 0;
  renderPatchSets();
  saveLibrary();
});

// Layers a new preset takes its tiles from (by name; unknown names are ignored).
const presetLayerOff = new Set<string>(); // unchecked layer names; everything else is in

function renderPresetLayers() {
  const box = $('preset-layers');
  box.innerHTML = '';
  if (!scene) return;
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const name = scene.layers[i].name;
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !presetLayerOff.has(name);
    check.addEventListener('change', () => {
      check.checked ? presetLayerOff.delete(name) : presetLayerOff.add(name);
    });
    label.append(check, ` ${name}`);
    box.appendChild(label);
  }
}
$('preset-layers-all').addEventListener('click', () => {
  presetLayerOff.clear();
  renderPresetLayers();
});
$('preset-layers-none').addEventListener('click', () => {
  for (const l of scene.layers) presetLayerOff.add(l.name);
  renderPresetLayers();
});

// Drop a layer from a preset, then shrink its box to the tiles that are left.
function trimPreset(p: Preset) {
  if (!p.tiles.length) return;
  const minC = Math.min(...p.tiles.map((t) => t[0]));
  const minR = Math.min(...p.tiles.map((t) => t[1]));
  for (const t of p.tiles) (t[0] -= minC), (t[1] -= minR);
  p.w = Math.max(...p.tiles.map((t) => t[0])) + 1;
  p.h = Math.max(...p.tiles.map((t) => t[1])) + 1;
}

let editingPreset: Preset | null = null;

function renderPresetEditor() {
  const box = $('preset-edit');
  box.classList.toggle('hidden', !editingPreset);
  box.innerHTML = '';
  const p = editingPreset;
  if (!p) return;
  const counts = new Map<string, number>();
  for (const t of p.tiles) counts.set(t[4], (counts.get(t[4]) ?? 0) + 1);
  const title = document.createElement('div');
  title.className = 'row';
  title.innerHTML = `<strong></strong><span class="muted">${p.w}×${p.h}</span>`;
  title.querySelector('strong')!.textContent = p.name;
  box.appendChild(title);
  for (const [layer, n] of counts) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = `${layer} · ${n} tile${n === 1 ? '' : 's'}`;
    const drop = document.createElement('button');
    drop.className = 'danger';
    drop.textContent = 'Remove';
    drop.title = `Take the "${layer}" tiles out of this preset`;
    drop.addEventListener('click', () => {
      if (counts.size === 1) return status('That would leave the preset empty; delete the preset instead', 'error');
      p.tiles = p.tiles.filter((t) => t[4] !== layer);
      trimPreset(p);
      renderPresets();
      saveLibrary();
      status(`Removed "${layer}" from preset "${p.name}"`);
    });
    row.append(label, drop);
    box.appendChild(row);
  }
  const done = document.createElement('button');
  done.textContent = 'Done';
  done.addEventListener('click', () => {
    editingPreset = null;
    renderPresetEditor();
  });
  box.appendChild(done);
}

function renderPresets() {
  renderScatterPresetOptions();
  renderPresetLayers();
  if (editingPreset && !library.presets.includes(editingPreset)) editingPreset = null;
  renderPresetEditor();
  const list = $('presets');
  list.innerHTML = '';
  library.presets.forEach((p, i) => {
    const li = document.createElement('li');
    const use = document.createElement('button');
    use.textContent = `${p.name} (${p.w}×${p.h})`;
    use.setAttribute('aria-pressed', String(tool === 'stamp' && stamp === p));
    use.addEventListener('click', () => {
      stamp = p;
      setTool('stamp');
      status(`Stamp "${p.name}": click to place · Esc to stop`);
    });
    const edit = document.createElement('button');
    edit.textContent = '✎';
    edit.title = 'Layers in this preset';
    edit.setAttribute('aria-pressed', String(editingPreset === p));
    edit.addEventListener('click', () => {
      editingPreset = editingPreset === p ? null : p;
      renderPresets();
    });
    const del = document.createElement('button');
    del.textContent = '✕';
    del.className = 'danger';
    del.title = 'Delete preset';
    del.addEventListener('click', () => {
      if (!confirm(`Delete preset "${p.name}"?`)) return;
      library.presets.splice(i, 1);
      if (stamp === p) setTool('paint');
      renderPresets();
      saveLibrary();
    });
    li.append(use, edit, del);
    list.appendChild(li);
  });
  ($('preset-save') as HTMLButtonElement).disabled = !selection;
}

$('preset-save').addEventListener('click', () => {
  const input = $<HTMLInputElement>('preset-name');
  const n = input.value.trim();
  if (!selection) return status('Select an area first (select tool)', 'error');
  if (!n) return input.focus();
  const layers = scene.layers.map((_, i) => i).filter((i) => !presetLayerOff.has(scene.layers[i].name));
  if (!layers.length) return status('Tick at least one layer to save', 'error');
  const preset = copySelection(selection, n, layers);
  if (!preset.tiles.length) return status('No tiles on the ticked layers in the selection', 'error');
  trimPreset(preset);
  library.presets.push(preset);
  input.value = '';
  renderPresets();
  saveLibrary();
  status(`Saved preset "${n}" (${preset.tiles.length} tiles)`);
});

$('fill-grass').addEventListener('click', () => {
  const layer = layerOrWarn();
  if (!layer) return;
  snapshot();
  layer.tiles = [];
  for (let r = 0; r < scene.rows; r++) {
    for (let c = 0; c < scene.cols; c++) {
      const x = Math.random();
      layer.tiles.push([c, r, 'town', x < 0.05 ? 2 : x < 0.16 ? 1 : 0]);
    }
  }
  edited();
});
$('clear-layer').addEventListener('click', () => {
  const layer = layerOrWarn();
  if (!layer || !layer.tiles.length) return;
  if (!confirm(`Remove all ${layer.tiles.length} tiles from layer "${layer.name}"? (Undo still works until you leave the page.)`)) return;
  snapshot();
  layer.tiles = [];
  renderBase();
  markDirty();
});

// ---------- scatter ----------

let scatterIndex = 0;
let lastScatter: { rect: Rect; undoLength: number } | null = null; // for "Scatter again"

const scatterSets = () => (library.scatterSets ??= []);
const currentScatter = () => scatterSets()[scatterIndex];

function pickWeighted<T extends { weight: number }>(items: T[]): T | undefined {
  const total = items.reduce((n, i) => n + Math.max(0, i.weight), 0);
  let x = Math.random() * total;
  for (const i of items) {
    x -= Math.max(0, i.weight);
    if (x < 0) return i;
  }
  return undefined;
}

function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Drop the current set's items into rect.
// A preset must fit inside rect with its whole box. "Only empty cells" looks at the active
// layer only (a preset may carry its own ground, e.g. grass, onto other layers).
function scatter(rect: Rect) {
  const result = { tiles: 0, presets: 0, missed: 0 };
  const set = currentScatter();
  const target = scene.layers[active];
  if (!set || !target) return result;
  const presets = new Map(library.presets.map((p) => [p.name, p]));
  const items = set.items.filter((i) => i.weight > 0 && (i.tile || (i.preset && presets.has(i.preset))));
  if (!items.length) return result;

  const filled = new Set(target.tiles.map((t) => `${t[0]},${t[1]}`)); // active layer, for emptyOnly
  const used = new Set<string>(); // cells taken by this scatter
  const free = (c: number, r: number) =>
    c >= rect.c0 && c <= rect.c1 && r >= rect.r0 && r <= rect.r1 && !(set.noOverlap && used.has(`${c},${r}`)) && !(set.emptyOnly && filled.has(`${c},${r}`));
  const box = (p: Preset, c: number, r: number) => Array.from({ length: p.w * p.h }, (_, k) => [c + (k % p.w), r + Math.floor(k / p.w)] as const);

  const cells: [number, number][] = [];
  for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) cells.push([c, r]);
  for (const [c, r] of shuffle(cells)) {
    if (Math.random() * 100 >= set.density) continue;
    const item = pickWeighted(items)!;
    if (item.tile) {
      if (!free(c, r)) continue;
      setTile(target, c, r, item.tile[0], item.tile[1]);
      used.add(`${c},${r}`);
      filled.add(`${c},${r}`);
      result.tiles++;
    } else {
      const p = presets.get(item.preset!)!;
      const cellsOf = box(p, c, r);
      if (!cellsOf.every(([x, y]) => free(x, y))) {
        result.missed++;
        continue;
      }
      place(p, c, r);
      for (const [x, y] of cellsOf) used.add(`${x},${y}`), filled.add(`${x},${y}`);
      result.presets++;
    }
  }
  return result;
}

function runScatter(rect: Rect) {
  if (!scene.layers[active]) return status('Add a layer first', 'error');
  const set = currentScatter();
  if (!set || !set.items.length) return status('Add tiles or presets to the scatter set first', 'error');
  snapshot();
  const n = scatter(rect);
  lastScatter = { rect, undoLength: undoStack.length };
  edited();
  const missed = n.missed ? ` · ${n.missed} preset(s) had no room` : '';
  status(`Scattered ${n.tiles} tile(s) and ${n.presets} preset(s) in ${rect.c1 - rect.c0 + 1} × ${rect.r1 - rect.r0 + 1} cells${missed} · "Scatter again" to re-roll`, 'dirty');
}

// Undo the last scatter and roll it again in the same place.
$('scatter-again').addEventListener('click', () => {
  if (!lastScatter || undoStack.length !== lastScatter.undoLength) return status('Scatter an area first (nothing to re-roll)', 'error');
  scene = JSON.parse(undoStack.pop()!);
  runScatter(lastScatter.rect);
});

function renderScatterPresetOptions() {
  const select = $<HTMLSelectElement>('scatter-preset');
  select.innerHTML = library.presets.length
    ? library.presets.map((p) => `<option>${p.name.replace(/</g, '&lt;')}</option>`).join('')
    : '<option value="">(no presets yet)</option>';
}

function renderScatter() {
  const sets = scatterSets();
  const select = $<HTMLSelectElement>('scatter-set');
  select.innerHTML = sets.map((p, i) => `<option value="${i}">${p.name.replace(/</g, '&lt;')}</option>`).join('');
  scatterIndex = Math.max(0, Math.min(scatterIndex, sets.length - 1));
  select.value = String(scatterIndex);
  const set = currentScatter();
  $('scatter-body').classList.toggle('hidden', !set);
  if (!set) return;
  $<HTMLInputElement>('scatter-density').value = String(set.density);
  $<HTMLInputElement>('scatter-overlap').checked = set.noOverlap;
  $<HTMLInputElement>('scatter-empty').checked = set.emptyOnly;
  const total = set.items.reduce((n, i) => n + Math.max(0, i.weight), 0);
  const list = $('scatter-items');
  list.innerHTML = '';
  const presetNames = new Set(library.presets.map((p) => p.name));
  set.items.forEach((item, i) => {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'sprite';
    if (item.tile) spriteStyle(icon, item.tile);
    else icon.textContent = '▦';
    const label = document.createElement('span');
    label.className = 'grow';
    const missing = item.preset && !presetNames.has(item.preset);
    label.textContent = item.tile ? `${item.tile[0]} ${item.tile[1]}` : `${item.preset}${missing ? ' (missing)' : ''}`;
    if (missing) label.style.color = 'var(--danger)';
    const weight = document.createElement('input');
    weight.type = 'number';
    weight.min = '0';
    weight.step = '0.5';
    weight.value = String(item.weight);
    weight.title = 'Weight: how often this one is picked, relative to the others';
    weight.addEventListener('change', () => {
      item.weight = Math.max(0, Number(weight.value) || 0);
      renderScatter();
      saveLibrary();
    });
    const share = document.createElement('span');
    share.className = 'muted';
    share.textContent = total ? `${Math.round((Math.max(0, item.weight) / total) * 100)}%` : '–';
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '✕';
    del.title = 'Remove from the set';
    del.addEventListener('click', () => {
      set.items.splice(i, 1);
      renderScatter();
      saveLibrary();
    });
    li.append(icon, label, weight, share, del);
    list.appendChild(li);
  });
}

$<HTMLSelectElement>('scatter-set').addEventListener('change', (e) => {
  scatterIndex = Number((e.target as HTMLSelectElement).value);
  renderScatter();
});
$('scatter-new').addEventListener('click', () => {
  const input = $<HTMLInputElement>('scatter-name');
  const n = input.value.trim();
  if (!n) return input.focus();
  const from = currentScatter();
  scatterSets().push(
    from
      ? { ...structuredClone(from), name: n }
      : { name: n, density: 15, noOverlap: true, emptyOnly: true, items: [] },
  );
  scatterIndex = scatterSets().length - 1;
  input.value = '';
  renderScatter();
  saveLibrary();
});
$('scatter-delete').addEventListener('click', () => {
  const set = currentScatter();
  if (!set || !confirm(`Delete scatter set "${set.name}"?`)) return;
  scatterSets().splice(scatterIndex, 1);
  scatterIndex = 0;
  renderScatter();
  saveLibrary();
});
$('scatter-add-tile').addEventListener('click', () => {
  const set = currentScatter();
  if (!set) return;
  set.items.push({ tile: [...selected], weight: 1 });
  renderScatter();
  saveLibrary();
});
$('scatter-add-preset').addEventListener('click', () => {
  const set = currentScatter();
  const name = $<HTMLSelectElement>('scatter-preset').value;
  if (!set || !name) return status('Save a preset first (select an area, then "Save selection")', 'error');
  set.items.push({ preset: name, weight: 1 });
  renderScatter();
  saveLibrary();
});
$<HTMLInputElement>('scatter-density').addEventListener('change', (e) => {
  const set = currentScatter();
  if (!set) return;
  set.density = Math.max(0, Math.min(100, Number((e.target as HTMLInputElement).value) || 0));
  renderScatter();
  saveLibrary();
});
for (const [id, key] of [['scatter-overlap', 'noOverlap'], ['scatter-empty', 'emptyOnly']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const set = currentScatter();
    if (!set) return;
    set[key] = (e.target as HTMLInputElement).checked;
    saveLibrary();
  });
}

// ---------- layers panel ----------

function renderLayers() {
  renderPresetLayers();
  const list = $('layers');
  list.innerHTML = '';
  // Show the top layer first.
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const layer = scene.layers[i];
    const li = document.createElement('li');
    li.className = i === active ? 'active' : '';
    li.innerHTML = `
      <button data-act="eye" title="Show / hide (editor only)">${hidden.has(i) ? '◌' : '●'}</button>
      <input type="text" value="${layer.name.replace(/"/g, '&quot;')}" aria-label="Layer name" />
      <span class="muted">${layer.tiles.length}</span>
      <button data-act="up" title="Move up">↑</button>
      <button data-act="down" title="Move down">↓</button>
      <button data-act="del" class="danger" title="Delete layer">✕</button>`;
    li.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      active = i;
      renderLayers();
    });
    const input = li.querySelector('input')!;
    input.addEventListener('change', () => {
      snapshot();
      layer.name = input.value.trim() || layer.name;
      markDirty();
    });
    li.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'eye') {
          hidden.has(i) ? hidden.delete(i) : hidden.add(i);
          renderBase();
          renderLayers();
          return;
        }
        snapshot();
        if (act === 'del') {
          if (layer.tiles.length && !confirm(`Delete layer "${layer.name}" with ${layer.tiles.length} tiles?`)) return undoStack.pop();
          scene.layers.splice(i, 1);
          active = Math.max(0, Math.min(active, scene.layers.length - 1));
        } else {
          const j = act === 'up' ? i + 1 : i - 1;
          if (j < 0 || j >= scene.layers.length) return undoStack.pop();
          [scene.layers[i], scene.layers[j]] = [scene.layers[j], scene.layers[i]];
          active = j;
        }
        hidden = new Set();
        renderBase();
        renderLayers();
        markDirty();
      }),
    );
    list.appendChild(li);
  }
}

$('add-layer').addEventListener('click', () => {
  snapshot();
  scene.layers.push({ name: `layer ${scene.layers.length + 1}`, tiles: [] });
  active = scene.layers.length - 1;
  renderLayers();
  markDirty();
});

// ---------- actors panel ----------

function renderActors() {
  $('actors-panel').classList.toggle('hidden', scene.kind === 'texture');
  const list = $('actors');
  list.innerHTML = '';
  (scene.actors ?? []).forEach((a, i) => {
    const li = document.createElement('li');
    li.className = i === selectedActor ? 'selected' : '';
    li.innerHTML = `
      <div class="row">
        <button class="sprite" data-act="sprite" title="Use the selected tile"></button>
        <select data-k="type"><option value="walk">walk</option><option value="wander">wander</option><option value="path">path</option></select>
        <label><input type="checkbox" data-k="hero" /> hero</label>
        <span class="spacer"></span>
        <button data-act="del" class="danger" title="Delete actor">✕</button>
      </div>
      <div class="row not-path">
        <label>row <input type="number" data-k="row" step="1" /></label>
        <label>from <input type="number" data-k="from" step="0.5" /></label>
        <label>to <input type="number" data-k="to" step="0.5" /></label>
      </div>
      <div class="row not-path">
        <label>then <select data-k="dir" title="After reaching 'to', turn up or down"><option value="up">up</option><option value="down">down</option></select></label>
        <input type="number" data-k="turn" step="1" min="0" title="Rows to go up or down (0 = none)" />
        <label>sec <input type="number" data-k="duration" step="1" min="1" /></label>
      </div>
      <div class="path-only">
        <textarea data-act="points" rows="2" title="Points: col,row or col,row,pause — separated by spaces. Positions are the sprite's top-left corner, in tiles."></textarea>
        <div class="row"><button data-act="add-point" title="Add the cell under the mouse… click the map after pressing">+ point from map</button></div>
      </div>
      <div class="row">
        <label class="path-only">speed <input type="number" data-k="speed" step="0.5" min="0.5" title="Tiles per second" /></label>
        <label>delay <input type="number" data-k="delay" step="1" /></label>
      </div>`;
    li.querySelectorAll<HTMLElement>('.not-path').forEach((el) => el.classList.toggle('hidden', a.type === 'path'));
    li.querySelectorAll<HTMLElement>('.path-only').forEach((el) => el.classList.toggle('hidden', a.type !== 'path'));
    const pts = li.querySelector<HTMLTextAreaElement>('[data-act="points"]')!;
    pts.value = pointsToText(a.points);
    pts.addEventListener('change', () => {
      const parsed = textToPoints(pts.value);
      if (!parsed) return status('Points look like "21,4.5  30,4.5,1  54.5,9" (col,row or col,row,pause)', 'error');
      snapshot();
      a.points = parsed;
      markDirty();
    });
    li.querySelector<HTMLButtonElement>('[data-act="add-point"]')!.addEventListener('click', () => {
      pickingPointFor = a;
      status('Click the map to add a point (the sprite\'s top-left goes there) · Esc to stop');
    });
    spriteStyle(li.querySelector<HTMLElement>('.sprite')!, a.sprite);
    li.addEventListener('mousedown', () => {
      if (selectedActor !== i) {
        selectedActor = i;
        list.querySelectorAll('li').forEach((x, j) => x.classList.toggle('selected', j === i));
      }
    });
    // Vertical turn after "to": stored as `up` (rows; negative = down).
    const dir = li.querySelector<HTMLSelectElement>('[data-k="dir"]')!;
    const turn = li.querySelector<HTMLInputElement>('[data-k="turn"]')!;
    dir.value = (a.up ?? 0) < 0 ? 'down' : 'up';
    turn.value = String(Math.abs(a.up ?? 0));
    const setTurn = () => {
      snapshot();
      const n = Math.max(0, Math.round(Number(turn.value) || 0));
      if (n === 0) delete a.up;
      else a.up = dir.value === 'down' ? -n : n;
      markDirty();
    };
    dir.addEventListener('change', setTurn);
    turn.addEventListener('change', setTurn);
    li.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]:not([data-k="dir"]):not([data-k="turn"])').forEach((input) => {
      const k = input.dataset.k as keyof Actor;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = !!a[k];
      else input.value = String(a[k] ?? (k === 'up' || k === 'delay' ? 0 : k === 'speed' ? 2 : ''));
      input.addEventListener('change', () => {
        snapshot();
        const v = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
        if (k === 'type') {
          a.type = v as Actor['type'];
          if (a.type === 'path' && !a.points?.length) a.points = [[a.from, a.row], [a.to, a.row]];
          renderActors();
        }
        else if (k === 'hero') v ? (a.hero = true) : delete a.hero;
        else {
          const n = Number(v);
          if (Number.isNaN(n)) return;
          if ((k === 'up' || k === 'delay') && n === 0) delete a[k];
          else (a as unknown as Record<string, number>)[k] = k === 'duration' ? Math.max(1, n) : k === 'speed' ? Math.max(0.5, n) : n;
        }
        markDirty();
      });
    });
    li.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        snapshot();
        if (b.dataset.act === 'sprite') a.sprite = [...selected];
        else {
          scene.actors!.splice(i, 1);
          selectedActor = -1;
        }
        renderActors();
        markDirty();
      }),
    );
    list.appendChild(li);
  });
}

$('add-actor').addEventListener('click', () => {
  snapshot();
  scene.actors ??= [];
  scene.actors.push({ sprite: ['farm', 122], type: 'wander', row: 0, from: 0, to: 3, duration: 8 });
  selectedActor = scene.actors.length - 1;
  renderActors();
  markDirty();
});

// ---------- lights panel ----------

const lightTypeOptions = () => Object.keys(LIGHT_TYPES).map((t) => `<option value="${t}">${t}</option>`).join('');

function renderLights() {
  $('lights-panel').classList.toggle('hidden', scene.kind !== 'world');
  const list = $('lights');
  list.innerHTML = '';
  (scene.lights ?? []).forEach((l, i) => {
    const d = resolveLight(l);
    const li = document.createElement('li');
    li.className = i === selectedLight ? 'selected' : '';
    li.innerHTML = `
      <div class="row">
        <select data-k="type">${lightTypeOptions()}</select>
        <span class="muted">${l.col},${l.row}</span>
        <button data-act="move" title="Click the map to move it">move</button>
        <span class="spacer"></span>
        <button data-act="del" class="danger" title="Delete light">✕</button>
      </div>
      <div class="row">
        <input type="color" data-k="color" title="Color" />
        <label>size <input type="number" data-k="radius" step="0.2" min="0.4" max="12" title="Glow radius in tiles" /></label>
        <label>power <input type="number" data-k="intensity" step="0.05" min="0" max="1" title="0–1" /></label>
      </div>
      <div class="row">
        <label>motion <select data-k="flicker"><option value="true">flicker</option><option value="breathe">breathe</option><option value="false">steady</option></select></label>
        <button data-act="reset" title="Back to the type's color, size, power and motion">defaults</button>
      </div>`;
    const color = d.color.length === 4 ? d.color.replace(/\w/g, (c: string) => c + c) : d.color;
    const vals: Record<string, string> = { type: l.type, color, radius: String(d.radius), intensity: String(d.intensity), flicker: String(d.flicker) };
    li.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((input) => {
      const k = input.dataset.k!;
      input.value = vals[k];
      input.addEventListener('change', () => {
        snapshot();
        const t = LIGHT_TYPES[l.type as keyof typeof LIGHT_TYPES];
        if (k === 'type') l.type = input.value;
        else if (k === 'color') input.value.toLowerCase() === t.color ? delete l.color : (l.color = input.value);
        else if (k === 'flicker') {
          const v = input.value === 'breathe' ? 'breathe' : input.value === 'true';
          v === t.flicker ? delete l.flicker : (l.flicker = v);
        } else {
          const n = Number(input.value);
          if (Number.isNaN(n)) return;
          const v = k === 'radius' ? Math.min(12, Math.max(0.4, n)) : Math.min(1, Math.max(0, n));
          v === t[k as 'radius' | 'intensity'] ? delete l[k as 'radius' | 'intensity'] : (l[k as 'radius' | 'intensity'] = v);
        }
        renderLights();
        markDirty();
      });
    });
    li.addEventListener('mousedown', () => {
      if (selectedLight !== i) focusLight(i, { scrollList: false });
    });
    li.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.act === 'move') {
          placingLight = i;
          return status('Click the map to put the light there · Esc to stop');
        }
        snapshot();
        if (b.dataset.act === 'reset') for (const k of ['color', 'radius', 'intensity', 'flicker'] as const) delete l[k];
        else {
          scene.lights!.splice(i, 1);
          selectedLight = -1;
        }
        renderLights();
        markDirty();
      }),
    );
    list.appendChild(li);
  });
}

$<HTMLSelectElement>('new-light-type').innerHTML = lightTypeOptions();
$<HTMLSelectElement>('new-light-type').addEventListener('change', (e) => (newLightType = (e.target as HTMLSelectElement).value));
$('add-light').addEventListener('click', () => startPlacingLight(newLightType));

// ---------- scene panel ----------

function loadScene(n: string) {
  if (dirty && n !== name && !confirm('Discard unsaved changes?')) {
    $<HTMLSelectElement>('scene-select').value = name;
    return;
  }
  name = n;
  scene = structuredClone(scenes[n]);
  active = scene.layers.length - 1;
  hidden = new Set();
  selectedActor = -1;
  selectedLight = -1;
  placingLight = null;
  selection = null;
  undoStack.length = 0;
  redoStack.length = 0;
  dirty = false;
  $('kind').textContent =
    scene.kind === 'world' ? 'page map → bands and zones' : scene.kind === 'section' ? `section → scene-${n}.png` : `texture → ${n}.png (repeated)`;
  zoom = scene.kind === 'world' ? 1 : 2;
  $<HTMLSelectElement>('zoom').value = String(zoom);
  $<HTMLTextAreaElement>('note').value = scene.note ?? '';
  $<HTMLInputElement>('cols').value = String(scene.cols);
  $<HTMLInputElement>('rows').value = String(scene.rows);
  renderBase();
  renderLayers();
  renderActors();
  renderLights();
  renderZones();
  status(`Loaded scenes/${n}.json`);
  history.replaceState(null, '', `#${n}`);
}

function renderSceneSelect() {
  const select = $<HTMLSelectElement>('scene-select');
  select.innerHTML = Object.keys(scenes)
    .sort()
    .map((n) => `<option value="${n}">${n}</option>`)
    .join('');
  select.value = name;
}

$<HTMLSelectElement>('scene-select').addEventListener('change', (e) => loadScene((e.target as HTMLSelectElement).value));
$<HTMLTextAreaElement>('note').addEventListener('change', (e) => {
  snapshot();
  scene.note = (e.target as HTMLTextAreaElement).value;
  markDirty();
});
$('resize').addEventListener('click', () => {
  const cols = Number($<HTMLInputElement>('cols').value);
  const rows = Number($<HTMLInputElement>('rows').value);
  if (!(cols >= 1 && rows >= 1 && cols <= 200 && rows <= 200)) return status('Size must be 1–200', 'error');
  const outside = scene.layers.reduce((n, l) => n + l.tiles.filter((t) => t[0] >= cols || t[1] >= rows).length, 0);
  if (outside && !confirm(`${outside} tiles fall outside the new size and will be removed. Continue?`)) return;
  snapshot();
  scene.cols = cols;
  scene.rows = rows;
  for (const l of scene.layers) l.tiles = l.tiles.filter((t) => t[0] < cols && t[1] < rows);
  renderBase();
  renderLayers();
  markDirty();
});

$('new-scene-toggle').addEventListener('click', () => $('new-scene').classList.toggle('hidden'));
$<HTMLFormElement>('new-scene').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = $<HTMLInputElement>('new-name').value.trim();
  if (scenes[n]) return status(`"${n}" already exists`, 'error');
  if (dirty && !confirm('Discard unsaved changes?')) return;
  dirty = false;
  const kind = $<HTMLSelectElement>('new-kind').value as Scene['kind'];
  scenes[n] = {
    kind,
    note: '',
    cols: Number($<HTMLInputElement>('new-cols').value),
    rows: Number($<HTMLInputElement>('new-rows').value),
    layers: [{ name: 'grass', tiles: [] }],
    ...(kind === 'section' ? { actors: [] } : {}),
  };
  name = n;
  renderSceneSelect();
  loadScene(n);
  $('new-scene').classList.add('hidden');
  dirty = true; // not in `saved` yet
  status(`New scene "${n}": fill the grass layer, then save`, 'dirty');
});

// ---------- header buttons ----------

function toggle(id: string, value: boolean) {
  $(id).setAttribute('aria-pressed', String(value));
}
$('grid').addEventListener('click', () => {
  toggle('grid', (showGrid = !showGrid));
  staticDirty = true;
});
$('dusk').addEventListener('click', () => {
  toggle('dusk', (dusk = !dusk));
  renderBase();
});
$('play').addEventListener('click', () => toggle('play', (playActors = !playActors)));
$<HTMLSelectElement>('zoom').addEventListener('change', (e) => {
  zoom = Number((e.target as HTMLSelectElement).value);
  staticDirty = true;
});

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(JSON.stringify(scene));
  scene = JSON.parse(prev);
  afterHistory();
}
function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(JSON.stringify(scene));
  scene = JSON.parse(next);
  afterHistory();
}
function afterHistory() {
  active = Math.min(active, scene.layers.length - 1);
  $<HTMLInputElement>('cols').value = String(scene.cols);
  $<HTMLInputElement>('rows').value = String(scene.rows);
  renderBase();
  renderLayers();
  renderActors();
  renderLights();
  renderZones();
  markDirty();
}
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

async function save() {
  const problems = worldProblems();
  if (problems.length) return status(`Not saved: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more, see Zones)` : ''}`, 'error');
  status('Saving…');
  try {
    const res = await fetch(`${API}/${name}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? res.statusText);
    scenes[name] = structuredClone(scene);
    saved[name] = JSON.stringify(scene);
    dirty = false;
    status(`Saved scenes/${name}.json · ${out.message}`);
  } catch (e) {
    status(`Save failed: ${(e as Error).message}`, 'error');
  }
}
$('save').addEventListener('click', save);

window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
    return;
  }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && tool === 'select' && ['c', 'x'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    e.key.toLowerCase() === 'c' ? copy() : cut();
    return;
  }
  if (mod && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    paste();
    return;
  }
  if (mod) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select') {
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (e.key === 'Escape') {
    if (placingLight !== null) {
      placingLight = null;
      renderPalette();
      return status('Stopped placing lights');
    }
    if (pickingPointFor) {
      pickingPointFor = null;
      return status('Stopped adding points');
    }
    if (tool === 'stamp') setTool('paint');
    else selection = null;
    renderPresets();
    return;
  }
  const keys: Record<string, () => void> = {
    b: () => setTool('paint'),
    e: () => setTool('erase'),
    r: () => setTool('rect'),
    p: () => setTool('patch'),
    t: () => setTool('scatter'),
    i: () => setTool('pick'),
    s: () => setTool('select'),
    z: () => scene.kind === 'world' && setTool('zone'),
    g: () => $('grid').click(),
    d: () => $('dusk').click(),
    ' ': () => $('play').click(),
  };
  const fn = keys[e.key.toLowerCase()];
  if (fn) {
    e.preventDefault();
    fn();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// ---------- start ----------

async function start() {
  await Promise.all(
    (['town', 'farm', 'dungeon'] as Pack[]).map(
      (p) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = body.dataset[p]!;
          sheets[p] = img;
        }),
    ),
  );
  await Promise.all(
    (['raw', 'dusk'] as const).map(
      (k) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = k === 'raw' ? body.dataset.lights! : body.dataset.lightsDusk!;
          lightSheets[k] = img;
        }),
    ),
  );
  const res = await fetch(`${API}/`);
  scenes = (await res.json()).scenes;
  for (const [n, sc] of Object.entries(scenes)) saved[n] = JSON.stringify(sc);
  library = await (await fetch(`${LIBRARY_API}/`)).json();
  renderPatchSets();
  renderScatter();
  const first = location.hash.slice(1);
  name = scenes[first] ? first : scenes.about ? 'about' : Object.keys(scenes)[0];
  renderSceneSelect();
  setTool('paint');
  renderPalette();
  loadScene(name);
  requestAnimationFrame(loop);
}

start().catch((e) => status(`Could not load: ${e.message}`, 'error'));
