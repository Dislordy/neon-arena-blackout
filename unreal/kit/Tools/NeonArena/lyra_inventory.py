"""
Neon Arena V3 (Build 3) — Lyra project inventory (read-only).

Lists the parts of your Lyra project that matter for our plan (experiences, pawn data,
heroes, weapons, abilities, gameplay cues, camera modes, input, maps, playlists) and the
C++ headers in Source/ and plugin Source/ folders. It changes NOTHING in your project.

How to run (Unreal Editor):
  Tools > Execute Python Script...  -> pick this file
Output:
  <YourProject>/Saved/NeonArena/lyra_inventory.txt   (paste its contents to Claude)
"""
import os
import unreal

ROOTS = ["/Game", "/ShooterCore", "/ShooterMaps", "/TopDownArena", "/ShooterExplorer", "/ShooterTests", "/NeonArena"]

# Name prefixes / keywords we care about, grouped for a readable report.
GROUPS = [
    ("Experiences", ("B_ShooterGame", "B_LyraDefaultExperience", "Experience")),
    ("Playlists / User-facing experiences", ("DA_",)),
    ("Pawn data", ("HeroData", "PawnData")),
    ("Heroes / characters", ("B_Hero",)),
    ("Weapon items + equipment", ("ID_", "WID_", "B_WeaponInstance")),
    ("Weapon abilities + ability sets", ("GA_Weapon", "AbilitySet_")),
    ("Damage effects", ("GE_Damage",)),
    ("Gameplay cues (VFX/SFX)", ("GCN_", "GCNL_")),
    ("Camera modes", ("CM_",)),
    ("Input", ("IMC_", "IA_", "InputData")),
    ("Scoring / bots / teams", ("Scoring", "BotSpawner", "TeamSetup", "B_Team")),
]


def class_name(asset):
    try:
        return str(asset.asset_class_path.asset_name)
    except AttributeError:  # UE 5.0
        return str(asset.asset_class)


def tag(asset, name):
    try:
        v = asset.get_tag_value(name)
        return str(v) if v else ""
    except Exception:
        return ""


def main():
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    rows = []
    for root in ROOTS:
        try:
            assets = reg.get_assets_by_path(root, recursive=True)
        except Exception:
            assets = []
        for a in assets:
            rows.append((str(a.package_name), str(a.asset_name), class_name(a),
                         tag(a, "NativeParentClass") or tag(a, "ParentClass")))

    out = []
    out.append("=== NEON ARENA V3 (BUILD 3) / LYRA INVENTORY ===")
    out.append("Engine: %s" % unreal.SystemLibrary.get_engine_version())
    out.append("Project: %s" % unreal.Paths.get_project_file_path())
    out.append("Total assets scanned: %d" % len(rows))

    # Content roots that exist
    roots_found = sorted({r[0].split("/")[1] for r in rows})
    out.append("Mounted content roots: " + ", ".join("/" + r for r in roots_found))

    # Maps
    out.append("\n--- Maps (World) ---")
    for pkg, name, cls, parent in sorted(rows):
        if cls == "World":
            out.append("  %s" % pkg)

    # Grouped interesting assets
    for title, keys in GROUPS:
        out.append("\n--- %s ---" % title)
        hits = [r for r in rows if any(k in r[1] for k in keys) and r[2] != "World"]
        for pkg, name, cls, parent in sorted(hits)[:200]:
            p = parent.split(".")[-1].strip("'\"") if parent else ""
            out.append("  %-60s %-28s %s" % (pkg, cls, ("parent=" + p) if p else ""))
        if not hits:
            out.append("  (none found)")

    # Blueprints that derive from Lyra C++ classes (shows the C++ <-> Blueprint seams)
    out.append("\n--- Blueprints derived from Lyra C++ classes ---")
    for pkg, name, cls, parent in sorted(rows):
        if parent and "Lyra" in parent and cls in ("Blueprint", "WidgetBlueprint", "AnimBlueprint", "GameplayAbilityBlueprint"):
            out.append("  %-60s <- %s" % (pkg, parent.split(".")[-1].strip("'\"")))

    # C++ headers
    proj_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
    out.append("\n--- C++ headers (Source/ and Plugins/*/Source/) ---")
    src_dirs = [os.path.join(proj_dir, "Source")]
    plug_root = os.path.join(proj_dir, "Plugins")
    for dirpath, dirnames, _ in os.walk(plug_root):
        if os.path.basename(dirpath) == "Source":
            src_dirs.append(dirpath)
            dirnames[:] = []
    for sd in src_dirs:
        for dirpath, _, files in os.walk(sd):
            hs = sorted(f for f in files if f.endswith(".h"))
            if hs:
                rel = os.path.relpath(dirpath, proj_dir)
                out.append("  %s: %s" % (rel, ", ".join(hs)))

    save_dir = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "NeonArena")
    os.makedirs(save_dir, exist_ok=True)
    path = os.path.join(save_dir, "lyra_inventory.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    unreal.log("Neon Arena inventory written to: " + path)
    print("Neon Arena inventory written to: " + path)


main()
