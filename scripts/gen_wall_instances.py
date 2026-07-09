#!/usr/bin/env python3
"""Generate wall_instances.yaml from library module entries."""

from __future__ import annotations

import argparse
import difflib
import sys
import tempfile
from pathlib import Path
from typing import Any

from entry_instances import ROOT, load_entry_instances


OUT_PATH = ROOT / "wall_instances.yaml"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true", help="fail if wall_instances.yaml drifts")
    args = parser.parse_args()

    text = render(load_entry_instances(ROOT))
    if args.verify:
        return verify(text)

    OUT_PATH.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT_PATH.relative_to(ROOT)}")
    return 0


def verify(text: str) -> int:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=True) as f:
        f.write(text)
        f.flush()
        fresh = Path(f.name).read_text(encoding="utf-8")

    committed = OUT_PATH.read_text(encoding="utf-8") if OUT_PATH.exists() else ""
    if committed == fresh:
        return 0

    sys.stderr.write("wall_instances.yaml is out of sync with library/modules\n")
    sys.stderr.writelines(
        line + "\n"
        for line in difflib.unified_diff(
            committed.splitlines(),
            fresh.splitlines(),
            fromfile="wall_instances.yaml",
            tofile="generated wall_instances.yaml",
            lineterm="",
        )
    )
    return 1


def render(instances: list[dict[str, Any]]) -> str:
    by_id = {inst["id"]: inst for inst in instances}
    lines = [
        "# Wall Instances",
        "# Generated from library/modules/*/schema.py by scripts/gen_wall_instances.py.",
        "# Kept for backward compatibility with legacy generators and compilers.",
        "# Source: https://wiki.opensourceecology.org/wiki/Wall_instances.yaml",
        "",
        "instances:",
    ]

    plain_ids = [
        "wall_4x8_2x6_24oc",
        "wall_4x8_2x6_16oc",
        "wall_3x8.5_2x6_16oc",
    ]
    interior_ids = [
        "iwall_4x8_2x4_16oc",
        "iwall_4x8_2x4_24oc",
        "iwall_3x8.5_2x4_single",
    ]
    aperture_ids = [
        "window_4x8_2x6_36x48",
        "window_4x9_2x6_36x48",
        "window_4x10_2x6_36x48",
        "door_4x8_2x6_38x83",
        "door_out_4x8_2x6_38x83",
        "double_door_8x8_2x6_72x83",
        "sliding_8x8_2x6_72x80",
        "garage_9x8_2x6_96x84",
        "idoor_4x8_2x4_38x83",
    ]

    for module_id in plain_ids:
        append_instance(lines, by_id.pop(module_id))

    lines.extend(["  # Interior walls — no OSB, 2x4 lumber"])
    for module_id in interior_ids:
        append_instance(lines, by_id.pop(module_id))

    lines.extend(
        [
            "  # =====================================================================",
            "  # Aperture wall panels — windows and doors.",
            "  # A door is a window taken to the floor: same header / king-stud / jack-stud",
            "  # logic; the window adds a sill and lower cripples. One parametric object.",
            "  # The `aperture` block drives the opening framing. Framing dims are measured",
            "  # from OSE source CAD — see docs/aperture_framing_reference.md.",
            "  # Panels are 48\" wide and snap exactly like a plain wall module.",
            "  # =====================================================================",
            "",
            "  # Exterior window — 2x6 + OSB, 36\"x48\" rough opening, sill at 24\".",
            "  # Available in 8', 9', and 10' module heights per OSE window spec.",
        ]
    )
    for module_id in aperture_ids:
        if module_id == "door_4x8_2x6_38x83":
            lines.extend(
                [
                    "  # Exterior door — 2x6 + OSB, 38\"x83\" rough opening, opening to the floor.",
                ]
            )
        elif module_id == "door_out_4x8_2x6_38x83":
            lines.extend(
                [
                    "  # Exterior door (out-swing) — same framing as door_4x8_2x6_38x83, swing flag only.",
                ]
            )
        elif module_id == "double_door_8x8_2x6_72x83":
            lines.extend(
                [
                    "  # Double door — 8' wide panel, 72\" x 83\" RO, doubled 2x12 header.",
                    "  # Standard double-door RO per IRC: two 3'-0\" doors + center stile = ~72\" total.",
                ]
            )
        elif module_id == "sliding_8x8_2x6_72x80":
            lines.extend(
                [
                    "  # Sliding glass door — 8' wide panel, 72\" x 80\" RO (standard 6-0 x 6-8 patio).",
                ]
            )
        elif module_id == "garage_9x8_2x6_96x84":
            lines.extend(
                [
                    "  # Garage door — 9' wide panel, 96\" x 84\" RO (standard 8-0 x 7-0 single garage).",
                    "  # Header is a built-up LVL or doubled 2x12 over the 8' span.",
                ]
            )
        elif module_id == "idoor_4x8_2x4_38x83":
            lines.extend(
                [
                    "  # Interior door — 2x4, 38\"x83\" rough opening (matches Seh2 8ft interior door).",
                ]
            )
        append_instance(lines, by_id.pop(module_id))

    for inst in by_id.values():
        lines.append("")
        append_instance(lines, inst)

    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines) + "\n"


def append_instance(lines: list[str], inst: dict[str, Any]) -> None:
    p = inst["parameters"]
    lines.extend(
        [
            f"  - id: {inst['id']}",
            f"    family: {inst['family']}",
            "    parameters:",
            f"      nominal_width_ft: {fmt(p['nominal_width_ft'])}",
            f"      nominal_height_ft: {fmt(p['nominal_height_ft'])}",
            f"      stud_lumber_nominal: \"{p['stud_lumber_nominal']}\"",
            f"      stud_spacing_oc_in: {fmt(p['stud_spacing_oc_in'])}",
            f"      osb_thickness_in: {fmt(p['osb_thickness_in'])}",
            f"      exterior_face: {p['exterior_face']}",
            f"      reference_house_orientation: {p['reference_house_orientation']}",
        ]
    )
    aperture = p.get("aperture")
    if aperture:
        lines.extend(
            [
                "      aperture:",
                f"        type: {aperture['type']}",
                f"        rough_opening_width_in: {fmt(aperture['rough_opening_width_in'])}",
                f"        rough_opening_height_in: {fmt(aperture['rough_opening_height_in'])}",
            ]
        )
        sill_line = f"        sill_height_in: {fmt(aperture['sill_height_in'])}"
        if inst["id"] == "window_4x8_2x6_36x48":
            sill_line += "            # height to top of sill (>= 24\" per OSE)"
        elif inst["id"] == "door_4x8_2x6_38x83":
            sill_line += "             # door: opening goes to the floor"
        lines.extend(
            [
                sill_line,
                f"        header_lumber_nominal: \"{aperture['header_lumber_nominal']}\"",
                f"        header_plies: {fmt(aperture['header_plies'])}",
            ]
        )
        if "swing" in aperture:
            lines.append(f"        swing: {aperture['swing']}")
    lines.append("")


def fmt(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.1f}" if value.is_integer() else str(value)
    return str(value)


if __name__ == "__main__":
    raise SystemExit(main())
