# Roadmap

The portfolio comes in two forms built from the same `content/`: the resume site (Phase 1, live) and a roguelike game (Phase 2+). Game design notes are in [GAME.md](GAME.md).

## Phase 1 — Resume site
- [x] Astro project in `site/`, reads everything from `content/`
- [x] Routes: `/en/` and `/ko/` (default `en`), language switcher
- [x] Sections: About, Experience, Projects, Skills, Education
- [x] Highlights shown as metric cards: big number + one short line
- [x] Skills section: chips per category; "Used in" (computed from experience and projects) shown as a chip tooltip
- [x] Resume PDF download (backend and AI versions, public copies without phone number)
- [x] Pixel-art look using the game's UI assets (see [SITE.md](SITE.md))
- [x] `scripts/validate.ts` content checks
- [x] GitHub Actions: validate → build → deploy to Pages
- [x] The page as one dusk RPG map: a scene per section, actors, lights, fireflies (see [SITE.md](SITE.md))
- [x] Map editor for the scenes (dev only)
- [x] Narrow screens: the map scales down, content a little less
- [x] Keyboard: Space / arrow keys jump between sections
- [x] "Under construction" dialog on the game button

## Phase 2 — Game foundation
- [ ] Godot project in `game/`, single-threaded web export to `/play/`
- [ ] `ContentDB` loads `content/` at runtime
- [ ] Title screen, warrior class, save/load
- [ ] Skills room: pick up items, inventory UI

## Phase 3 — Combat
- [ ] Player movement (platformer), melee weapon
- [ ] Effect types: `melee`, `projectile`, `aoe` first; then `dash`, `buff`, `chain`, `summon`
- [ ] One fixed-layout dungeon with one monster

## Phase 4 — Roguelike
- [ ] Room-based procedural map generation with seeds
- [ ] All sections as dungeons, boss weaknesses, run end screen

## Phase 5 — Polish
- [ ] More classes (tank, mage, healer) with different play styles
- [ ] Mobile touch controls (or auto "skip" mode on mobile)
- [ ] More languages (ja, fr, ...)
