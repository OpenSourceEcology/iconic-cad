# Iconic CAD engineering-audit findings

Audit date: 2026-09-02  
Severities: critical / high / medium / low.  
Status note: issues explicitly recorded in existing `known_issues` metadata are still findings when the affected module remains `status: active` and is offered in the production palette.

Summary: 2 critical, 8 high, 8 medium, and 3 low findings (21 total). Critical: SOL-01, SOL-06. High: SOL-02, SOL-03, SOL-04, SOL-05, SOL-07, SOL-09, SOL-12, SOL-13.

## Verification baseline

Commands run from `/Users/cct/code/iconic-cad`:

```text
bash /Users/cct/GoodAncestor/projects/iconic-cad/work/sol-audit-2026-09-02/04-repro/run-node-suite.sh /Users/cct/code/iconic-cad
=> all 20 tests/*.mjs commands passed; members export covers all 15 modules
=> TOTAL FAILING COMMANDS: 0

./.venv/bin/python -m pytest tests -v
=> 28 passed in 0.12s

./.venv/bin/python -m libtools validate-code --root . --all
=> PASS for all 15 library modules

./.venv/bin/python scripts/check_links.py
=> All relative Markdown links resolve.

./.venv/bin/python build_lib.py --verify --no-thumbs
=> YAML, specs.json, and members.json passed; then:
   ERROR: freecadcmd not found on PATH — install FreeCAD to bake geometry.
```

The committed BREP/FCStd geometry could not be regenerated locally because neither `freecadcmd` nor `FreeCADCmd` is installed. Findings that need that binary are labeled **UNVERIFIED under FreeCAD**. Pure member/foundation math and Python-consumer tests were executed without FreeCAD.

Individual repro commands below use paths relative to this audit output directory; each script can also be invoked by its absolute path from any working directory.

## SOL-01 — Critical — exterior wall modules emit one top plate where the project specification requires two

**Files:** `web/js/members.js:66-83`, `web/js/members.js:95-125`, `docs/aperture_framing_reference.md:31-42`, `docs/aperture_framing_reference.md:98-103`, `seh_lib/wall_builder.py:261-268`

**What is wrong:** The canonical member enumerator explicitly emits one `top_plate` for both plain and aperture panels:

```js
// NOTE: spec says double top plate; render3d models single.
out.push(member('top_plate', studNom, 0, H - PT, W, PT));
```

The repository's authoritative exterior framing checklist says “Use a double top plate,” and its exterior aperture description repeats “double top plate.” Because `members.json` now drives `seh_lib/wall_builder.py`, this is no longer only a preview/BOM discrepancy: the under-modeled member list propagates into regenerated FreeCAD library solids, browser BREPs, cut lists, quantities, weights, and fab drawings. Fixing the plate count also requires shortening exterior full-height studs/kings/cripples by 1.5 in so the overall panel height remains unchanged.

Interior panels need a separately explicit policy: the measured non-bearing interior-door reference documents a single top plate (`docs/aperture_framing_reference.md:76-83`), so a blanket second plate on all 15 modules would also be wrong.

**Verification:** `node 04-repro/check-top-plates.mjs` reports `1 top_plate member` for every one of the 15 modules. `node tests/members_export.mjs` passes, proving the committed `members.json` faithfully contains this current behavior rather than correcting it downstream. This was previously tracked as CAD-AUD-001 and remains present.

**Concrete fix:** Add an authored `top_plate_count` (or an explicit plate-stack list) to each module schema. Generate the browser module records from those schemas, emit each plate at a distinct Z, derive vertical-member endpoints from the plate stack, update expectations/BOM/fab output, rebake BREPs/FCStd, and add acceptance tests that distinguish exterior double plates from documented interior single-plate modules.

## SOL-02 — High — every window module places its subheader inside both lower cripples

**Files:** `web/js/members.js:141-150`, `docs/aperture_framing_reference.md:23-27`, `library/modules/window_4x8_2x6_36x48/meta.yaml:17-23`, `library/modules/window_4x8_2x6_36x48/expect.yaml:38-42`

