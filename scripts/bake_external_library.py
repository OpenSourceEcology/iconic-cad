#!/usr/bin/env python3
"""
Bake placeable VCS library entries into Iconic CAD editor assets.

Usage:
    scripts/bake_external_library.py <path-to-vcs-library-checkout>

The script uses the checkout's installed/importable libtools package to discover
entries with interface metadata, validates selected entries with validate-code,
and writes web/data/systems/vcs12.json. When freecadcmd is available it also
compiles wall/ceiling entries and bakes per-direction BREP assets into
web/assets/lib/vcs12/.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from textwrap import dedent

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "web" / "assets" / "lib" / "vcs12"
MANIFEST_PATH = REPO_ROOT / "web" / "data" / "systems" / "vcs12.json"
DIRECTIONS = ("north", "south", "east", "west")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("library_root", type=Path)
    ap.add_argument("--no-thumbs", action="store_true", help="skip thumbnail generation")
    args = ap.parse_args()

    lib_root = args.library_root.resolve()
    if not (lib_root / "library").is_dir():
      fail(f"not a vcs-library checkout: {lib_root}")

    sys.path.insert(0, str(lib_root))
    from libtools.export_json import export_entry
    from libtools.registry import discover

    entries = discover(lib_root)
    exported = [export_entry(e) for e in entries]
    placeable = [
        (entry, data) for entry, data in zip(entries, exported)
        if (data.get("interface") or {}).get("system") == "vcs12"
        and (data.get("interface") or {}).get("role") in {"wall", "ceiling"}
    ]
    if not placeable:
        fail("no vcs12 wall/ceiling interface entries found")

    validate_ids = [data["id"] for _, data in placeable]
    validate_code(lib_root, validate_ids)

    wall_entries = [data for _, data in placeable if data["interface"]["role"] == "wall"]
    manifest = vcs12_manifest(wall_entries)
    write_json(MANIFEST_PATH, manifest)
    print(f"wrote {MANIFEST_PATH.relative_to(REPO_ROOT)} ({len(wall_entries)} wall modules)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    freecadcmd = shutil.which(os.environ.get("FREECADCMD", "freecadcmd"))
    if not freecadcmd:
        write_pending(validate_ids, "freecadcmd not found; BREP and thumbnail assets were not baked")
        print("freecadcmd not found; wrote manifest only")
        return 0

    bake_geometry(freecadcmd, lib_root, validate_ids)
    if args.no_thumbs:
        write_pending(validate_ids, "thumbnail bake skipped; BREP assets were baked")
        print("thumbnail bake skipped")
    else:
        write_placeholder_svgs(wall_entries)
        print("wrote placeholder SVG thumbnails; replace with rendered PNGs when the viewer bake is available")
    return 0


def fail(msg: str) -> None:
    print("ERROR: " + msg, file=sys.stderr)
    raise SystemExit(1)


def validate_code(root: Path, ids: list[str]) -> None:
    with tempfile.TemporaryDirectory(prefix="iconic-vcs-reports-") as reports:
        cmd = [
            sys.executable, "-m", "libtools", "validate-code",
            "--root", str(root),
            "--reports-dir", reports,
            *ids,
        ]
        print("[validate] " + " ".join(cmd))
        res = subprocess.run(cmd, cwd=REPO_ROOT)
    if res.returncode != 0:
        fail("validate-code failed; refusing to bake VCS assets")


def vcs12_manifest(wall_entries: list[dict]) -> dict:
    palette = []
    for data in sorted(wall_entries, key=lambda d: d["id"]):
        iface = data["interface"]
        palette.append({
            "id": data["id"],
            "label": data.get("title") or data["id"],
            "thumb": f"assets/lib/vcs12/{data['id']}.svg",
            "brep_base": f"assets/lib/vcs12/{data['id']}",
            "width_in": float(iface["width_in"]),
            "height_in": float(iface["height_in"]),
            "depth_in": float(iface["depth_in"]),
            "exterior_face": iface["exterior_face"],
        })
    return {
        "id": "vcs12",
        "label": "VCS 12-ft Demonstrator",
        "module_grid_in": 12,
        "stud_spacing_in": 24,
        "wall_depth_in": 6,
        "palette": palette,
    }


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_pending(ids: list[str], reason: str) -> None:
    lines = [reason, "", "Pending assets:"]
    for entry_id in ids:
        for direction in DIRECTIONS:
            lines.append(f"- {entry_id}__{direction}.brp")
        lines.append(f"- {entry_id}.svg")
    (OUT_DIR / "ASSETS_PENDING.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def bake_geometry(freecadcmd: str, lib_root: Path, ids: list[str]) -> None:
    driver = dedent(
        r'''
        import importlib.util
        import os
        from pathlib import Path
        import sys

        root = Path(os.environ["VCS_LIBRARY_ROOT"]).resolve()
        out_dir = Path(os.environ["ICONIC_VCS_OUT"]).resolve()
        ids = os.environ["ICONIC_VCS_IDS"].split(",")
        sys.path.insert(0, str(root))

        import FreeCAD as App
        import Part
        from libtools.registry import discover, load_schema

        ROT = {"north": 0.0, "east": 90.0, "south": 180.0, "west": 270.0}

        def load_compiler(path):
            spec = importlib.util.spec_from_file_location("_vcs_compiler_" + path.parent.name, path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod

        def entry_shape(doc):
            shapes = []
            for obj in doc.Objects:
                shape = getattr(obj, "Shape", None)
                solids = getattr(shape, "Solids", None) if shape is not None else None
                if shape is not None and solids:
                    shapes.append(shape.copy())
            if not shapes:
                raise RuntimeError("compiled document produced no solids")
            return Part.makeCompound(shapes)

        def bake_dir(shape, rot):
            s = shape.copy()
            s.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), rot)
            bb = s.BoundBox
            s.translate(App.Vector(-bb.XMin, -bb.YMin, -bb.ZMin))
            return s.mirror(App.Vector(0, 0, 0), App.Vector(0, 1, 0))

        entries = {entry.id: entry for entry in discover(root)}
        out_dir.mkdir(parents=True, exist_ok=True)
        volumes = {}
        for entry_id in ids:
            entry = entries[entry_id]
            schema = load_schema(entry)
            compiler = load_compiler(entry.compiler_path)
            doc = App.newDocument(schema["document_name"])
            compiler.compile(schema, doc)
            doc.recompute()
            shape = entry_shape(doc)
            volumes[entry_id] = int(round(shape.Volume))
            for direction, rot in ROT.items():
                bake_dir(shape, rot).exportBrep(str(out_dir / f"{entry_id}__{direction}.brp"))
            App.closeDocument(doc.Name)
            print(f"baked {entry_id}")

        import json
        (out_dir / "volumes.json").write_text(json.dumps(volumes, indent=2) + "\n", encoding="utf-8")
        '''
    )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(driver)
        driver_path = f.name
    env = os.environ.copy()
    env["VCS_LIBRARY_ROOT"] = str(lib_root)
    env["ICONIC_VCS_OUT"] = str(OUT_DIR)
    env["ICONIC_VCS_IDS"] = ",".join(ids)
    cmd = [freecadcmd, driver_path]
    print("[geometry] " + " ".join(cmd))
    try:
        res = subprocess.run(cmd, cwd=REPO_ROOT, env=env)
    finally:
        Path(driver_path).unlink(missing_ok=True)
    if res.returncode != 0:
        fail("freecadcmd bake failed")


def write_placeholder_svgs(wall_entries: list[dict]) -> None:
    for data in wall_entries:
        iface = data["interface"]
        w = float(iface["width_in"])
        h = float(iface["height_in"])
        label = data["id"].replace("_", " ")
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">
  <rect width="120" height="90" fill="#111828"/>
  <rect x="18" y="18" width="84" height="44" rx="2" fill="#2a3a5c" stroke="#4fc3f7" stroke-width="2"/>
  <rect x="18" y="18" width="84" height="8" fill="#4fc3f7" opacity="0.28"/>
  <text x="60" y="74" text-anchor="middle" fill="#ddeeff" font-size="8" font-family="monospace">{label}</text>
  <text x="60" y="84" text-anchor="middle" fill="#8a93a8" font-size="7" font-family="monospace">{w:g} x {h:g} in</text>
</svg>
'''
        (OUT_DIR / f"{data['id']}.svg").write_text(svg, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
