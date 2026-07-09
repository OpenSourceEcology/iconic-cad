"""Build the legacy wall-instance structure from library entries."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from libtools.registry import discover, load_schema


ROOT = Path(__file__).resolve().parent.parent


def load_entry_instances(root: Path = ROOT, *, active_only: bool = True) -> list[dict[str, Any]]:
    entries = [
        entry
        for entry in discover(root)
        if entry.layer == "module" and (entry.status == "active" or not active_only)
    ]
    instances = []
    for entry in sorted(entries, key=lambda entry: module_sort_key(entry.id)):
        schema = load_schema(entry)
        instances.append(instance_from_schema(schema))
    return instances


def instance_from_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": schema["document_name"],
        "family": schema["family"],
        "parameters": pairs_to_dict(schema["parameters"]),
    }


def pairs_to_dict(value: Any) -> Any:
    if isinstance(value, tuple):
        return {key: pairs_to_dict(child) for key, child in value}
    return value


def instances_document(root: Path = ROOT) -> dict[str, list[dict[str, Any]]]:
    return {"instances": load_entry_instances(root)}


def module_sort_key(module_id: str) -> tuple[int, str]:
    preferred = {
        "wall_4x8_2x6_24oc": 0,
        "wall_4x8_2x6_16oc": 1,
        "wall_3x8.5_2x6_16oc": 2,
        "iwall_4x8_2x4_16oc": 3,
        "iwall_4x8_2x4_24oc": 4,
        "iwall_3x8.5_2x4_single": 5,
        "window_4x8_2x6_36x48": 6,
        "window_4x9_2x6_36x48": 7,
        "window_4x10_2x6_36x48": 8,
        "door_4x8_2x6_38x83": 9,
        "door_out_4x8_2x6_38x83": 10,
        "double_door_8x8_2x6_72x83": 11,
        "sliding_8x8_2x6_72x80": 12,
        "garage_9x8_2x6_96x84": 13,
        "idoor_4x8_2x4_38x83": 14,
    }
    if module_id in preferred:
        return (preferred[module_id], module_id)
    if module_id.startswith("wall_"):
        group = 100
    elif module_id.startswith("iwall_"):
        group = 200
    elif module_id.startswith("window_"):
        group = 300
    elif "door" in module_id or module_id.startswith(("sliding_", "garage_")):
        group = 400
    else:
        group = 500
    return (group, module_id)
