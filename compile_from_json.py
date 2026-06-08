#!/usr/bin/env python3
"""
Compile a house from a JSON layout exported by the web UI.

The JSON already contains exact module positions in mm — no run
detection, port snapping, or corner math needed. Just load each
CAD shape, rotate, normalize, translate, and save.

Blocking geometry (C/T/E) for interior wall T-junctions is computed
and placed as separate Part::Feature objects in the assembly.

Usage:
    freecadcmd -c "import sys; sys.argv=['compile_from_json.py','layout.json']; \
      exec(open('compile_from_json.py').read())"
"""

import json
import math
import os
import sys
import zipfile

import yaml

try:
    import FreeCAD as App
    import Part  # noqa: F401
    _FREECAD = True
except ImportError:
    _FREECAD = False

CAD_LIBRARY = "cad_library"
YAML_PATH = "wall_instances.yaml"
IN_TO_MM = 25.4

# Same rotation mapping as compile_house.py (SVG Y-down → FreeCAD Y-up fix)
DIRECTION_TO_ROT = {"south": 180.0, "east": 90.0, "north": 0.0, "west": 270.0}

# Lumber lookup
NOMINAL_TO_ACTUAL = {
    "2x2": (1.5, 1.5), "2x3": (1.5, 2.5), "2x4": (1.5, 3.5),
    "2x6": (1.5, 5.5), "2x8": (1.5, 7.25), "2x10": (1.5, 9.25),
    "2x12": (1.5, 11.25),
}


def load_yaml_specs():
    """Load module parameters from wall_instances.yaml."""
    with open(YAML_PATH) as f:
        data = yaml.safe_load(f)
    return {inst["id"]: inst["parameters"] for inst in data["instances"]}


def stud_positions(width_in, stud_thick_in, spacing_oc_in):
    """Compute stud X positions (in inches) including end studs."""
    pos = [0.0]
    right_edge = width_in - stud_thick_in
    cur = spacing_oc_in
    while cur + stud_thick_in <= right_edge:
        pos.append(cur)
        cur += spacing_oc_in
    if pos[-1] != right_edge:
        pos.append(right_edge)
    return pos


def find_cad_file(base_module):
    for f in os.listdir(CAD_LIBRARY):
        if f.startswith(base_module) and f.endswith(".FCStd"):
            return os.path.join(CAD_LIBRARY, f)
    raise FileNotFoundError(f"No CAD file for: {base_module}")


def load_shape(base_module, cache={}):
    if base_module in cache:
        return cache[base_module]
    path = find_cad_file(base_module)
    doc = App.openDocument(path)
    shape = None
    for obj in doc.Objects:
        if hasattr(obj, "Shape") and obj.Shape.Volume > 0:
            if "port" not in obj.Name.lower():
                shape = obj.Shape.copy()
                break
    App.closeDocument(doc.Name)
    if shape is None:
        raise RuntimeError(f"No shape in {path}")
    cache[base_module] = shape
    return shape


def prepare_shape(base_module, rot_deg):
    base = load_shape(base_module)
    shape = base.copy()
    shape.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), rot_deg)
    bb = shape.BoundBox
    shape.translate(App.Vector(-bb.XMin, -bb.YMin, -bb.ZMin))
    return shape


def mirror_y(shape):
    """Reflect the assembled shape across the X-axis (Y -> -Y).

    The web UI authors layouts in screen coordinates (Y points DOWN); the 2D
    plan and the 3D preview (render3d.js) both present a Y-up world by flipping
    Y. The export must apply the same flip or it builds the mirror image of the
    designed house. Applied as one global reflection of every finished shape
    (walls + blocking together) so their relative alignment is preserved.
    fcstd.js does the identical flip via a -1 BREP Location (tests/parity.mjs).
    """
    return shape.mirror(App.Vector(0, 0, 0), App.Vector(0, 1, 0))


def get_canonical_contact(direction, width_mm, contact_x, contact_y, wall_x, wall_y):
    """Convert global contact point to canonical X along the wall's run."""
    if direction == "north":
        return contact_x - wall_x
    elif direction == "south":
        return width_mm - (contact_x - wall_x)
    elif direction == "east":
        return contact_y - wall_y
    elif direction == "west":
        return width_mm - (contact_y - wall_y)


def stud_centers_assembled(direction, tx, ty, width_mm, studs_in, st_in):
    """Get stud center positions in assembled coords along the run axis."""
    centers = []
    for s_in in studs_in:
        center_mm = (s_in + st_in / 2) * IN_TO_MM
        if direction == "north":
            centers.append(tx + center_mm)
        elif direction == "south":
            centers.append(tx + width_mm - center_mm)
        elif direction == "east":
            centers.append(ty + center_mm)
        elif direction == "west":
            centers.append(ty + width_mm - center_mm)
    return centers