**What is wrong:** Lower cripples start at `zCripBot`, then the subheader is emitted at that same Z with a full 1.5 in height:

```js
for (const cx of cripX) emit('lower_cripple', ..., zCripBot, zSillBot - zCripBot);
emit('subheader', studNom, roX0, roW, zCripBot, PT);
```

This creates a positive-volume lumber collision, not face contact. The validator passes only because every window entry's `expect.yaml` allowlists the collision, while metadata calls it a known issue. These modules nevertheless remain active. The same erroneous member records are used by 3D, BOM/fab, and Python/FreeCAD geometry generation.

**Verification:** `node 04-repro/check-member-overlaps.mjs` finds six lower-cripple/subheader collisions: two per 8/9/10 ft window. Each collision is `38.1 mm × 38.1 mm` in elevation, equivalent to the full 1.5 in × 1.5 in cross-section over the full wall depth. **UNVERIFIED under FreeCAD:** the local machine cannot rebake the solids, but `seh_lib/wall_builder.py:87-111` is a direct box transcription, so the next FreeCAD bake will preserve these overlaps.

**Concrete fix:** Decide the actual framing sequence from the source detail. If the subheader is the bottom of the lower-cripple zone, start lower cripples at `zCripBot + PT` and shorten them; otherwise notch/split them according to a documented detail. Remove `allowed_contact`, update the expected member geometry, and add a pure-JS strict positive-volume overlap test for all framing members.

## SOL-03 — High — the active garage module's header occupies the same volume as its top plate

**Files:** `web/js/members.js:104-139`, `web/js/constants.js:38-39`, `library/modules/garage_9x8_2x6_96x84/meta.yaml:17-23`, `library/modules/garage_9x8_2x6_96x84/expect.yaml:30-34`

**What is wrong:** An 84 in rough opening plus an 11.25 in-tall 2x12 header reaches Z=95.25 in. The single top plate occupies Z=94.5–96 in. The header therefore penetrates it by 0.75 in across 99 in of run. Restoring the required second exterior top plate makes the available stack tighter, not better. Again, validation passes because `allowed_contact` explicitly suppresses the overlap, and the invalid module remains active in the palette.

**Verification:** `node 04-repro/check-member-overlaps.mjs` reports:

```text
{"module":"garage_9x8_2x6_96x84","roles":["top_plate","header"],
 "overlap":{"x_mm":2514.6,"z_mm":19.05}}
```

That is a 99 in × 0.75 in positive elevation overlap (the metadata records 408.375 in³ after wall-depth extrusion). **UNVERIFIED under FreeCAD** for the same local-tool reason as SOL-02.

**Concrete fix:** Do not merely remove the allowlist. Redesign the module envelope/detail: increase panel height, reduce rough-opening height, or select an engineered header assembly that fits the available height and load/span requirements. Encode a schema validation rule `RO top + header depth <= underside of plate stack`, and reject any active module that violates it.

## SOL-04 — High — header plies are counted in the BOM but collapsed into an undeclared full-wall-depth solid in CAD

**Files:** `web/js/members.js:31-41`, `web/js/members.js:133-136`, `web/js/render3d.js:188-210`, `seh_lib/wall_builder.py:87-111`

**What is wrong:** `header_plies` is metadata on one two-dimensional header record. Both 3D consumers ignore `plies` geometrically and extrude every non-sheathing member through the entire stud depth (`5.5 in` exterior, `3.5 in` interior). A two-ply dimensional-lumber header occupies 3 in across the wall (before any explicitly modeled spacer), not 5.5 in; the one-ply interior 2x4 header occupies 1.5 in, not 3.5 in. No spacer, insulation layer, LVL/full-depth product, or Y placement is present in the schema. Meanwhile `bom.js:72-75` multiplies the header quantity by `plies`, so takeoff semantics and CAD semantics disagree.

