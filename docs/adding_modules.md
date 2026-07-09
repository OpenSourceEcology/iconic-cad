# Adding a module to Iconic CAD

This is the worked template for adding new modules, using the **window + door
apertures** as the example. Follow the same six touch-points for any future
module (sliding door, double door, garage header, etc.).

## The pipeline (what you're plugging into)

Per the Iconic CAD Protocol, one library-entry schema compiles three ways:

```
library/modules/<id>/schema.py ─┬── scripts/gen_specs.py ──▶ web/assets/lib/specs.json
        (authored schema)       │── scripts/gen_wall_instances.py ──▶ wall_instances.yaml
                                │── (freecadcmd) ─────────▶ web/assets/lib/<id>__<dir>.brp  (4: N/S/E/W)
                                │── (freecadcmd) ─────────▶ web/assets/lib/volumes.json
                                │── (freecadcmd) ─────────▶ cad_library/<id>.FCStd   (the part)
                                └── (headless Chromium) ──▶ web/thumbs/<id>.png
                                    ▲
                                    └─── python build_lib.py  regenerates ALL of the above

web UI (web/js/) ──Export──▶ layout.json ──compile_from_json.py──▶ House.FCStd
  place + snap                   │         (Python + FreeCAD, ./compile.sh,
  3D + BOM                       │          loads cad_library/*.FCStd)
                                  ├──web/js/fcstd.js──▶ house.FCStd
                                  │   (browser, no terminal; loads the .brp +
                                  │    specs.json browser assets above)
                                  └──export_ifc.py──▶ house.ifc
                                      (Python, requires ifcopenshell)
```

The library entry is the authored source of truth. `python build_lib.py` is the
single command that validates entries first, then regenerates every derived
artifact from them — the compatibility `wall_instances.yaml`, the Python
compiler's `cad_library/*.FCStd`, **and** the committed browser-export assets
(`web/assets/lib/*.brp`, `volumes.json`, `specs.json`) and `web/thumbs/*.png`.
The web UI lets a user place parts and exports positions; the JSON compiler (or
the in-browser `fcstd.js`) reassembles the parts into a house. (The old SVG/icon
compiler is retired — see the `legacy` branch.)

> **Module ids carry no orientation or material suffix.** The entry directory,
> `meta.yaml` id, and `SCHEMA["document_name"]` use *the* module id everywhere
> downstream — the `wall_instances.yaml` compatibility id, the `specs.json` key,
> the `<id>__<dir>.brp` filename, the `web/thumbs/<id>.png` name, the
> `cad_library/<id>.FCStd` part, and the `id` in `web/js/constants.js`. Keep it
> the same string in all of them (e.g. `window_4x8_2x6_36x48`, not
> `window_4x8_2x6_36x48_south`). `build_lib` enforces this — every artifact is
> derived from the entry id.

## Design principle for apertures

**A door is a window taken to the floor.** Same king/jack/header/cripple logic;
a window just adds a sill and lower cripples. So windows and doors are *one*
parametric object — a `family: aperture_wall_panel` driven by an `aperture`
block — not two code paths. They are 48"-wide wall panels and snap exactly like
a plain wall. Exact framing dims were measured from OSE source CAD; see
[aperture_framing_reference.md](aperture_framing_reference.md).

## The six touch-points

### 1. Library validation entry — `library/modules/<id>/`

Add a module entry with `schema.py`, `compiler.py`, `meta.yaml`, and
`expect.yaml`. The `SCHEMA` parameters carry the shared wall parameters plus an
`aperture` block:

```python
SCHEMA = {
    "schema_name": "ApertureWallPanel",
    "units": "in",
    "document_name": "window_4x8_2x6_36x48",
    "family": "aperture_wall_panel",
    "parameters": (
        ("nominal_width_ft", 4.0),
        ("nominal_height_ft", 8.0),
        ("stud_lumber_nominal", "2x6"),
        ("stud_spacing_oc_in", 16),
        ("osb_thickness_in", 0.4375),
        ("exterior_face", "south"),
        ("reference_house_orientation", "faces_south"),
        ("aperture", (
            ("type", "window"),
            ("rough_opening_width_in", 36),
            ("rough_opening_height_in", 48),
            ("sill_height_in", 24),
            ("header_lumber_nominal", "2x8"),
            ("header_plies", 2),
        )),
    ),
}
```

`osb_thickness_in: 0` makes it an interior (2x4, no-OSB) panel.
`wall_instances.yaml` is generated from these entries by
`scripts/gen_wall_instances.py` for older code paths that still read the YAML.

### 2. CAD generator — `generate_wall_library.py`

`build_aperture_panel()` reads the `aperture` block and emits conventional
platform framing (kings, jacks, header at the RO top, cripples above, plus a
sill + lower cripples for a window). `main()` dispatches to it whenever an
instance has an `aperture` key. Port markers are identical to walls, so the
JSON compiler treats apertures as ordinary panels — no compiler changes needed.

You don't call this directly — `build_lib` (step 3b) invokes the same
`build_wall` / `build_aperture_panel` functions to produce both the
`cad_library/*.FCStd` part **and** the per-direction browser `.brp` solids. To
build *only* the `cad_library/` parts for the CLI compiler, `./generate.sh` still
runs `generate_wall_library.py` on its own.

