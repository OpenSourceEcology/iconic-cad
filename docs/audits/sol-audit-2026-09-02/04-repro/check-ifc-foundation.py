#!/usr/bin/env python3
"""Run export_ifc.main with tiny API stubs; no numpy/ifcopenshell install needed."""
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path


class Matrix:
    def __init__(self, n):
        self.rows = [[1.0 if r == c else 0.0 for c in range(n)] for r in range(n)]

    def __getitem__(self, key):
        r, c = key
        return self.rows[r][c]

    def __setitem__(self, key, value):
        r, c = key
        self.rows[r][c] = value


numpy = types.ModuleType("numpy")
numpy.eye = Matrix
sys.modules["numpy"] = numpy


class FakeModel:
    def __init__(self):
        self.walls = []

    def write(self, _path):
        pass


def fake_run(operation, model=None, **kwargs):
    if operation == "project.create_file":
        return FakeModel()
    if operation == "root.create_entity":
        entity = types.SimpleNamespace(**kwargs)
        if kwargs.get("ifc_class") == "IfcWall":
            model.walls.append(entity)
        return entity
    if operation in {"unit.add_si_unit", "context.add_context", "geometry.add_wall_representation"}:
        return types.SimpleNamespace(operation=operation, **kwargs)
    return None


ifcopenshell = types.ModuleType("ifcopenshell")
api = types.ModuleType("ifcopenshell.api")
api.run = fake_run
ifcopenshell.api = api
sys.modules["ifcopenshell"] = ifcopenshell
sys.modules["ifcopenshell.api"] = api

repo = Path("/Users/cct/code/iconic-cad")
spec = importlib.util.spec_from_file_location("export_ifc", repo / "export_ifc.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

layout = {
    "levels": [{"id": "L1", "name": "Level 1", "z_mm": 0}],
    "entities": [
        {"id": "w1", "kind": "wall", "module": "wall_4x8_2x6_16oc", "direction": "north",
         "x_mm": 0, "y_mm": 0, "width_mm": 1219.2, "depth_mm": 150.8125, "level": "L1"},
        {"id": "foundation_1", "kind": "foundation", "level": "L1",
         "params": {"slab_thickness_mm": 101.6}},
    ],
}
with tempfile.TemporaryDirectory() as td:
    src = Path(td) / "layout.json"
    src.write_text(json.dumps(layout))
    captured = None

    original = fake_run

    def capture_run(operation, model=None, **kwargs):
        nonlocal_holder = capture_run.__dict__
        result = original(operation, model, **kwargs)
        if operation == "project.create_file":
            nonlocal_holder["model"] = result
        return result

    module.run = capture_run
    module.main(str(src), str(Path(td) / "out.ifc"))
    captured = capture_run.model
    print("IfcWall count:", len(captured.walls))
    print("IfcWall names:", [w.name for w in captured.walls])
    raise SystemExit(1 if len(captured.walls) != 1 else 0)
