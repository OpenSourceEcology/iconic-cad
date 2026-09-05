# Iconic CAD architecture map

Audit date: 2026-09-02  
Repository: `/Users/cct/code/iconic-cad`  
First-pass status: written before detailed defect investigation; later observations may refine this map.

## What the repository actually contains

Iconic CAD is primarily a no-build, static ES-module web application, plus generators and exporters written in Python and Node:

- `landing/index.html`: a separate static landing page. No checked-in workflow seen in the first pass publishes `landing/`; the deployment mechanism for `iconic-cad.goodancestor.com` is therefore **UNVERIFIED** from this repository alone.
- `web/index.html` and `web/js/*.js`: the browser layout editor. `web/js/main.js:5-30` initializes system manifests, WebGL preview, UI, project options, foundation/trade flows, canvas, and pricing. There is no bundler or `package.json`; browser-native ES modules are served directly.
- `web/assets/lib/`: committed derived artifacts used by browser export and preview, including four directional BREP files per SEH module, `members.json`, `specs.json`, and `volumes.json`. `web/assets/lib/vcs12/` holds the demonstrator's separately baked assets.
- `library/modules/*/`: source library entries (`schema.py`, compiler wrapper, metadata, and expected-output contract). `scripts/entry_instances.py` turns these entries into the aggregate instance document; `wall_instances.yaml` is generated compatibility/input data rather than the newest authoring source.
- `seh_lib/wall_builder.py` and `generate_wall_library.py`: turn module entries and the exported member lists into FreeCAD wall-library documents.
- `compile_from_json.py`: places generated FreeCAD wall shapes and procedural blocking/foundation pieces into a layout assembly.
- `export_ifc.py`: experimental, coarse IFC4 exporter; it emits one rectangular `IfcWall` per wall entity rather than framing solids.
- `foundation_lib.py`: FreeCAD-free foundation/silhouette geometry implementation kept in parity with `web/js/foundation_geom.js`.
- `tests/`: plain Node `.mjs` scripts plus pytest tests; most geometry math is intentionally testable without FreeCAD.

## Authoring and generated-data flow

The current SEH source/generation path is:

```text
library/modules/*/{schema.py,meta.yaml,expect.yaml,compiler.py}
                  |
                  +--> scripts/entry_instances.py
                         |
                         +--> scripts/gen_wall_instances.py --> wall_instances.yaml
                         +--> scripts/gen_specs.py ----------> web/assets/lib/specs.json

web/js/constants.js (ALL_MODULES)
        +
web/js/members.js (enumerateMembers)
        |
        +--> scripts/export_members.mjs --> web/assets/lib/members.json
                                               |
                                               +--> seh_lib/wall_builder.py
                                                      |
                                                      +--> FreeCAD library/BREP bake
```

Evidence:

- `scripts/export_members.mjs:35-40` iterates sorted `ALL_MODULES` and calls `enumerateMembers(mod)` for each.
- `seh_lib/wall_builder.py:33-55` loads the committed `members.json` and selects members by module ID.
- `seh_lib/wall_builder.py:87-111` performs a deliberately thin conversion from member records to box specifications, skipping sheathing.
- `seh_lib/wall_builder.py:261-268` uses those box specifications for Python/FreeCAD framing geometry, while still generating OSB separately.
- `build_lib.py:338-368` regenerates YAML, specs, members, FreeCAD/BREP geometry, volumes, and optionally thumbnails in that dependency order.

Important boundary: `members.json` is a generation-time contract for Python/FreeCAD library geometry. The browser FCStd path does **not** consume it at runtime; `web/js/fcstd.js` translates the committed directional `.brp` assets and adds procedural blocking/foundation shapes. This is why `.github/workflows/geometry-verify.yml:1-65` runs the heavy `build_lib.py --verify --no-thumbs` gate when generator or baked-asset paths change.

Known intentional exception: aperture sheathing is not single-sourced. `web/js/members.js` enumerates rectangular sheathing strips, while `seh_lib/wall_builder.py:10-18` documents that FreeCAD generation cuts an opening from one full sheet and ignores member-list sheathing records.

## Runtime web data flow

1. `web/js/main.js` starts the app and asynchronously loads `web/data/systems/{seh,vcs12}.json` through `web/js/systems.js:85-95`.
2. `web/js/state.js` owns the v2 document (`project`, levels, layers, entities) and UI/history state.
3. Placement/snap modules create entities containing a module object, direction, millimetre position, level/layer, system, and optional T-junction connections.
4. Rendering fans out to:
   - `render2d.js` / `plan_rects.js` for plan geometry;
   - `render3d.js` plus `members.js` for framing preview;
   - `bom.js` plus `pricing.json` for takeoff and estimates;
   - `render_fab.js`, `runs.js`, and `render_summary.js` for fabrication/build outputs;
   - foundation and trade flows in `foundation*.js` and `trades.js`.
