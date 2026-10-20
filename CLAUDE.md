# CLAUDE.md — Neon Arena: Blackout (V4 · Build 4)

A cyberpunk multiplayer FPS: a rainy neon city at night, wet reflective streets, fog, punchy gunplay.
The project has **two tracks** in one repository:

| Track | Folder | Status |
|---|---|---|
| **Web game** (playable now) | `web/` | Three.js client + authoritative Node/Socket.IO server. V4 · Build 4. |
| **Unreal Engine 5 / Lyra rebuild** | `unreal/` | Starter kit + plan. The Lyra project itself lives on the developer's PC. At milestone M0. |
| Original prototype | `archive/v1-prototype/` | Read-only history. Don't modify. |

## Version history
| Version | What |
|---|---|
| V1 | Original prototype (client-trusted movement, simple boxes). `archive/v1-prototype/` |
| V2 (2.0) | Web rework: authoritative 60 Hz server, prediction/reconciliation, lag-compensated hits, PBR world, reflections, fog, rain, recoil/reload/ADS, positional audio |
| V2.1 | Megacity art pass: graffiti, vending machines, holo-ads, holo koi, vertical signs, lens streaks, red/yellow/cyan HUD |
| V2.2 | Cyber-knight runners, machined VX-9 rifle (extruded model, charm, inspect on F), ember death, "FLATLINED" screen |
| V3 (Build 3) | Unreal/Lyra plan + starter kit (inventory script, V2 map export, carry-over spec) |
| **V4 (Build 4)** | **This repo**: both tracks unified, web hosting via `render.yaml`, Chromebook launcher `web/scripts/play.sh` |
| V4.1–V4.4 | Audio remix, realistic gunfire, mobile landscape + touch HUD, in-game ☰ menu |
| V4.5 | Classes: Soldier / Assassin (3 dash charges) / Knight (greatsword → shotgun on kill, 130 HP); regenerating energy shields |
| V4.6 | "The Alley": 32×112 m back-alley map with invisible end walls, grim/rugged atmosphere, lighter default graphics (Medium) |
| V4.7 | Assassin sniper rifle (scope, bolt action) + Obliteration Beam after 5 kills in a row (charge-up, huge beam, burning half of the map) |
| V4.8 | Beam Clash: two beams meet -> cutscene + W/A/S/D quick-time duel, winner obliterates the loser |
| V4.9 | Rune-Warden: Soldier's 3-kill streak -> runes + 20 s monster form (claws, 250 HP, adapts to repeated weapons) |
| V4.9.1 | Rune-Warden animation pass: roar / chest-pound / ground-smash entrance, brute gait, stomps, landing slam, revert shrink |
| V4.10 | Rune-Warden driven by imported creature animations (`models/warden.glb`, skeleton only) with our own body on the bones |
| V4.11 | Functional recoil (aim climb + settle), Knight Ashen Guard (block/parry/stagger/riposte) and Cinder Crash (4-kill leap slam) |
| V5 | Motion Pass (started in ChatGPT): damped body lean, strafe counter-sway, landing compression, weightier camera bob/roll |

Details: `CHANGELOG.md`. Third-party assets and their authors: `CREDITS.md` (keep it up to date).

## About the developer and how to work with them
- They are a **beginner** (with Unreal especially) and play/test on a **Chromebook** (Linux terminal, Chrome). Explain changes in plain language.
- Prefer giving exact commands / click-by-click steps. Keep the game runnable on low-end hardware (Low preset must stay smooth).
- Web game: friends join via the public link **https://neon-arena-blackout.onrender.com** (Render free plan, auto-deploys
  from `main` via the `render.yaml` Blueprint; first load after idle takes ~1 min). Fallback: `ngrok http 3000` from the Chromebook.
- They like the look of **Cyberpunk 2077 + Dark Souls 3**, but all brands/slogans must be **original** — never copy real game brands, logos or characters.
- Unreal track rules:
  - Claude **cannot edit Blueprints or `.umap`/`.uasset` files**. Use **Unreal Python scripts** (`unreal/kit/Tools/NeonArena/*.py`) or **exact click-by-click instructions**.
  - **One milestone at a time**, each with "How to test"; wait for confirmation before the next.
  - **Don't delete or restructure Lyra's core systems** without approval; our work goes in a new Game Feature plugin `NeonArena` and in duplicates of Lyra assets.

## Web track (`web/`)
```
cd web && npm install && npm start     # http://localhost:3000
npm test                               # sim unit tests + server integration tests (must pass)
./scripts/play.sh                      # start + public ngrok link (Chromebook)
```
- `shared/sim.js` — **single source of truth** for movement, collision, map boxes, classes (`CLASSES`), weapon timings, ray casts and damage.
  Map = "The Alley" (`HALF_X` 16, `HALF_Z` 56). Box kinds `boundary` (invisible wall) and `fence` don't stop bullets (`box.solid`).
  Shotgun pellets are seeded by the input sequence number (`pelletDirs`) so client and server agree.
  Loaded by the server (`require`) and the browser (`<script>`, `window.NeonSim`). Any map/gameplay change goes here first.
- `server.js` — authoritative: clients send only inputs; server runs 60 Hz ticks, owns position/ammo/HP/score,
  lag compensation (≤300 ms rewind), input-budget anti-speedhack, 30 Hz snapshots.
- `public/js/` — `main.js` (input, prediction/reconciliation, interpolation, loop), `world.js` (arena, lights, reflections, fog),
  `nightcity.js` (megacity dressing), `textures.js` (procedural PBR), `effects.js`, `weapon.js` + `gunmodel.js` (VX-9)
  + `classgear.js` (knight greatsword / shotgun), `warden.js` (Rune-Warden body; rides the animated skeleton in `public/models/warden.glb`, built by `web/tools/convert-warden.mjs`), `avatar.js` (one look per class), `audio.js` (procedural HRTF audio), `post.js`,
  `hud.js`, `touch.js` (phone controls).
- `NAB_DEBUG=1` enables a test-only `debug` socket event (teleport, grant shotgun, ult, `mon:'rise'`, `crash`). Never set it on Render.
- Quality presets live in `public/js/main.js` (`PRESETS`); `?quality=low|medium|high|ultra` forces one.
- Verify visual changes with headless Chromium + SwiftShader (Playwright) and check for console errors at Low/Medium/High.
- Hosting: `render.yaml` (root) deploys `web/` on Render's free plan; the server honours `PORT`.

## Unreal track (`unreal/`)
- `unreal/kit/` is copied into the developer's Lyra project folder (next to `LyraStarterGame.uproject`):
  `CLAUDE.md` (Lyra-specific), `Tools/NeonArena/lyra_inventory.py` (read-only project scan),
  `Tools/NeonArena/v2_map.json` (the V2 arena: 93 boxes + 14 spawns, meters, Y-up),
  `Tools/NeonArena/alley_map.json` (the current web map, V4.6: 139 boxes + 14 spawns).
- Carry-over spec (V2 numbers to reproduce in Unreal) and the Lyra structure notes: `unreal/kit/CLAUDE.md`.
- Milestones M0–M13 are tracked there. **Current: M0** (baseline + inventory output not yet received).

## Repo conventions
- Commit messages: short imperative subject, body explaining what/why.
- Never commit `node_modules/` or Unreal `Binaries/ Intermediate/ Saved/ DerivedDataCache/`.