def get_frame_depth_range(direction, tx, ty, sd_mm, osb_mm):
    """Get the frame depth range (min, max) in assembled coordinates."""
    if direction == "north":
        return (ty + osb_mm, ty + osb_mm + sd_mm, "y")
    elif direction == "south":
        return (ty, ty + sd_mm, "y")
    elif direction == "east":
        return (tx, tx + sd_mm, "x")
    elif direction == "west":
        return (tx + osb_mm, tx + osb_mm + sd_mm, "x")


def create_blocking(conn, target_mod, modules_by_id, yaml_specs, min_x, min_y):
    """Create blocking geometry shapes for a T-junction connection.
    Parity contract with web/js/fcstd.js createBlocking: tests/parity.mjs"""
    target = modules_by_id.get(conn["target_id"])
    if not target:
        return []

    # Find YAML params for the target wall. Module ids now match the YAML id
    # exactly (build_lib enforces one id scheme); the prefix match is retained
    # defensively and as a no-op for the exact-match case.
    target_module = target["module"]
    params = None
    for key, val in yaml_specs.items():
        if target_module.startswith(key) or key.startswith(target_module):
            params = val
            break
    if not params:
        print(f"  Warning: no YAML spec for {target_module}, skipping blocking")
        return []

    width_in = params["nominal_width_ft"] * 12
    height_in = params["nominal_height_ft"] * 12
    st_in, sd_in = NOMINAL_TO_ACTUAL[params["stud_lumber_nominal"]]
    osb_in = params.get("osb_thickness_in", 0)
    spacing_in = params["stud_spacing_oc_in"]

    width_mm = width_in * IN_TO_MM
    H = height_in * IN_TO_MM
    st_mm = st_in * IN_TO_MM
    sd_mm = sd_in * IN_TO_MM
    osb_mm = osb_in * IN_TO_MM
    plate_t = st_mm
    stud_h = H - 2 * plate_t

    # Blocking lumber is always 2x4
    bt = 1.5 * IN_TO_MM  # block thickness
    bd = 3.5 * IN_TO_MM  # block depth

    # Assembled position of target wall
    tx = target["x_mm"] - min_x
    ty = target["y_mm"] - min_y

    # Contact point in assembled coords
    cx = conn["contact_x_mm"] - min_x
    cy = conn["contact_y_mm"] - min_y

    d = target["direction"]
    is_h = d in ("north", "south")

    # Frame depth range in assembled coords
    depth_min, depth_max, depth_axis = get_frame_depth_range(d, tx, ty, sd_mm, osb_mm)
    # Blocking sits flush against the interior face (where the interior wall connects)
    # North/West: interior face is at depth_max → stud at far side
    # South/East: interior face is at depth_min → stud at near side
    if d in ("north", "west"):
        depth_flush = depth_max - bt
    else:
        depth_flush = depth_min

    shapes = []
    blocking_type = conn.get("blocking", "C1")

    # Interior wall's end stud is bt (1.5") wide along the target wall's run
    iwall_half = bt / 2  # half of interior wall end stud thickness
    contact_along = cx if is_h else cy  # contact position along the run axis

    if blocking_type == "C2":
        # In the open: 2 continuous studs flanking the interior wall's end stud
        # End stud centered at contact, studs on each side flush against it
        # Safety: skip any stud that would collide with existing framing
        studs_in_c2 = stud_positions(width_in, st_in, spacing_in)
        stud_ctrs_c2 = stud_centers_assembled(d, tx, ty, width_mm, studs_in_c2, st_in)
        st_half_mm = st_in * IN_TO_MM / 2

        right_start = contact_along + iwall_half
        left_start = contact_along - iwall_half - bd

        def overlaps_stud(block_min, block_max):
            for sc in stud_ctrs_c2:
                if block_min < sc + st_half_mm and block_max > sc - st_half_mm:
                    return True
            return False

        right_ok = not overlaps_stud(right_start, right_start + bd)
        left_ok = not overlaps_stud(left_start, left_start + bd)

        if is_h:
            if right_ok:
                s1 = Part.makeBox(bd, bt, stud_h)
                s1.translate(App.Vector(right_start, depth_flush, plate_t))
                shapes.append(s1)
            if left_ok:
                s2 = Part.makeBox(bd, bt, stud_h)
                s2.translate(App.Vector(left_start, depth_flush, plate_t))
                shapes.append(s2)
        else:
            if right_ok:
                s1 = Part.makeBox(bt, bd, stud_h)
                s1.translate(App.Vector(depth_flush, right_start, plate_t))
                shapes.append(s1)
            if left_ok:
                s2 = Part.makeBox(bt, bd, stud_h)
                s2.translate(App.Vector(depth_flush, left_start, plate_t))
                shapes.append(s2)

    elif blocking_type == "C1":
        # Near an existing stud: 1 continuous stud flush against the existing stud
        # The existing stud's 1.5" skinny side + new stud's 3.5" = 5" nailing surface
        studs_in = stud_positions(width_in, st_in, spacing_in)
        stud_ctrs = stud_centers_assembled(d, tx, ty, width_mm, studs_in, st_in)

        # Find nearest existing stud center
        nearest_ctr = min(stud_ctrs, key=lambda sc: abs(sc - contact_along))
        st_half_mm = st_in * IN_TO_MM / 2  # half of existing stud thickness

        # Place blocking stud flush against the existing stud, on the interior wall side
        if contact_along >= nearest_ctr:
            # Interior wall is to the right/below the existing stud
            blocking_start = nearest_ctr + st_half_mm  # right edge of existing stud
        else:
            # Interior wall is to the left/above the existing stud
            blocking_start = nearest_ctr - st_half_mm - bd  # new stud ends at left edge

        if is_h:
            s = Part.makeBox(bd, bt, stud_h)
            s.translate(App.Vector(blocking_start, depth_flush, plate_t))
        else:
            s = Part.makeBox(bt, bd, stud_h)
            s.translate(App.Vector(depth_flush, blocking_start, plate_t))
        shapes.append(s)

    elif blocking_type == "T":
        # Horizontal blocks between nearest studs
        canonical_x = get_canonical_contact(d, width_mm, cx + min_x, cy + min_y,
                                            target["x_mm"], target["y_mm"])
        canonical_x_in = canonical_x / IN_TO_MM

        studs = stud_positions(width_in, st_in, spacing_in)

        # Find the two studs bracketing the contact
        left_stud_end_in = 0
        right_stud_start_in = width_in - st_in
        for s_pos in studs:
            if s_pos + st_in <= canonical_x_in:
                left_stud_end_in = s_pos + st_in
            if s_pos >= canonical_x_in:
                right_stud_start_in = s_pos
                break

        block_len_in = right_stud_start_in - left_stud_end_in
        if block_len_in <= 0:
            return []

        block_len_mm = block_len_in * IN_TO_MM
        left_mm = left_stud_end_in * IN_TO_MM

        # Place 4 evenly spaced horizontal blocks
        num_blocks = 4
        block_spacing = stud_h / (num_blocks + 1)

        for i in range(num_blocks):
            z = plate_t + block_spacing * (i + 1) - bd / 2

            if is_h:
                # Map canonical left_mm back to assembled X
                if d == "north":
                    bx = tx + left_mm
                else:  # south — reversed
                    bx = tx + width_mm - (left_mm + block_len_mm)

                # 3.5" face (bd) along Z, facing interior wall from Y
                b = Part.makeBox(block_len_mm, bt, bd)
                b.translate(App.Vector(bx, depth_flush, z))
            else:
                # Map canonical left_mm to assembled Y
                if d == "east":
                    by = ty + left_mm
                else:  # west — reversed
                    by = ty + width_mm - (left_mm + block_len_mm)

                # 3.5" face (bd) along Z, facing interior wall from X
                b = Part.makeBox(bt, block_len_mm, bd)
                b.translate(App.Vector(depth_flush, by, z))

            shapes.append(b)

    return shapes