**Verification:** `node 04-repro/check-header-depth.mjs` reports every exterior aperture as `2 plies require 3 in across wall; renderers use 5.5 in`, and the interior door as `1 plies require 1.5 in ... renderers use 3.5 in`. The code paths above confirm both WebGL and Python generation use the full panel depth. **UNVERIFIED under FreeCAD:** baked solid dimensions could not be inspected locally, although the generator conversion is direct.

**Concrete fix:** Extend the member schema with the third-axis placement and size (`y_mm`, `depth_mm`) or explicitly expand a header assembly into ply members and optional spacers. Make both renderers consume those values. Validate that ply thickness plus declared spacers fits the wall cavity and assert per-ply solids/volumes in entry expectations.

## SOL-05 — High — all three render/export paths ignore the serialized L2 elevation and omit the floor assembly

**Files:** `web/js/state.js:56-71`, `web/js/render3d.js:293-315`, `web/js/fcstd.js:301-304`, `compile_from_json.py:443-456`, `docs/layout_schema.md:14-20`

**What is wrong:** The document creates `L2.z_mm = 3095.63`, described as a floor-to-floor rise including a bearing gap, 2x12 joists, and subfloor. WebGL, browser FCStd, and CLI FCStd all instead place L2 at the tallest L1 wall top. The Python compiler explicitly says not to read `levels[].z_mm`. For ordinary 8 ft L1 panels, L2 is placed 657.23 mm lower than the serialized level datum. The preview draws only a transparent plane and both CAD exports omit floor/rim/subfloor solids and BOM.

**Verification:** `node 04-repro/check-second-story.mjs` prints:

```text
levels[L2].z_mm: 3095.63
browser/Python exporter L2 base for an 8 ft L1: 2438.4
vertical disagreement: 657.23 mm
```

This was previously tracked as CAD-AUD-003 and remains present. No FreeCAD binary is needed to verify the placement inputs; final FCStd inspection is **UNVERIFIED under FreeCAD**.

**Concrete fix:** Until a real floor system exists, block L2 CAD/fab/build-book exports and label the preview conceptual. Then make `levels[].z_mm` the sole placement datum, model the complete floor/rim/subfloor assembly between storeys, validate consistent support elevations, and add a two-storey golden that checks each exported object's Z bounds.

## SOL-06 — Critical — climate-derived “Frost Skirt Depth” changes cost but has zero effect on foundation geometry

**Files:** `web/index.html:1051-1071`, `web/js/foundation.js:52-61`, `web/js/foundation.js:72-91`, `web/js/foundation_geom.js:162-171`, `web/js/foundation_geom.js:231-255`, `foundation_lib.py:306-320`, `web/js/bom.js:154-172`

**What is wrong:** The UI exposes an engineering-sensitive Frost Skirt Depth, prefilled from climate frost depth and warns that editing it affects frost protection. The geometry functions deliberately assign the value to an unused variable and instead create a fixed vertical loop 1 in outside the grade beam. The BOM independently prices EPS area as `perimeter × skirt_depth_mm`. Consequently, changing 150 mm to 1800 mm changes material/cost output by 12× while leaving WebGL and both FCStd geometries byte-identical. This can falsely present a foundation as climate-adapted when it is not.

**Verification:** `node 04-repro/check-skirt-depth.mjs` output:

```text
150 mm depth pieces: 9
1800 mm depth pieces: 9
geometry byte-identical: true
```

Python contains the same explicit unused assignment, and `tests/foundation_parity.mjs` only proves that both implementations share the omission. This was previously CAD-AUD-004 and remains present.

**Concrete fix:** Disable/remove the control and EPS pricing until a reviewed FPSF model exists, or implement a horizontal insulation wing whose plan extent is `skirt_depth_mm`. Derive BOM surface/volume from the actual `foundationSolids()` pieces, add monotonic tests showing greater skirt depth enlarges geometry, and keep conspicuous “not engineered/site-specific review required” labeling.

## SOL-07 — High — IFC export turns the foundation entity into a default 4×8 wall

**Files:** `export_ifc.py:41-45`, `export_ifc.py:75-105`, `web/js/io.js:18-35`

