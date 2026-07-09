#!/usr/bin/env python3
"""
Wall module generator with port markers for port-based assembly.

Each wall module is built in a canonical "south-facing" pose:
  - Width along +X, depth (studs) along +Y, height along +Z
  - OSB sheathing on the south face (Y = -osb_thickness to 0)
  - Stud frame from Y=0 to Y=stud_depth
  - Bottom plate at Z=0, top plate at Z = height - plate_thickness

Usage (must run via freecadcmd):
    freecadcmd -c "import sys; sys.argv=['generate_wall_library.py','wall_instances.yaml']; exec(open('generate_wall_library.py').read())"
"""

from pathlib import Path
import sys

import yaml

from seh_lib import build_aperture_panel, build_wall


OUTPUT_DIR = Path("cad_library")


def load_yaml(path):
    with open(path, "r") as f:
        return yaml.safe_load(f)


def main():
    if len(sys.argv) != 2:
        print("Usage: generate_wall_library.py instances.yaml")
        sys.exit(1)

    data = load_yaml(sys.argv[1])
    OUTPUT_DIR.mkdir(exist_ok=True)

    for inst in data["instances"]:
        iid = inst["id"]
        print(f"Generating {iid}...")
        if "aperture" in inst["parameters"]:
            doc = build_aperture_panel(inst)
        else:
            doc = build_wall(inst)
        out = OUTPUT_DIR / f"{iid}.FCStd"
        out.parent.mkdir(exist_ok=True)
        doc.saveAs(str(out))
        print(f"  Saved {out}")

        for o in doc.Objects:
            if o.Name.startswith("port_"):
                bb = o.Shape.BoundBox
                cx = (bb.XMin + bb.XMax) / 2.0
                cy = (bb.YMin + bb.YMax) / 2.0
                cz = (bb.ZMin + bb.ZMax) / 2.0
                print(f"  {o.Name}: center=({cx:.1f}, {cy:.1f}, {cz:.1f})")

    print(f"\nGenerated {len(data['instances'])} modules in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
