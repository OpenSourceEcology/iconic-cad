#!/usr/bin/env python3
"""
FOUNDATION LIB — pure Python port of the browser's foundation derivation.

This is the deliberate JS<->Python parallel pair (same precedent as the
wall/blocking math): it mirrors web/js/region.js (compute_region flood-fill)
and web/js/foundation_geom.js (foundation_solids) byte-for-byte in behaviour so
the terminal compiler's foundation matches the browser exactly. Kept honest by
the golden parity test tests/foundation_parity.mjs.

PURE: no FreeCAD, no I/O. Imports only the stdlib so it can run under plain
python3 (the golden generator) AND under freecadcmd (the compiler).
"""

import math

IN_TO_MM = 25.4

# ---- region (port of web/js/region.js) -----------------------------------
REGION_CELL_MM = 3 * IN_TO_MM   # 3" cell, must equal region.js REGION_CELL_MM
MARGIN_CELLS = 2
EMPTY, WALL, FLOOD = 0, 1, 2


def is_horizontal(direction):
    return direction in ("north", "south")


def module_bbox(width_mm, depth_mm, direction):
    """Post-rotation footprint, mirrors geometry.js getModuleBBox."""
    if is_horizontal(direction):
        return width_mm, depth_mm
    return depth_mm, width_mm


def _wall_dir(e):
    return e.get("direction") or e.get("dir")


def _wall_bbox(e):
    return module_bbox(e["width_mm"], e["depth_mm"], _wall_dir(e))


def compute_region(entities, cell_mm=REGION_CELL_MM):
    """Port of region.js computeRegion. Returns a region descriptor dict with:
    rects, cells, contains_point, is_enclosed, bbox."""
    walls = [e for e in entities if e.get("kind") == "wall"]  # exterior only
    if not walls:
        return _empty_region()

    # 1. extent over exterior-wall footprints
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    fps = []
    for e in walls:
        w, h = _wall_bbox(e)
        r = {"x0": e["x_mm"], "y0": e["y_mm"], "x1": e["x_mm"] + w, "y1": e["y_mm"] + h}
        min_x = min(min_x, r["x0"]); min_y = min(min_y, r["y0"])
        max_x = max(max_x, r["x1"]); max_y = max(max_y, r["y1"])
        fps.append(r)

    # 2. grid with a MARGIN_CELLS-wide ring on every side
    origin_x = min_x - MARGIN_CELLS * cell_mm
    origin_y = min_y - MARGIN_CELLS * cell_mm
    cols = math.ceil((max_x - min_x) / cell_mm) + 2 * MARGIN_CELLS + 1
    rows = math.ceil((max_y - min_y) / cell_mm) + 2 * MARGIN_CELLS + 1
    grid = bytearray(cols * rows)  # EMPTY

    def at(cx, cy):
        return cy * cols + cx

    # mark WALL by any-overlap with a footprint (leak-proof at corners)
    for r in fps:
        cx0 = math.floor((r["x0"] - origin_x) / cell_mm)
        cx1 = math.floor((r["x1"] - origin_x) / cell_mm)
        cy0 = math.floor((r["y0"] - origin_y) / cell_mm)
        cy1 = math.floor((r["y1"] - origin_y) / cell_mm)
        for cy in range(cy0, cy1 + 1):
            for cx in range(cx0, cx1 + 1):
                if 0 <= cx < cols and 0 <= cy < rows:
                    grid[at(cx, cy)] = WALL

    # 3. flood from the margin ring (border cells are all EMPTY by construction)
    stack = []

    def push(cx, cy):
        if cx < 0 or cx >= cols or cy < 0 or cy >= rows:
            return
        i = at(cx, cy)
        if grid[i] == EMPTY:
            grid[i] = FLOOD
            stack.append(i)

    for cx in range(cols):
        push(cx, 0); push(cx, rows - 1)
    for cy in range(rows):
        push(0, cy); push(cols - 1, cy)
    while stack:
        i = stack.pop()
        cx = i % cols
        cy = i // cols
        push(cx + 1, cy); push(cx - 1, cy); push(cx, cy + 1); push(cx, cy - 1)

    # 4. filled silhouette = WALL cells + enclosed interior
    enclosed_area = 0.0
    rmin_x = rmin_y = math.inf
    rmax_x = rmax_y = -math.inf
    for cy in range(rows):
        for cx in range(cols):
            s = grid[at(cx, cy)]
            if s == EMPTY:
                enclosed_area += cell_mm * cell_mm
            if s != FLOOD:
                wx = origin_x + cx * cell_mm
                wy = origin_y + cy * cell_mm
                rmin_x = min(rmin_x, wx); rmin_y = min(rmin_y, wy)
                rmax_x = max(rmax_x, wx + cell_mm); rmax_y = max(rmax_y, wy + cell_mm)

    is_enclosed = enclosed_area > 0
    bbox = ({"minX": rmin_x, "minY": rmin_y, "maxX": rmax_x, "maxY": rmax_y}
            if is_enclosed else None)

    def state_at(x, y):
        cx = math.floor((x - origin_x) / cell_mm)
        cy = math.floor((y - origin_y) / cell_mm)
        if cx < 0 or cx >= cols or cy < 0 or cy >= rows:
            return FLOOD
        return grid[at(cx, cy)]

    def contains_point(x, y):
        return state_at(x, y) != FLOOD

    # FILL MASK — enclosed interior + the EXACT wall band (trims over-mark).
    def center_in_footprint(x, y):
        for r in fps:
            if r["x0"] <= x < r["x1"] and r["y0"] <= y < r["y1"]:
                return True
        return False

    def is_empty(cx, cy):
        return 0 <= cx < cols and 0 <= cy < rows and grid[at(cx, cy)] == EMPTY

    def is_fill(cx, cy):
        s = grid[at(cx, cy)]
        if s == EMPTY:
            return True
        if s != WALL:
            return False
        if center_in_footprint(origin_x + (cx + 0.5) * cell_mm,
                               origin_y + (cy + 0.5) * cell_mm):
            return True
        return (is_empty(cx - 1, cy) or is_empty(cx + 1, cy)
                or is_empty(cx, cy - 1) or is_empty(cx, cy + 1))

    # merged per-row rectangles of the fill cells
    rects = []
    for cy in range(rows):
        run_start = -1
        for cx in range(cols + 1):
            fill = cx < cols and is_fill(cx, cy)
            if fill and run_start < 0:
                run_start = cx
            elif not fill and run_start >= 0:
                rects.append({
                    "x_mm": origin_x + run_start * cell_mm,
                    "y_mm": origin_y + cy * cell_mm,
                    "w_mm": (cx - run_start) * cell_mm,
                    "h_mm": cell_mm,
                })
                run_start = -1

    return {
        "cells": {"cols": cols, "rows": rows, "cell_mm": cell_mm,
                  "origin_x": origin_x, "origin_y": origin_y},
        "bbox": bbox, "area_mm2": enclosed_area, "is_enclosed": is_enclosed,
        "contains_point": contains_point, "rects": rects,
    }


