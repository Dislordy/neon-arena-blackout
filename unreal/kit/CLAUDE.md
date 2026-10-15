# CLAUDE.md — Neon Arena: Blackout, Unreal/Lyra track (started as V3 · Build 3, part of the V4 project)

## What this project is
**Neon Arena: Blackout V3 (Build 3)** is a multiplayer FPS made in **Unreal Engine 5** on top of the
**Lyra Starter Game**. It is the successor to **Neon Arena V2**, a browser game (Three.js + Node/Socket.IO).
V3 rebuilds V2 in Unreal: **same arena, same gameplay numbers, same neon look**, now with UE5 visuals.

Goal: one map with a Cyberpunk-style look: a rainy neon city at night, wet reflective streets, fog,
and punchy, realistic gunplay.

### Version history
| Version | What | Where |
|---|---|---|
| V1 | Original prototype (Three.js, client-trusted movement) | original `neon-arena-blackout.zip` |
| V2 | Browser game: authoritative server, PBR neon megacity, cyber-knight runners, VX-9 rifle | GitHub `Dislordy/neon-arena-blackout` → `web/` |
| **V3 (Build 3)** | **This project: Unreal Engine 5 + Lyra** | this Lyra project folder |
| V4 (Build 4) | Unified repo for both tracks | GitHub `Dislordy/neon-arena-blackout` |

V2's source (the web game) is in the `Dislordy/neon-arena-blackout` repo under `web/` — gameplay numbers in
`web/shared/sim.js` and `web/server.js`. V2's map is exported in `Tools/NeonArena/v2_map.json`.

