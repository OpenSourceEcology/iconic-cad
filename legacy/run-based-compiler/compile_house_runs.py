#!/usr/bin/env python3
"""
Run-based house compiler.

Assembles wall modules from an SVG icon layout by identifying wall runs
(consecutive same-direction modules) and placing them as units, then
connecting runs at corners using intersection math.

This avoids the port-selection bug (#3) present in the BFS port-based
compiler, where perpendicular port snapping at corners produces overhang.

Usage (dry-run, no FreeCAD needed):
    python3 compile_house_runs.py --dry-run examples/small_rectangle.svg

Usage (FreeCAD):
    freecadcmd -c "import sys; sys.argv=['compile_house_runs.py','layout.svg']; exec(open('compile_house_runs.py').read())"
"""

import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

# ---------------------------------------------------------------------------
# Try to import FreeCAD — will fail in dry-run mode, which is fine
# ---------------------------------------------------------------------------
try:
    import FreeCAD as App
    import Part  # noqa: F401
    HAS_FREECAD = True
except ImportError:
    HAS_FREECAD = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CAD_LIBRARY = "cad_library"
GRID = 64.0
SVG_NS = {"svg": "http://www.w3.org/2000/svg"}
IN_TO_MM = 25.4

# Module dimensions (mm)
WALL_4FT_WIDTH = 1219.2       # 48" = 4ft
WALL_3FT_WIDTH = 914.4        # 36" = 3ft
WALL_DEPTH = 150.8125         # 5.5" stud + 7/16" OSB

# Rotation mapping: SVG Y-down -> FreeCAD Y-up
# North icons (top of SVG) get 0 deg, south icons (bottom) get 180 deg
DIRECTION_TO_ROT = {"south": 180.0, "east": 90.0, "north": 0.0, "west": 270.0}

# Known module widths by base name
MODULE_WIDTHS = {
    "wall_4x8_2x6_16oc": WALL_4FT_WIDTH,
    "wall_4x8_2x6_24oc": WALL_4FT_WIDTH,
    "wall_3x8.5_2x6_16oc": WALL_3FT_WIDTH,
}
DEFAULT_WIDTH = WALL_4FT_WIDTH


# ===================================================================
# SVG PARSING (reused from compile_house.py)
# ===================================================================

