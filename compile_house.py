#!/usr/bin/env python3
"""
Port-based house compiler (v3).

Assembles wall modules from an SVG icon layout using connection ports
embedded in each .FCStd file. Handles any building shape via graph-based
BFS assembly.

v3 changes:
  - Direction is read from icon name (e.g. wall_4x8_2x6_16oc_east)
    instead of parsed from SVG transform rotation
  - No corner_offset() — corners are just port snaps like straight runs
  - The user decides corner dominance by choosing which directional icon
    to place in the corner cell

Wall module convention (unrotated = south-facing, stored in .FCStd):
  - Width along +X, depth (studs) along +Y, height along +Z
  - OSB at -Y, studs at +Y
  - port_left at (0, -osb, 0), port_right at (W, -osb, 0)

Direction → rotation mapping:
  south = 0°, east = 90°, north = 180°, west = 270°

Usage:
    freecadcmd -c "import sys; sys.argv=['compile_house.py','layout.svg']; exec(open('compile_house.py').read())"
"""

import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import deque

import FreeCAD as App
import Part  # noqa: F401

CAD_LIBRARY = "cad_library"
GRID = 64.0
SVG_NS = {"svg": "http://www.w3.org/2000/svg"}

# Rotation mapping accounts for SVG Y-down → FreeCAD Y-up mismatch:
# north/south are swapped from the naive CAD convention so that
# OSB faces outward when icons are laid out in map orientation
# (north at top of SVG, south at bottom).
DIRECTION_TO_ROT = {"south": 180.0, "east": 90.0, "north": 0.0, "west": 270.0}


# ===================================================================
# SVG PARSING
# ===================================================================

def parse_icon_name(name):
    """Extract base module name and direction from icon name.

    e.g. 'wall_4x8_2x6_16oc_east' → ('wall_4x8_2x6_16oc', 'east', 90.0)
    """
    for d in ("north", "south", "east", "west"):
        if name.endswith("_" + d):
            base = name[:-(len(d) + 1)]
            return base, d, DIRECTION_TO_ROT[d]
    # Fallback: try old-style with _osb716_south suffix
    for d in ("north", "south", "east", "west"):
        if "_" + d in name:
            base = name.split("_" + d)[0]
            return base, d, DIRECTION_TO_ROT[d]
    raise ValueError(f"Cannot parse direction from icon name: {name}")


def parse_transform_position(transform_str):
    """Extract icon center position from SVG transform.

    Only extracts position — direction comes from the icon name, not rotation.
    """
    if not transform_str:
        return GRID / 2.0, GRID / 2.0

    # matrix(a,b,c,d,e,f)
    m = re.search(
        r"matrix\(\s*([\-\d.]+)[, ]+([\-\d.]+)[, ]+([\-\d.]+)[, ]+"
        r"([\-\d.]+)[, ]+([\-\d.]+)[, ]+([\-\d.]+)\s*\)",
        transform_str,
    )
    if m:
        a, b, c, d, e, f = (float(m.group(i)) for i in range(1, 7))
        cx = a * 32 + c * 32 + e
        cy = b * 32 + d * 32 + f
        return cx, cy

    # translate(tx, ty)
    tx = ty = 0.0
    mt = re.search(r"translate\(\s*([\-\d.]+)(?:[, ]+([\-\d.]+))?\s*\)", transform_str)
    if mt:
        tx = float(mt.group(1))
        ty = float(mt.group(2) or 0.0)
    return tx + GRID / 2.0, ty + GRID / 2.0


def detect_direction_from_clips(g):
    """Detect wall direction from clip-path references in DIRECT children.

    When icons are imported into Inkscape, data-module gets stripped but
    clip-path IDs like 'west-clip', 'east-clip-3' etc. survive.
    Only checks direct children to avoid matching on parent layer groups.
    """
    for elem in g:
        cp = elem.attrib.get("clip-path", "")
        for d in ("north", "south", "east", "west"):
            if d in cp:
                return d
    return None


def parse_svg(svg_path):
    """Parse wall icons from SVG. Returns list of icon dicts."""
    root = ET.parse(svg_path).getroot()
    icons = []
    for g in root.findall(".//svg:g", SVG_NS):
        module = g.attrib.get("data-module")
        if not module:
            # Fallback: try to detect direction from clip-path names
            direction = detect_direction_from_clips(g)
            if not direction:
                continue
            # Infer module name — use first matching CAD file
            module = f"wall_4x8_2x6_16oc_{direction}"

        base, direction, rot = parse_icon_name(module)
        cx, cy = parse_transform_position(g.attrib.get("transform", ""))
        gx = int(round((cx - GRID / 2.0) / GRID))
        gy = int(round((cy - GRID / 2.0) / GRID))

        icons.append({
            "id": g.attrib.get("id", f"icon_{len(icons)}"),
            "module": module,
            "base_module": base,
            "direction": direction,
            "gx": gx,
            "gy": gy,
            "rot": rot,
        })
    return icons


