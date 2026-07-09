#!/usr/bin/env python3
"""Generate libtools library entries from wall_instances.yaml."""

from __future__ import annotations

import argparse
import difflib
import pprint
import shutil
import sys
import tempfile
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
SOURCE_YAML = ROOT / "wall_instances.yaml"
MODULE_DIR = ROOT / "library" / "modules"
WIKI_SOURCE = "https://wiki.opensourceecology.org/wiki/Wall_instances.yaml"
ENTRY_FILES = ("schema.py", "compiler.py", "meta.yaml", "expect.yaml")


LUMBER_ACTUAL_IN = {
    "2x2": (1.5, 1.5),
    "2x3": (1.5, 2.5),
    "2x4": (1.5, 3.5),
    "2x6": (1.5, 5.5),
    "2x8": (1.5, 7.25),
    "2x10": (1.5, 9.25),
    "2x12": (1.5, 11.25),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true", help="fail if generated entries drift")
    args = parser.parse_args()

    instances = load_instances()
    if args.verify:
        return verify(instances)

    write_entries(MODULE_DIR, instances, clean=True)
    return 0


def load_instances() -> list[dict]:
    with SOURCE_YAML.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)["instances"]


def verify(instances: list[dict]) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        generated = Path(tmp) / "modules"
        write_entries(generated, instances, clean=False)
        diffs = collect_diffs(generated, MODULE_DIR)
        if diffs:
            sys.stderr.write("library/modules is out of sync with wall_instances.yaml\n")
            sys.stderr.write("\n".join(diffs))
            return 1
    return 0


def write_entries(root: Path, instances: list[dict], clean: bool) -> None:
    if clean and root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)

    expected_ids = {inst["id"] for inst in instances}
    if clean:
        for child in root.iterdir():
            if child.is_dir() and child.name not in expected_ids:
                shutil.rmtree(child)

    for inst in instances:
        entry_dir = root / inst["id"]
        entry_dir.mkdir(parents=True, exist_ok=True)
        write_text(entry_dir / "schema.py", schema_py(inst))
        write_text(entry_dir / "compiler.py", compiler_py())
        write_yaml(entry_dir / "meta.yaml", meta_yaml(inst))
        write_yaml(entry_dir / "expect.yaml", expect_yaml(inst))


def collect_diffs(generated: Path, committed: Path) -> list[str]:
    diffs = []
    entry_names = {p.name for p in generated.iterdir() if p.is_dir()} | {
        p.name for p in committed.iterdir() if p.is_dir()
    }
    paths = [
        Path(entry_name) / file_name
        for entry_name in sorted(entry_names)
        for file_name in ENTRY_FILES
    ]
    for rel in paths:
        left = generated / rel
        right = committed / rel
        left_text = left.read_text(encoding="utf-8") if left.exists() else ""
        right_text = right.read_text(encoding="utf-8") if right.exists() else ""
        if left_text == right_text:
            continue
        diffs.extend(
            difflib.unified_diff(
                right_text.splitlines(),
                left_text.splitlines(),
                fromfile=f"library/modules/{rel}",
                tofile=f"generated/{rel}",
                lineterm="",
            )
        )
    return [line + "\n" for line in diffs]


def schema_py(inst: dict) -> str:
    schema = {
        "schema_name": schema_name(inst),
        "units": "in",
        "document_name": inst["id"],
        "family": inst["family"],
        "parameters": pairs_literal(inst["parameters"]),
    }
    schema.update(validator_params(inst))
    body = pprint.pformat(schema, width=88, sort_dicts=False)
    return f'"""Generated schema for {inst["id"]}."""\n\nSCHEMA = {body}\n'


def compiler_py() -> str:
    return """from seh_lib import build_instance_into_doc, instance_from_schema


def compile(schema, doc):
    instance = instance_from_schema(schema)
    build_instance_into_doc(instance, doc)
    return list(doc.Objects)
"""