**What is wrong:** The exporter iterates every serialized entity without checking `kind`. A foundation has no `module`, `direction`, `width_mm`, or `depth_mm`, so the exporter silently substitutes `"wall"`, north, 1219.2 mm, and 150.8125 mm, then creates an `IfcWall`. The command reports that object as a wall and produces an apparently valid IFC rather than warning that foundation support is missing. It also infers height by parsing substrings in the module ID instead of using an authored/exported height.

**Verification:** `04-repro/check-ifc-foundation.py` replaces only the external IFC API with a recording stub and invokes the real `export_ifc.main()` on one wall plus one foundation. Output:

```text
Wrote .../out.ifc: 2 walls, 1 storey(s)
IfcWall count: 2
IfcWall names: ['wall_4x8_2x6_16oc [w1]', 'wall [foundation_1]']
```

The generated geometry was not opened in a real IFC viewer because `ifcopenshell` is unavailable in the audit environment; API call semantics are therefore **UNVERIFIED under ifcopenshell**, but entity dispatch and the wrong class/name are directly executed.

**Concrete fix:** Dispatch explicitly on `kind`. Export only `wall`/`iwall` as `IfcWall` now; either skip foundations with a conspicuous warning and non-success summary or map their actual slab/beam solids to suitable IFC classes. Put explicit `height_mm`/geometry references in the layout contract, reject missing/invalid dimensions, and add an IFC test that asserts entity classes and counts for a mixed layout.

## SOL-08 — Medium — fetched construction-system JSON cannot update the active SEH module objects

**Files:** `web/js/systems.js:3-31`, `web/js/systems.js:64-95`, `web/js/constants.js:5-12`, `web/js/main.js:13-22`, `web/data/systems/seh.json:1-38`

**What is wrong:** `systems.js` contains complete fallback copies of both manifests. At module evaluation, `constants.js` snapshots the fallback SEH palette into exported `MODULES`. `main.js` then starts `loadSystemManifests()` asynchronously and does not await it before initializing the UI. Replacing the manifest map later cannot update `MODULES`, `ALL_MODULES`, or consumers that already imported them. Thus `web/data/systems/seh.json` looks authoritative but changes to it are ignored by the main SEH palette/enumerator unless the duplicated JavaScript literals are also edited.

**Verification:** `node 04-repro/check-system-manifest-freeze.mjs` supplies a fetched SEH manifest whose first module is 60 in wide:

```text
loaded seh.json width: 60 in
constants.js MODULES width after load: 47.99999999999999 in
```

The checked-in copies currently match for the three manifest-listed SEH modules, which is why existing manifest tests pass.

**Concrete fix:** Choose one source. Prefer loading and validating manifest JSON before constructing the palette and before `initUI()`, with consumers querying the manifest registry rather than snapshot exports. If synchronous boot is required, generate one JS artifact from the JSON at build time and verify it. Generate/compose the aperture and interior entries through the same manifest contract rather than keeping an incomplete three-module SEH manifest plus 12 literals elsewhere.

## SOL-09 — High — the “single” member enumerator ignores declared height and derives spacing from ID text

**Files:** `web/js/members.js:57-83`, `web/js/members.js:89-112`, `web/js/constants.js:11-47`, `scripts/export_members.mjs:29-40`

**What is wrong:** Plain wall height is calculated from whether `mod.id` contains `8.5`, otherwise it is forced to 8 ft. Stud spacing is parsed from `16oc`/`24oc` substrings, with an undocumented 18 in fallback. Aperture height similarly mixes an aperture override with `4x9`/`4x10` ID parsing. The module objects already carry `height_mm`, and system manifests carry stud spacing. This means a schema/manifest can be internally correct while `members.json` bakes different geometry solely because an ID naming convention changed.

**Verification:** `node 04-repro/check-enumerator-data-use.mjs` changes only data fields/identity around the same module:

```text
declared height_mm after schema-like change: 2743.2
enumerated height_mm: 2438.3999999999996
16oc module stud X (in): 0, 16, 32, 46.5
same data after id rename stud X (in): 0, 18, 36, 46.5
```