def _empty_region():
    return {"cells": None, "bbox": None, "area_mm2": 0.0, "is_enclosed": False,
            "contains_point": lambda x, y: False, "rects": []}


# ---- foundation_solids (port of web/js/foundation_geom.js) ----------------
DEFAULT_CELL_MM = 3 * IN_TO_MM
MERGE_TOL = 1e-6   # mm — strip x/w/edge equality
RUN_TOL = 2        # mm — end-to-end contiguity gap along a run
RUN_BAND = 60      # mm — same-line cross-axis clustering


def _merge_slab_rects(rects):
    """Greedy-merge per-row fill strips into MAXIMAL rectangles (port of
    foundation_geom.js mergeSlabRects). Stack vertically-adjacent strips that
    share x_mm + w_mm into one taller box → minimal rectangle set covering the
    silhouette (rectangle house -> 1; L -> 2-3)."""
    open_rects = []
    for s in rects:
        host = None
        for o in open_rects:
            if (abs(o["x_mm"] - s["x_mm"]) < MERGE_TOL and
                    abs(o["w_mm"] - s["w_mm"]) < MERGE_TOL and
                    abs((o["y_mm"] + o["h_mm"]) - s["y_mm"]) < MERGE_TOL):
                host = o
                break
        if host:
            host["h_mm"] += s["h_mm"]
        else:
            open_rects.append({"x_mm": s["x_mm"], "y_mm": s["y_mm"],
                               "w_mm": s["w_mm"], "h_mm": s["h_mm"]})
    return open_rects


