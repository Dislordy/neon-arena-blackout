# Changelog — Neon Arena: Blackout

## V4.2 — Realistic gunfire
- VX-9 shot rebuilt the way a real rifle sounds: supersonic N-wave crack, saturated muzzle blast, low thump from
  filtered noise (no synth "boing"), bolt carrier back/forward clacks, short air boom; faint electrical crackle.
- Echoes off the real map: each shot casts rays and replays from the buildings it hits, delayed by the extra
  travel distance at the speed of sound (343 m/s), quieter and duller.
- Speed of sound and air absorption: remote shots arrive after the muzzle flash and lose highs with distance.
- Near misses: a supersonic bullet "crack" that arrives before the shooter's bang.
- Street-canyon reverb: dense early reflections, long low rumble, fast-decaying highs.
- Real recordings supported: drop CC0 files in `web/public/audio/` and list them in `manifest.json`.

## V4.1 — Audio remix
- Mixer rebuilt into separate channels: action (guns, movement, impacts) with its own glue compressor,
  ambience (rain, city hum, neon buzz) that ducks under every gunshot, UI (hit markers), and a master limiter.
- New VX-9 rifle sound in 4 stereo variations: crack, sub punch, body, FM plasma zap, metallic ring, bolt clack,
  slap-back echoes off buildings. Distant shots get a muffled version with rolling echoes.
- Softer stereo rain (no hiss), wet footsteps (6 variations), armour clink on other runners' steps,
  reverb with early reflections off the street walls.
- Measured mix: own fire ≈ −10 dB, nearby enemy ≈ −17 dB, footsteps/reload ≈ −24 dB, rain ≈ −34 dB (RMS).

## V4 · Build 4
- New home: this repository unifies the web game, the Unreal/Lyra track and the V1 archive.
- Web: version badge "V4 · BUILD 4", `render.yaml` for a permanent public link (Render free plan),
  `web/scripts/play.sh` Chromebook launcher (game + ngrok link, or `--local`).
- Unreal: starter kit moved to `unreal/kit/` (Lyra CLAUDE.md, inventory script, V2 map export).

## V3 · Build 3 — Unreal Engine 5 / Lyra plan
- Plan of 13 testable milestones to rebuild the game on Lyra (own `NeonArena` Game Feature plugin).
- `lyra_inventory.py` (read-only scan of a Lyra project), `v2_map.json` (arena export), carry-over spec of V2 numbers.

## V2.2 — Cyber-knights & VX-9
- Runners rebuilt as cyber-knights: worn plate armour, hooded great helm with neon visor slit, layered pauldron,
  tattered cloak/tabard animated by wind and motion, chrome cyber-arm, idle breathing, hit flinch,
  collapse-and-dissolve-into-embers death.
- VX-9 "Kestrel" rifle built from bevelled extruded profiles (vented handguard, skeleton stock, curved mag),
  plasma coils that heat up when firing, capacitor tube, skull charm on a pendulum, inspect animation (F).
- Viewmodel arms: chrome cyber-arm + plate gauntlet. Souls-style "FLATLINED" death screen.

## V2.1 — Megacity art pass
- Graffiti, vending machines (solid in the shared map), trash clutter, vertical katakana neon signs,
  animated holo-ads on megabuildings, holographic koi, magenta smog.
- Post: anamorphic lens streaks, damage glitch tearing, teal/sodium grade. HUD restyle (red/yellow/cyan).

## V2 (2.0) — Web rework
- Graphics: procedural PBR materials, IBL, soft shadows + sweeping searchlights, planar puddle reflections,
  height fog, light shafts, ground mist, rain, bloom/ACES, detailed arena and skyline.
- Gunplay: recoil, sway, ADS, keyframed reload, muzzle flashes, tracers, impacts/decals, shells,
  server-confirmed hit markers, damage numbers/indicators, procedural HRTF positional audio.
- Multiplayer: shared deterministic sim, inputs-only clients, 60 Hz authoritative server, prediction +
  reconciliation, interpolation, lag-compensated hits, anti-speedhack input budget. Tests: `npm test`.

## V1 — Prototype
- Original browser prototype (client-simulated movement). Kept in `archive/v1-prototype/`.
