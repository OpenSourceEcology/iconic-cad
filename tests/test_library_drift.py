from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from entry_instances import load_entry_instances  # noqa: E402
from gen_wall_instances import render  # noqa: E402


def test_wall_instances_yaml_matches_library_entries():
    expected = render(load_entry_instances(ROOT))
    actual = (ROOT / "wall_instances.yaml").read_text(encoding="utf-8")
    assert actual == expected
