#!/usr/bin/env bash
# Compile a web-UI layout JSON to a FreeCAD .FCStd assembly.
# Usage: ./compile.sh layout.json
if [ -z "$1" ]; then
  echo "Usage: $0 <layout.json>"; exit 1
fi
# The filename travels as data in an environment variable, never spliced into
# the Python source (SOL-20: a quote in the name broke or injected code).
ICONIC_LAYOUT_JSON="$1" freecadcmd -c "import os, sys; sys.argv=['compile_from_json.py', os.environ['ICONIC_LAYOUT_JSON']]; exec(open('compile_from_json.py').read())"
