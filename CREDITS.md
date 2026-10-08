# Credits

Every third-party asset and font in this repo, with its license.

## Graphics

All in `assets/kenney/`, each folder with its original `License.txt`. Created by [Kenney](https://www.kenney.nl), CC0 1.0 (public domain).

| Pack | Files in repo | Used in |
|---|---|---|
| Fantasy UI Borders 1.0 | `PNG/Default` sprites | Site panels, cards, buttons, dividers (tinted by `site/scripts/build-ui.mjs`); game UI later |
| Flag Pack 1.0 | `CA`, `KR`, `US`, `GB` (Default, 64 px) | Site language switcher and location flags |
| Tiny Dungeon 1.0 | `tilemap_packed.png`, `tile_0097.png` | Site header scene, section icons, favicon; game later |
| Tiny Town 1.1 | `tilemap_packed.png` | Site header scene; game later |
| Tiny Farm 1.0 | `tilemap_packed.png` | Site header scene; game later |

## Code libraries

- [Lenis](https://github.com/darkroomengineering/lenis) — smooth wheel scrolling on the site. MIT License. Installed from npm, not committed.

## Made for this repo

- Pixel moon, `site/src/assets/moon.svg` (site sky)
- Light-source sprites, `assets/custom/lights.png`, drawn by `site/scripts/make-light-sprites.mjs` in the Tiny packs' palette: wall torch, brazier, campfire, street lamp. The two lit windows are Tiny Town tiles 84 and 88 (Kenney, CC0) with the glass recolored.
- Construction barricade and traffic cone, `assets/custom/barricade.png` and `cone.png`, drawn by `site/scripts/make-construction-sprites.mjs` in the same palette (the game button's "under construction" dialog)

## Fonts

| Asset | Author | License | Used in |
|---|---|---|---|
| [Galmuri](https://github.com/quiple/galmuri) (Galmuri11 Bold) | Lee Minseo (quiple) | SIL Open Font License 1.1 | Site headings, nav, labels. Installed from npm (`galmuri`), not committed. |

Body text uses the visitor's system fonts.
