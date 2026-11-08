"""IFC export dispatches on entity kind and takes heights from authored specs.

Runs the real exporter with real ifcopenshell and reads the written file back.
Covers audit finding SOL-07 (docs/audits/sol-audit-2026-09-02/02-findings.md).
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

ifcopenshell = pytest.importorskip("ifcopenshell")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import export_ifc  # noqa: E402

FT = 12 * 25.4

MIXED = {
    "version": 2,
    "units": "mm",
    "levels": [{"id": "L1", "name": "Level 1", "z_mm": 0}],
    "entities": [
        {"id": "w1", "kind": "wall", "module": "wall_4x8_2x6_16oc", "direction": "north",
         "x_mm": 0, "y_mm": 0, "level": "L1", "width_mm": 1219.2, "depth_mm": 150.8125},
        {"id": "i1", "kind": "iwall", "module": "iwall_4x8_2x4_16oc", "direction": "east",
         "x_mm": 382.0, "y_mm": 150.8125, "level": "L1", "width_mm": 1219.2, "depth_mm": 88.9},
        {"id": "win1", "kind": "wall", "module": "window_4x10_2x6_36x48", "direction": "south",
         "x_mm": 1219.2, "y_mm": 0, "level": "L1", "width_mm": 1219.2, "depth_mm": 150.8125},
        {"id": "foundation_1", "kind": "foundation", "level": "L1",
         "params": {"type": "slab"}},
    ],
}


def export(tmp_path, layout):
    src = tmp_path / "layout.json"
    src.write_text(json.dumps(layout))
    out = tmp_path / "out.ifc"
    result = export_ifc.main(str(src), str(out))
    return result, out


def wall_dims(model):
    """{name: (length, thickness, height)} in the file's unit (mm)."""
    dims = {}
    for wall in model.by_type("IfcWall"):
        solids = [item for rep in wall.Representation.Representations
                  for item in rep.Items if item.is_a("IfcExtrudedAreaSolid")]
        assert len(solids) == 1
        points = solids[0].SweptArea.OuterCurve.Points.CoordList
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        dims[wall.Name] = (max(xs) - min(xs), max(ys) - min(ys), solids[0].Depth)
    return dims


def wall_heights(model):
    return {name: d[2] for name, d in wall_dims(model).items()}


def test_mixed_layout_exports_walls_and_skips_foundation(tmp_path, capsys):
    (count, skipped), out = export(tmp_path, MIXED)
    model = ifcopenshell.open(str(out))

    names = sorted(w.Name for w in model.by_type("IfcWall"))
    assert names == [
        "iwall_4x8_2x4_16oc [i1]",
        "wall_4x8_2x6_16oc [w1]",
        "window_4x10_2x6_36x48 [win1]",
    ]
    assert count == 3
    assert skipped == [("foundation_1", "foundation")]
    assert "foundation_1 (foundation)" in capsys.readouterr().err


def test_heights_come_from_specs(tmp_path):
    _, out = export(tmp_path, MIXED)
    heights = wall_heights(ifcopenshell.open(str(out)))
    assert heights["wall_4x8_2x6_16oc [w1]"] == pytest.approx(8 * FT)
    assert heights["window_4x10_2x6_36x48 [win1]"] == pytest.approx(10 * FT)


def test_wall_dimensions_are_in_millimetres(tmp_path):
    # ifcopenshell's wall API takes metres; the file's unit is mm. A 4 ft
    # exterior wall must come out 1219.2 x 150.8125 x 2438.4 mm, not 1000x that.
    _, out = export(tmp_path, MIXED)
    dims = wall_dims(ifcopenshell.open(str(out)))
    assert dims["wall_4x8_2x6_16oc [w1]"] == pytest.approx((1219.2, 150.8125, 8 * FT))
    assert dims["iwall_4x8_2x4_16oc [i1]"] == pytest.approx((1219.2, 88.9, 8 * FT))


def test_height_does_not_parse_module_id(tmp_path):
    # An id whose text says 4x10 but whose spec says 8 ft must export at 8 ft.
    specs = export_ifc.load_specs()
    specs["custom_4x10_lookalike"] = dict(specs["wall_4x8_2x6_16oc"])
    layout = copy.deepcopy(MIXED)
    layout["entities"] = [dict(MIXED["entities"][0], module="custom_4x10_lookalike")]
    src = tmp_path / "layout.json"
    src.write_text(json.dumps(layout))
    out = tmp_path / "out.ifc"
    export_ifc.main(str(src), str(out), specs=specs)
    heights = wall_heights(ifcopenshell.open(str(out)))
    assert heights["custom_4x10_lookalike [w1]"] == pytest.approx(8 * FT)


@pytest.mark.parametrize("mutate, message", [
    (lambda e: e.pop("width_mm"), "missing width_mm"),
    (lambda e: e.update(depth_mm=0), "non-positive depth_mm"),
    (lambda e: e.update(width_mm="wide"), "non-numeric width_mm"),
    (lambda e: e.update(module="no_such_module"), "no spec"),
    (lambda e: e.pop("module"), "has no module"),
])
def test_invalid_wall_rejected_without_writing(tmp_path, mutate, message):
    layout = copy.deepcopy(MIXED)
    mutate(layout["entities"][0])
    with pytest.raises(export_ifc.LayoutError, match=message):
        export(tmp_path, layout)
    assert not (tmp_path / "out.ifc").exists()


def test_v1_modules_without_kind_still_export(tmp_path):
    entity = {k: v for k, v in MIXED["entities"][0].items() if k != "kind"}
    (count, skipped), _ = export(tmp_path, {"modules": [entity]})
    assert (count, skipped) == (1, [])
