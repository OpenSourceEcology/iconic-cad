"""Reusable geometry builders for SEH wall library entries."""

IN_TO_MM = 25.4
PORT_SIZE = 1.0  # mm, tiny marker cube


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


def cripple_x_positions(width_in, st_in, spacing_in, lo_in, hi_in):
    """OC-grid stud X positions (inches) that fall inside the opening."""
    xs = [
        x
        for x in stud_positions(width_in, st_in, spacing_in)
        if lo_in < x and x + st_in < hi_in
    ]
    if not xs:
        xs = [(lo_in + hi_in) / 2.0 - st_in / 2.0]
    return xs


def build_wall_document(instance):
    import FreeCAD

    doc = FreeCAD.newDocument(instance["id"])
    build_instance_into_doc(instance, doc, compound=True)
    doc.recompute()
    return doc


def build_wall(instance):
    return build_wall_document(instance)


def build_aperture_panel(instance):
    return build_wall_document(instance)


def build_instance_into_doc(instance, doc, compound=False):
    if "aperture" in instance["parameters"]:
        return _build_aperture_into_doc(instance, doc, compound=compound)
    return _build_plain_wall_into_doc(instance, doc, compound=compound)


def build_framed_wall_panel(instance, doc, compound=False):
    return _build_plain_wall_into_doc(instance, doc, compound=compound)


def build_interior_wall_panel(instance, doc, compound=False):
    return _build_plain_wall_into_doc(instance, doc, compound=compound)


def build_aperture_wall_panel(instance, doc, compound=False):
    return _build_aperture_into_doc(instance, doc, compound=compound)


def instance_from_schema(schema):
    return {
        "id": schema["document_name"],
        "family": schema["family"],
        "parameters": _pairs_to_dict(schema["parameters"]),
    }


def _pairs_to_dict(value):
    if isinstance(value, tuple):
        return {key: _pairs_to_dict(child) for key, child in value}
    return value


def _add_shape(doc, name, shape):
    obj = doc.addObject("Part::Feature", name)
    obj.Label = name
    obj.Shape = shape
    return obj


def _box_shape(sx, sy, sz, px=0, py=0, pz=0):
    import FreeCAD
    import Part

    shape = Part.makeBox(sx, sy, sz)
    shape.translate(FreeCAD.Vector(px, py, pz))
    return shape


def _emit_shapes(doc, named_shapes, compound):
    import Part

    if compound:
        wall = Part.makeCompound([shape for _, shape in named_shapes])
        _add_shape(doc, "wall_module", wall)
        return [doc.Objects[-1]]

    objects = []
    for name, shape in named_shapes:
        objects.append(_add_shape(doc, name, shape))
    return objects


def _add_ports(doc, W, osb):
    half = PORT_SIZE / 2.0
    port_y = -osb if osb > 0 else 0
    left = _box_shape(PORT_SIZE, PORT_SIZE, PORT_SIZE, -half, port_y - half, -half)
    right = _box_shape(PORT_SIZE, PORT_SIZE, PORT_SIZE, W - half, port_y - half, -half)
    return [_add_shape(doc, "port_left", left), _add_shape(doc, "port_right", right)]


def _build_plain_wall_into_doc(instance, doc, compound):
    p = instance["parameters"]

    width_in = ft_in(p["nominal_width_ft"])
    height_in = ft_in(p["nominal_height_ft"])
    stud_thick_in, stud_depth_in = nominal_to_actual(p["stud_lumber_nominal"])
    spacing_in = p["stud_spacing_oc_in"]
    osb_thick_in = p["osb_thickness_in"]

    W = in_mm(width_in)
    H = in_mm(height_in)
    st = in_mm(stud_thick_in)
    sd = in_mm(stud_depth_in)
    osb = in_mm(osb_thick_in)
    plate_t = st
    stud_len = H - 2.0 * plate_t

    shapes = [
        ("bottom_plate", _box_shape(W, sd, plate_t)),
        ("top_plate", _box_shape(W, sd, plate_t, 0, 0, H - plate_t)),
    ]

    for index, x_in in enumerate(stud_positions(width_in, stud_thick_in, spacing_in), 1):
        shapes.append(
            (
                f"stud_{index}",
                _box_shape(st, sd, stud_len, in_mm(x_in), 0, plate_t),
            )
        )

    if osb_thick_in > 0:
        shapes.append(("osb_panel", _box_shape(W, osb, H, 0, -osb, 0)))

    objects = _emit_shapes(doc, shapes, compound=compound)
    objects.extend(_add_ports(doc, W, osb))
    doc.recompute()
    return objects