`tests/members_export.mjs` verifies only that the baked file matches this enumerator; it does not test data-field authority.

**Concrete fix:** Give every module explicit, validated `height_mm`, `stud_spacing_mm`, lumber/plate policy, and aperture fields; make `enumerateMembers()` consume only those fields. Treat IDs as opaque stable keys. Generate the runtime module catalog from library entries so there is no second manual schema, and add metamorphic tests proving that renaming an ID cannot alter geometry.

## SOL-10 — Medium — connection blocking still has independent JS and Python framing algorithms

**Files:** `web/js/fcstd.js:85-157`, `compile_from_json.py:61-71`, `compile_from_json.py:161-347`, `web/js/members.js:57-164`

**What is wrong:** The single enumerator covers panel members only. Browser FCStd and Python FCStd each recompute stud positions, stud height, depth faces, and C1/C2/T blocking from separate hand-maintained algorithms and a separate `specs.json`/YAML path. A change such as the required plate-stack correction in SOL-01 can update panel members while leaving blocking at the old `H - 2*plate` height. `tests/parity.mjs` compares the two duplicated implementations, which detects divergence between copies but cannot prove either matches the member model.

**Verification:** Static tracing shows `fcstd.js:createBlocking()` calls its local `studPositions()` and `compile_from_json.py:create_blocking()` calls its own `stud_positions()`; neither reads the target's records from `members.json`. The current parity suite passed, establishing only present-day copy parity. Resulting blocking solids are **UNVERIFIED under FreeCAD**.

**Concrete fix:** Define blocking as member/operation records in the shared geometry contract. Obtain existing target-stud intervals and usable vertical extents from enumerated members, run one pure connection enumerator, and export its records to Python alongside `members.json`. Retain cross-language parity only for transformations/BREP packaging, not construction math.

## SOL-11 — Medium — plate purchasing uses panel width, charging tiny offcuts as full 12-foot boards

**Files:** `web/js/bom.js:27-58`, `web/js/bom.js:64-75`, `web/js/constants.js:34-39`, `tests/stock_pricing.mjs`

**What is wrong:** For every plate-role member, `stockKeyFor()` ignores `m.length_mm` and chooses stock from the module-level `plateLenFt`. Door bottom plates are split into short stubs, but each stub is charged as a full board sized for the whole panel. There is also no cutting-stock packing, so even using actual length independently would still overbuy when several pieces can share a board.

**Verification:** `node 04-repro/check-stock-plates.mjs` runs the production enumerator and stock selector:

```text
double_door_8x8_2x6_72x83
  bottom_plate 12 in -> 2x6_12ft
  bottom_plate 12 in -> 2x6_12ft
garage_9x8_2x6_96x84
  bottom_plate 6 in -> 2x6_12ft
  bottom_plate 6 in -> 2x6_12ft
```

The stock-pricing test covers long studs/headers but not split plates.

**Concrete fix:** First map all stock by the member's actual cut length. Then separate the cut list from the purchase list and apply a deterministic cutting-stock optimizer per nominal/grade, with configurable kerf and waste allowance. Add tests where both door stubs fit a single stock board and where an impossible cut is rejected rather than silently assigned the longest stocked length.

## SOL-12 — High — aperture sheathing has three contradictory installation states

**Files:** `docs/aperture_framing_reference.md:98-103`, `web/js/members.js:155-161`, `web/js/render3d.js:200-210`, `web/js/bom.js:130-151`, `seh_lib/wall_builder.py:1-18`, `seh_lib/wall_builder.py:297-315`

**What is wrong:** The framing reference says exterior OSB covers the whole panel face and is cut on installation. The JS member model instead emits four pre-cut strips around the opening, and WebGL/fab drawings consume those strips. Python deliberately ignores those records, creates one full sheet, and subtracts the rough opening in CAD. The BOM separately buys whole sheets from `specs.json`. Thus preview, fab card, Python CAD, written procedure, and purchase quantities do not describe one build state.

