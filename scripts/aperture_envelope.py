"""Validate that aperture framing fits below the required top-plate stack."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


HEADER_DEPTH_IN = {
    "2x4": 3.5,
    "2x6": 5.5,
    "2x8": 7.25,
    "2x10": 9.25,
    "2x12": 11.25,
}

# Each entry is pending an OSE envelope/header decision and must be REMOVED
# once that decision lands. Validation rejects both additions and stale entries.
GRANDFATHERED_APERTURE_ENVELOPE_VIOLATIONS = frozenset(
    {
        "double_door_8x8_2x6_72x83",
        "garage_9x8_2x6_96x84",
    }
)


class ApertureEnvelopeError(ValueError):
    """Raised when the module catalog violates the aperture envelope policy."""


def aperture_headroom_in(instance: dict[str, Any]) -> float | None:
    """Return aperture headroom in inches, or None for a plain wall panel."""
    parameters = instance["parameters"]
    aperture = parameters.get("aperture")
    if aperture is None:
        return None

    header_nominal = aperture["header_lumber_nominal"]
    try:
        header_depth_in = HEADER_DEPTH_IN[header_nominal]
    except KeyError as exc:
        raise ApertureEnvelopeError(
            f"{instance['id']}: unsupported header_lumber_nominal {header_nominal!r}"
        ) from exc

    authored_plate_count = parameters["top_plate_count"]
    is_exterior = parameters["exterior_face"] != "none"
    # Exterior framing requires two top plates. max() prevents a legacy or new
    # single-plate field from hiding the envelope required by that policy.
    plate_count = max(authored_plate_count, 2) if is_exterior else authored_plate_count
    required_height_in = (
        aperture.get("sill_height_in", 0)
        + aperture["rough_opening_height_in"]
        + header_depth_in
        + plate_count * 1.5
    )
    return parameters["nominal_height_ft"] * 12.0 - required_height_in


def validate_aperture_envelopes(instances: Iterable[dict[str, Any]]) -> None:
    """Reject unexpected violations and grandfathered entries that have cleared."""
    violations: dict[str, float] = {}
    for instance in instances:
        headroom_in = aperture_headroom_in(instance)
        if headroom_in is not None and headroom_in < 0:
            violations[instance["id"]] = headroom_in

    violation_ids = set(violations)
    unexpected = violation_ids - GRANDFATHERED_APERTURE_ENVELOPE_VIOLATIONS
    stale = GRANDFATHERED_APERTURE_ENVELOPE_VIOLATIONS - violation_ids
    errors = []
    for module_id in sorted(unexpected):
        errors.append(
            f"{module_id}: aperture framing is {-violations[module_id]:g} in too tall "
            "for the panel envelope"
        )
    if stale:
        errors.append(
            "grandfathered aperture envelope exception(s) no longer violate the rule; "
            "remove from GRANDFATHERED_APERTURE_ENVELOPE_VIOLATIONS: "
            + ", ".join(sorted(stale))
        )
    if errors:
        raise ApertureEnvelopeError("aperture envelope validation failed:\n- " + "\n- ".join(errors))
