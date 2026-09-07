#!/usr/bin/env python3
"""Fail if any relative Markdown link points at a file that doesn't exist.

Scans every tracked *.md file for inline links `[text](target)`, ignores
external (http/https/mailto) and pure in-page anchors, strips any `#fragment`,
and resolves the rest relative to the linking file. Exits non-zero on the first
broken link so CI fails the build.
"""
import re
import subprocess
import sys
from pathlib import Path

LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
ROOT = Path(__file__).resolve().parent.parent

broken = []
tracked = subprocess.check_output(["git", "ls-files", "-z", "--", "*.md"], cwd=ROOT)
for name in tracked.decode("utf-8").split("\0"):
    if not name:
        continue
    md = ROOT / name
    text = md.read_text(encoding="utf-8")
    for target in LINK.findall(text):
        target = target.strip()
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        path = target.split("#", 1)[0]
        if not path:
            continue
        resolved = (md.parent / path).resolve()
        if not resolved.exists():
            broken.append(f"{md.relative_to(ROOT)}: -> {target}")

if broken:
    print("Broken relative Markdown links:")
    for b in broken:
        print(f"  {b}")
    sys.exit(1)

print("All relative Markdown links resolve.")
