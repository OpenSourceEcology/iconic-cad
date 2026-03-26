#!/usr/bin/env python3
"""
Grid-based house compiler (v4).

Assembles wall modules from an SVG icon layout using grid geometry
instead of connection ports. Each module's position is computed from
its grid coordinates, module dimensions, and wall direction.

Key difference from v3 (port-based):
  - No port markers needed in .FCStd files
  - No port selection ambiguity at corners
  - Positions computed from known module dimensions + grid adjacency
  - Each module's placement is deterministic from the grid

Wall module convention (unrotated = south-facing, stored in .FCStd):
  Width along +X, depth (studs) along +Y, height along +Z
  OSB at -Y, studs at +Y

After rotation + normalization (bbox starts at origin):
  South (0°):   bbox (W, D, H) — runs along X, depth along Y
  East  (90°):  bbox (D, W, H) — runs along Y, depth along X
  North (180°): bbox (W, D, H) — runs along X, depth along Y
  West  (270°): bbox (D, W, H) — runs along Y, depth along X

Usage:
    # With FreeCAD:
    freecadcmd -c "import sys; sys.argv=['compile_house_grid.py','layout.svg']; \\
      exec(open('compile_house_grid.py').read())"

    # Dry run (no FreeCAD needed, prints positions):
    python3 compile_house_grid.py --dry-run layout.svg
"""

import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import deque

# Try FreeCAD; fall back to dry-run stubs
try:
    import FreeCAD as App
    import Part  # noqa: F401
    HAS_FREECAD = True
except ImportError:
    HAS_FREECAD = False

CAD_LIBRARY = "cad_library"
GRID = 64.0
SVG_NS = {"svg": "http://www.w3.org/2000/svg"}
IN_TO_MM = 25.4

DIRECTION_TO_ROT = {"south": 0.0, "east": 90.0, "north": 180.0, "west": 270.0}


# ===================================================================
# DRY-RUN STUBS (used when FreeCAD is unavailable)
# ===================================================================

class Vec3:
    """Minimal vector for dry-run mode."""
    __slots__ = ("x", "y", "z")

    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)

    def __add__(self, o):
        return Vec3(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o):
        return Vec3(self.x - o.x, self.y - o.y, self.z - o.z)

    def __repr__(self):
        return f"({self.x:.1f}, {self.y:.1f}, {self.z:.1f})"


class BBox:
    """Minimal bounding box for dry-run mode."""
    def __init__(self, xmin, ymin, zmin, xmax, ymax, zmax):
        self.XMin, self.YMin, self.ZMin = xmin, ymin, zmin
        self.XMax, self.YMax, self.ZMax = xmax, ymax, zmax


def make_vector(x, y, z):
    if HAS_FREECAD:
        return App.Vector(x, y, z)
    return Vec3(x, y, z)


# ===================================================================
# MODULE DIMENSIONS
# ===================================================================

# Lumber nominal → actual (inches)
LUMBER_TABLE = {
    "2x2": (1.5, 1.5), "2x3": (1.5, 2.5), "2x4": (1.5, 3.5),
    "2x6": (1.5, 5.5), "2x8": (1.5, 7.25), "2x10": (1.5, 9.25),
    "2x12": (1.5, 11.25),
}


def parse_module_dimensions(base_module):
    """Parse physical dimensions from module name.

    'wall_4x8_2x6_16oc' → (width_mm, depth_mm, height_mm)
    'wall_3x8.5_2x6_16oc' → (914.4, 150.8, 2590.8)
    """
    m = re.match(
        r"wall_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)_(\d+x\d+)", base_module
    )
    if not m:
        raise ValueError(f"Cannot parse dimensions from: {base_module}")

    width_ft = float(m.group(1))
    height_ft = float(m.group(2))
    lumber = m.group(3)

    if lumber not in LUMBER_TABLE:
        raise ValueError(f"Unknown lumber size: {lumber}")
    _, stud_depth_in = LUMBER_TABLE[lumber]

    width_mm = width_ft * 12.0 * IN_TO_MM
    height_mm = height_ft * 12.0 * IN_TO_MM
    osb_mm = 0.4375 * IN_TO_MM  # 7/16" OSB
    depth_mm = stud_depth_in * IN_TO_MM + osb_mm

    return width_mm, depth_mm, height_mm


