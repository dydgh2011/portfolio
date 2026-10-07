# Yongho (Mark) Nam — Portfolio

A personal portfolio in two forms, built from **one content source**:

1. **Resume site** (now): a fast, static, pixel-styled HTML site for recruiters. Built with Astro, hosted on GitHub Pages.
2. **Roguelike game** (later): a 2D action platformer made in Godot, where you walk through my resume. Skills are items, and each job, school, and project is a monster.

```
content/ (JSON + icons)  ── one source of truth
   ├──▶ site/   Astro → static HTML        (Phase 1)
   └──▶ game/   Godot 4 → web export /play (Phase 2+)
```

Inspired by Dungreed, Sephiria, and Skul.
 
---

## Roadmap

### Phase 1 — Resume site
- [x] Astro project in `site/`, reads everything from `content/`
- [x] Routes: `/en/` and `/ko/` (default `en`), language switcher
- [x] Sections: About, Projects, Experience, Skills, Education (projects first)
- [x] Highlights shown as metric cards: big number + one short line
- [x] Skills section: chips per category; "Used in" (computed from experience and projects) shown as a chip tooltip
- [x] Resume PDF download (backend and AI versions, public copies without phone number)
- [x] Pixel-art look using the game's UI assets (see [Site design](#site-design))
- [x] `scripts/validate.ts` content checks
- [x] GitHub Actions: validate → build → deploy to Pages

### Phase 2 — Game foundation
- [ ] Godot project in `game/`, single-threaded web export to `/play/`
- [ ] `ContentDB` loads `content/` at runtime
- [ ] Title screen, warrior class, save/load
- [ ] Skills room: pick up items, inventory UI

### Phase 3 — Combat
- [ ] Player movement (platformer), melee weapon
- [ ] Effect types: `melee`, `projectile`, `aoe` first; then `dash`, `buff`, `chain`, `summon`
- [ ] One fixed-layout dungeon with one monster

### Phase 4 — Roguelike
- [ ] Room-based procedural map generation with seeds
- [ ] All sections as dungeons, boss weaknesses, run end screen

### Phase 5 — Polish
- [ ] More classes (tank, mage, healer) with different play styles
- [ ] Mobile touch controls (or auto "skip" mode on mobile)
- [ ] More languages (ja, fr, ...)

---

## Repository layout

```
portfolio/
├── content/
│   ├── data/            # language-neutral data: ids, dates, skills, game numbers
│   │   ├── profile.json
│   │   ├── experience.json
│   │   ├── projects.json
│   │   ├── education.json
│   │   ├── skills.json
│   │   ├── elements.json
│   │   └── game.json
│   ├── i18n/            # text only, one folder per language
│   │   ├── en/  profile.json  experience.json  projects.json  education.json  skills.json  ui.json
│   │   └── ko/  ...
│   ├── icons/           # skill icons, file name = "icon" field in skills.json
│   └── resume/          # PDF resumes, paths set in profile.json → resumePdf
├── assets/kenney/       # CC0 art packs shared by site and game (see CREDITS.md)
├── site/                # Astro site (Phase 1)
├── game/                # Godot project (Phase 2+)
├── scripts/validate.ts  # content checks, run in CI
└── .github/workflows/deploy.yml
```

---

## Content model

**Rule: data and text are separate.**

- `content/data/` holds things that do not change between languages: ids, dates, which skills were used, game stats.
- `content/i18n/<lang>/` holds only text, keyed by the same ids.
- To add a language, copy `i18n/en/` to `i18n/<lang>/` and translate. Missing keys fall back to English.

### Ids
- kebab-case, unique inside each file (`gamespring-admin-ai`, `window-functions`).
- Never rename an id once it is live: save files and translations depend on it.

### Writing style: short, not the resume

The PDF resume is long and detailed on purpose. This site is **not** a copy of it.

- Every entry has one `summary` line (max ~70 characters).
- Experience: max **4 highlights** per role. Projects: max **2–3**.
- A highlight = `metric` (a short number, shown big) + `text` (one line, max ~80 characters).
- No full sentences of process ("Interviewed..., then moved..., and built..."). Say the result.
- Anything longer goes in the PDF resume. The site links to it ("Full details in the PDF resume").
- Plain text only. No markdown in content strings.

### `skills.json`

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | unique id |
| `name` | yes | display name (English). Translations can override it in `i18n/<lang>/skills.json` |
| `category` | yes | `languages`, `spoken`, `backend`, `frontend`, `databases`, `infrastructure`, `ai` |
| `icon` | no | file in `content/icons/`. No icon = text only |
| `listed` | no | default `true`. `false` = not shown in the Skills section, but projects/experience can still reference it (e.g. Electron, SQLite) |
| `parent` | no | group under another skill on the site (EC2 under AWS) |
| `game` | no | if present, this skill is a game item. No `game` = site only |

`game` object:

```json
{
  "slot": "weapon | skill",
  "element": "neutral | water | fire | wind | earth | lightning",
  "effect": { "type": "projectile", "damage": 12, "cooldown": 0.8, "speed": 200 }
}
```

`effect.type` must be one of `game.json → effectTypes`. Other keys in `effect` are parameters for that type.

### Elements

| Element | Role | Skill category |
|---|---|---|
| neutral | weapon | languages |
| water | skill | backend |
| fire | skill | databases |
| wind | skill | frontend |
| earth | skill | infrastructure |
| lightning | skill | ai |

Programming languages are **weapons** (basic attack style). Frameworks and tools are **skills** on top of them.

### Experience / projects / education
- Each entry has `skills` (list of skill ids) and an optional `game.monster` + `game.difficulty`.
- **Boss weakness = the entry's `skills`.** Hitting a boss with an item from that list deals `weaknessBonus` × damage. The game rules show where each skill was really used.
- `highlights` is a list of ids. Text for each id lives in `i18n/<lang>/...json` as `{ "metric": "...", "text": "..." }`. The metric is in i18n because units change by language ("8 h / week" vs "주 8시간").