def _compute_runs(walls):
    """Group exterior walls into runs (one run = one full side). Port of
    foundation_geom.js computeFoundationRuns / runs.js detectRunsForLevel,
    geometry-only. Each run: horiz, letter, near_cross, depth, a_min, a_max."""
    feats = []
    for w in walls:
        bw, bh = module_bbox(w["width_mm"], w["depth_mm"], w["direction"])
        horiz = is_horizontal(w["direction"])
        x0, y0, x1, y1 = w["x_mm"], w["y_mm"], w["x_mm"] + bw, w["y_mm"] + bh
        feats.append({
            "horiz": horiz,
            "depth": bh if horiz else bw,
            "cross": y0 if horiz else x0,
            "a0": x0 if horiz else y0,
            "a1": x1 if horiz else y1,
        })

    # 1. cluster into collinear lines (same orientation + cross band)
    lines = []
    for ft in feats:
        line = next((L for L in lines if L["horiz"] == ft["horiz"]
                     and abs(L["cross"] - ft["cross"]) <= RUN_BAND), None)
        if line is None:
            line = {"horiz": ft["horiz"], "cross": ft["cross"], "items": []}
            lines.append(line)
        line["items"].append(ft)

    # 2. within each line, sort along the axis and split into contiguous chains
    runs = []
    for L in lines:
        L["items"].sort(key=lambda f: f["a0"])
        chain, end = [], None

        def flush():
            nonlocal chain
            if not chain:
                return
            runs.append({
                "horiz": L["horiz"],
                "near_cross": min(c["cross"] for c in chain),
                "depth": chain[0]["depth"],
                "a_min": min(c["a0"] for c in chain),
                "a_max": max(c["a1"] for c in chain),
            })
            chain = []

        for ft in L["items"]:
            if chain and ft["a0"] - end > RUN_TOL:
                flush()
            chain.append(ft)
            end = ft["a1"] if end is None else max(end, ft["a1"])
        flush()

    # 3. order top-to-bottom (minY), ties left-to-right (minX); letter by order
    def min_x(r):
        return r["a_min"] if r["horiz"] else r["near_cross"]

    def min_y(r):
        return r["near_cross"] if r["horiz"] else r["a_min"]

    runs.sort(key=lambda r: (min_y(r), min_x(r)))
    for i, r in enumerate(runs):
        r["letter"] = chr(65 + i)
    return runs


def _end_ext(r, a_end_val, all_runs, skirt_t):
    """Extension for one run end. Returns P.depth + skirt_t if SUBMISSIVE (a perpendicular
    run P butts r at that end — P's wall crosses r's line and P's cross band contains the
    end coord), or 0 if DOMINANT (r reaches the building corner)."""
    for p in all_runs:
        if p["horiz"] == r["horiz"]:
            continue
        # (a) r's cross band within p's along-axis extent
        if p["a_min"] > r["near_cross"] + RUN_TOL:
            continue
        if r["near_cross"] + r["depth"] > p["a_max"] + RUN_TOL:
            continue
        # (b) p's cross band contains a_end_val
        if p["near_cross"] - RUN_TOL > a_end_val:
            continue
        if a_end_val > p["near_cross"] + p["depth"] + RUN_TOL:
            continue
        return p["depth"] + skirt_t
    return 0