def parse_icon_name(name):
    """Extract base module name and direction from icon name.

    e.g. 'wall_4x8_2x6_16oc_east' -> ('wall_4x8_2x6_16oc', 'east', 90.0)
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
    """Extract icon center position from SVG transform."""
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
    """Detect wall direction from clip-path references in DIRECT children."""
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
    """Horizontal walls run along X (north/south facing)."""
    return direction in ("north", "south")


def is_vertical(direction):
    """Vertical walls run along Y after rotation (east/west facing)."""
    return direction in ("east", "west")


def get_module_width(base_module):
    """Get module width in mm from base module name."""
    return MODULE_WIDTHS.get(base_module, DEFAULT_WIDTH)


# ===================================================================
# CAD HELPERS (FreeCAD mode only)
# ===================================================================

def rotate_vec_z(v, deg):
    """Rotate a FreeCAD Vector around Z axis."""
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    return App.Vector(v.x * c - v.y * s, v.x * s + v.y * c, v.z)


def find_cad_file(base_module):
    """Find the .FCStd file for a base module name."""
    path = os.path.join(CAD_LIBRARY, base_module + ".FCStd")
    if os.path.exists(path):
        return path
    for f in os.listdir(CAD_LIBRARY):
        if f.startswith(base_module) and f.endswith(".FCStd"):
            return os.path.join(CAD_LIBRARY, f)
    raise FileNotFoundError(f"No CAD file found for module: {base_module}")


def load_module_shape(base_module, cache={}):
    """Load module shape from cad_library (no ports needed)."""
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


def prepare_module_shape(base_module, rot_deg):
    """Load, rotate, and normalize a wall module shape.

    Returns (shape, bbox).
    """
    base_shape = load_module_shape(base_module)

    shape = base_shape.copy()
    shape.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), rot_deg)

    bb = shape.BoundBox
    offset = App.Vector(-bb.XMin, -bb.YMin, -bb.ZMin)
    shape.translate(offset)

    return shape, shape.BoundBox


# ===================================================================
# RUN IDENTIFICATION
# ===================================================================

def identify_runs(icons):
    """Group icons into wall runs.

    A run is a maximal sequence of consecutive icons with the same
    direction orientation (H or V) along the run axis.

    - Horizontal runs: same gy, horizontal direction (N/S), consecutive gx
    - Vertical runs: same gx, vertical direction (E/W), consecutive gy

    Returns list of Run dicts, each with:
      - 'icons': list of icons in order
      - 'axis': 'h' or 'v'
      - 'direction': the shared direction
    """
    # Separate icons by orientation and row/column
    h_by_row = defaultdict(list)   # gy -> list of icons
    v_by_col = defaultdict(list)   # gx -> list of icons

    for icon in icons:
        if is_horizontal(icon["direction"]):
            h_by_row[icon["gy"]].append(icon)
        else:
            v_by_col[icon["gx"]].append(icon)

    runs = []

    # Build horizontal runs (same gy, sorted by gx, consecutive)
    for gy, row_icons in sorted(h_by_row.items()):
        row_icons.sort(key=lambda i: i["gx"])
        run = [row_icons[0]]
        for i in range(1, len(row_icons)):
            if (row_icons[i]["gx"] == run[-1]["gx"] + 1 and
                    row_icons[i]["direction"] == run[-1]["direction"]):
                run.append(row_icons[i])
            else:
                runs.append({
                    "icons": run,
                    "axis": "h",
                    "direction": run[0]["direction"],
                })
                run = [row_icons[i]]
        runs.append({
            "icons": run,
            "axis": "h",
            "direction": run[0]["direction"],
        })

    # Build vertical runs (same gx, sorted by gy, consecutive)
    for gx, col_icons in sorted(v_by_col.items()):
        col_icons.sort(key=lambda i: i["gy"])
        run = [col_icons[0]]
        for i in range(1, len(col_icons)):
            if (col_icons[i]["gy"] == run[-1]["gy"] + 1 and
                    col_icons[i]["direction"] == run[-1]["direction"]):
                run.append(col_icons[i])
            else:
                runs.append({
                    "icons": run,
                    "axis": "v",
                    "direction": run[0]["direction"],
                })
                run = [col_icons[i]]
        runs.append({
            "icons": run,
            "axis": "v",
            "direction": run[0]["direction"],
        })

    return runs


# ===================================================================
# RUN ADJACENCY
# ===================================================================

def build_run_adjacency(runs):
    """Find corner connections between perpendicular runs.

    Two runs are adjacent if an icon at the end of one run is
    grid-adjacent to any icon in the other run, and the runs are
    perpendicular. At least one of the two connecting icons must be
    at a run endpoint (first or last icon in the run).

    Returns list of (run_i, run_j, icon_i, icon_j, pos_i, pos_j) tuples.
    """
    # Build a lookup: (gx, gy) -> (run_index, position_in_run)
    coord_to_run = {}
    for ri, run in enumerate(runs):
        for pi, icon in enumerate(run["icons"]):
            coord_to_run[(icon["gx"], icon["gy"])] = (ri, pi)

    adjacencies = []
    seen = set()

    for ri, run in enumerate(runs):
        # Check run endpoints
        endpoint_indices = [0]
        if len(run["icons"]) > 1:
            endpoint_indices.append(len(run["icons"]) - 1)

        for pi in endpoint_indices:
            icon = run["icons"][pi]
            gx, gy = icon["gx"], icon["gy"]
            pos_i = "start" if pi == 0 else "end"
            if len(run["icons"]) == 1:
                pos_i = "both"

            for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                nb_coord = (gx + dx, gy + dy)
                if nb_coord not in coord_to_run:
                    continue
                rj, pj = coord_to_run[nb_coord]
                if rj == ri:
                    continue

                # Must be perpendicular
                if runs[ri]["axis"] == runs[rj]["axis"]:
                    continue

                pair = (min(ri, rj), max(ri, rj))
                if pair in seen:
                    continue
                seen.add(pair)

                run_j = runs[rj]
                pos_j = "start" if pj == 0 else ("end" if pj == len(run_j["icons"]) - 1 else "mid")
                if len(run_j["icons"]) == 1:
                    pos_j = "both"

                adjacencies.append((ri, rj, icon, run_j["icons"][pj], pos_i, pos_j))

    return adjacencies


# ===================================================================
# RUN PLACEMENT
# ===================================================================

def compute_run_total_width(run):
    """Compute total width of all modules in a run."""
    return sum(get_module_width(icon["base_module"]) for icon in run["icons"])


def place_runs(runs, adjacencies):
    """Place all runs using corner intersection math.

    Returns dict: run_index -> list of (icon, x_mm, y_mm) placements.

    Module bounding boxes after rotation + normalization to origin:
      - North (0 deg):   (0,0) to (W, D). OSB at Y=0, studs toward +Y.
      - South (180 deg): (0,0) to (W, D). Studs toward Y=0, OSB at Y=D.
      - East (90 deg):   (0,0) to (D, W). Studs toward X=0, OSB at X=D.
      - West (270 deg):  (0,0) to (D, W). OSB at X=0, studs toward +X.

    Run placement origin = the module bbox origin (0,0 corner) for the
    first module in the run. Subsequent modules in the run stack along
    the run axis (+X for horizontal, +Y for vertical).

    Corner geometry: when a vertical run meets a horizontal run at a
    corner, the perpendicular run butts against the end of the dominant
    run. The connecting icon's grid position difference (dgx, dgy)
    determines which side they meet on.
    """
    placed = {}  # run_index -> (origin_x, origin_y) of first module bbox origin
    placements = {}  # run_index -> [(icon, x, y), ...]

    if not runs:
        return placements

    # Build adjacency lookup
    adj_map = defaultdict(list)
    for ri, rj, icon_i, icon_j, pos_i, pos_j in adjacencies:
        adj_map[ri].append((rj, icon_i, icon_j, pos_i, pos_j))
        adj_map[rj].append((ri, icon_j, icon_i, pos_j, pos_i))

    def place_run_modules(run_idx):
        """Place individual modules within a run given its origin."""
        run = runs[run_idx]
        ox, oy = placed[run_idx]
        result = []

        for i, icon in enumerate(run["icons"]):
            offset = sum(get_module_width(run["icons"][j]["base_module"])
                         for j in range(i))
            if run["axis"] == "h":
                result.append((icon, ox + offset, oy))
            else:
                result.append((icon, ox, oy + offset))

        placements[run_idx] = result

    def get_module_end(run_idx, icon_idx):
        """Get the far edge position of a placed module along its run axis."""
        icon, mx, my = placements[run_idx][icon_idx]
        w = get_module_width(icon["base_module"])
        run = runs[run_idx]
        if run["axis"] == "h":
            return mx + w  # right edge X
        else:
            return my + w  # bottom edge Y

    # Seed: prefer leftmost vertical run, then topmost horizontal
    seed_idx = 0
    best_key = None
    for ri, run in enumerate(runs):
        if run["axis"] == "v":
            key = (0, run["icons"][0]["gx"], run["icons"][0]["gy"])
        else:
            key = (1, run["icons"][0]["gy"], run["icons"][0]["gx"])
        if best_key is None or key < best_key:
            best_key = key
            seed_idx = ri

    placed[seed_idx] = (0.0, 0.0)
    place_run_modules(seed_idx)

    # BFS to place remaining runs
    queue = [seed_idx]
    while queue:
        ci = queue.pop(0)
        c_run = runs[ci]

        for ni, c_icon, n_icon, c_pos, n_pos in adj_map[ci]:
            if ni in placed:
                continue

            n_run = runs[ni]

            # Find connecting icon indices
            c_idx = next(j for j, ic in enumerate(c_run["icons"])
                         if ic["gx"] == c_icon["gx"] and ic["gy"] == c_icon["gy"])
            n_idx = next(j for j, ic in enumerate(n_run["icons"])
                         if ic["gx"] == n_icon["gx"] and ic["gy"] == n_icon["gy"])

            # Placed position of connecting icon in current run
            _, cx, cy = placements[ci][c_idx]
            c_w = get_module_width(c_icon["base_module"])
            n_w = get_module_width(n_icon["base_module"])

            # Offset of connecting icon within the neighbor run
            n_pre = sum(get_module_width(n_run["icons"][j]["base_module"])
                        for j in range(n_idx))

            # Grid delta from current connecting icon to neighbor connecting icon
            dgx = n_icon["gx"] - c_icon["gx"]
            dgy = n_icon["gy"] - c_icon["gy"]

            D = WALL_DEPTH

            if c_run["axis"] == "v" and n_run["axis"] == "h":
                # Current is vertical (E/W), neighbor is horizontal (N/S)
                # Vertical module bbox: (D, W) — depth along X, width along Y
                # Horizontal module bbox: (W, D) — width along X, depth along Y

                # --- Neighbor's Y (depth axis for H run) ---
                # V walls are dominant — they cover corners. H walls sit
                # flush INSIDE the V wall span, not outside it.
                if dgy < 0:
                    ny = cy          # H top flush with V module top
                elif dgy > 0:
                    ny = cy + c_w - D  # H bottom flush with V module bottom
                else:
                    if c_idx == 0:
                        ny = cy          # top of V run: H flush with V top
                    else:
                        ny = cy + c_w - D  # bottom of V run: H flush with V bottom

                # --- Neighbor's X (run axis for H run) ---
                # H wall starts past V wall's depth (V is dominant at corners).
                # V module bbox in X: cx to cx + D
                if dgx > 0:
                    nx_icon = cx + D
                elif dgx < 0:
                    nx_icon = cx - n_w
                else:
                    if n_idx == 0:
                        nx_icon = cx + D
                    else:
                        nx_icon = cx - n_w

                nx = nx_icon - n_pre
                placed[ni] = (nx, ny)

            elif c_run["axis"] == "h" and n_run["axis"] == "v":
                # Current is horizontal (N/S), neighbor is vertical (E/W)
                # H module bbox: (W, D) — width along X, depth along Y
                # V module bbox: (D, W) — depth along X, width along Y

                # --- Neighbor's X (depth axis for V run) ---
                # H module bbox in X: cx to cx + c_w
                if dgx > 0:
                    # Neighbor to the right — V run left at H module right edge
                    nx = cx + c_w
                elif dgx < 0:
                    # Neighbor to the left — V run right at H module left edge
                    nx = cx - D
                else:
                    # Same column — determine which side of H wall the
                    # V run extends toward
                    if n_idx == 0:
                        # V run starts here, extends to the right (+X)
                        nx = cx + c_w
                    else:
                        # V run ends here, came from the left (-X)
                        nx = cx - D

                # --- Neighbor's Y (run axis for V run) ---
                # V walls are dominant — they start flush with the H wall's
                # position so they cover the full corner zone.
                # H module bbox in Y: cy to cy + D
                if dgy > 0:
                    ny_icon = cy
                elif dgy < 0:
                    ny_icon = cy + D - n_w
                else:
                    if n_idx == 0:
                        ny_icon = cy        # V starts at H wall's Y
                    else:
                        ny_icon = cy + D - n_w  # V ends at H wall's far edge

                ny = ny_icon - n_pre
                placed[ni] = (nx, ny)

            place_run_modules(ni)
            queue.append(ni)

    return placements


# ===================================================================
# DRY RUN OUTPUT
# ===================================================================

def print_dry_run(runs, placements):
    """Print placement summary without FreeCAD."""
    print("\n=== Run-based placement (dry run) ===\n")

    for ri, run in enumerate(runs):
        total_w = compute_run_total_width(run)
        n = len(run["icons"])
        first = run["icons"][0]
        last = run["icons"][-1]
        print(f"Run {ri}: {run['axis'].upper()} {run['direction']:5s} "
              f"({n} modules, {total_w:.1f}mm = {total_w/IN_TO_MM:.1f}in) "
              f"grid ({first['gx']},{first['gy']})..({last['gx']},{last['gy']})")

    print()

    all_placements = []
    for ri in sorted(placements.keys()):
        for icon, x, y in placements[ri]:
            w = get_module_width(icon["base_module"])
            run = runs[ri]
            if run["axis"] == "h":
                x2 = x + w
                y2 = y + WALL_DEPTH
            else:
                x2 = x + WALL_DEPTH
                y2 = y + w
            all_placements.append((icon, x, y, x2, y2, ri))
            print(f"  {icon['id']:12s} {icon['direction']:5s} "
                  f"run={ri} "
                  f"origin=({x:8.1f}, {y:8.1f}) "
                  f"extent=({x2:8.1f}, {y2:8.1f}) "
                  f"size={w:.1f}x{WALL_DEPTH:.1f}mm")

    # Compute bounding box
    if all_placements:
        min_x = min(p[1] for p in all_placements)
        min_y = min(p[2] for p in all_placements)
        max_x = max(p[3] for p in all_placements)
        max_y = max(p[4] for p in all_placements)
        print(f"\nBounding box: ({min_x:.1f}, {min_y:.1f}) .. ({max_x:.1f}, {max_y:.1f})")
        print(f"  Total size: {max_x - min_x:.1f} x {max_y - min_y:.1f} mm")
        print(f"             ({(max_x - min_x)/IN_TO_MM:.1f} x {(max_y - min_y)/IN_TO_MM:.1f} in)")

    # Sanity checks
    print("\n=== Sanity checks ===")
    ok = True

    # Check for overlapping modules (same-axis overlap)
    for i, (ic_a, x_a, y_a, x2_a, y2_a, ri_a) in enumerate(all_placements):
        for j, (ic_b, x_b, y_b, x2_b, y2_b, ri_b) in enumerate(all_placements):
            if j <= i:
                continue
            # Check 2D overlap (with small tolerance)
            tol = 0.1
            if (x_a + tol < x2_b and x2_a - tol > x_b and
                    y_a + tol < y2_b and y2_a - tol > y_b):
                print(f"  WARNING: overlap between {ic_a['id']} and {ic_b['id']}")
                ok = False

    if ok:
        print("  All checks passed.")


# ===================================================================
# FREECAD ASSEMBLY
# ===================================================================

def assemble_freecad(runs, placements, out_file):
    """Create FreeCAD document with placed wall modules."""
    if not HAS_FREECAD:
        raise RuntimeError("FreeCAD not available. Use --dry-run mode.")

    doc = App.newDocument("HouseAssembly")
    count = 0

    for ri in sorted(placements.keys()):
        run = runs[ri]
        for icon, x, y in placements[ri]:
            shape, bbox = prepare_module_shape(icon["base_module"], icon["rot"])

            # Translate to computed position
            shape.translate(App.Vector(x, y, 0))

            name = f"wall_{count:02d}_{icon['id']}"
            obj = doc.addObject("Part::Feature", name)
            obj.Shape = shape
            if obj.ViewObject:
                obj.ViewObject.Visibility = True
            count += 1

            print(f"Placed {name} ({icon['direction']}) at ({x:.1f}, {y:.1f})")

    doc.recompute()
    out_abs = os.path.abspath(out_file)
    doc.saveAs(out_abs)
    print(f"\nSaved {out_abs} ({count} walls)")


# ===================================================================
# MAIN
# ===================================================================

def main():
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--dry-run"]

    if len(args) != 1:
        print("Usage: compile_house_runs.py [--dry-run] <floor_plan.svg>")
        sys.exit(1)

    svg = args[0]
    if not os.path.exists(svg):
        raise FileNotFoundError(f"Missing: {svg}")

    if not dry_run and not HAS_FREECAD:
        print("FreeCAD not available. Running in dry-run mode.")
        dry_run = True

    # Parse SVG
    icons = parse_svg(svg)
    if not icons:
        raise RuntimeError("No wall icons found in SVG")

    print(f"Parsed {len(icons)} icons from {svg}:")
    for i in icons:
        print(f"  {i['id']}: {i['base_module']} {i['direction']} "
              f"grid=({i['gx']},{i['gy']})")

    # Identify runs
    runs = identify_runs(icons)
    print(f"\nIdentified {len(runs)} wall runs:")
    for ri, run in enumerate(runs):
        icons_str = ", ".join(f"({ic['gx']},{ic['gy']})" for ic in run["icons"])
        print(f"  Run {ri}: {run['axis'].upper()} {run['direction']:5s} "
              f"[{len(run['icons'])} modules] {icons_str}")

    # Build adjacency
    adjacencies = build_run_adjacency(runs)
    print(f"\nFound {len(adjacencies)} corner connections:")
    for ri, rj, icon_i, icon_j, pos_i, pos_j in adjacencies:
        print(f"  Run {ri} ({pos_i}) <-> Run {rj} ({pos_j}): "
              f"({icon_i['gx']},{icon_i['gy']}) -- ({icon_j['gx']},{icon_j['gy']})")

    # Place runs
    placements = place_runs(runs, adjacencies)

    if dry_run:
        print_dry_run(runs, placements)
    else:
        out = os.path.splitext(svg)[0] + "_runs.FCStd"
        assemble_freecad(runs, placements, out)


if __name__ == "__main__":
    main()