# Fixed isometric orientation quat (view dir (-1,-1,-1), up +Z) — matches
# web/js/fcstd.js guiDocumentXml so both exporters open the same upright view.
ISO_ORIENT = "0.1870 0.4516 0.8722  2.4476"


def _camera_settings(bb):
    cx = (bb.XMin + bb.XMax) / 2.0
    cy = (bb.YMin + bb.YMax) / 2.0
    cz = bb.ZMax / 2.0
    m = max(bb.XMax - bb.XMin, bb.ZMax, 1000.0)
    k = m * 1.5
    focal = k * math.sqrt(3)
    lines = [
        "#Inventor V2.1 ascii", "", "",
        "OrthographicCamera {",
        "  viewportMapping ADJUST_CAMERA",
        "  position %g %g %g" % (cx + k, cy + k, cz + k),
        "  orientation " + ISO_ORIENT,
        "  nearDistance 1",
        "  farDistance %g" % (focal * 3),
        "  aspectRatio 1",
        "  focalDistance %g" % focal,
        "  height %g" % (m * 1.5),
        "}", ""]
    return "&#10;".join(lines)


def write_gui_document(out_abs, doc):
    """Inject GuiDocument.xml (per-object Visibility + saved camera) into the
    saved .FCStd. freecadcmd has no GUI so saveAs writes no GuiDocument.xml,
    which makes FreeCAD open the objects hidden with a non-deterministic camera.
    Mirrors web/js/fcstd.js guiDocumentXml."""
    objs = [o for o in doc.Objects if hasattr(o, "Shape") and o.Shape.Volume != 0]
    if not objs:
        return
    bb = objs[0].Shape.BoundBox
    for o in objs[1:]:
        bb = bb.united(o.Shape.BoundBox)
    vps = "".join(
        '        <ViewProvider name="%s" expanded="0">\n'
        '            <Properties Count="1" TransientCount="0">\n'
        '                <Property name="Visibility" type="App::PropertyBool"><Bool value="true"/></Property>\n'
        '            </Properties>\n'
        '        </ViewProvider>\n' % o.Name for o in objs)
    xml = (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<!DOCTYPE GuiDocument>\n"
        '<Document SchemaVersion="1">\n'
        '    <ViewProviderData Count="%d">\n%s    </ViewProviderData>\n'
        '    <Camera settings="%s"/>\n'
        "</Document>\n" % (len(objs), vps, _camera_settings(bb)))
    with zipfile.ZipFile(out_abs, "a", zipfile.ZIP_DEFLATED) as z:
        if "GuiDocument.xml" not in z.namelist():
            z.writestr("GuiDocument.xml", xml)


