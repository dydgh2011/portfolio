// Kenney CC0 packs in the repo's assets/ folder (shared with the game).
// Tiles are read straight from each pack's packed tilemap: 12 × 11 tiles of 16 px, no spacing.

const sheets = import.meta.glob<string>('../../../assets/kenney/tiny-*/tilemap_packed.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const flags = import.meta.glob<string>('../../../assets/kenney/flag-pack/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export type Pack = 'dungeon' | 'town' | 'farm';
export type TileRef = [Pack, number];

export const TILE = 16;
const COLUMNS = 12;
const ROWS = 11;

export function sheetUrl(pack: Pack): string {
  return sheets[`../../../assets/kenney/tiny-${pack}/tilemap_packed.png`];
}

/** Inline style that shows one tile at a whole-number scale. */
export function tileStyle([pack, index]: TileRef, scale: number): string {
  const size = TILE * scale;
  const x = (index % COLUMNS) * size;
  const y = Math.floor(index / COLUMNS) * size;
  return [
    `background-image:url(${sheetUrl(pack)})`,
    `background-size:${COLUMNS * size}px ${ROWS * size}px`,
    `background-position:-${x}px -${y}px`,
  ].join(';');
}

export function flagUrl(country?: string): string | undefined {
  return country ? flags[`../../../assets/kenney/flag-pack/${country}.png`] : undefined;
}

// Section icons: me, loot, weapons, potions, the wise.
export const sectionIcons: Record<string, TileRef> = {
  about: ['dungeon', 97],
  projects: ['dungeon', 89],
  experience: ['dungeon', 104],
  skills: ['dungeon', 115],
  education: ['dungeon', 84],
};
