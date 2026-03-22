#!/usr/bin/env python3
"""
Port-based house compiler (v2).

Assembles wall modules from an SVG icon layout using connection ports
embedded in each .FCStd file. Handles any building shape — rectangles,
L-shapes, T-shapes, U-shapes, courtyards — via graph-based assembly.

Key improvements over PortFlow v1:
  - Port selection uses a deterministic direction table, not coordinate heuristics
  - Corner inset offset derived from actual wall bounding boxes post-rotation
  - Rotation is applied to ports as part of the shape transform, keeping them
    in sync with geometry at all times
  - Seed wall is placed at origin with bbox-min alignment; all subsequent
    walls are placed relative to already-placed walls via port snapping

Wall module convention (unrotated = south-facing, 0 degrees):
  - Width along +X, depth (studs) along +Y, height along +Z
  - OSB at -Y, studs at +Y
  - port_left at (0, 0, 0), port_right at (W, 0, 0)

Rotation convention (SVG icon rotation → compass facing):
  0°   = south  (horizontal wall, OSB faces south / -Y)
  90°  = east   (vertical wall,   OSB faces east  / +X after rotation)
  180° = north  (horizontal wall, OSB faces north / +Y after rotation)
  270° = west   (vertical wall,   OSB faces west  / -X after rotation)

Usage:
    freecadcmd -c "import sys; sys.argv=['compile_house.py','test_rectangle.svg']; exec(open('compile_house.py').read())"
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


# ===================================================================
# SVG PARSING
# ===================================================================

def parse_transform(transform_str):
    """Extract (center_x, center_y, rotation_deg) from SVG transform attribute.

    Handles both:
      - translate(tx,ty) rotate(angle,...) — programmatic SVGs
      - matrix(a,b,c,d,e,f) — Inkscape output

    Returns the icon's center position in SVG coordinates and the rotation angle.
    """
    if not transform_str:
        return GRID / 2.0, GRID / 2.0, 0.0

    # Try matrix() first — this is what Inkscape emits
    m = re.search(
        r"matrix\(\s*([\-\d.]+)[, ]+([\-\d.]+)[, ]+([\-\d.]+)[, ]+"
        r"([\-\d.]+)[, ]+([\-\d.]+)[, ]+([\-\d.]+)\s*\)",
        transform_str,
    )
    if m:
        a, b, c, d, e, f = (float(m.group(i)) for i in range(1, 7))
        rot = round(math.degrees(math.atan2(b, a))) % 360
        # Icon center (32,32) in local space → global space
        cx = a * 32 + c * 32 + e
        cy = b * 32 + d * 32 + f
        return cx, cy, float(rot)

    # Fallback: translate()/rotate() — programmatic SVGs
    tx = ty = 0.0
    rot = 0.0
    mt = re.search(r"translate\(\s*([\-\d.]+)(?:[, ]+([\-\d.]+))?\s*\)", transform_str)
    if mt:
        tx = float(mt.group(1))
        ty = float(mt.group(2) or 0.0)
    mr = re.search(r"rotate\(\s*([\-\d.]+)", transform_str)
    if mr:
        rot = float(mr.group(1)) % 360.0
    # Center = translate origin + half icon
    return tx + GRID / 2.0, ty + GRID / 2.0, rot


def parse_svg(svg_path):
    """Parse wall icons from SVG. Returns list of icon dicts."""
    root = ET.parse(svg_path).getroot()
    icons = []
    for g in root.findall(".//svg:g", SVG_NS):
        module = g.attrib.get("data-module")
        if not module:
            continue
        cx, cy, rot = parse_transform(g.attrib.get("transform", ""))
        gx = int(round((cx - GRID / 2.0) / GRID))
        gy = int(round((cy - GRID / 2.0) / GRID))
        icons.append({
            "id": g.attrib.get("id", f"icon_{len(icons)}"),
            "module": module,
            "gx": gx,
            "gy": gy,
            "rot": rot,
        })
    return icons


# ===================================================================
# ORIENTATION HELPERS
# ===================================================================

def compass(rot):
    """Map rotation degrees to compass direction string."""
    r = rot % 360.0
    return {0.0: "S", 90.0: "E", 180.0: "N", 270.0: "W"}.get(r, "?")


def is_horizontal(rot):
    """Horizontal walls run along X (north/south facing)."""
    return compass(rot) in ("N", "S")


def is_vertical(rot):
    """Vertical walls run along Y after rotation (east/west facing)."""
    return compass(rot) in ("E", "W")


# ===================================================================
# CAD HELPERS
# ===================================================================

def rotate_vec_z(v, deg):
    """Rotate a FreeCAD Vector around Z axis."""
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    return App.Vector(v.x * c - v.y * s, v.x * s + v.y * c, v.z)


def load_module(name, cache={}):
    """Load module from cad_library. Returns (shape, port_left_pos, port_right_pos).

    All values are in the module's canonical (unrotated) frame.
    """
    if name in cache:
        return cache[name]

    path = os.path.join(CAD_LIBRARY, name + ".FCStd")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing: {path}")

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

    cache[name] = (shape, pl, pr)
    return shape, pl, pr


def prepare_module(module_name, rot_deg):
    """Load, rotate, and normalize a wall module.

    Returns (shape, port_left_world, port_right_world, bbox).
    The shape's BoundBox.Min is at the origin after normalization.
    Port positions are adjusted to match.
    """
    base_shape, base_pl, base_pr = load_module(module_name)

    # Copy and rotate
    shape = base_shape.copy()
    shape.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), rot_deg)
    pl = rotate_vec_z(base_pl, rot_deg)
    pr = rotate_vec_z(base_pr, rot_deg)

    # Normalize: shift so BoundBox min is at origin
    bb = shape.BoundBox
    offset = App.Vector(-bb.XMin, -bb.YMin, -bb.ZMin)
    shape.translate(offset)
    pl = pl + offset
    pr = pr + offset

    return shape, pl, pr, shape.BoundBox


# ===================================================================
# PORT SELECTION — GEOMETRIC APPROACH
# ===================================================================

# Instead of a lookup table, we select ports geometrically:
# For a given grid direction (dx, dy), pick the port of each wall
# that is closest to the neighbor's direction.
#
# This works for both straight runs and corners because it relies
# on actual port positions after rotation+normalization, not on
# trying to predict port behavior from compass directions.

def select_ports(placed_icon, placed_pl, placed_pr, placed_bb,
                 neighbor_icon, neighbor_pl, neighbor_pr, neighbor_bb):
    """Select which port of placed wall and which port of neighbor wall
    should coincide for connection.

    Strategy:
    - For same-orientation connections (straight run), pick the port on the
      side facing the neighbor using the run axis.
    - For perpendicular connections (corners), pick the port on the placed
      wall that's closest to where the neighbor physically is, using the
      wall's long axis position.

    Returns (placed_port_pos, neighbor_port_pos).
    """
    dx = neighbor_icon["gx"] - placed_icon["gx"]
    dy = neighbor_icon["gy"] - placed_icon["gy"]

    p_h = is_horizontal(placed_icon["rot"])
    n_h = is_horizontal(neighbor_icon["rot"])

    # --- Placed wall port selection ---
    if p_h:
        # Horizontal wall runs along X.
        if dx != 0:
            # Neighbor is along the run → pick by X direction
            p_port = placed_pr if placed_pr.x > placed_pl.x else placed_pl
            if dx < 0:
                p_port = placed_pl if placed_pl.x < placed_pr.x else placed_pr
        else:
            # Neighbor is perpendicular (dy != 0) — corner connection.
            # We need to figure out which END of the horizontal wall
            # the vertical neighbor is at. Use the grid column of the
            # neighbor vs the grid extent of the horizontal wall's run.
            # The neighbor is at the SAME grid column as the placed wall,
            # so we need to check if this is the left end or right end
            # of the building. Use the placed wall's port X positions.
            # Actually simpler: for the corner, the vertical wall connects
            # at the end of the placed wall that's on its side. Since
            # the neighbor is in the same column, we pick the port that's
            # closest to the neighbor's eventual position.
            # For horizontal walls at a corner, the vertical wall always
            # connects at the end where it will be placed. We don't know
            # the other walls yet, so use the compass of the neighbor:
            # West wall (270°) → connects at the west (min-X) end
            # East wall (90°) → connects at the east (max-X) end
            n_compass = compass(neighbor_icon["rot"])
            if n_compass == "W":
                p_port = placed_pl if placed_pl.x < placed_pr.x else placed_pr
            else:  # E or fallback
                p_port = placed_pr if placed_pr.x > placed_pl.x else placed_pl
    else:
        # Vertical wall runs along Y.
        if dy != 0:
            # Neighbor is along the run → pick by Y direction
            p_port = placed_pr if placed_pr.y > placed_pl.y else placed_pl
            if dy < 0:
                p_port = placed_pl if placed_pl.y < placed_pr.y else placed_pr
        else:
            # Corner connection. Same logic but for X axis.
            n_compass = compass(neighbor_icon["rot"])
            if n_compass == "N":
                p_port = placed_pl if placed_pl.y < placed_pr.y else placed_pr
            else:  # S or fallback
                p_port = placed_pr if placed_pr.y > placed_pl.y else placed_pl

    # --- Neighbor wall port selection ---
    # Mirror logic: pick the neighbor's port that faces back
    if n_h:
        if dx != 0:
            n_port = neighbor_pl if neighbor_pl.x < neighbor_pr.x else neighbor_pr
            if dx > 0:
                # Neighbor is to the right of placed → neighbor's left end faces back
                n_port = neighbor_pl if neighbor_pl.x < neighbor_pr.x else neighbor_pr
            else:
                n_port = neighbor_pr if neighbor_pr.x > neighbor_pl.x else neighbor_pl
        else:
            # Corner: neighbor is horizontal, connection via dy
            p_compass = compass(placed_icon["rot"])
            if p_compass == "W":
                n_port = neighbor_pl if neighbor_pl.x < neighbor_pr.x else neighbor_pr
            else:  # E
                n_port = neighbor_pr if neighbor_pr.x > neighbor_pl.x else neighbor_pl
    else:
        if dy != 0:
            if dy > 0:
                n_port = neighbor_pl if neighbor_pl.y < neighbor_pr.y else neighbor_pr
            else:
                n_port = neighbor_pr if neighbor_pr.y > neighbor_pl.y else neighbor_pl
        else:
            # Corner: neighbor is vertical, connection via dx
            p_compass = compass(placed_icon["rot"])
            if p_compass == "N":
                n_port = neighbor_pl if neighbor_pl.y < neighbor_pr.y else neighbor_pr
            else:  # S
                n_port = neighbor_pr if neighbor_pr.y > neighbor_pl.y else neighbor_pl

    return p_port, n_port


# ===================================================================
# CORNER INSET OFFSET
# ===================================================================

def corner_offset(placed_icon, neighbor_icon, placed_bb, neighbor_bb,
                  placed_port, neighbor_port):
    """Compute the offset when horizontal meets vertical at a corner.

    Rule: N/S walls protrude full length. E/W walls are inset by the
    N/S wall's thickness so they fit between the N and S walls.

    Instead of using the full wall thickness, we compute the offset from
    the placed wall's connecting port to its far edge in the connection
    direction. This correctly accounts for the port not being at the
    bbox corner (due to OSB offset).

    Returns an App.Vector offset to add to the neighbor's position.
    """
    p_h = is_horizontal(placed_icon["rot"])
    n_h = is_horizontal(neighbor_icon["rot"])

    # Same orientation → straight run, no offset
    if p_h == n_h:
        return App.Vector(0, 0, 0)

    dx = neighbor_icon["gx"] - placed_icon["gx"]
    dy = neighbor_icon["gy"] - placed_icon["gy"]

    if p_h and not n_h:
        # Placed is horizontal (N/S), neighbor is vertical (E/W).
        # The vertical wall must inset behind the horizontal wall.
        # Offset = distance from the connecting port to the far Y edge
        # of the placed wall, in the direction of dy.
        if dy != 0:
            if dy > 0:
                # Neighbor is south of placed. Push to placed wall's max Y edge.
                gap = placed_bb.YMax - placed_port.y
            else:
                # Neighbor is north of placed. Push to placed wall's min Y edge.
                gap = placed_port.y - placed_bb.YMin
            return App.Vector(0, dy * gap, 0)
        else:
            return App.Vector(0, 0, 0)

    else:
        # Placed is vertical (E/W), neighbor is horizontal (N/S).
        # Horizontal walls protrude past vertical walls.
        if dx != 0:
            if dx > 0:
                gap = placed_bb.XMax - placed_port.x
            else:
                gap = placed_port.x - placed_bb.XMin
            return App.Vector(dx * gap, 0, 0)
        else:
            return App.Vector(0, 0, 0)


# ===================================================================
# ADJACENCY GRAPH
# ===================================================================

def build_adjacency(icons):
    """Build grid adjacency. Returns (coord_map, adj_dict)."""
    cmap = {}
    for icon in icons:
        cmap[(icon["gx"], icon["gy"])] = icon

    adj = {(i["gx"], i["gy"]): [] for i in icons}
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
    """BFS assembly using port snapping."""
    if not icons:
        raise RuntimeError("No icons to assemble")

    cmap, adj = build_adjacency(icons)

    # Track placed walls: (gx,gy) → {shape, pl, pr, bb, icon}
    placed = {}
    doc = App.newDocument("HouseAssembly")
    count = 0

    # Seed: top-left icon
    seed = min(icons, key=lambda i: (i["gy"], i["gx"]))
    shp, pl, pr, bb = prepare_module(seed["module"], seed["rot"])

    obj = doc.addObject("Part::Feature", f"wall_{count:02d}_{seed['id']}")
    obj.Shape = shp
    count += 1

    placed[(seed["gx"], seed["gy"])] = {
        "shape": shp, "pl": pl, "pr": pr, "bb": bb, "icon": seed,
    }
    print(f"Seed: {seed['id']} ({compass(seed['rot'])}, rot={seed['rot']})")
    print(f"  port_left=({pl.x:.1f}, {pl.y:.1f}, {pl.z:.1f})")
    print(f"  port_right=({pr.x:.1f}, {pr.y:.1f}, {pr.z:.1f})")

    # BFS
    queue = deque([(seed["gx"], seed["gy"])])
    while queue:
        cgx, cgy = queue.popleft()
        cur = placed[(cgx, cgy)]

        for nb_icon in adj[(cgx, cgy)]:
            nk = (nb_icon["gx"], nb_icon["gy"])
            if nk in placed:
                continue

            # Prepare neighbor (rotated + normalized at origin)
            n_shp, n_pl, n_pr, n_bb = prepare_module(nb_icon["module"], nb_icon["rot"])

            # Select which ports to connect
            c_port, n_port = select_ports(
                cur["icon"], cur["pl"], cur["pr"], cur["bb"],
                nb_icon, n_pl, n_pr, n_bb,
            )

            # Base translation: snap neighbor's port to placed wall's port
            translation = c_port - n_port

            # Corner inset offset
            c_off = corner_offset(cur["icon"], nb_icon, cur["bb"], n_bb,
                                  c_port, n_port)
            translation = translation + c_off

            # Apply translation
            n_shp.translate(translation)
            n_pl = n_pl + translation
            n_pr = n_pr + translation
            n_bb_new = n_shp.BoundBox

            obj = doc.addObject("Part::Feature", f"wall_{count:02d}_{nb_icon['id']}")
            obj.Shape = n_shp
            count += 1

            placed[nk] = {
                "shape": n_shp, "pl": n_pl, "pr": n_pr,
                "bb": n_bb_new, "icon": nb_icon,
            }
            queue.append(nk)

            print(f"Placed {nb_icon['id']} ({compass(nb_icon['rot'])}, rot={nb_icon['rot']})")
            print(f"  connected to {cur['icon']['id']} | offset=({translation.x:.1f}, {translation.y:.1f}, {translation.z:.1f})")

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
        print(f"  {i['id']}: {i['module']} grid=({i['gx']},{i['gy']}) {compass(i['rot'])} ({i['rot']}°)")

    out = os.path.splitext(svg)[0] + ".FCStd"
    assemble(icons, out)


if __name__ == "__main__":
    main()
