import json
import subprocess
import sys
from pathlib import Path

from libtools.registry import discover
from libtools.schema_check import check_schema_source


ROOT = Path(__file__).resolve().parents[1]


def test_generated_entry_schema_and_registry_discovery(tmp_path):
    result = subprocess.run(
        ["node", "tests/helpers/gen_entry_fixture.mjs"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    files = json.loads(result.stdout)
    entry_dir = tmp_path / "library" / "assemblies" / "generated_test_assembly"
    entry_dir.mkdir(parents=True)
    for name, content in files.items():
        (entry_dir / name).write_text(content, encoding="utf-8")

    violations = check_schema_source((entry_dir / "schema.py").read_text(encoding="utf-8"))
    assert violations == []

    entries = discover(tmp_path)
    assert len(entries) == 1
    assert entries[0].id == "generated_test_assembly"
    assert entries[0].layer == "assembly"
    assert entries[0].status == "wip"