### `game.json`
- `route`: order of sections in a run. Change the order here, not in code.
- `classes`: only `warrior` is enabled for now.

---

## How to update content

**Add a skill (site only)**
1. Add `{ "id": "...", "name": "...", "category": "..." }` to `data/skills.json`.
2. If the name needs translation, add it to `i18n/<lang>/skills.json`.

**Make a skill a game item**
1. Put `<id>.png` in `content/icons/`.
2. Add `icon` and `game` to the skill. Reuse an existing `effect.type`.
3. No code change needed. A new `effect.type` needs one new script in `game/effects/` and an entry in `effectTypes`.

**Add or swap a highlight**
1. Add the id to `highlights` in `data/experience.json` (or `projects.json`). Keep the max count.
2. Add `{ "metric": "...", "text": "..." }` under the same id in every `i18n/<lang>/` file.

Push to `main` → CI validates → site rebuilds. The game reads content at runtime, so **content changes never need a Godot re-export**.

---

## Validation (`scripts/validate.ts`)

Errors (fail the build):
- invalid JSON, duplicate ids
- a `skills` list or `parent` points to a skill id that does not exist
- `game.element` not in `elements.json`, `effect.type` not in `effectTypes`
- a data entry or highlight has no English text
- more highlights than the limit (4 per role, 3 per project)

Warnings:
- a `summary` or highlight `text` is longer than the style limit
- a non-English language is missing a key (falls back to English)
- a skill has `game` but its icon file is missing (game uses the element's default icon)
- an icon file exists but no skill uses it

---

## Site design

Pixel style, built from the same free asset pack the game uses.

- **Readability first.** Pixel font only for headings, nav, and labels. Body text uses a normal readable font. For Korean, use a pixel font with Hangul support (e.g. Galmuri, OFL license).
- `image-rendering: pixelated` on all sprites. Scale sprites only by whole numbers (×2, ×3, ×4).
- Panels and buttons: 9-slice UI tiles with CSS `border-image`. Kenney Fantasy UI Borders sprites are white; `site/scripts/build-ui.mjs` tints them to the site palette before `dev`/`build` (change sprite or color there).
- Header scene: a top-down map (farm → town → dungeon gate) laid out in `site/scripts/scene.mjs` and composed into one PNG by `build-ui.mjs`; the knight walks the road (static with reduced motion). Section icons are tiles from `tilemap_packed.png`, set in `site/src/lib/sprites.ts`.
- Flags (Flag Pack) mark languages (`profile.json → languageFlags`) and places (`country` on experience/education).
- Resume PDFs in `content/resume/` are the public copies: **no phone number**. Rebuild them from the private `.tex` with the phone line removed.
- Each skill chip uses its element color from `elements.json`.
- All resume text is real HTML text (selectable, searchable, screen-reader friendly). Never put text inside images or canvas.
- Respect `prefers-reduced-motion`. Keep color contrast at WCAG AA.
- Add a print stylesheet that removes decorations, so printing the page gives a clean resume.
- Keep the first load light: no game engine on the resume site, only small sprite sheets.

---

## Game design (Phase 2+)

- **Engine:** Godot 4 (latest stable), **GDScript only** (C# projects cannot export to web in Godot 4, as far as I know).
- **Resolution:** 640×360 base viewport (40 × 22.5 tiles of 16 px). Stretch mode `viewport`, scale mode `integer` → clean ×2 (720p) and ×3 (1080p).
- **Web export:** turn **Thread Support off**. GitHub Pages cannot send the cross-origin isolation headers that threaded builds need.
- **Autoloads:**
  - `ContentDB` — loads `content/` (on web via `HTTPRequest` from `../content/`, in the editor from a local copy), resolves translations, loads icons with `Image.load_png_from_buffer()`
  - `GameState` — class, inventory, current route step, seed
  - `SaveManager` — `user://save.json` (on web this is stored in IndexedDB). Always include a `"version"` field
- **Effects:** `effects/SkillEffect.gd` base class with `activate(user, params)`. One script per effect type, mapped in `EffectRegistry.gd`.
- **Player:** `CharacterBody2D`. Maps use `TileMapLayer`.
- **Map generation:** room-based (like Spelunky). Hand-made room template scenes are placed on a grid and connected with doors. Use `RandomNumberGenerator` with a seed. A `?seed=1234` URL parameter (read through `JavaScriptBridge`) replays the same map.
- **Dungeons:** one dungeon scene, reused for education, experience, and projects with different data.

---

## Deployment

GitHub Actions on push to `main`:
1. `validate.ts`
2. Build Astro → `dist/`
3. Copy `content/` → `dist/content/`
4. (Phase 2+) Export Godot web build → `dist/play/`
5. Deploy `dist/` to GitHub Pages

Repo name is `portfolio`, so the site lives at `/portfolio/`. Set `base: '/portfolio'` in Astro, and use relative paths in the game. If a custom domain is added later, set `base: '/'`.

---

## Rules for this repo

- **Content lives in `content/` only.** Never hard-code resume text in `site/` or `game/`.
- **No phone number on the public site.** Email, GitHub, and LinkedIn only.
- **Confidentiality.** Keep internal system and tool names generic, the same way the PDF resume does. Publicly shipped game features may be named.
- **Asset licenses.** Before committing any asset, check its license allows redistribution in a public repo. Some free packs allow use in projects but not sharing raw files. Record every asset and font in `CREDITS.md`.
- **Logos** come from Simple Icons (CC0) or Devicon (MIT). They are trademarks of their owners and are shown only to name the technology.