def meta_yaml(inst: dict) -> dict:
    meta = {
        "id": inst["id"],
        "layer": "module",
        "title": inst["id"].replace("_", " ").title(),
        "owner": "Collin DeSantis",
        "license": "OSE",
        "version": "0.1.0",
        "status": "active",
        "provenance": {
            "author": "Collin DeSantis",
            "source_file": "wall_instances.yaml",
            "source": WIKI_SOURCE,
        },
        "slots": {
            "icon": None,
            "fab_drawing": None,
            "bom": None,
            "cheatsheet": None,
        },
    }
    issues = known_issues(inst)
    if issues:
        meta["known_issues"] = issues
    return meta


def expect_yaml(inst: dict) -> dict:
    p = inst["parameters"]
    width_in = p["nominal_width_ft"] * 12.0
    height_in = p["nominal_height_ft"] * 12.0
    _stud_t, stud_depth = LUMBER_ACTUAL_IN[p["stud_lumber_nominal"]]
    osb = p["osb_thickness_in"]
    roles = role_counts(inst)

    return {
        "envelope": {
            "bbox_in": {
                "x": [0.0, round(width_in, 6)],
                "y": [round(-osb, 6), round(stud_depth, 6)],
                "z": [0.0, round(height_in, 6)],
            },
            "tolerance_in": 0.05,
        },
        "solids": {
            "min_count": sum(role["count"] for role in roles),
            "roles": roles,
        },
        "overlap": {
            "tolerance_in3": 0.01,
            "allowed_contact": issue12_contacts(inst),
        },
        "params": param_rules(inst),
    }


def role_counts(inst: dict) -> list[dict]:
    p = inst["parameters"]
    if "aperture" in p:
        return aperture_role_counts(inst)
    return plain_wall_role_counts(inst)


def plain_wall_role_counts(inst: dict) -> list[dict]:
    p = inst["parameters"]
    width_in = p["nominal_width_ft"] * 12.0
    st, _sd = LUMBER_ACTUAL_IN[p["stud_lumber_nominal"]]
    stud_count = len(stud_positions(width_in, st, p["stud_spacing_oc_in"]))
    roles = [
        {"pattern": "bottom_plate", "count": 1},
        {"pattern": "top_plate", "count": 1},
        {"pattern": "stud_*", "count": stud_count},
    ]
    if p["osb_thickness_in"] > 0:
        roles.append({"pattern": "osb_panel", "count": 1})
    roles.append({"pattern": "port_*", "count": 2})
    return roles


def aperture_role_counts(inst: dict) -> list[dict]:
    p = inst["parameters"]
    a = p["aperture"]
    width_in = p["nominal_width_ft"] * 12.0
    height_in = p["nominal_height_ft"] * 12.0
    st, _sd = LUMBER_ACTUAL_IN[p["stud_lumber_nominal"]]
    _hdr_t, hdr_depth = LUMBER_ACTUAL_IN[a["header_lumber_nominal"]]
    ro_w = a["rough_opening_width_in"]
    ro_h = a["rough_opening_height_in"]
    sill_top = a.get("sill_height_in", 0) or 0
    is_window = a["type"] == "window" and sill_top > 0

    # docs/aperture_framing_reference.md: aperture panels keep a single top
    # plate in current geometry, use full-height edge kings, jacks flanking
    # the centered RO, one header solid above the RO, and OC-grid cripples
    # inside the opening.
    top_plate_z = height_in - st
    ro_top = sill_top + ro_h
    header_top = ro_top + hdr_depth
    cripple_count = len(
        cripple_x_positions(width_in, st, p["stud_spacing_oc_in"], (width_in - ro_w) / 2.0, (width_in + ro_w) / 2.0)
    )
    top_cripple_count = cripple_count if top_plate_z - header_top > (1.0 / 25.4) else 0

    roles = [
        {"pattern": "bottom_plate*", "count": 1 if is_window else 2},
        {"pattern": "top_plate", "count": 1},
        {"pattern": "king_stud_*", "count": 2},
        {"pattern": "jack_stud_*", "count": 2},
        {"pattern": "header", "count": 1},
    ]
    if top_cripple_count:
        roles.append({"pattern": "top_cripple_*", "count": top_cripple_count})

    if is_window:
        # docs/aperture_framing_reference.md: windows add a sill, lower
        # OC-grid cripples, a subheader just above the sole plate when the
        # lower zone is tall enough, and horizontal blocking every 24 inches
        # in that zone.
        lower_top = sill_top - st
        lower_bot = st
        roles.append({"pattern": "sill", "count": 1})
        if lower_top - lower_bot > (1.0 / 25.4):
            roles.append({"pattern": "lower_cripple_*", "count": cripple_count})
        if lower_top - lower_bot > st + (1.0 / 25.4):
            roles.append({"pattern": "subheader", "count": 1})
        blocking = 0
        z = lower_bot + 24.0
        while z + st < lower_top - (1.0 / 25.4):
            blocking += 1
            z += 24.0
        if blocking:
            roles.append({"pattern": "blocking_*", "count": blocking})

    if p["osb_thickness_in"] > 0:
        roles.append({"pattern": "osb_panel", "count": 1})
    roles.append({"pattern": "port_*", "count": 2})
    return roles


