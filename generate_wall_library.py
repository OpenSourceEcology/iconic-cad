#!/usr/bin/env python3
"""
Wall module generator with port markers for port-based assembly.

Each wall module is built in a canonical "south-facing" pose:
  - Width along +X, depth (studs) along +Y, height along +Z
  - OSB sheathing on the south face (Y = -osb_thickness to 0)
  - Stud frame from Y=0 to Y=stud_depth
  - Bottom plate at Z=0, top plate at Z = height - plate_thickness

Port markers are small cubes placed at ground level (Z=0) on the
stud-frame face (Y=0) at each end of the wall:
  - port_left:  center at X=0,           Y=0, Z=0
  - port_right: center at X=wall_width,  Y=0, Z=0

The compiler reads these port positions to snap walls together.
Ports sit at Y=0 (inner stud face), so when two walls connect
in a straight run, their ports coincide exactly. Corner inset
offsets are computed by the compiler from wall thickness.

Usage (must run via freecadcmd):
    freecadcmd -c "import sys; sys.argv=['generate_wall_library.py','wall_instances.yaml']; exec(open('generate_wall_library.py').read())"
"""

from pathlib import Path
import sys
import yaml
import FreeCAD
import Part

OUTPUT_DIR = Path("cad_library")
IN_TO_MM = 25.4
PORT_SIZE = 1.0  # mm, tiny marker cube


def load_yaml(path):
    with open(path, "r") as f:
        return yaml.safe_load(f)


def nominal_to_actual(nominal):
    """Return (thickness_in, depth_in) for nominal lumber size."""
    table = {
        "2x2": (1.5, 1.5),
        "2x3": (1.5, 2.5),
        "2x4": (1.5, 3.5),
        "2x6": (1.5, 5.5),
        "2x8": (1.5, 7.25),
        "2x10": (1.5, 9.25),
        "2x12": (1.5, 11.25),
    }
    return table[nominal]


def in_mm(v):
    return v * IN_TO_MM


def ft_in(v):
    return v * 12.0


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


def build_wall(instance):
    """Build a wall module with port markers. Returns FreeCAD Document."""
    iid = instance["id"]
    p = instance["parameters"]

    width_in = ft_in(p["nominal_width_ft"])
    height_in = ft_in(p["nominal_height_ft"])
    stud_thick_in, stud_depth_in = nominal_to_actual(p["stud_lumber_nominal"])
    spacing_in = p["stud_spacing_oc_in"]
    osb_thick_in = p["osb_thickness_in"]

    # Convert everything to mm
    W = in_mm(width_in)
    H = in_mm(height_in)
    st = in_mm(stud_thick_in)
    sd = in_mm(stud_depth_in)
    osb = in_mm(osb_thick_in)
    plate_t = st  # plate thickness = stud thickness

    stud_len = H - 2.0 * plate_t

    shapes = []

    # --- Bottom plate: X=0..W, Y=0..sd, Z=0..plate_t ---
    shapes.append(Part.makeBox(W, sd, plate_t))

    # --- Top plate: same footprint, at top ---
    top = Part.makeBox(W, sd, plate_t)
    top.translate(FreeCAD.Vector(0, 0, H - plate_t))
    shapes.append(top)

    # --- Studs ---
    for x_in in stud_positions(width_in, stud_thick_in, spacing_in):
        s = Part.makeBox(st, sd, stud_len)
        s.translate(FreeCAD.Vector(in_mm(x_in), 0, plate_t))
        shapes.append(s)

    # --- OSB sheathing: south face, Y = -osb..0 (skip for interior walls) ---
    if osb_thick_in > 0:
        osb_panel = Part.makeBox(W, osb, H)
        osb_panel.translate(FreeCAD.Vector(0, -osb, 0))
        shapes.append(osb_panel)

    # --- Compound ---
    wall = Part.makeCompound(shapes)

    doc = FreeCAD.newDocument(iid)
    obj = doc.addObject("Part::Feature", "wall_module")
    obj.Shape = wall

    # --- Port markers ---
    # Ports at the outer corners (OSB face, Y = -osb) so that when
    # two walls snap together at a corner, they meet at the building edge.
    half = PORT_SIZE / 2.0
    port_y = -osb if osb > 0 else 0  # outer face (OSB surface), or stud face for interior walls

    # port_left: left (X=0) end, outer face, ground level
    pl = Part.makeBox(PORT_SIZE, PORT_SIZE, PORT_SIZE)
    pl.translate(FreeCAD.Vector(-half, port_y - half, -half))
    pl_obj = doc.addObject("Part::Feature", "port_left")
    pl_obj.Shape = pl

    # port_right: right (X=W) end, outer face, ground level
    pr = Part.makeBox(PORT_SIZE, PORT_SIZE, PORT_SIZE)
    pr.translate(FreeCAD.Vector(W - half, port_y - half, -half))
    pr_obj = doc.addObject("Part::Feature", "port_right")
    pr_obj.Shape = pr

    doc.recompute()
    return doc