**Verification:** The divergence is explicitly documented in `wall_builder.py` and `scripts/export_members.mjs`; all aperture metadata keeps CAD-AUD-005 as a known issue. The JS and Python code above show strip emission versus boolean subtraction. The member-export and Python-box tests pass because Python's test intentionally skips `sheathing`, not because the outputs agree. Final cut topology is **UNVERIFIED under FreeCAD**.

**Concrete fix:** Choose and name canonical states, for example `stock`, `factory_cut`, and `installed`. Model a sheet as one material item with explicit cut operations/openings rather than four independent purchased strips. Render/export the requested state from that record, make fab instructions describe the cut operation, and validate that material area/stock count and installed geometry remain linked.

## SOL-13 — High — the active interior-door module contradicts the measured reference detail

**Files:** `docs/aperture_framing_reference.md:61-83`, `web/js/constants.js:42-44`, `web/js/members.js:95-139`

**What is wrong:** The measured interior-door reference calls for two outer end studs, two inner full-height studs, no separate jack studs, and a flat 1.5 in-high 2x4 header at Z=83 in. The shared aperture algorithm instead emits two shortened jacks, no inner full-height studs, and interprets nominal `2x4` depth as a 3.5 in-tall header. The module is in `ALL_MODULES` and available as an active editor choice.

**Verification:** Direct comparison of the measured coordinate table at lines 65-76 with emitted roles/geometry at `members.js:127-139`. The existing known-issue metadata tracks this as CAD-AUD-010, but the green member export merely preserves the mismatch. **UNVERIFIED under FreeCAD** for regenerated solid inspection.

**Concrete fix:** Do not send interior and exterior apertures through one implicit framing pattern. Add an authored `framing_detail`/member-stack policy (or explicit member records) for the measured non-bearing interior assembly, including header orientation. Add exact-coordinate expectations from the reference table and prevent `status: active` when a module retains an unwaived structural mismatch.

## SOL-14 — Medium — layout loading is lossy and non-transactional

**Files:** `web/js/io.js:56-76`, `web/js/load.js:10-17`, `web/js/load.js:43-87`, `docs/layout_schema.md`

**What is wrong:** `applyLoadedData()` resets the live document before validating the input. Unknown module IDs only produce `console.warn` and are silently omitted, while a later mixed-system error throws after earlier entities have already been inserted. `io.js` catches that exception and displays an alert, but the user's previous design is gone and a partially loaded document remains. The loader also accepts any `version`/`units`, directions, coordinates, levels, foundation parameter shape, and duplicate IDs without contract validation.

**Verification:** `node 04-repro/check-load-transaction.mjs` produces:

```text
Unknown module: module_does_not_exist
unknown-module load returned normally: true
requested entities: 2 loaded entities: 1
later mixed-system error: Mixed construction systems are not supported: project seh, entity vcs12
entities left after failed load: [ 'valid' ]
```

Existing load tests exercise resets/defaults but not rejection atomicity or unknown-module preservation.

**Concrete fix:** Parse and validate into a detached candidate document, collect all errors, and swap it into `doc` only after the entire file passes. Reject unsupported versions/units, unknown modules, invalid enums/non-finite numbers, missing referenced levels, duplicate IDs, bad connections, and incomplete foundation params. If forward compatibility requires unknown entities, preserve them as opaque disabled records—never silently delete them.

## SOL-15 — Medium — save/export drops assembly provenance needed for a faithful custom-assembly round trip

**Files:** `web/js/state.js:13-18`, `web/js/assembly_translate.js:79-95`, `web/js/assembly_translate.js:103-126`, `web/js/assembly_translate.js:185-203`, `web/js/io.js:10-35`, `web/js/load.js:72-85`

**What is wrong:** Exploding an assembly stores its complete source module object—including per-module options such as window dimensions and corner reinforcement—in `entity.props.assembly.module`. `composeAssembly()` prefers that object so it can reproduce the assembly schema. The loader restores `m.props`, but both Save and Export omit `props` from serialization. After a save/load cycle, compose falls back to `{type}` and silently loses all such overrides.