def main():
    if not _FREECAD:
        print("Error: FreeCAD not available. Run via freecadcmd.")
        sys.exit(1)

    if len(sys.argv) != 2:
        print("Usage: compile_from_json.py <layout.json>")
        sys.exit(1)

    json_path = sys.argv[1]
    with open(json_path) as f:
        data = json.load(f)

    modules = data.get("entities") or data.get("modules") or []
    if not modules:
        print("Error: no entities/modules in layout JSON")
        sys.exit(1)

    # Load YAML specs for blocking calculations
    yaml_specs = load_yaml_specs()

    # Build lookup by ID
    modules_by_id = {m["id"]: m for m in modules}

    # Normalize positions so minimum is at origin
    min_x = min(m["x_mm"] for m in modules)
    min_y = min(m["y_mm"] for m in modules)

    # L2 base Z = tallest L1 wall top (matches fcstd.js / render3d.js — no joist gap).
    # Do NOT read levels[].z_mm; that would diverge from the browser exporter.
    l2_base_z = 0.0
    for m in modules:
        if m.get("level", "L1") == "L1":
            s = prepare_shape(m["module"], DIRECTION_TO_ROT[m["direction"]])
            l2_base_z = max(l2_base_z, s.BoundBox.ZMax)

    def z_for(mod):
        return l2_base_z if mod.get("level", "L1") == "L2" else 0.0

    doc = App.newDocument("HouseAssembly")

    blocking_idx = 0

    for i, m in enumerate(modules):
        rot = DIRECTION_TO_ROT[m["direction"]]
        shape = prepare_shape(m["module"], rot)

        x = m["x_mm"] - min_x
        y = m["y_mm"] - min_y
        shape.translate(App.Vector(x, y, z_for(m)))
        shape = mirror_y(shape)  # screen-down -> Y-up world (match preview/export)

        name = f"wall_{i:02d}_{m['id']}"
        obj = doc.addObject("Part::Feature", name)
        obj.Shape = shape
        if obj.ViewObject:
            obj.ViewObject.Visibility = True

        print(f"Placed {name} ({m['direction']}) at ({x:.1f}, {y:.1f})")

        # Process blocking connections
        z_off = z_for(m)
        for conn in m.get("connections", []):
            blocking_shapes = create_blocking(conn, m, modules_by_id,
                                              yaml_specs, min_x, min_y)
            for bs in blocking_shapes:
                if z_off:
                    bs.translate(App.Vector(0, 0, z_off))
                bs = mirror_y(bs)  # same global flip as the walls
                bname = f"blocking_{blocking_idx:02d}_{conn.get('blocking', 'C')}"
                bobj = doc.addObject("Part::Feature", bname)
                bobj.Shape = bs
                if bobj.ViewObject:
                    bobj.ViewObject.Visibility = True
                blocking_idx += 1

            if blocking_shapes:
                print(f"  Added {len(blocking_shapes)} blocking pieces "
                      f"({conn.get('blocking', 'C')}) at target {conn['target_id']}")

    doc.recompute()
    out = os.path.splitext(json_path)[0] + ".FCStd"
    out_abs = os.path.abspath(out)
    doc.saveAs(out_abs)
    write_gui_document(out_abs, doc)
    print(f"\nSaved {out_abs} ({len(modules)} walls, {blocking_idx} blocking pieces)")


if __name__ == '__main__':
    main()
