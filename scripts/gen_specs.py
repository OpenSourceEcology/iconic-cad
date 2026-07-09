#!/usr/bin/env python3
"""
Generate web/assets/lib/specs.json from library module entries.

Run from the repo root after editing library/modules:
    python scripts/gen_specs.py

specs.json is the single source of wall framing parameters used by the browser
FreeCAD export (web/js/fcstd.js). The CI asserts this file stays in sync on
every push.

No FreeCAD required.
"""
import json
import os

from entry_instances import instances_document

YAML_PATH = 'wall_instances.yaml'
OUT_PATH = os.path.join('web', 'assets', 'lib', 'specs.json')
DATA = None


def main():
    data = DATA if DATA is not None else instances_document()

    specs = {}
    for inst in data['instances']:
        p = inst['parameters']
        specs[inst['id']] = {
            'w': p['nominal_width_ft'],
            'h': p['nominal_height_ft'],
            'lum': p['stud_lumber_nominal'],
            'oc': p['stud_spacing_oc_in'],
            'osb': p.get('osb_thickness_in', 0),
        }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(specs, f, separators=(',', ':'))
        f.write('\n')

    print(f'Wrote {OUT_PATH} ({len(specs)} entries)')


if __name__ == '__main__':
    main()
