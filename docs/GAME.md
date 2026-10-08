# Game design (Phase 2+)

Not started yet. The game will read the same `content/` as the site at runtime, so content changes never need a Godot re-export. Planned steps are in [ROADMAP.md](ROADMAP.md); the game parts of the content model (`game` fields, elements, `game.json`) are in [CONTENT.md](CONTENT.md).

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

## Deployment

The web export goes to `dist/play/` in the same GitHub Pages build as the site (step 4 in the deploy workflow, not added yet). Use relative paths in the game: the site lives at `/portfolio/`.