**Verification:** `node 04-repro/check-props-save.mjs` checks the four sides of the source contract and reports:

```text
state_declares_props: true
loader_restores_props: true
compose_consumes_props: true
serializer_writes_props: false
```

The existing custom round-trip test composes directly from in-memory exploded entities; it does not pass them through layout serialization.

**Concrete fix:** Serialize validated `props` (or, better, a specifically versioned `source_module` field) and test `explode → save JSON → load → compose`. Avoid a completely open property bag in the durable file format: define allowed names/types and preserve unknown future fields under an explicit extensions namespace.

## SOL-16 — Medium — foundation cost is not pure over its advertised entity argument

**Files:** `web/js/bom.js:154-172`, `web/js/bom.js:175-200`, `web/js/region.js:200-208`

**What is wrong:** `foundationEstimate(entities)` finds the foundation and perimeter from its explicit argument but obtains slab area through `regionForLevel('L1')`, which reads and caches global `doc.entities`. `computeTotalCost()` is documented as pure over `(entities, catalog)`, yet the same input can produce a different result depending on unrelated global document/cache state. Tests pass because they always pass `doc.entities` itself.

**Verification:** `node 04-repro/check-foundation-estimate-purity.mjs` calls the function twice with the identical argument `[foundation]`:

```text
explicit argument wall count: 0
with global shell concrete_m3: 1.01673086976
with blank global doc concrete_m3: 0
same explicit argument, same result: false
```

**Concrete fix:** Call the pure `computeRegion(entities.filter(...))` inside the estimate or pass a precomputed region as an explicit argument. Keep the doc-reading cache wrapper only at the UI boundary. Add a test in which the requested entity list intentionally differs from global state.

## SOL-17 — Medium — the documented build is missing a required dependency, and GitLab geometry verification cannot install it

**Files:** `build_lib.py:72-78`, `requirements.txt:1-3`, `requirements-dev.txt:1-2`, `README.md:34-38`, `README.md:62-70`, `.github/workflows/ci.yml:19-35`, `.gitlab-ci.yml:16-39`, `.gitlab-ci.yml:57-62`

**What is wrong:** `build_lib.py` unconditionally runs `python -m libtools`, but neither requirements file declares `libtools`. The README tells contributors to install only `requirements.txt` and later run `python build_lib.py`. GitHub CI compensates with an undocumented VCS URL in its workflow. GitLab's normal and FreeCAD jobs install only the two requirements files; in particular, `verify-geometry` then calls `build_lib.py`, so a clean runner has no `libtools` module. The CI providers also run different subsets: GitHub omits `system_load.mjs` and `systems_manifest.mjs`, while GitLab omits those plus several library/round-trip tests and the `members.json --verify` gate.

**Verification:** Repository dependency/workflow inspection at the cited lines. The audit environment's pre-existing `.venv` happens to contain `libtools`, so the local command passed. Creating a clean environment succeeded, but network-restricted package installation could not complete; the actual hosted GitLab failure is therefore **UNVERIFIED in GitLab**. The missing declaration and invocation are deterministic from the files.

**Concrete fix:** Declare a pinned, immutable `libtools` source in a lockable dev/build requirements file (prefer a release/tag or commit, not a moving branch), update the README to install build dependencies, and have all CI use the same installer. Replace hand-listed JS commands with one checked-in suite runner that discovers `tests/*.mjs`, and call the same generated-artifact gates on both providers.

## SOL-18 — Medium — a third-party CDN outage prevents the entire editor from booting, not only 3D

**Files:** `web/index.html:7-18`, `web/index.html:1077`, `web/js/main.js:5-28`, `web/js/render3d.js:11-17`, `README.md:134-138`

**What is wrong:** The import map resolves `three` to jsDelivr. `main.js` statically imports `render3d.js`, which statically imports `three`; browser module linking must complete before any body of `main.js` runs. Therefore the `try/catch` around `init3d()` cannot degrade gracefully when Three.js fails to download—the entire editor initialization, including 2D, load/save, and BOM, never executes. This conflicts with the app's otherwise static/offline posture; “no internet required after initial load” depends on an unguaranteed browser HTTP cache. Google Fonts are also remote but only affect styling.