# ===================================================================
# ORIENTATION HELPERS
# ===================================================================

def is_horizontal(direction):
    """Horizontal walls run along X (north/south facing)."""
    return direction in ("north", "south")


def is_vertical(direction):
    """Vertical walls run along Y after rotation (east/west facing)."""
    return direction in ("east", "west")


# ===================================================================
# CAD HELPERS
# ===================================================================

def rotate_vec_z(v, deg):
    """Rotate a FreeCAD Vector around Z axis."""
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    return App.Vector(v.x * c - v.y * s, v.x * s + v.y * c, v.z)


def find_cad_file(base_module):
    """Find the .FCStd file for a base module name.

    Tries exact match first, then looks for old-style names with _osb716_south.
    """
    path = os.path.join(CAD_LIBRARY, base_module + ".FCStd")
    if os.path.exists(path):
        return path
    # Try old naming convention
    for f in os.listdir(CAD_LIBRARY):
        if f.startswith(base_module) and f.endswith(".FCStd"):
            return os.path.join(CAD_LIBRARY, f)
    raise FileNotFoundError(f"No CAD file found for module: {base_module}")


def load_module(base_module, cache={}):
    """Load module from cad_library. Returns (shape, port_left_pos, port_right_pos)."""
    if base_module in cache:
        return cache[base_module]

    path = find_cad_file(base_module)
    doc = App.openDocument(path)
    shape = pl = pr = None

    for obj in doc.Objects:
        if obj.Name == "wall_module":
            shape = obj.Shape.copy()
        elif obj.Name == "port_left":
            bb = obj.Shape.BoundBox
            pl = App.Vector(
                (bb.XMin + bb.XMax) / 2.0,
                (bb.YMin + bb.YMax) / 2.0,
                (bb.ZMin + bb.ZMax) / 2.0,
            )
        elif obj.Name == "port_right":
            bb = obj.Shape.BoundBox
            pr = App.Vector(
                (bb.XMin + bb.XMax) / 2.0,
                (bb.YMin + bb.YMax) / 2.0,
                (bb.ZMin + bb.ZMax) / 2.0,
            )

    App.closeDocument(doc.Name)

    if shape is None:
        raise RuntimeError(f"No wall_module in {path}")
    if pl is None or pr is None:
        raise RuntimeError(f"Missing port markers in {path}")

    cache[base_module] = (shape, pl, pr)
    return shape, pl, pr


def prepare_module(base_module, rot_deg):
    """Load, rotate, and normalize a wall module.

    Returns (shape, port_left_world, port_right_world, bbox).
    """
    base_shape, base_pl, base_pr = load_module(base_module)

    shape = base_shape.copy()
    shape.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), rot_deg)
    pl = rotate_vec_z(base_pl, rot_deg)
    pr = rotate_vec_z(base_pr, rot_deg)

    bb = shape.BoundBox
    offset = App.Vector(-bb.XMin, -bb.YMin, -bb.ZMin)
    shape.translate(offset)
    pl = pl + offset
    pr = pr + offset

    return shape, pl, pr, shape.BoundBox


# ===================================================================
# PORT SELECTION
# ===================================================================

def select_ports(placed, neighbor):
    """Select which ports to connect between two adjacent walls.

    For each wall, pick the port closest to the other wall based on
    grid direction. Simple geometric selection — no special corner logic.
    """
    dx = neighbor["icon"]["gx"] - placed["icon"]["gx"]
    dy = neighbor["icon"]["gy"] - placed["icon"]["gy"]

    def pick_port(wall, dx, dy):
        """Pick the port on the side facing (dx, dy)."""
        pl, pr = wall["pl"], wall["pr"]
        if is_horizontal(wall["icon"]["direction"]):
            # Horizontal wall: ports differ along X
            if dx > 0:
                return pl if pl.x > pr.x else pr
            elif dx < 0:
                return pl if pl.x < pr.x else pr
            else:
                # Same column — perpendicular connection
                # Pick port based on which end of the wall this neighbor is at
                if dy > 0:
                    return pl if pl.y > pr.y else pr
                else:
                    return pl if pl.y < pr.y else pr
        else:
            # Vertical wall: ports differ along Y
            if dy > 0:
                return pl if pl.y > pr.y else pr
            elif dy < 0:
                return pl if pl.y < pr.y else pr
            else:
                # Same row — perpendicular connection
                if dx > 0:
                    return pl if pl.x > pr.x else pr
                else:
                    return pl if pl.x < pr.x else pr

    p_port = pick_port(placed, dx, dy)
    n_port = pick_port(neighbor, -dx, -dy)
    return p_port, n_port


# ===================================================================
# ADJACENCY GRAPH
# ===================================================================