Verify a panel's framing by measuring its solids (W × D × H, origin) in
`freecadcmd` — that's how the reference dims were checked.

### 3. Web UI placement + plan silhouette — `web/js/constants.js`, `web/js/render2d.js`

- Add the module to `APERTURE_MODULES` (exterior) or `INT_APERTURE_MODULES`
  (interior) in `web/js/constants.js` with an `aperture` metadata object (inches).
  These flow into `ALL_MODULES`, so snapping/ports/save/load work for free.
- `drawAperturePlan()` in `web/js/render2d.js` renders the conventional top-down
  floor-plan symbol — glazing double-line + jamb ticks for a window; opening gap
  + leaf + swing arc for a door (hinged to the interior side).
- The library palette tile uses an inline-SVG plan thumbnail (no icon files);
  pick it, then press **R** to rotate.

### 3b. Regenerate all browser-export assets — `build_lib.py`

This is the step that's easy to forget — and forgetting it is exactly what
leaves the in-browser FreeCAD export stale. After adding the module entry,
regenerate **every** derived artifact with one command:

```bash
python build_lib.py
```

It produces (all idempotent, from the entries):

| Artifact | Consumer | Needs |
|----------|----------|-------|
| `wall_instances.yaml` | compatibility path for older generators / compilers | plain Python |
| `web/assets/lib/specs.json` | `fcstd.js` framing params | plain Python |
| `web/assets/lib/<id>__<dir>.brp` (×4) | `fcstd.js` per-direction solids | `freecadcmd` |
| `web/assets/lib/volumes.json` | reference / sanity-check | `freecadcmd` |
| `cad_library/<id>.FCStd` | `compile_from_json.py` (CLI) | `freecadcmd` |
| `web/thumbs/<id>.png` | library palette | headless Chromium |

The `.brp` are baked per direction the same way `compile_from_json.prepare_shape`
poses each wall (rotate about Z, drop the bounding box to the origin), so
`fcstd.js`'s Locations-injection reproduces the Python compiler exactly. Without
this step a new module works in the CLI compiler and the 2D/3D preview but is
**missing or wrong in the browser `.FCStd` export.**

Useful flags:

```bash
python build_lib.py --verify     # rebuild to a temp dir, diff vs committed; clobbers nothing
python build_lib.py --no-thumbs  # skip the Chromium thumbnail bake (needs network for the three.js CDN)
```

Commit the entry change together with the regenerated compatibility YAML,
`specs.json`, `.brp`, `volumes.json`, and `thumbs`. CI asserts the YAML and
`specs.json` stay in sync with the entries.
(FreeCAD version differences can make the `.brp` non-byte-identical even when the
geometry is correct — `--verify` compares geometry, not bytes.)

### 4. 3D preview — `web/js/render3d.js`

`buildAperture3D()` in `web/js/render3d.js` mirrors the generator framing in
three.js so the live preview shows the real opening (OSB cut out around the RO).
`buildWall3D()` dispatches to it for any module with an `aperture`.

### 5. BOM — `web/pricing.json`

Add a `module_specs.<id>` entry (`studs`, `plates`, `osb_sheets`,
`lumber_type`, nail/screw counts). Stud counts for apertures are full-stud-
equivalent estimates (kings + jacks + cripples + header stock); note this in
the entry's `notes`.

### 6. Compatibility YAML — `wall_instances.yaml`

Do not edit `wall_instances.yaml` directly. It is regenerated from
`library/modules/<id>/schema.py`:

```bash
python scripts/gen_wall_instances.py
```

The fast CI lane runs:

```bash
python scripts/gen_wall_instances.py --verify
```

`--verify` regenerates the YAML to a temp file and byte-compares it against the
committed copy, exiting nonzero on drift.

## Checklist for a new module

- [ ] `library/modules/<id>/` entry added (id has **no** orientation/material
      suffix — same string used everywhere downstream)
- [ ] `web/js/constants.js`: module entry in `APERTURE_MODULES` / `INT_APERTURE_MODULES`
      with the **same** `id`
- [ ] `web/js/render2d.js`: plan silhouette in `drawAperturePlan()`
- [ ] `web/js/render3d.js`: 3D framing in `buildAperture3D()`
- [ ] `web/pricing.json`: BOM spec
- [ ] `python scripts/gen_wall_instances.py` — regenerates compatibility
      `wall_instances.yaml` from the entries
- [ ] **`python build_lib.py`** — regenerates `specs.json`, the 4 `.brp`,
      `volumes.json`, `cad_library/*.FCStd`, the compatibility YAML, and the
      thumbnail. **Don't skip this** — it's what keeps the browser export from
      going stale. Commit all of it with the entry change.
- [ ] `compile_from_json.py` reassembles it (run `./compile.sh test_layout.json`)
- [ ] `python build_lib.py --verify` clean, and `node tests/parity.mjs` passes
- [ ] `python scripts/gen_wall_instances.py --verify` clean
- [ ] dims sourced from real CAD / code, not guessed — record them in
      [aperture_framing_reference.md](aperture_framing_reference.md)
