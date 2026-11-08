#!/usr/bin/env python3
"""
Export an IFC4 model from a web-UI layout JSON.

IFC is the open multi-trade interchange format (IfcProject -> IfcSite ->
IfcBuilding -> IfcBuildingStorey -> IfcWall). This reads the same JSON the
web UI exports and emits one IfcWall per wall or interior-wall module, grouped
by level/storey, so the model opens in any IFC viewer or hands off to a trade's
software.

Today it exports walls only; foundation entities are skipped and named in a
warning until they have an IFC mapping. As trade layers (electrical, plumbing,
...) gain real entities, they map onto their own IFC classes (IfcFlowSegment,
IfcOutlet, ...) under the same storeys.

Usage:
    python3 export_ifc.py layout.json [out.ifc]

Requires: ifcopenshell  (pip install ifcopenshell)
"""
import json
import sys
from pathlib import Path

import numpy as np
import ifcopenshell
from ifcopenshell.api import run

IN_TO_MM = 25.4
FT_TO_MM = 12 * IN_TO_MM
MM_PER_M = 1000.0
HORIZONTAL = ("north", "south")

# Entity kinds this exporter turns into IfcWall. Anything else (foundation
# today) is skipped and reported, never guessed into a default wall.
WALL_KINDS = ("wall", "iwall")

SPECS_PATH = Path(__file__).resolve().parent / "web" / "assets" / "lib" / "specs.json"


class LayoutError(ValueError):
    """The layout is missing or carries invalid data the export depends on."""


def load_specs(path=SPECS_PATH):
    """Authored module specs (generated from library entries by gen_specs.py)."""
    with open(path) as f:
        return json.load(f)


def wall_height_mm(module_id, specs):
    """Wall height from the module's authored spec, not from its id text."""
    spec = specs.get(module_id)
    if spec is None:
        raise LayoutError(f"module {module_id!r} has no spec in {SPECS_PATH.name}")
    return float(spec["h"]) * FT_TO_MM


def positive_mm(it, key):
    """A required positive dimension from an entity; no silent defaults."""
    if key not in it:
        raise LayoutError(f"entity {it.get('id')!r} is missing {key}")
    try:
        value = float(it[key])
    except (TypeError, ValueError):
        raise LayoutError(f"entity {it.get('id')!r} has non-numeric {key}: {it[key]!r}")
    if not value > 0:
        raise LayoutError(f"entity {it.get('id')!r} has non-positive {key}: {value}")
    return value


def entity_kind(it):
    # v1 layouts ("modules") carry no kind; every v1 item was a wall module.
    if "kind" not in it and "module" in it:
        return "wall"
    return it.get("kind")


def main(in_path, out_path, specs=None):
    """Write the IFC file. Returns (walls written, list of skipped entities)."""
    if specs is None:
        specs = load_specs()
    with open(in_path) as f:
        data = json.load(f)
    items = data.get("entities") or data.get("modules") or []
    levels = {lv["id"]: lv for lv in data.get("levels", [])}

    # Validate everything before building the model, so a bad layout fails
    # without writing a partial file.
    walls, skipped = [], []
    for n, it in enumerate(items):
        kind = entity_kind(it)
        if kind not in WALL_KINDS:
            skipped.append((it.get("id", n), kind))
            continue
        if not it.get("module"):
            raise LayoutError(f"{kind} entity {it.get('id', n)!r} has no module")
        walls.append({
            "id": it.get("id", n),
            "module": it["module"],
            "direction": it.get("direction", "north"),
            "x": float(it.get("x_mm", 0)),
            "y": float(it.get("y_mm", 0)),
            "w": positive_mm(it, "width_mm"),
            "depth": positive_mm(it, "depth_mm"),
            "height": wall_height_mm(it["module"], specs),
            "level": it.get("level", "L1"),
        })

    model = run("project.create_file", version="IFC4")
    project = run("root.create_entity", model, ifc_class="IfcProject", name="Iconic CAD House")

    # Length unit = millimetre, so JSON mm values pass through unchanged.
    mm = run("unit.add_si_unit", model, unit_type="LENGTHUNIT", prefix="MILLI")
    run("unit.assign_unit", model, units=[mm])

    model_ctx = run("context.add_context", model, context_type="Model")
    body = run("context.add_context", model, context_type="Model",
               context_identifier="Body", target_view="MODEL_VIEW", parent=model_ctx)

    site = run("root.create_entity", model, ifc_class="IfcSite", name="Site")
    building = run("root.create_entity", model, ifc_class="IfcBuilding", name="Building")
    run("aggregate.assign_object", model, products=[site], relating_object=project)
    run("aggregate.assign_object", model, products=[building], relating_object=site)

    # One storey per level (default a single Level 1).
    storeys = {}

    def storey_for(level_id):
        if level_id not in storeys:
            lv = levels.get(level_id, {})
            st = run("root.create_entity", model, ifc_class="IfcBuildingStorey",
                     name=lv.get("name", level_id or "Level 1"))
            run("aggregate.assign_object", model, products=[st], relating_object=building)
            storeys[level_id] = (st, lv.get("z_mm", 0))
        return storeys[level_id]

    for wl in walls:
        storey, z = storey_for(wl["level"])

        wall = run("root.create_entity", model, ifc_class="IfcWall",
                   name=f"{wl['module']} [{wl['id']}]")
        run("spatial.assign_container", model, products=[wall], relating_structure=storey)

        # add_wall_representation takes metres and converts to the project
        # unit (mm); passing mm here made every wall 1000x too large.
        rep = run("geometry.add_wall_representation", model, context=body,
                  length=wl["w"] / MM_PER_M, height=wl["height"] / MM_PER_M,
                  thickness=wl["depth"] / MM_PER_M)
        run("geometry.assign_representation", model, product=wall, representation=rep)

        # Wall geometry runs along local +X; rotate 90° for vertical (E/W) runs.
        m = np.eye(4)
        if wl["direction"] not in HORIZONTAL:
            m[0, 0], m[0, 1] = 0.0, -1.0
            m[1, 0], m[1, 1] = 1.0, 0.0
        m[0, 3], m[1, 3], m[2, 3] = wl["x"], wl["y"], z
        run("geometry.edit_object_placement", model, product=wall, matrix=m, is_si=False)

    model.write(out_path)
    print(f"Wrote {out_path}: {len(walls)} walls, {len(storeys)} storey(s)")
    if skipped:
        listed = ", ".join(f"{eid} ({kind})" for eid, kind in skipped)
        print(f"WARNING: IFC export does not support {len(skipped)} "
              f"entit{'y' if len(skipped) == 1 else 'ies'}; not in {out_path}: {listed}",
              file=sys.stderr)
    return len(walls), skipped


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".ifc"
    try:
        main(src, dst)
    except LayoutError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
