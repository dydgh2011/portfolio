# Content

Everything shown on the site (and later in the game) comes from `content/`. Never hard-code resume text in `site/` or `game/`.

**Rule: data and text are separate.**

- `content/data/` holds things that do not change between languages: ids, dates, which skills were used, game stats.
- `content/i18n/<lang>/` holds only text, keyed by the same ids.
- To add a language, copy `i18n/en/` to `i18n/<lang>/` and translate. Missing keys fall back to English.

## Ids
- kebab-case, unique inside each file (`gamespring-admin-ai`, `window-functions`).
- Never rename an id once it is live: save files and translations depend on it.

## Writing style: short, not the resume

The PDF resume is long and detailed on purpose. This site is **not** a copy of it.

- Every entry has one `summary` line (max ~70 characters).
- Experience: max **4 highlights** per role. Projects: max **2–3**.
- A highlight = `metric` (a short number, shown big) + `text` (one line, max ~80 characters).
- No full sentences of process ("Interviewed..., then moved..., and built..."). Say the result.
- Anything longer goes in the PDF resume. The site links to it ("Full details in the PDF resume").
- Plain text only. No markdown in content strings.

## `skills.json`

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

## Elements

| Element | Role | Skill category |
|---|---|---|
| neutral | weapon | languages |
| water | skill | backend |
| fire | skill | databases |
| wind | skill | frontend |
| earth | skill | infrastructure |
| lightning | skill | ai |

Programming languages are **weapons** (basic attack style). Frameworks and tools are **skills** on top of them.

## Experience / projects / education
- Each entry has `skills` (list of skill ids) and an optional `game.monster` + `game.difficulty`.
- **Boss weakness = the entry's `skills`.** Hitting a boss with an item from that list deals `weaknessBonus` × damage. The game rules show where each skill was really used.
- `highlights` is a list of ids. Text for each id lives in `i18n/<lang>/...json` as `{ "metric": "...", "text": "..." }`. The metric is in i18n because units change by language ("8 h / week" vs "주 8시간").

## `game.json`
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

Push to `master` → CI validates → site rebuilds. The game reads content at runtime, so **content changes never need a Godot re-export**.

---

## Validation (`scripts/validate.ts`)

Run it with `node scripts/validate.ts` (or `npm run validate` in `site/`). CI runs it before every build.

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

## Rules for this repo

- **Content lives in `content/` only.** Never hard-code resume text in `site/` or `game/`.
- **No phone number on the public site.** Email, GitHub, and LinkedIn only.
- **Confidentiality.** Keep internal system and tool names generic, the same way the PDF resume does. Publicly shipped game features may be named.
- **Asset licenses.** Before committing any asset, check its license allows redistribution in a public repo. Some free packs allow use in projects but not sharing raw files. Record every asset and font in `CREDITS.md`.
- **Logos** come from Simple Icons (CC0) or Devicon (MIT). They are trademarks of their owners and are shown only to name the technology.
