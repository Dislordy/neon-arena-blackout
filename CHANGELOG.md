# Changelog — Neon Arena: Blackout

## V4.8 — Beam Clash
- Fire your Obliteration Beam at someone who is charging (or holding) theirs and aiming back, and the beams
  **clash**: a quick cutscene (black bars, side-on camera, "BEAM CLASH", both players shout a line) and then a
  5-second **W/A/S/D duel** — both get the same random key sequence; every correct key pushes the clash point
  towards your rival, a wrong key stuns you for 0.3 s. Arrow keys work too; phones get four on-screen buttons.
- Most correct keys wins: the winner's beam overpowers the other, obliterates the loser and carries on down the
  alley (the half it goes into burns as usual). A perfect tie detonates both beams — double obliteration.
- Everyone else watches the two beams grind against each other in the alley. The server checks every key press.

## V4.7 — Longwire & the Obliteration Beam
- Assassin now carries the **Longwire sniper rifle**: 5-round bolt action (1.1 s between shots, 2.1 s reload),
  150 headshot (one-shot kill) / 80 body / 60 legs, no damage falloff. Scope with right-click (or ADS on phones):
  zoomed view with a scope overlay and lower sensitivity; dead accurate scoped, strays a little from the hip.
- **5 kills in a row** (without dying) charge the **Obliteration Beam**: the next shot starts a 1.6 s build-up —
  a blue rune circle grows in front of the rifle while you slow down — then a 14 m-wide beam tears down the alley,
  through walls, killing everyone in its path. The half of the alley it went into **burns for 15 s**
  (20 damage per second on the ground; fire escapes and bridges are safe; the shooter is immune).
- HUD streak meter, "OBLITERATION READY" alert, kill feed "✦ OBLITERATED" / "🔥 burned". Other players see and hear
  the charge-up coming. New sounds: sniper crack, bolt, charge-up, beam blast, beam ready.

## V4.6 — The Alley
- New map: a long back-alley between two rotting megablocks — 32 m × 112 m (twice as long as the old arena).
  Burnt-out bus in the middle, wrecked cars, dumpsters, concrete barriers, crates, burning barrels,
  a chain-link fence with razor wire (stops people, not bullets), loading-bay alcoves, a shanty camp,
  and fire escapes joined by footbridges across the alley.
- No more arena walls: the sides are building fronts and the two ends are **invisible walls**; the alley keeps
  going into the fog past an abandoned police cordon.
- Harsher atmosphere: thick dirty smog, starless soot sky with lightning and thunder, dying sodium street lamps,
  flickering signs (many half dead), barrel fires with embers and smoke, steam from manholes, a snapped cable that
  sparks, a police drone sweeping the alley with a searchlight, grim graffiti and ads ("WE BUY ORGANS · CASH TODAY"),
  trash everywhere, distant sirens. Drained, gritty colour grade.
- Lighter graphics: default quality is now **Medium** on computers (Low on phones), less bloom, fewer real lights
  (each quality level has a light budget; the rest are glow-only).
- Unreal kit: `alley_map.json` export of the new map.

## V4.5 — Classes & shields
- Pick a class in the lobby (or from the ☰ menu; it switches on your next respawn):
  - **Soldier** — the original runner: VX-9 rifle, 100 HP, one dash.
  - **Assassin** — VX-9 rifle, 85 HP, fastest runner, **three dash charges** that refill one at a time.
    A small badge on the top-right of the dash button shows how many are left.
  - **Knight** — 130 HP, the *Cinder Oath* greatsword (hold fire to swing; small lunge; alternating slashes).
    Every kill reforges the blade into the *Pyre* shotgun (6 shells, 8 pellets); it folds back into the sword when empty.
- Everyone has a 50-point **energy shield** that takes damage first and recharges after 3.5 s out of fire.
  The SHIELD ability (Q) now also refills it instantly. New HUD shield bar, hit/break/recharge sounds.
- New third-person looks: tactical Soldier (visored helmet, chest rig), hooded Assassin (mask, glowing eyes,
  long cloak), horned Knight (twin spiked pauldrons, tabard, sword or shotgun in hand).
- New sounds: sword swing / hit, shotgun blast + pump, transformation, shield hit / break / recharge.
- All damage stays server-authoritative and lag-compensated (sword reach, pellets, shield). 31 automated tests.

## V4.4 — In-game menu
- ☰ menu button next to the timer (phones and desktop; Esc also opens it on desktop): Resume, Sound on/off
  with a volume slider (remembered between visits, M toggles sound), Scoreboard, and Exit match
  (needs a second tap so a stray thumb can't throw you out). The match keeps running while it is open.

## V4.3 — Mobile
- Landscape play: tapping Create/Join on a phone goes fullscreen and locks the screen sideways (Android Chrome);
  phones held upright see a "Rotate your phone" screen. Web app manifest (landscape, fullscreen) for Add to Home Screen.
- New touch controls: floating joystick that appears under your left thumb, drag anywhere on the right to aim,
  big FIRE button you can also drag to keep aiming while shooting, ADS toggle, jump, reload, and
  Dash / Shield / Scan buttons with live cooldown rings. Short vibrations on fire and taps.
- Compact phone HUD: smaller top bar, ammo at the bottom centre, leaderboard and keyboard hints hidden,
  notch-safe button placement, touch control hints on the menu. Low graphics picked automatically.

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
