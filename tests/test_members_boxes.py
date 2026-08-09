"""
Unit tests for seh_lib.wall_builder.boxes_from_members — the Python-side half
of the single-enumerator refactor (design_decisions.md Decision 6).

These are FreeCAD-free: boxes_from_members() is pure Python that turns a
web/assets/lib/members.json member list into (name, sx,sy,sz, px,py,pz) box
specs. This is the "does the Python consumer faithfully render the single
source" check called for by the refactor — it does NOT re-derive framing
positions, it only checks the JSON -> box-spec transcription (naming,
depth/py placement, sheathing skip). The framing *math* itself is asserted
against acceptance numbers in tests/enumerate_parity.mjs (JS side); these
numbers are cross-checked here against the exact same members.json the
Python geometry builder reads, so a drift between the two would show up as a
mismatch against the literal values transcribed below.

Run: python -m pytest tests/test_members_boxes.py -v
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from seh_lib.wall_builder import MEMBERS_PATH, boxes_from_members, members_for

IN_TO_MM = 25.4


def test_members_json_exists_and_has_all_modules():
    assert os.path.exists(MEMBERS_PATH), (
        f"{MEMBERS_PATH} missing — run `node scripts/export_members.mjs`"
    )
    with open(MEMBERS_PATH) as f:
        doc = json.load(f)
    # every library/modules/<id> entry must have a members.json entry
    lib_root = os.path.join(os.path.dirname(MEMBERS_PATH), "..", "..", "..", "library", "modules")
    lib_root = os.path.normpath(lib_root)
    ids = sorted(os.listdir(lib_root))
    for iid in ids:
        assert iid in doc, f"library/modules/{iid} has no members.json entry"


def test_members_for_unknown_module_raises_clear_error():
    try:
        members_for("not_a_real_module")
        assert False, "expected KeyError"
    except KeyError as e:
        assert "not_a_real_module" in str(e)
        assert "export_members.mjs" in str(e)


def test_boxes_from_members_skips_sheathing():
    members = members_for("wall_4x8_2x6_16oc")
    assert any(m["role"] == "sheathing" for m in members)
    boxes = boxes_from_members(members, depth_mm=139.7)
    assert not any(name == "osb_panel" for name, *_ in boxes)
    assert all(sy == 139.7 for _, sx, sy, sz, px, py, pz in boxes)
    assert all(py == 0.0 for _, sx, sy, sz, px, py, pz in boxes)


def test_plain_wall_16oc_four_studs():
    # Same acceptance number as tests/enumerate_parity.mjs's JS-side check:
    # wall_4x8_2x6_16oc has exactly 4 studs at 0/16/32/46.5 in.
    members = members_for("wall_4x8_2x6_16oc")
    boxes = boxes_from_members(members, depth_mm=139.7)
    stud_names = sorted(name for name, *_ in boxes if name.startswith("stud_"))
    assert stud_names == ["stud_1", "stud_2", "stud_3", "stud_4"]
    xs = sorted(px for name, sx, sy, sz, px, py, pz in boxes if name.startswith("stud_"))
    expected = [0, 16 * IN_TO_MM, 32 * IN_TO_MM, 46.5 * IN_TO_MM]
    for got, want in zip(xs, expected):
        assert abs(got - want) < 1e-3, (got, want)


def test_window_acceptance_spec_matches_js_side():
    # Literal values transcribed from tests/enumerate_parity.mjs's window
    # acceptance block — cross-checked here against the same members.json
    # the Python geometry builder consumes, via boxes_from_members().
    members = members_for("window_4x8_2x6_36x48")
    boxes = {name: (sx, sy, sz, px, py, pz) for name, sx, sy, sz, px, py, pz in boxes_from_members(members, depth_mm=139.7)}

    assert set(n for n in boxes if n.startswith("king_stud")) == {"king_stud_left", "king_stud_right"}
    assert abs(boxes["king_stud_left"][2] - 2362.2) < 1e-3  # sz = height

    assert set(n for n in boxes if n.startswith("jack_stud")) == {"jack_stud_left", "jack_stud_right"}
    assert abs(boxes["jack_stud_left"][2] - 1790.7) < 1e-3

    assert abs(boxes["header"][0] - 990.6) < 1e-3  # sx = width

    assert set(n for n in boxes if n.startswith("top_cripple_")) == {"top_cripple_1", "top_cripple_2"}
    assert abs(boxes["top_cripple_1"][2] - 387.35) < 1e-2

    assert abs(boxes["sill"][0] - 914.4) < 1e-3

    assert set(n for n in boxes if n.startswith("lower_cripple_")) == {"lower_cripple_1", "lower_cripple_2"}
    assert abs(boxes["lower_cripple_1"][2] - 533.4) < 1e-3

    assert "subheader" in boxes
    assert not any(n.startswith("blocking_") for n in boxes)  # 21" zone < 24" spacing


def test_door_bottom_plate_split_around_opening():
    # A door (sill_in=0) has NO continuous bottom plate — it's cut in two
    # around the rough opening, unlike a window's single full-width plate.
    members = members_for("door_4x8_2x6_38x83")
    boxes = {name: (sx, sy, sz, px, py, pz) for name, sx, sy, sz, px, py, pz in boxes_from_members(members, depth_mm=139.7)}
    assert set(n for n in boxes if n.startswith("bottom_plate")) == {"bottom_plate_left", "bottom_plate_right"}
    assert "sill" not in boxes


def test_deterministic():
    a = boxes_from_members(members_for("window_4x8_2x6_36x48"), depth_mm=139.7)
    b = boxes_from_members(members_for("window_4x8_2x6_36x48"), depth_mm=139.7)
    assert a == b
