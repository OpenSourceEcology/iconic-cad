"""Regressions for Sol audit hygiene findings (docs/audits/sol-audit-2026-09-02/02-findings.md).

SOL-17: libtools (run by build_lib.py) is declared, pinned to a commit, and CI
        installs it from the requirements files rather than an unpinned URL.
SOL-20: compile.sh passes the layout filename as data, never as Python source.
SOL-21: build_lib.py --verify removes its temp dir even when a step raises.
"""
import os
import re
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIN = re.compile(r"^libtools @ git\+https://github\.com/OpenSourceEcology/vcs-library@[0-9a-f]{40}$")


def _req_lines(name):
    return [l.strip() for l in (ROOT / name).read_text().splitlines()
            if l.strip() and not l.lstrip().startswith("#")]


def test_sol17_libtools_declared_and_pinned():
    build = _req_lines("requirements-build.txt")
    assert any(PIN.match(l) for l in build), build
    assert "-r requirements-build.txt" in _req_lines("requirements-dev.txt")


def test_sol17_ci_does_not_install_unpinned_libtools():
    files = list((ROOT / ".github/workflows").glob("*.yml")) + [ROOT / ".gitlab-ci.yml"]
    for f in files:
        for line in f.read_text().splitlines():
            if "libtools @" in line:
                raise AssertionError(f"{f.name} installs libtools inline: {line.strip()}")


def _fake_freecadcmd(tmp_path):
    """A freecadcmd stand-in that runs the -c string with this Python, from a
    cwd whose compile_from_json.py just records sys.argv."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    fake = bindir / "freecadcmd"
    fake.write_text(f"#!/bin/sh\n[ \"$1\" = -c ] || exit 9\nexec {os.sys.executable} -c \"$2\"\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    work = tmp_path / "work"
    work.mkdir()
    (work / "compile_from_json.py").write_text(
        "import sys\nopen('argv.txt', 'w').write(sys.argv[1])\n")
    env = dict(os.environ, PATH=f"{bindir}{os.pathsep}{os.environ['PATH']}")
    return work, env


def test_sol20_compile_sh_filename_is_data(tmp_path):
    work, env = _fake_freecadcmd(tmp_path)
    nasty = 'x",__import__("pathlib").Path("PWNED").touch(),"y.json'
    r = subprocess.run(["bash", str(ROOT / "compile.sh"), nasty], cwd=work, env=env,
                       capture_output=True, text=True)
    assert not (work / "PWNED").exists(), "filename was executed as Python"
    assert r.returncode == 0, r.stderr
    assert (work / "argv.txt").read_text() == nasty


def test_sol20_compile_sh_plain_filename(tmp_path):
    work, env = _fake_freecadcmd(tmp_path)
    r = subprocess.run(["bash", str(ROOT / "compile.sh"), "my layout's.json"], cwd=work, env=env,
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert (work / "argv.txt").read_text() == "my layout's.json"


def test_sol21_verify_tempdir_removed_when_a_step_raises(tmp_path, monkeypatch):
    import importlib.util
    import sys
    import pytest
    spec = importlib.util.spec_from_file_location("build_lib_under_test", ROOT / "build_lib.py")
    bl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bl)

    made = []
    real_mkdtemp = bl.tempfile.mkdtemp

    def mkdtemp(**kw):
        d = real_mkdtemp(dir=tmp_path, **kw)
        made.append(d)
        return d

    def boom(*a, **k):
        raise RuntimeError("specs step crashed")

    monkeypatch.setattr(bl.tempfile, "mkdtemp", mkdtemp)
    monkeypatch.setattr(bl, "validate_entries", lambda: None)
    monkeypatch.setattr(bl, "entry_instances_document", lambda: {})
    monkeypatch.setattr(bl, "write_instances_yaml", lambda data, path: None)
    monkeypatch.setattr(bl, "verify_wall_instances", lambda: True)
    monkeypatch.setattr(bl, "run_specs", boom)
    monkeypatch.setattr(bl.os, "chdir", lambda p: None)
    monkeypatch.setattr(sys, "argv", ["build_lib.py", "--verify", "--no-thumbs"])
    with pytest.raises(RuntimeError):
        bl.main()
    assert made, "verify did not create a temp dir"
    assert not os.path.exists(made[0]), f"verify leaked {made[0]}"