def get_module_bbox(base_module, direction):
    """Compute bounding box extents for a module at a given direction.

    Returns (x_extent, y_extent, z_extent) after rotation+normalization.
    """
    w, d, h = parse_module_dimensions(base_module)
    if is_horizontal(direction):
        return w, d, h  # width along X, depth along Y
    else:
        return d, w, h  # depth along X, width along Y


# ===================================================================
# SVG PARSING  (unchanged from compile_house.py)
# ===================================================================

def parse_icon_name(name):
    """Extract base module name and direction from icon name."""
    for d in ("north", "south", "east", "west"):
        if name.endswith("_" + d):
            base = name[:-(len(d) + 1)]
            return base, d, DIRECTION_TO_ROT[d]
    for d in ("north", "south", "east", "west"):
        if "_" + d in name:
            base = name.split("_" + d)[0]
            return base, d, DIRECTION_TO_ROT[d]
    raise ValueError(f"Cannot parse direction from icon name: {name}")


def parse_transform_position(transform_str):
    """Extract icon center position from SVG transform."""
    if not transform_str:
        return GRID / 2.0, GRID / 2.0

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

    tx = ty = 0.0
    mt = re.search(
        r"translate\(\s*([\-\d.]+)(?:[, ]+([\-\d.]+))?\s*\)", transform_str
    )
    if mt:
        tx = float(mt.group(1))
        ty = float(mt.group(2) or 0.0)
    return tx + GRID / 2.0, ty + GRID / 2.0


def detect_direction_from_clips(g):
    """Detect wall direction from clip-path references in direct children."""
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
            direction = detect_direction_from_clips(g)
            if not direction:
                continue
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
    return direction in ("north", "south")


def is_vertical(direction):
    return direction in ("east", "west")


# ===================================================================
# CAD HELPERS (FreeCAD mode only)
# ===================================================================

def rotate_vec_z(v, deg):
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    return App.Vector(v.x * c - v.y * s, v.x * s + v.y * c, v.z)


def find_cad_file(base_module):
    path = os.path.join(CAD_LIBRARY, base_module + ".FCStd")
    if os.path.exists(path):
        return path
    for f in os.listdir(CAD_LIBRARY):
        if f.startswith(base_module) and f.endswith(".FCStd"):
            return os.path.join(CAD_LIBRARY, f)
    raise FileNotFoundError(f"No CAD file found for module: {base_module}")


def load_shape(base_module, cache={}):
    """Load just the shape from a CAD file (no ports needed)."""
    if base_module in cache:
        return cache[base_module]

    path = find_cad_file(base_module)
    doc = App.openDocument(path)
    shape = None
    for obj in doc.Objects:
        if obj.Name == "wall_module":
            shape = obj.Shape.copy()
            break
    App.closeDocument(doc.Name)

    if shape is None:
        raise RuntimeError(f"No wall_module in {path}")
    cache[base_module] = shape
    return shape


def prepare_shape(base_module, rot_deg):
    """Load, rotate, normalize a wall shape. Returns (shape, bbox)."""
    base = load_shape(base_module)
    shape = base.copy()
    shape.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), rot_deg)
    bb = shape.BoundBox
    shape.translate(App.Vector(-bb.XMin, -bb.YMin, -bb.ZMin))
    return shape, shape.BoundBox


# ===================================================================
# GRID-BASED OFFSET COMPUTATION
# ===================================================================

