// Draws the profile-link icons for the nav (made for this repo), 12×12, in brand colors:
// assets/custom/github.png, linkedin.png, reddit.png. Shown at ×2.
// Run: node scripts/make-social-sprites.mjs  (the PNGs are committed; rerun only to change the art)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const out = join(dirname(fileURLToPath(import.meta.url)), '../../assets/custom');
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

// '#' = the icon color, 'o' = its inner color, '.' = transparent
const ICONS = {
  // the cat cut out of a circle (the cat is see-through)
  github: {
    colors: { '#': '#f3e9d2' },
    rows: [
      '....####....',
      '..########..',
      '.##.####.##.',
      '.#........#.',
      '#..........#',
      '#..........#',
      '#..........#',
      '##........##',
      '###......###',
      '##.##..#####',
      '..#....###..',
      '....#..#....',
    ],
  },
  linkedin: {
    colors: { '#': '#0a66c2', o: '#ffffff' },
    rows: [
      '.##########.',
      '############',
      '##oo########',
      '############',
      '##oo#oooo###',
      '##oo#oo#oo##',
      '##oo#oo#oo##',
      '##oo#oo#oo##',
      '##oo#oo#oo##',
      '##oo#oo#oo##',
      '############',
      '.##########.',
    ],
  },
  // Snoo: antenna, ears, eyes and smile
  reddit: {
    colors: { '#': '#ff4500', o: '#ffffff' },
    rows: [
      '.........###',
      '......######',
      '......#..###',
      '...######...',
      '############',
      '############',
      '##oo####oo##',
      '##oo####oo##',
      '.##########.',
      '.##o####o##.',
      '..##oooo##..',
      '...######...',
    ],
  },
};

mkdirSync(out, { recursive: true });
for (const [name, { colors, rows }] of Object.entries(ICONS)) {
  const png = new PNG({ width: 12, height: 12 });
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    png.data.set([...hex(colors[c]), 255], (y * 12 + x) * 4);
  }));
  writeFileSync(join(out, `${name}.png`), PNG.sync.write(png));
}
console.log('wrote', Object.keys(ICONS).map((n) => `${n}.png`).join(', '), 'to', out);
