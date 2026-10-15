# Neon Arena — Unreal Engine 5 / Lyra track

The goal is to rebuild the web game in **Unreal Engine 5** on top of **Lyra Starter Game**: same arena,
same gameplay numbers, the same neon look, with UE5 lighting (Lumen), volumetric fog, Niagara rain and real assets.

## What's here
| File | Purpose |
|---|---|
| `kit/CLAUDE.md` | Lyra-specific notes: how Lyra is organised, the V2 numbers to carry over, the milestone plan (M0–M13). |
| `kit/Tools/NeonArena/lyra_inventory.py` | **Read-only** scan of your Lyra project (assets, maps, C++ headers). |
| `kit/Tools/NeonArena/v2_map.json` | The V2 arena layout (93 boxes, 14 spawns), used to auto-build the blockout in M2. |
| `kit/Tools/NeonArena/alley_map.json` | The web game's current map, "The Alley" (V4.6: 139 boxes, 14 spawns). |

## How to use it
1. Copy everything inside `kit/` into your Lyra project folder (next to `LyraStarterGame.uproject`).
2. Do **M0** from `kit/CLAUDE.md`:
   - back up the project (source control)
   - play **L_Expanse** with 2 players (*Play ▸ ⋮ ▸ Number of Players = 2, Net Mode = Play As Listen Server*)
   - run *Tools ▸ Execute Python Script…* → `Tools/NeonArena/lyra_inventory.py`
   - send Claude `Saved/NeonArena/lyra_inventory.txt` and your UE version (*Help ▸ About*).

The Lyra project itself is many gigabytes, so it is **not** stored in this repository.
If you want Claude to read its C++, push `Source/`, `Config/`, `Plugins/*/Source/`, `*.uproject` and `CLAUDE.md` to a separate repo.