## Rules for working with me (the developer)
- I'm a **beginner with Unreal**. Explain every change in plain language: what changed, why, and where to find it in the editor.
- Claude **cannot edit Blueprints or `.umap`/`.uasset` files** (they're binary). When a change needs the editor, either:
  - write an **Unreal Python script** (saved under `Tools/NeonArena/`, run via *Tools → Execute Python Script…*), or
  - give **exact click-by-click instructions**.
- Work **one milestone at a time**. Each milestone ends with "How to test" steps. Don't start the next milestone until I confirm the current one works.
- **Don't delete or restructure Lyra's core systems** (`Source/LyraGame`, Lyra's plugins, `ShooterCore`, `ShooterMaps`) without my approval.
  Our work lives in a **new Game Feature plugin `NeonArena`** (`Plugins/GameFeatures/NeonArena`, mount point `/NeonArena/`)
  and in **duplicates** of Lyra assets, never in edits to the originals.
- C++ changes are allowed, but prefer adding new classes over modifying Lyra's, and explain how to rebuild
  (close editor → build `LyraStarterGame` *Development Editor / Win64* → reopen).

## Carry-over spec from V2 (source of truth: `web/shared/sim.js` and `web/server.js`)
V2 uses **meters, Y-up**; Unreal uses **centimeters, Z-up**. Conversion: `UE_X = x·100`, `UE_Y = z·100`, `UE_Z = y·100`
(this mirrors the map left↔right — fine, the arena is point-symmetric).

### Arena
- 56 m × 56 m square (perimeter wall center line at ±28 m), walls 7 m tall.
- 93 solid pieces: reactor core (center), 6 neon buildings, 2 towers, 6 cover walls, 16 jumpable crates (1.1 m),
  10 barrels, 4 vending machines, 4 perimeter catwalks (deck at 3.3 m) each with a 10-step staircase.
- 14 spawn points. Exact boxes/spawns: `Tools/NeonArena/v2_map.json`.

### The Alley (web V4.6 map — the web game's current map)
- Back-alley 32 m wide × 112 m long (building fronts at x = ±16 m with 3 m-deep alcoves, invisible walls at z = ±56 m;
  the alley visually continues into fog past a police cordon).
- Burnt-out bus in the middle, wrecked cars, dumpsters (1.25 m, jumpable), concrete barriers (1 m), chain-link fences
  (block players, not bullets), crates, burning barrels, a shanty shack; fire escapes along the fronts joined by
  footbridges across the alley (deck at 3.3 m, 10-step stairs). 139 boxes, 14 spawns: `Tools/NeonArena/alley_map.json`
  (each box says `blocksBullets`). Which map M2 blocks out first is the developer's choice.

### Player
| V2 value | Meaning | Unreal equivalent (to tune) |
|---|---|---|
| 1.8 m tall, 0.35 m radius, eyes at 1.62 m | body size | capsule half-height 90 cm, radius 35 cm |
| 6.2 m/s | run speed | MaxWalkSpeed 620 |
| jump 7.2 m/s, gravity 19 m/s² (~1.36 m jump) | snappy jumps | JumpZVelocity 720, GravityScale ≈ 1.94 |
| step 0.45 m | stairs/crates edges | MaxStepHeight 45 |
| 100 HP; respawn 2.5 s; spawn protection 1.6 s | health/respawn | Lyra health + Elimination experience settings |

### VX-9 "Kestrel" energy rifle
| V2 value | Meaning |
|---|---|
| 24-round magazine, 1.35 s reload (auto-reload when empty) | ammo |
| 183 ms between shots (~330 RPM), full-auto | fire rate |
| body 34 · head 68 (2×) · legs 26 | damage (3 body shots / 2 headshots to kill) |
| full damage to 25 m, falls to 65 % at 70 m; max range 90 m | falloff |
| climbing vertical recoil + small horizontal drift, less when aiming down sights | recoil feel |
| plasma coils, capacitor tube, skull charm, inspect on F | look/details |

### Abilities and match
| V2 | Behavior |
|---|---|
| Dash (Shift) | 19 m/s burst for 0.22 s, 5 s cooldown |
| Shield (Q) | 2.2 s, damage × 0.3, 9 s cooldown; also instantly refills the energy shield (V4.5) |
| Scan (E) | reveals enemies through walls 1.4 s, 12 s cooldown |
| Match | 4 min, up to 8 players, free-for-all; kill 100 pts, headshot kill 125 |

### Classes (added in web V4.5)
| Class | HP | Speed | Dash | Weapon |
|---|---|---|---|---|
| Soldier | 100 | 6.2 m/s | 1 charge, 5 s | VX-9 rifle |
| Assassin | 85 | 6.7 m/s | 3 charges, each refills in 2.8 s, 0.27 s between dashes | Longwire sniper (V4.7): 5 rounds, 1.1 s bolt cycle, 2.1 s reload, 150 head / 80 body / 60 legs, no falloff, 0.05 rad hip spread, exact when scoped. 5 kills in a row → Obliteration Beam: 1.6 s charge (30% move speed), 14 m-wide beam, 140 m, through walls, kills; the half of the map it fired into burns 15 s at 20 dps below 1.5 m height |
| Knight | 130 | 6.0 m/s | 1 charge, 5 s | Greatsword: 60 dmg, 0.55 s swing, 2.7 m reach, ~40° cone, small lunge. Every kill turns it into a shotgun: 6 shells, 8 pellets, 0.065 rad spread, 13/20/10 dmg per pellet (body/head/legs), full to 8 m then down to 25% at 25 m, 0.8 s pump; folds back into the sword when empty |

Beam Clash (V4.8): a beam fired at a player who is charging/holding theirs and aiming back starts a clash —
both locked 7.1 s (1.2 s intro cutscene, 5 s duel, 0.9 s outro), same random 60-key W/A/S/D sequence, wrong key = 0.3 s stun,
max 20 presses/s; most correct keys wins and their beam fires through the loser; tie = both die.

Rune-Warden (V4.9): a Soldier with 3 kills in a row → 1.5 s rune rise (30% move speed, can't attack) → 20 s monster:
250 HP + full shield, 7.4 m/s, jump 9.2 m/s, hitbox ×1.35; claws replace the rifle: 85 dmg, 0.5 s swing, 3.4 m reach,
~100° cone, 5 m/s lunge. Adaptation: each hit from the same weapon type does 15% less (max −60%); the halo turns 60° per step.
On expiry HP is scaled back (hp / 250 × 100).

Everyone has a 50-point energy shield that takes damage before health and refills at 25/s after 3.5 s without damage.

### Look
Rain, wet puddle reflections, height fog + light shafts, magenta-tinted smog, neon signs (incl. vertical katakana signs),
animated holo-ads on megabuildings, holographic koi around the reactor core, graffiti, vending machines, flying traffic,
bloom + anamorphic streaks, teal-shadow / sodium-highlight grade. Runners are "cyber-knights": worn plate armour,
hooded helm with neon visor slit, tattered cloak, chrome cyber-arm. HUD: red / electric-yellow / cyan, "FLATLINED" death screen.
All brand names are original (MOKU RAMEN, HELIX BIOWARE, VOLTA COLA, …) — never copy real Cyberpunk 2077 brands/logos.

## How Lyra is organised (stock layout — verify with `Tools/NeonArena/lyra_inventory.py`)
> Status: written from the standard Lyra Starter Game, **not yet verified against this project**.
> After running the inventory script, update this section with real paths/names.

| Path | What it is | C++ or Blueprint/Data |
|---|---|---|
| `LyraStarterGame.uproject` | Project file (plugins, modules) | text |
| `Source/LyraGame/` | Framework: experiences, character, weapons, abilities, camera, teams, UI base | **C++** |
| `Source/LyraEditor/` | Editor-only tools | C++ |
| `Config/` | `DefaultGame.ini` (Asset Manager types, default experience), `DefaultEngine.ini` (rendering, maps, online) | text |
| `Content/` | Core content: default hero, UI, front end `L_LyraFrontEnd`, `B_LyraDefaultExperience` | Blueprint/Data |
| `Plugins/` (non-GameFeatures) | CommonGame, CommonUser, ModularGameplayActors, GameSettings, UIExtension, … | mostly C++ |
| `Plugins/GameFeatures/ShooterCore/` | **The shooter game**: experiences, hero, weapons, scoring, bots, shooter UI | Blueprint/Data |
| `Plugins/GameFeatures/ShooterMaps/` | `L_Expanse`, `L_Convolution_Blockout` + playlist entries | Blueprint/Data |

### Experiences (instead of "one GameMode per map")
- **C++:** `GameModes/LyraExperienceDefinition.h`, `LyraExperienceManagerComponent` (loads it on the GameState),
  `LyraGameMode` (generic), `LyraUserFacingExperienceDefinition` (menu/playlist entry), `LyraWorldSettings` (per-map default).
- **Data:** `ShooterCore/Content/Experiences/B_ShooterGame_Elimination` etc. An experience lists Game Feature plugins
  to enable, the **Default Pawn Data**, and **Actions** (add components like scoring/bots/teams, widgets, input).
- Selection order: URL `?Experience=` → map *World Settings → Default Gameplay Experience* → project default.

### Player character
- **C++:** `Character/` — `ALyraCharacter`, `ULyraPawnExtensionComponent`, `ULyraHeroComponent`, `ULyraHealthComponent`;
  `Camera/` — `ULyraCameraComponent`, `ULyraCameraMode`.
- **Data/Blueprint:** `B_Hero_ShooterMannequin`, Pawn Data `HeroData_ShooterGame` (pawn class, ability sets, input config,
  default camera mode), camera modes `CM_ThirdPerson` / `CM_ThirdPersonADS`, anim Blueprints + weapon anim layers.
- ⚠️ Lyra's shooter is **third-person by default**; V2 is first-person → milestone M9.

### Weapons (Gameplay Ability System)
- **C++:** `Inventory/`, `Equipment/` (`ULyraQuickBarComponent` = weapon slots), `Weapons/` — `ULyraRangedWeaponInstance`
  (spread/heat), `ULyraGameplayAbility_RangedWeapon` (hitscan traces, predicted on client, confirmed by server),
  `ULyraWeaponStateComponent` (confirmed hit markers); damage via `ULyraDamageExecution`.
- **Data/Blueprint per weapon** (`ShooterCore/Content/Weapons/Rifle/`): `ID_Rifle` → `WID_Rifle` → `B_WeaponInstance_Rifle`
  → `AbilitySet_ShooterRifle` → `GA_Weapon_Fire_Rifle` → `GE_Damage_*` → `GCN_*` cues (muzzle flash, impacts, sounds).
- Stock Lyra relies on **spread**, not camera kick → V2-style recoil must be added (M10).

### Multiplayer
Server-authoritative replication + GAS prediction. Editor test: *Play ▸ ⋮ ▸ Number of Players = 2, Net Mode = Play As Listen Server*.

## Planned V3 assets (all inside the NeonArena plugin)
| Thing | Path |
|---|---|
| Experience | `/NeonArena/Experiences/B_NeonArena_Elimination` (duplicate of `B_ShooterGame_Elimination`) |
| Map | `/NeonArena/Maps/L_NeonArena` (blockout generated from `v2_map.json`) |
| Playlist entry | `/NeonArena/Playlists/DA_NeonArena_FFA` |
| Weather | `/NeonArena/Weather/MPC_Weather`, `M_WetSurface`, `NS_Rain` |
| VX-9 rifle | `/NeonArena/Weapons/VX9/` (duplicates of Lyra rifle assets, retuned to V2 numbers) |
| Abilities | `/NeonArena/Abilities/` (Dash, Shield, Scan) |
| Editor scripts | `Tools/NeonArena/*.py` |

## Milestone tracker
- [ ] M0 Baseline: Lyra runs, 2-player listen-server test, source control, inventory output pasted, UE version noted
- [ ] M1 `NeonArena` Game Feature plugin + own experience (duplicate), proven active
- [ ] M2 V2 arena blockout generated in `L_NeonArena` from `v2_map.json` (Python), spawns placed, 2-player playable
- [ ] M3 Map selectable from Lyra's main menu (playlist entry)
- [ ] M4 Night lighting + Lumen + volumetric fog
- [ ] M5 Wet reflective streets (MPC_Weather + M_WetSurface + puddles)
- [ ] M6 Neon signs and practical lights (V2 sign set)
- [ ] M7 Rain (Niagara) + rain audio
- [ ] M8 Post-process grade (bloom, flares, grain, LUT) matching V2
- [ ] M9 Camera: first-person (V2 style) vs. tight third-person — decide, then implement
- [ ] M10 Punchy gunplay: VX-9 retuned to V2 numbers, recoil, shakes, muzzle/impact VFX, audio, hit feedback
- [ ] M11 V2 movement feel (speed/jump/gravity) + Dash/Shield/Scan abilities
- [ ] M12 Set dressing: megabuildings, holo-ads, koi, graffiti, cyber-knight look (Nanite)
- [ ] M13 Performance + packaged multiplayer test

## Useful facts
- Python scripts need *Edit ▸ Plugins ▸ "Python Editor Script Plugin"* enabled (on by default in UE5).
- `Saved/`, `Intermediate/`, `Binaries/`, `DerivedDataCache/` are generated — never commit them.