def compute_offset(cur, nb_icon, cmap):
    """Compute placement offset for neighbor using grid geometry.

    cur:     dict with 'icon', 'pos', 'x_ext', 'y_ext' for the placed wall
    nb_icon: icon dict for the neighbor to be placed
    cmap:    grid coordinate map for run-boundary detection

    Returns a position vector for the neighbor's origin.
    """
    dx = nb_icon["gx"] - cur["icon"]["gx"]
    dy = nb_icon["gy"] - cur["icon"]["gy"]

    cur_dir = cur["icon"]["direction"]
    nb_dir = nb_icon["direction"]
    cur_icon = cur["icon"]

    # Current module's bbox extents
    cx = cur["x_ext"]
    cy = cur["y_ext"]

    # Neighbor module's bbox extents (after rotation)
    nx, ny, _ = get_module_bbox(nb_icon["base_module"], nb_dir)

    same_orient = is_horizontal(cur_dir) == is_horizontal(nb_dir)

    if same_orient:
        # --- Straight run ---
        if is_horizontal(cur_dir):
            ox = cx if dx > 0 else -nx
            oy = 0.0
        else:
            ox = 0.0
            oy = cy if dy > 0 else -ny

    elif dx != 0 and dy == 0:
        # --- Perpendicular, same row (connection along X) ---
        if is_horizontal(cur_dir):
            # H→V: neighbor at end of horizontal run
            ox = cx if dx > 0 else -nx
            oy = 0.0
        else:
            # V→H: neighbor past vertical wall's depth
            ox = cx if dx > 0 else -nx
            # Which end of the vertical wall? Check run position.
            gx, gy = cur_icon["gx"], cur_icon["gy"]
            has_above = ((gx, gy - 1) in cmap and
                         is_vertical(cmap[(gx, gy - 1)]["direction"]))
            has_below = ((gx, gy + 1) in cmap and
                         is_vertical(cmap[(gx, gy + 1)]["direction"]))
            if not has_above:
                oy = 0.0         # top of run
            elif not has_below:
                oy = cy - ny     # bottom of run
            else:
                oy = 0.0         # middle (unusual)

    elif dx == 0 and dy != 0:
        # --- Perpendicular, same column (connection along Y) ---
        if is_vertical(cur_dir):
            # V→H: neighbor at end of vertical run
            oy = cy if dy > 0 else -ny
            # Place past the vertical wall's depth
            if cur_dir == "west":
                ox = cx   # extend rightward from west wall interior
            else:  # east
                ox = -nx  # extend leftward from east wall interior
        else:
            # H→V: neighbor past horizontal wall's depth
            oy = cy if dy > 0 else -ny
            # Which end of the horizontal wall? Check run position.
            gx, gy = cur_icon["gx"], cur_icon["gy"]
            has_left = ((gx - 1, gy) in cmap and
                        is_horizontal(cmap[(gx - 1, gy)]["direction"]))
            has_right = ((gx + 1, gy) in cmap and
                         is_horizontal(cmap[(gx + 1, gy)]["direction"]))
            if not has_left:
                ox = 0.0         # left end of run
            elif not has_right:
                ox = cx - nx     # right end of run
            else:
                ox = 0.0         # middle (unusual)
    else:
        raise ValueError(f"Diagonal adjacency? dx={dx}, dy={dy}")

    # Negate Y: SVG has Y-down, FreeCAD has Y-up (north).
    # Without this, north/south walls end up with OSB facing inward.
    return cur["pos"] + make_vector(ox, -oy, 0)


# ===================================================================
# ADJACENCY GRAPH
# ===================================================================

def build_adjacency(icons):
    """Build grid adjacency. Returns (coord_map, adj_dict)."""
    cmap = {}
    for icon in icons:
        key = (icon["gx"], icon["gy"])
        if key in cmap:
            print(f"  WARNING: duplicate at ({icon['gx']},{icon['gy']}), "
                  f"skipping {icon['id']}")
            continue
        cmap[key] = icon

    adj = {k: [] for k in cmap}
    for (gx, gy) in cmap:
        for ddx, ddy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            nb = (gx + ddx, gy + ddy)
            if nb in cmap:
                adj[(gx, gy)].append(cmap[nb])

    return cmap, adj


# ===================================================================
# ASSEMBLY
# ===================================================================