5. `web/js/io.js:10-40` serializes the v2 JSON contract. Non-foundation entities carry `module`, `system`, `direction`, `(x_mm,y_mm)`, level/layer, width/depth, owner, and optional connections; foundations carry parameter objects.
6. Output paths:
   - Browser `.FCStd`: `web/js/fcstd.js` fetches committed BREPs, transforms them, and packages the FreeCAD archive using vendored JSZip.
   - CLI `.FCStd`: `compile_from_json.py` reads the JSON, loads `cad_library/*.FCStd`, applies direction/position/level placement, creates blocking/foundation solids, and saves an assembly. This requires `freecadcmd` and a generated local `cad_library/`.
   - IFC4: `export_ifc.py` maps layout wall entities to box-shaped `IfcWall` objects grouped into storeys.

## Construction systems

- SEH (`web/data/systems/seh.json`): default panelized system. Its manifest currently describes only the three plain exterior palette modules. Interior and aperture modules remain hard-coded in `web/js/constants.js:13-45`, so the construction-system abstraction is incomplete.
- VCS-12 (`web/data/systems/vcs12.json`): demonstrator containing five exterior module types and separate baked assets. Per `README.md:18`, major workflows are deliberately disabled for this system.
- `web/js/systems.js:3-31` also embeds fallback copies of both manifests. At runtime fetched JSON replaces them after validation. This creates two copies of each system manifest in tracked code/data.

## Layout and geometry units

- Browser/layout contract: millimetres (`docs/layout_schema.md:14-39`).
- Module authoring and many construction inputs: feet/inches or inches; conversion constant is generally `25.4` mm/in.
- Browser canvas coordinates are Y-down. FreeCAD is Y-up; `compile_from_json.py` and the browser FCStd translation have explicit transform conventions that parity tests exercise.
- Entity `width_mm` is the unrotated run length and `depth_mm` is wall thickness; direction determines the plan bounding box.

## Test coverage map

The GitHub fast CI lane (`.github/workflows/ci.yml:19-59`) covers:

- generated YAML/spec/member freshness;
- Python blocking math, entry/library drift, generated-entry shape, and members-to-box conversion;
- JS/Python blocking golden parity and foundation golden parity;
- member enumeration/rendering acceptance values, cut-list fractions, pricing/stock selection, and foundation cost;
- load reset, canvas resize regression, project shape, export gates, local JSZip use;
- assembly translation, custom-entry round trips, entry files, and built-in library;
- Markdown relative links and library-entry code validation.

The path-filtered heavy GitHub lane (`.github/workflows/geometry-verify.yml:12-65`) installs FreeCAD, runs `build_lib.py --verify --no-thumbs`, and validates library output. Thumbnail regeneration is not a required CI check.

Material gaps visible in the first pass (to be investigated before assigning findings):

- no browser/DOM end-to-end test of actual interactive placement, download, or deployment;
- no checked-in test invocation for `tests/system_load.mjs` or `tests/systems_manifest.mjs` in GitHub fast CI;
- no obvious automated IFC exporter tests;
- no obvious direct end-to-end CLI assembly test under `freecadcmd` in the fast suite (the heavy generator lane validates generated module outputs, not necessarily a compiled layout);
- deployment does not have a smoke/link test against the hosted domain.

## Build and deploy path

- Development: serve `web/` directly (`python3 -m http.server 8080 --directory web` or the no-cache `scripts/serve.py`).
- Library rebuild: `python build_lib.py`; it requires libtools, Node, FreeCAD, and optionally Chromium/network for thumbnails. `--verify --no-thumbs` is the reproducibility gate.
- CLI use: `generate.sh` creates the gitignored `cad_library/`; `compile.sh <layout.json>` invokes the FreeCAD compiler.
- GitHub Pages: `.github/workflows/publish-app.yml:1-28` uploads only `web/` after pushes to `main` that touch `web/**`.
- GitLab Pages: `.gitlab-ci.yml:74-83` copies only `web/` to `public/` on the default branch.
- Production custom-domain deployment of both `landing/` and `web/`: **UNVERIFIED**. No CNAME, landing-copy step, custom-domain config, or infrastructure definition was found in the first-pass tracked-file inventory.