def add_ports(doc, W, osb):
    """Add port_left / port_right markers, identical convention to build_wall."""
    half = PORT_SIZE / 2.0
    port_y = -osb if osb > 0 else 0
    pl = Part.makeBox(PORT_SIZE, PORT_SIZE, PORT_SIZE)
    pl.translate(FreeCAD.Vector(-half, port_y - half, -half))
    doc.addObject("Part::Feature", "port_left").Shape = pl
    pr = Part.makeBox(PORT_SIZE, PORT_SIZE, PORT_SIZE)
    pr.translate(FreeCAD.Vector(W - half, port_y - half, -half))
    doc.addObject("Part::Feature", "port_right").Shape = pr


def cripple_x_positions(width_in, st_in, spacing_in, lo_in, hi_in):
    """OC-grid stud X positions (inches) that fall inside the opening (lo, hi).

    Cripples restore standard stud spacing above the header (and below the
    sill) for sheathing/drywall attachment. Fall back to one centered cripple
    if the OC grid puts none inside the opening.
    """
    xs = [x for x in stud_positions(width_in, st_in, spacing_in)
          if lo_in < x and x + st_in < hi_in]
    if not xs:
        xs = [(lo_in + hi_in) / 2.0 - st_in / 2.0]
    return xs


def build_aperture_panel(instance):
    """Build a window/door aperture wall panel with framed opening + ports.

    Built in the same canonical south-facing pose as build_wall: width along
    +X, depth (studs) along +Y, height along +Z, OSB on the south face.

    Conventional platform framing (advanced/OVE framing intentionally avoided):
    king studs at the panel edges, jack (trimmer) studs flanking the opening,
    a built-up header directly above the rough opening, top cripples from the
    header to the top plate, and for windows a sill plus lower cripples below
    it. See docs/aperture_framing_reference.md for the measured source dims.
    """
    iid = instance["id"]
    p = instance["parameters"]
    a = p["aperture"]

    width_in = ft_in(p["nominal_width_ft"])
    height_in = ft_in(p["nominal_height_ft"])
    st_in, sd_in = nominal_to_actual(p["stud_lumber_nominal"])
    spacing_in = p["stud_spacing_oc_in"]
    osb_thick_in = p["osb_thickness_in"]

    # Opening parameters
    ro_w_in = a["rough_opening_width_in"]
    ro_h_in = a["rough_opening_height_in"]
    sill_top_in = a.get("sill_height_in", 0) or 0  # 0 for a door (to floor)
    is_window = a["type"] == "window" and sill_top_in > 0
    hdr_th_in, hdr_dep_in = nominal_to_actual(a.get("header_lumber_nominal", "2x8"))

    # mm conversions
    W = in_mm(width_in)
    H = in_mm(height_in)
    st = in_mm(st_in)
    sd = in_mm(sd_in)
    osb = in_mm(osb_thick_in)
    plate_t = st

    ro_w = in_mm(ro_w_in)
    ro_x0 = (W - ro_w) / 2.0          # opening centered in the panel
    ro_x1 = ro_x0 + ro_w
    ro_z_bottom = in_mm(sill_top_in)  # top of sill (0 = floor, for doors)
    ro_z_top = ro_z_bottom + in_mm(ro_h_in)
    hdr_h = in_mm(hdr_dep_in)         # header height = lumber nominal depth (on edge)
    z_stud_top = H - plate_t          # underside of (single) top plate
    z_stud_bot = plate_t              # top of bottom plate

    shapes = []

    def box(sx, sy, sz, px, py, pz):
        b = Part.makeBox(sx, sy, sz)
        b.translate(FreeCAD.Vector(px, py, pz))
        shapes.append(b)

    # --- Bottom plate (cut out across a door opening) ---
    if is_window:
        box(W, sd, plate_t, 0, 0, 0)
    else:
        box(ro_x0, sd, plate_t, 0, 0, 0)            # left stub
        box(W - ro_x1, sd, plate_t, ro_x1, 0, 0)    # right stub

    # --- Single top plate (matches the wall library's single-plate convention;
    #     the whole library moves to a double top plate together later) ---
    box(W, sd, plate_t, 0, 0, z_stud_top)

    # --- King studs at the panel edges (full height) ---
    box(st, sd, z_stud_top - z_stud_bot, 0, 0, z_stud_bot)
    box(st, sd, z_stud_top - z_stud_bot, W - st, 0, z_stud_bot)

    # --- Jack (trimmer) studs flanking the opening, carrying the header ---
    jack_h = ro_z_top - z_stud_bot
    box(st, sd, jack_h, ro_x0 - st, 0, z_stud_bot)
    box(st, sd, jack_h, ro_x1, 0, z_stud_bot)

    # --- Header directly above the rough opening, bearing on the jacks ---
    box(ro_w + 2 * st, sd, hdr_h, ro_x0 - st, 0, ro_z_top)

    # --- Top cripples: header -> top plate, on the OC grid ---
    z_above = ro_z_top + hdr_h
    cripple_xs = cripple_x_positions(width_in, st_in, spacing_in,
                                     ro_w_in and (width_in - ro_w_in) / 2.0,
                                     (width_in + ro_w_in) / 2.0)
    if z_stud_top - z_above > 1.0:
        for x_in in cripple_xs:
            box(st, sd, z_stud_top - z_above, in_mm(x_in), 0, z_above)

    # --- Window only: sill + subheader + lower cripples + blocking ---
    # Per OSE spec (Marcin's window checklist):
    #   - Sill (rough sill) at the bottom of the rough opening
    #   - Subheader: horizontal nailer at the sole-plate end of the lower cripple zone,
    #     provides required fastening surface for sheathing/trim
    #   - Lower cripples (vertical): sole plate → sill
    #   - Horizontal blocking every 24" from subheader up through the lower cripple zone
    if is_window:
        sill_t = st  # sill/subheader are flat 2x members (1.5" tall)
        z_sill_bot = ro_z_bottom - sill_t    # underside of sill
        # Sill (rough sill at bottom of RO)
        box(ro_w, sd, sill_t, ro_x0, 0, z_sill_bot)
        z_cripple_top = z_sill_bot
        z_cripple_bot = z_stud_bot
        # Lower vertical cripples
        if z_cripple_top - z_cripple_bot > 1.0:
            for x_in in cripple_xs:
                box(st, sd, z_cripple_top - z_cripple_bot, in_mm(x_in), 0, z_cripple_bot)
        # Subheader: horizontal nailer just above the sole plate
        if z_cripple_top - z_cripple_bot > sill_t + 1.0:
            box(ro_w, sd, sill_t, ro_x0, 0, z_cripple_bot)
        # Horizontal blocking every 24" from subheader upward through lower cripple zone
        block_spacing = in_mm(24.0)
        z_blk = z_cripple_bot + block_spacing
        while z_blk + sill_t < z_cripple_top - 1.0:
            box(ro_w, sd, sill_t, ro_x0, 0, z_blk)
            z_blk += block_spacing

    # --- OSB sheathing over the panel face, with the rough opening cut out ---
    if osb_thick_in > 0:
        osb_panel = Part.makeBox(W, osb, H)
        osb_panel.translate(FreeCAD.Vector(0, -osb, 0))
        hole = Part.makeBox(ro_w, osb + 2, ro_z_top - ro_z_bottom)
        hole.translate(FreeCAD.Vector(ro_x0, -osb - 1, ro_z_bottom))
        osb_panel = osb_panel.cut(hole)
        shapes.append(osb_panel)

    panel = Part.makeCompound(shapes)
    doc = FreeCAD.newDocument(iid)
    doc.addObject("Part::Feature", "wall_module").Shape = panel
    add_ports(doc, W, osb)
    doc.recompute()
    return doc


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

        # Print port positions for verification
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