def assemble(icons, out_file, dry_run=False):
    """Assembly using grid-based offsets.

    Strategy: extend each straight run fully before processing corners.
    This ensures modules are always placed from their own run, never
    from a perpendicular shortcut that gives the wrong position.
    """
    if not icons:
        raise RuntimeError("No icons to assemble")

    cmap, adj = build_adjacency(icons)

    placed = {}
    doc = None
    if not dry_run:
        doc = App.newDocument("HouseAssembly")
    count = [0]  # mutable for nested fn

    def place(icon, pos):
        """Place a module at the given position."""
        nk = (icon["gx"], icon["gy"])
        nbx, nby, nbz = get_module_bbox(icon["base_module"], icon["direction"])

        if not dry_run:
            n_shp, _ = prepare_shape(icon["base_module"], icon["rot"])
            n_shp.translate(App.Vector(pos.x, pos.y, pos.z))
            obj = doc.addObject(
                "Part::Feature", f"wall_{count[0]:02d}_{icon['id']}"
            )
            obj.Shape = n_shp
            if obj.ViewObject:
                obj.ViewObject.Visibility = True

        count[0] += 1
        placed[nk] = {
            "icon": icon, "pos": pos, "x_ext": nbx, "y_ext": nby,
        }
        print(f"{'Seed' if count[0] == 1 else 'Placed'}: {icon['id']} "
              f"({icon['direction']}) at grid ({icon['gx']},{icon['gy']})  "
              f"pos={pos}")

    def extend_run(start_key):
        """Extend straight run from a placed module. Only same-orient."""
        queue = deque([start_key])
        while queue:
            cgx, cgy = queue.popleft()
            cur = placed[(cgx, cgy)]
            cur_dir = cur["icon"]["direction"]
            for nb_icon in adj[(cgx, cgy)]:
                nk = (nb_icon["gx"], nb_icon["gy"])
                if nk in placed:
                    continue
                if is_horizontal(nb_icon["direction"]) != is_horizontal(cur_dir):
                    continue  # perpendicular — skip for now
                nb_pos = compute_offset(cur, nb_icon, cmap)
                place(nb_icon, nb_pos)
                queue.append(nk)

    # --- Seed ---
    seed = min(cmap.values(), key=lambda i: (i["gy"], i["gx"]))
    place(seed, make_vector(0, 0, 0))

    # Extend the seed's straight run
    extend_run((seed["gx"], seed["gy"]))

    # --- Iteratively discover corners and extend their runs ---
    while True:
        found = False
        for key in list(placed.keys()):
            cur = placed[key]
            cur_dir = cur["icon"]["direction"]
            for nb_icon in adj[key]:
                nk = (nb_icon["gx"], nb_icon["gy"])
                if nk in placed:
                    continue
                if is_horizontal(nb_icon["direction"]) == is_horizontal(cur_dir):
                    continue  # same orient — should already be placed
                # Corner connection: place and extend its run
                nb_pos = compute_offset(cur, nb_icon, cmap)
                place(nb_icon, nb_pos)
                extend_run(nk)
                found = True
        if not found:
            break

    # --- Output ---
    if not dry_run:
        doc.recompute()
        out_abs = os.path.abspath(out_file)
        doc.saveAs(out_abs)
        print(f"\nSaved {out_abs} ({count[0]} walls)")
    else:
        print(f"\n--- Dry run complete: {count[0]} walls ---")
        min_x = min(p["pos"].x for p in placed.values())
        max_x = max(p["pos"].x + p["x_ext"] for p in placed.values())
        min_y = min(p["pos"].y for p in placed.values())
        max_y = max(p["pos"].y + p["y_ext"] for p in placed.values())
        w = max_x - min_x
        h = max_y - min_y
        print(f"Building footprint: {w:.1f} x {h:.1f} mm")
        print(f"                  = {w/IN_TO_MM/12:.1f} x "
              f"{h/IN_TO_MM/12:.1f} ft")


# ===================================================================
# MAIN
# ===================================================================

def main():
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--dry-run"]

    if len(args) != 1:
        print("Usage: compile_house_grid.py [--dry-run] <floor_plan.svg>")
        sys.exit(1)

    svg = args[0]
    if not os.path.exists(svg):
        raise FileNotFoundError(f"Missing: {svg}")

    if not dry_run and not HAS_FREECAD:
        print("FreeCAD not available. Use --dry-run for position preview.")
        sys.exit(1)

    if not dry_run and not os.path.isdir(CAD_LIBRARY):
        raise FileNotFoundError(f"Missing: {CAD_LIBRARY}")

    icons = parse_svg(svg)
    if not icons:
        raise RuntimeError("No wall icons found in SVG")

    print(f"Parsed {len(icons)} icons from {svg}:")
    for i in icons:
        print(f"  {i['id']}: {i['base_module']} {i['direction']} "
              f"grid=({i['gx']},{i['gy']})")

    out = os.path.splitext(svg)[0] + ".FCStd"
    assemble(icons, out, dry_run=dry_run)


if __name__ == "__main__":
    main()