def build_adjacency(icons):
    """Build grid adjacency. Returns (coord_map, adj_dict)."""
    cmap = {}
    for icon in icons:
        key = (icon["gx"], icon["gy"])
        if key in cmap:
            print(f"  WARNING: duplicate icon at grid ({icon['gx']},{icon['gy']}), skipping {icon['id']}")
            continue
        cmap[key] = icon

    adj = {k: [] for k in cmap}
    for (gx, gy) in cmap:
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            nb = (gx + dx, gy + dy)
            if nb in cmap:
                adj[(gx, gy)].append(cmap[nb])

    return cmap, adj


# ===================================================================
# ASSEMBLY
# ===================================================================

def assemble(icons, out_file):
    """BFS assembly using port snapping. No special corner logic."""
    if not icons:
        raise RuntimeError("No icons to assemble")

    cmap, adj = build_adjacency(icons)

    placed = {}
    doc = App.newDocument("HouseAssembly")
    count = 0

    # Seed: top-left icon
    seed = min(cmap.values(), key=lambda i: (i["gy"], i["gx"]))
    shp, pl, pr, bb = prepare_module(seed["base_module"], seed["rot"])

    obj = doc.addObject("Part::Feature", f"wall_{count:02d}_{seed['id']}")
    obj.Shape = shp
    if obj.ViewObject:
        obj.ViewObject.Visibility = True
    count += 1

    placed[(seed["gx"], seed["gy"])] = {
        "shape": shp, "pl": pl, "pr": pr, "bb": bb, "icon": seed,
    }
    print(f"Seed: {seed['id']} ({seed['direction']}) at ({seed['gx']},{seed['gy']})")

    # BFS
    queue = deque([(seed["gx"], seed["gy"])])
    while queue:
        cgx, cgy = queue.popleft()
        cur = placed[(cgx, cgy)]

        for nb_icon in adj[(cgx, cgy)]:
            nk = (nb_icon["gx"], nb_icon["gy"])
            if nk in placed:
                continue

            # Prepare neighbor
            n_shp, n_pl, n_pr, n_bb = prepare_module(nb_icon["base_module"], nb_icon["rot"])

            # Temporary neighbor dict for port selection
            nb_data = {"pl": n_pl, "pr": n_pr, "bb": n_bb, "icon": nb_icon}

            # Select ports and snap
            c_port, n_port = select_ports(cur, nb_data)
            translation = c_port - n_port

            # Corner thickness offset: when orientations differ,
            # push the neighbor inward by the placed wall's thickness.
            # Thickness is the SHORT dimension of the bounding box.
            cur_dir = cur["icon"]["direction"]
            nb_dir = nb_icon["direction"]
            if is_horizontal(cur_dir) != is_horizontal(nb_dir):
                dx = nb_icon["gx"] - cur["icon"]["gx"]
                dy = nb_icon["gy"] - cur["icon"]["gy"]
                cur_bb = cur["bb"]
                x_extent = cur_bb.XMax - cur_bb.XMin
                y_extent = cur_bb.YMax - cur_bb.YMin
                thickness = min(x_extent, y_extent)
                if dy != 0:
                    translation = translation + App.Vector(0, dy * thickness, 0)
                elif dx != 0:
                    translation = translation + App.Vector(dx * thickness, 0, 0)

            # Apply
            n_shp.translate(translation)
            n_pl = n_pl + translation
            n_pr = n_pr + translation

            obj = doc.addObject("Part::Feature", f"wall_{count:02d}_{nb_icon['id']}")
            obj.Shape = n_shp
            if obj.ViewObject:
                obj.ViewObject.Visibility = True
            count += 1

            placed[nk] = {
                "shape": n_shp, "pl": n_pl, "pr": n_pr,
                "bb": n_shp.BoundBox, "icon": nb_icon,
            }
            queue.append(nk)

            print(f"Placed {nb_icon['id']} ({nb_icon['direction']}) at ({nb_icon['gx']},{nb_icon['gy']})")

    # Save
    doc.recompute()
    out_abs = os.path.abspath(out_file)
    doc.saveAs(out_abs)
    print(f"\nSaved {out_abs} ({count} walls)")


# ===================================================================
# MAIN
# ===================================================================

def main():
    if len(sys.argv) != 2:
        print("Usage: compile_house.py <floor_plan.svg>")
        sys.exit(1)

    svg = sys.argv[1]
    if not os.path.exists(svg):
        raise FileNotFoundError(f"Missing: {svg}")
    if not os.path.isdir(CAD_LIBRARY):
        raise FileNotFoundError(f"Missing: {CAD_LIBRARY}")

    icons = parse_svg(svg)
    if not icons:
        raise RuntimeError("No wall icons found in SVG")

    print(f"Parsed {len(icons)} icons from {svg}:")
    for i in icons:
        print(f"  {i['id']}: {i['base_module']} {i['direction']} grid=({i['gx']},{i['gy']})")

    out = os.path.splitext(svg)[0] + ".FCStd"
    assemble(icons, out)


if __name__ == "__main__":
    main()
