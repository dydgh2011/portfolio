// Header scene, top-down: farm → town → dungeon gate, joined by a dirt road.
// Composed into one PNG by build-ui.mjs, so there are no seams between tiles.
// Each layer is a list of [col, row, pack, tile]. Later layers draw on top.

export const COLS = 28;
export const ROWS = 4;

// Grass everywhere, with a few flower tiles.
const flowers = new Set(['3,0', '9,3', '15,0', '19,3', '25,0', '1,3']);
const grass = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) grass.push([c, r, 'town', flowers.has(`${c},${r}`) ? 2 : (c * 7 + r * 3) % 5 === 0 ? 1 : 0]);
}

// Road along rows 2–3, from the left edge to the gate.
const road = [];
for (let c = 0; c <= 24; c++) {
  road.push([c, 2, 'town', 13]);
  road.push([c, 3, 'town', 37]);
}
road.push([25, 2, 'town', 14], [25, 3, 'town', 38]);

const farm = [
  // two crop beds
  [1, 0, 'farm', 48], [2, 0, 'farm', 49], [3, 0, 'farm', 49], [4, 0, 'farm', 50],
  [1, 1, 'farm', 60], [2, 1, 'farm', 61], [3, 1, 'farm', 61], [4, 1, 'farm', 62],
  [6, 0, 'farm', 90], [7, 0, 'farm', 91], [8, 0, 'farm', 92],
  [6, 1, 'farm', 126], [7, 1, 'farm', 127], [8, 1, 'farm', 128],
];
const crops = [
  [1, 0, 'farm', 30], [2, 0, 'farm', 42], [3, 0, 'farm', 30], [4, 0, 'farm', 42],
  [1, 1, 'farm', 66], [2, 1, 'farm', 18], [3, 1, 'farm', 66], [4, 1, 'farm', 18],
  [5, 1, 'farm', 122], [0, 0, 'farm', 83],
];

const town = [
  // red-roof house
  [11, 0, 'town', 64], [12, 0, 'town', 67], [13, 0, 'town', 66],
  [11, 1, 'town', 84], [12, 1, 'town', 85], [13, 1, 'town', 84],
  // well, sign, trees
  [15, 0, 'town', 92], [15, 1, 'town', 104],
  [10, 1, 'town', 83],
  [9, 0, 'town', 16], [14, 0, 'town', 28], [17, 0, 'town', 16], [18, 1, 'town', 5], [16, 1, 'town', 94],
];

const dungeon = [
  // stone gate the road runs into
  [22, 0, 'town', 96], [23, 0, 'town', 97], [24, 0, 'town', 97], [25, 0, 'town', 98],
  [22, 1, 'town', 111], [23, 1, 'town', 112], [24, 1, 'town', 113], [25, 1, 'town', 114],
  [20, 0, 'town', 27], [26, 1, 'town', 27], [27, 0, 'town', 28],
];
const monsters = [
  [26, 3, 'dungeon', 108], [27, 2, 'dungeon', 120],
];

export const layers = [grass, road, farm, crops, town, dungeon, monsters];