def foundation_solids(params, silhouette):
    """Port of foundation_geom.js foundationSolids. Returns ordered list of
    piece dicts {group, kind, label, dims{dx_mm,dy_mm,dz_mm},
    center{x_mm,y_mm,z_mm}}. World plan mm, z-DOWN (top of slab = z=0).
    Monolithic slab + one grade beam per run + one continuous frost skirt
    per run (corner-extended so the FPSF loop is gapless)."""
    slab_t = params["slab_thickness_mm"]
    beam_w = params["beam_w_mm"]
    beam_d = params["beam_d_mm"]
    skirt_d = params["skirt_depth_mm"]
    skirt_t = params["skirt_thickness_mm"]

    rects = silhouette.get("rects", [])
    walls = silhouette.get("walls", [])
    contains_point = silhouette["contains_point"]
    cell = silhouette.get("cell_mm") or DEFAULT_CELL_MM
    # 2 cells: clears the ≤1-cell over-mark from any-overlap WALL marking.
    # ¾-cell probe can land in the over-mark band and misread as interior.
    probe = cell * 2

    pieces = []

    # SLAB — monolithic: maximal rectangles covering the silhouette.
    for i, r in enumerate(_merge_slab_rects(rects)):
        pieces.append({
            "group": "foundation", "kind": "slab", "label": "slab_%02d" % i,
            "dims": {"dx_mm": r["w_mm"], "dy_mm": r["h_mm"], "dz_mm": slab_t},
            "center": {"x_mm": r["x_mm"] + r["w_mm"] / 2,
                       "y_mm": r["y_mm"] + r["h_mm"] / 2, "z_mm": -slab_t / 2},
        })

    runs = _compute_runs(walls)

    # GRADE BEAM — one per run, full length, centered on the wall line.
    for r in runs:
        length = r["a_max"] - r["a_min"]
        axis_c = (r["a_min"] + r["a_max"]) / 2
        line_c = r["near_cross"] + r["depth"] / 2
        pieces.append({
            "group": "foundation", "kind": "beam", "label": "beam_%s" % r["letter"],
            "dims": {"dx_mm": length if r["horiz"] else beam_w,
                     "dy_mm": beam_w if r["horiz"] else length, "dz_mm": beam_d},
            "center": ({"x_mm": axis_c, "y_mm": line_c, "z_mm": -beam_d / 2}
                       if r["horiz"]
                       else {"x_mm": line_c, "y_mm": axis_c, "z_mm": -beam_d / 2}),
        })

    # FROST SKIRT — one continuous panel per run on its OUTSIDE face.
    # Per-end extension: SUBMISSIVE ends (a perp run butts there) extend by
    # P.depth + skirt_t to bridge across P and overlap P's outer skirt;
    # DOMINANT ends (run reaches the building corner) extend by 0.
    # Result: gapless FPSF loop, no stub past any convex corner.
    for r in runs:
        orig_axis_c = (r["a_min"] + r["a_max"]) / 2  # probe along wall midpoint
        ext_at_min = _end_ext(r, r["a_min"], runs, skirt_t)
        ext_at_max = _end_ext(r, r["a_max"], runs, skirt_t)
        new_a_min = r["a_min"] - ext_at_min
        new_a_max = r["a_max"] + ext_at_max
        grown = new_a_max - new_a_min
        skirt_axis_c = (new_a_min + new_a_max) / 2
        far_cross = r["near_cross"] + r["depth"]
        if r["horiz"]:
            near_out = not contains_point(orig_axis_c, r["near_cross"] - probe)
            fy = (r["near_cross"] - skirt_t / 2) if near_out else (far_cross + skirt_t / 2)
            pieces.append({
                "group": "foundation", "kind": "skirt", "label": "skirt_%s" % r["letter"],
                "dims": {"dx_mm": grown, "dy_mm": skirt_t, "dz_mm": skirt_d},
                "center": {"x_mm": skirt_axis_c, "y_mm": fy, "z_mm": -skirt_d / 2},
            })
        else:
            near_out = not contains_point(r["near_cross"] - probe, orig_axis_c)
            fx = (r["near_cross"] - skirt_t / 2) if near_out else (far_cross + skirt_t / 2)
            pieces.append({
                "group": "foundation", "kind": "skirt", "label": "skirt_%s" % r["letter"],
                "dims": {"dx_mm": skirt_t, "dy_mm": grown, "dz_mm": skirt_d},
                "center": {"x_mm": fx, "y_mm": skirt_axis_c, "z_mm": -skirt_d / 2},
            })

    return pieces


def silhouette_for_walls(walls, cell_mm=REGION_CELL_MM):
    """Build the silhouette dict foundation_solids expects from a list of L1
    wall dicts (each with x_mm,y_mm,width_mm,depth_mm,direction,id). Runs the
    region flood-fill for the slab rects and the outside-face probe."""
    region = compute_region(walls, cell_mm)
    return {
        "rects": region["rects"],
        "walls": [{"id": w["id"], "x_mm": w["x_mm"], "y_mm": w["y_mm"],
                   "width_mm": w["width_mm"], "depth_mm": w["depth_mm"],
                   "direction": _wall_dir(w)} for w in walls],
        "contains_point": region["contains_point"],
        "cell_mm": region["cells"]["cell_mm"] if region["cells"] else None,
    }
