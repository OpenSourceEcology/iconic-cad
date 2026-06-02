#!/usr/bin/env python3
"""
Generate web/assets/lib/specs.json from wall_instances.yaml.

Run from the repo root after editing wall_instances.yaml:
    python scripts/gen_specs.py

specs.json is the single source of wall framing parameters used by the browser
FreeCAD export (web/js/fcstd.js). The CI asserts this file stays in sync with
the YAML on every push.

No FreeCAD required — reads YAML only.
"""
import json
import os
import yaml

YAML_PATH = 'wall_instances.yaml'
OUT_PATH = os.path.join('web', 'assets', 'lib', 'specs.json')


def main():
    with open(YAML_PATH) as f:
        data = yaml.safe_load(f)

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