def validator_params(inst: dict) -> dict:
    p = inst["parameters"]
    params = {
        "module_width_in": p["nominal_width_ft"] * 12.0,
        "module_height_in": p["nominal_height_ft"] * 12.0,
        "stud_spacing_in": p["stud_spacing_oc_in"],
        "osb_thickness_in": p["osb_thickness_in"],
    }
    if "aperture" in p:
        a = p["aperture"]
        params.update(
            {
                "rough_opening_width_in": a["rough_opening_width_in"],
                "rough_opening_height_in": a["rough_opening_height_in"],
                "sill_height_in": a["sill_height_in"],
                "header_plies": a["header_plies"],
            }
        )
    return params


def param_rules(inst: dict) -> list[dict]:
    rules = []
    for key, value in validator_params(inst).items():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            rules.append({"key": key, "min": value, "max": value})
    return rules


def known_issues(inst: dict) -> list[str]:
    p = inst["parameters"]
    issues = [
        "CAD-AUD-001: current geometry emits a single top plate; expect.yaml records current behavior.",
    ]
    if "aperture" in p and p["osb_thickness_in"] > 0:
        issues.append(
            "CAD-AUD-005: current exterior aperture geometry cuts the OSB opening in CAD; expect.yaml records current behavior."
        )
    aperture = p.get("aperture") or {}
    if aperture.get("type") == "window":
        issues.append(
            "Issue #12: lower cripples intersect the subheader (12.375 in3 each); allowed_contact records current behavior."
        )
    if aperture.get("type") == "garage":
        issues.append(
            "Issue #12: header intersects the top plate (408.375 in3); allowed_contact records current behavior."
        )
    if inst["id"] == "idoor_4x8_2x4_38x83":
        issues.append(
            "CAD-AUD-010: current interior door uses shared jack/header aperture framing; expect.yaml records current behavior."
        )
    return issues


def issue12_contacts(inst: dict) -> list[list[str]]:
    # Documented current-behavior intersections, tracked in issue #12:
    # window lower cripples run through the subheader; the garage header
    # reaches into the top plate. Allowances go away with the members fix.
    aperture = inst["parameters"].get("aperture")
    if not aperture:
        return []
    if aperture.get("type") == "window":
        return [["lower_cripple_*", "subheader"]]
    if aperture.get("type") == "garage":
        return [["top_plate", "header"]]
    return []


def pairs_literal(value):
    if isinstance(value, dict):
        return tuple((key, pairs_literal(child)) for key, child in value.items())
    return value


def stud_positions(width_in: float, stud_thick_in: float, spacing_oc_in: float) -> list[float]:
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
    xs = [
        x
        for x in stud_positions(width_in, st_in, spacing_in)
        if lo_in < x and x + st_in < hi_in
    ]
    if not xs:
        xs = [(lo_in + hi_in) / 2.0 - st_in / 2.0]
    return xs


def schema_name(inst: dict) -> str:
    return "".join(part.capitalize() for part in inst["family"].split("_"))


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def write_yaml(path: Path, data: dict) -> None:
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