def _build_aperture_into_doc(instance, doc, compound):
    import FreeCAD
    import Part

    p = instance["parameters"]
    a = p["aperture"]

    width_in = ft_in(p["nominal_width_ft"])
    height_in = ft_in(p["nominal_height_ft"])
    st_in, sd_in = nominal_to_actual(p["stud_lumber_nominal"])
    spacing_in = p["stud_spacing_oc_in"]
    osb_thick_in = p["osb_thickness_in"]

    ro_w_in = a["rough_opening_width_in"]
    ro_h_in = a["rough_opening_height_in"]
    sill_top_in = a.get("sill_height_in", 0) or 0
    is_window = a["type"] == "window" and sill_top_in > 0
    _hdr_th_in, hdr_dep_in = nominal_to_actual(a.get("header_lumber_nominal", "2x8"))

    W = in_mm(width_in)
    H = in_mm(height_in)
    st = in_mm(st_in)
    sd = in_mm(sd_in)
    osb = in_mm(osb_thick_in)
    plate_t = st

    ro_w = in_mm(ro_w_in)
    ro_x0 = (W - ro_w) / 2.0
    ro_x1 = ro_x0 + ro_w
    ro_z_bottom = in_mm(sill_top_in)
    ro_z_top = ro_z_bottom + in_mm(ro_h_in)
    hdr_h = in_mm(hdr_dep_in)
    z_stud_top = H - plate_t
    z_stud_bot = plate_t

    shapes = []

    def box(name, sx, sy, sz, px, py, pz):
        shapes.append((name, _box_shape(sx, sy, sz, px, py, pz)))

    if is_window:
        box("bottom_plate", W, sd, plate_t, 0, 0, 0)
    else:
        box("bottom_plate_left", ro_x0, sd, plate_t, 0, 0, 0)
        box("bottom_plate_right", W - ro_x1, sd, plate_t, ro_x1, 0, 0)

    box("top_plate", W, sd, plate_t, 0, 0, z_stud_top)
    box("king_stud_left", st, sd, z_stud_top - z_stud_bot, 0, 0, z_stud_bot)
    box("king_stud_right", st, sd, z_stud_top - z_stud_bot, W - st, 0, z_stud_bot)

    jack_h = ro_z_top - z_stud_bot
    box("jack_stud_left", st, sd, jack_h, ro_x0 - st, 0, z_stud_bot)
    box("jack_stud_right", st, sd, jack_h, ro_x1, 0, z_stud_bot)
    box("header", ro_w + 2 * st, sd, hdr_h, ro_x0 - st, 0, ro_z_top)

    z_above = ro_z_top + hdr_h
    cripple_xs = cripple_x_positions(
        width_in,
        st_in,
        spacing_in,
        ro_w_in and (width_in - ro_w_in) / 2.0,
        (width_in + ro_w_in) / 2.0,
    )
    if z_stud_top - z_above > 1.0:
        for index, x_in in enumerate(cripple_xs, 1):
            box(
                f"top_cripple_{index}",
                st,
                sd,
                z_stud_top - z_above,
                in_mm(x_in),
                0,
                z_above,
            )

    if is_window:
        sill_t = st
        z_sill_bot = ro_z_bottom - sill_t
        box("sill", ro_w, sd, sill_t, ro_x0, 0, z_sill_bot)
        z_cripple_top = z_sill_bot
        z_cripple_bot = z_stud_bot
        if z_cripple_top - z_cripple_bot > 1.0:
            for index, x_in in enumerate(cripple_xs, 1):
                box(
                    f"lower_cripple_{index}",
                    st,
                    sd,
                    z_cripple_top - z_cripple_bot,
                    in_mm(x_in),
                    0,
                    z_cripple_bot,
                )
        if z_cripple_top - z_cripple_bot > sill_t + 1.0:
            box("subheader", ro_w, sd, sill_t, ro_x0, 0, z_cripple_bot)
        block_spacing = in_mm(24.0)
        z_blk = z_cripple_bot + block_spacing
        block_index = 1
        while z_blk + sill_t < z_cripple_top - 1.0:
            box(f"blocking_{block_index}", ro_w, sd, sill_t, ro_x0, 0, z_blk)
            block_index += 1
            z_blk += block_spacing

    if osb_thick_in > 0:
        osb_panel = Part.makeBox(W, osb, H)
        osb_panel.translate(FreeCAD.Vector(0, -osb, 0))
        hole = Part.makeBox(ro_w, osb + 2, ro_z_top - ro_z_bottom)
        hole.translate(FreeCAD.Vector(ro_x0, -osb - 1, ro_z_bottom))
        shapes.append(("osb_panel", osb_panel.cut(hole)))

    objects = _emit_shapes(doc, shapes, compound=compound)
    objects.extend(_add_ports(doc, W, osb))
    doc.recompute()
    return objects
