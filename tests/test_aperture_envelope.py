from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from aperture_envelope import (  # noqa: E402
    ApertureEnvelopeError,
    validate_aperture_envelopes,
)
from entry_instances import load_entry_instances  # noqa: E402


def test_current_catalog_has_exact_grandfathered_violations():
    validate_aperture_envelopes(load_entry_instances(ROOT))


def test_third_aperture_envelope_violation_fails():
    instances = load_entry_instances(ROOT)
    third = copy.deepcopy(
        next(inst for inst in instances if inst["id"] == "double_door_8x8_2x6_72x83")
    )
    third["id"] = "third_violating_aperture"

    with pytest.raises(ApertureEnvelopeError, match="third_violating_aperture"):
        validate_aperture_envelopes([*instances, third])


def test_resolved_grandfathered_violation_fails_until_allowlist_is_cleaned():
    instances = copy.deepcopy(load_entry_instances(ROOT))
    resolved = next(
        inst for inst in instances if inst["id"] == "double_door_8x8_2x6_72x83"
    )
    resolved["parameters"]["nominal_height_ft"] = 9.0

    with pytest.raises(
        ApertureEnvelopeError,
        match="no longer violate.*double_door_8x8_2x6_72x83",
    ):
        validate_aperture_envelopes(instances)
