# NEON ARENA: BLACKOUT — V5 · Motion Pass

**▶ Play now: https://neon-arena-blackout.onrender.com** (free hosting — if nobody has played for a while, the first load takes about a minute)

A cyberpunk multiplayer FPS: rain-soaked neon megacity, wet reflective streets, fog, cyber-knight runners
and punchy energy-rifle gunplay.

| Folder | What's inside |
|---|---|
| [`web/`](web/) | **The playable browser game** (Three.js + authoritative Node server). |
| [`unreal/`](unreal/) | The **Unreal Engine 5 / Lyra** rebuild: starter kit, plan and milestones. |
| [`archive/v1-prototype/`](archive/v1-prototype/) | The original V1 prototype, kept for history. |

See [`CHANGELOG.md`](CHANGELOG.md) for V1 → V5.

## Play the web game
```bash
cd web
npm install
npm start            # open http://localhost:3000
```
Chromebook (Linux terminal): `cd web && ./scripts/play.sh` starts the game and an ngrok link for friends.

## Share it with friends: permanent link (free)
1. Make an account at **https://render.com** and connect your GitHub.
2. Click **New + → Blueprint**, pick this repository, and click **Apply**. Render reads `render.yaml` and builds the game.
3. After a few minutes you get a link like `https://neon-arena-blackout.onrender.com`. Send that to friends.

The free plan sleeps after ~15 minutes with nobody playing; the first visit then takes about a minute to wake it up.

## Unreal Engine 5 / Lyra track
Start with [`unreal/README.md`](unreal/README.md).