**Verification:** Static ES-module dependency trace at the cited lines. Node also fails to import the browser chain without a resolution for `three`, illustrating that the dependency is required at link time. A real-browser CDN-failure smoke test was not available, so UI behavior is **UNVERIFIED in a browser**, but module-link failure semantics are standard.

**Concrete fix:** Vendor the pinned Three.js module/addons under `web/vendor/` or produce a reproducible bundled build with hashes/licenses. Point the import map locally. Add a browser smoke test with all external network blocked that asserts 2D editing starts; keep 3D failure handling for WebGL capability errors only.

## SOL-19 — Low — the public landing page and deployment definitions are outside the same release contract as the app

**Files:** `.github/workflows/publish-app.yml:1-28`, `.gitlab-ci.yml:74-84`, `landing/index.html:99-123`, `landing/index.html:186-194`

**What is wrong:** Both checked-in deploy jobs publish only `web/`; neither publishes or validates `landing/`, and no workflow in the repo targets `iconic-cad.goodancestor.com`. The live host was checked on 2026-09-02 and serves the landing content, whose editor links point to the independently deployed GitHub Pages app. This split may be intentional, but it is an undocumented manual production release path. The landing's hero example has also drifted from active data: it depicts an 8 ft-wide window panel, a 32 in sill, a 2x10 header, and a double top plate, while the active editor window modules are 4 ft wide with a 24 in sill, 2x8 header, and the erroneous single top plate. It presents example text as though it is the input that generated the drawing.

**Verification:** Workflow/source comparison above plus read-only inspection of `https://iconic-cad.goodancestor.com/` on the audit date. The ownership and external automation of that domain are **UNVERIFIED** because no configuration is present in this repo.

**Concrete fix:** Document which host owns each artifact and add one release workflow (or a clearly linked external deployment definition) that tests and deploys the intended `landing/` + `web/` topology atomically. Generate the hero example from a real checked-in active entry, or label it conceptual; add a content test that its parameters/member count match the source entry.

## SOL-20 — Low — `compile.sh` interpolates an unescaped filename into executable Python source

**File:** `compile.sh:1-7`

**What is wrong:** The shell expands `$1` inside the string passed to `freecadcmd -c`:

```bash
freecadcmd -c "import sys; sys.argv=['compile_from_json.py',\"$1\"]; exec(...)"
```

A filename containing a quote/backslash can break the command, and a deliberately crafted filename can inject Python statements into the FreeCAD process. This is primarily a local robustness problem, but layout filenames should be treated as data.

**Verification:** Direct shell/source inspection. Execution was **UNVERIFIED** because `freecadcmd` is not installed; no exploit payload was run.

**Concrete fix:** Stop embedding user data in `-c`. Use FreeCAD's supported script invocation with arguments if available, or pass the path via a separately quoted environment/argv channel and read it as data. Add a shell test with spaces, quotes, Unicode, and leading dashes in the filename.

## SOL-21 — Low — `build_lib.py --verify` leaks its temporary tree on early failure

**Files:** `build_lib.py:67-69`, `build_lib.py:145-153`, `build_lib.py:292-336`

**What is wrong:** Verify mode creates a directory with `mkdtemp`, but cleanup occurs only at the bottom of the success path. `run_geometry()` calls `fail()`, which raises `SystemExit` when FreeCAD is absent (and other helpers can do likewise), bypassing `shutil.rmtree`. Repeated failed verification leaves full generated YAML/spec directories in the system temp area.

**Verification:** The audit command printed temp path `/var/folders/.../build_lib_verify__dxsddk9`, then exited at “freecadcmd not found.” The directory still existed afterward.

**Concrete fix:** Wrap the complete verify body in `try/finally: shutil.rmtree(tmp, ignore_errors=True)`, and have helpers return/raise ordinary errors rather than calling `sys.exit` deep inside the call stack. Add a subprocess test that intentionally fails after temp creation and asserts cleanup.
