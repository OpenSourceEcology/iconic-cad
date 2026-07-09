from __future__ import annotations

import importlib.util
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent


def test_library_entry_ids_match_wall_instances():
    yaml_ids = {inst["id"] for inst in load_instances()}
    entry_ids = {path.name for path in (ROOT / "library" / "modules").iterdir() if path.is_dir()}
    assert entry_ids == yaml_ids


def test_schema_parameters_match_wall_instances():
    instances = {inst["id"]: inst for inst in load_instances()}
    for entry_id, inst in instances.items():
        schema = load_schema(ROOT / "library" / "modules" / entry_id / "schema.py")
        assert pairs_to_dict(schema["parameters"]) == inst["parameters"]


def load_instances():
    with (ROOT / "wall_instances.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)["instances"]


def load_schema(path: Path):
    spec = importlib.util.spec_from_file_location(f"_schema_{path.parent.name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SCHEMA


def pairs_to_dict(value):
    if isinstance(value, tuple):
        return {key: pairs_to_dict(child) for key, child in value}
    return value
