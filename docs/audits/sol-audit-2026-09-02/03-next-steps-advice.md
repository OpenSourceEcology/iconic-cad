# Iconic CAD: ranked next-step advice

Audit date: 2026-09-02

## Bottom line

Iconic CAD is ready to become a data-driven *building-system compiler*, but it is not yet safe to widen its catalog. The highest-leverage move is to finish the source-of-truth refactor: one validated module schema should produce member/operation records, every preview/export/BOM should consume those records, and an active module should be unable to pass with positive-volume collisions or unresolved construction-critical issues. Adding dozens of wiki modules before that will multiply the current ambiguity.

## Ranked work

### 1. Correct or disable misleading construction output first

Treat SOL-01 through SOL-06, SOL-12, and SOL-13 as one release-blocking geometry program:

1. Temporarily disable climate/frost-skirt claims and two-storey CAD/build-pack output. Keep those modes visibly conceptual until the missing assemblies exist.
2. Get a maintainer plus an experienced SEH framer/engineer to approve canonical details for exterior plate stacks, window lower framing, garage header/envelope, header plies/spacers, interior doors, and sheathing installation state.
3. Encode those decisions as data, not new branches keyed by module ID.
4. Reject positive-volume lumber intersections for every active entry. An allowlist is suitable for intentional joinery only when it names the joint/detail and records approval; `known_issue` should force `wip`/non-palette status for a construction-critical defect.
5. Rebuild and inspect all 15 BREPs/FCStd files under `freecadcmd`, then compare member counts, bounds, volumes, and representative screenshots before release.

This comes before feature work because the present app can generate polished drawings, quantities, and CAD that consistently repeat a wrong detail. Internal consistency is useful only after the construction rule is correct.

### 2. Finish the single-source model

Make `library/modules/*` the authored source. Generate all of these from it:

- the full SEH system manifest, including interior/aperture modules;
- browser runtime module records;
- `members.json` (or its replacement);
- specs, BOM rules, thumbnails, and baked geometry.

The replacement member contract should be three-dimensional and operation-aware. At minimum, each record needs a stable member ID, role, material/product ID, nominal and actual dimensions, `x/y/z`, orientation, cut length, quantity/plies, stock state, and any cut/drill/opening operations. Assembly records need connections/ports and support/host relationships. IDs must be opaque keys; dimensions and stud spacing must never be inferred from ID text.

Then move T-junction blocking, sheathing, and foundation takeoff onto shared pure enumerators. Keep renderer/exporter code limited to coordinates, transformations, and file packaging.

### 3. Make the layout file a validated, lossless contract

Introduce an explicit next schema version rather than silently stretching v2. Recommended additions:

- module revision/digest as well as module ID and system;
- canonical `level_id` whose authored `z_mm` all consumers honor;
- typed entity payloads per kind rather than optional fields on one loose object;
- validated connection/host/port references;
- an extensions/provenance namespace for assembly source data;
- explicit geometry/material state (`stock`, `fabricated`, `installed`);
- source units only at ingestion; normalized persisted geometry in millimetres;
- migration functions for every supported old version.

Loading must be transactional: validate a detached candidate, report all errors, then replace the document. Save/load and browser/CLI/browser-FCStd parity should be golden tests over the same fixtures.

### 4. Repair exporters and takeoff before calling them handoff artifacts

- IFC: filter by kind immediately; export only classes with supported geometry and state omissions in the file/report. Stop deriving dimensions from names. Add round-trip checks with real IfcOpenShell.
- Second story: model joists, rim, subfloor, bearing/support, openings, and story datum before enabling fabrication exports.
- BOM: derive material from actual members/operations, separate cut list from purchase list, implement deterministic stock packing, and retain price source/date/region separately from quantity.
- Foundation: derive cost from emitted solids; keep site/climate/geotechnical inputs and engineering approval distinct from geometric parameters.

### 5. Turn CI and deployment into one reproducible release gate

Pin all build dependencies, including `libtools`; use one discovered JS test runner in GitHub and GitLab; and add a small checked-in layout compiled end-to-end by FreeCAD in the heavy lane. The gate should inspect the resulting FCStd, not only library entries. Vendor Three.js so the static editor starts without external network.

Define the production topology in the repo: which content serves `/`, where the editor lives, how `landing/` and `web/` are versioned together, and which domain is smoke-tested after deployment. Generate landing examples from real entries so marketing diagrams cannot drift.

## What the current structure is ready for next

After ranks 1–3, the codebase has useful extension seams:

- Library entries already separate schema, compiler, metadata, and expectations. That is the right unit for adding reviewed, parametric modules.
- System manifests provide the beginning of construction-system selection. Once they are actually authoritative, SEH variants and VCS-12 can share editor infrastructure without sharing framing assumptions.
- Orthogonal `level` and `layer` fields plus trade producer/group registries are a credible basis for foundation, floor, roof, electrical, plumbing, HVAC, and solar objects.
- Pure JS geometry plus Python parity is a good testing approach where a browser exporter and FreeCAD compiler both need the same result. Generate shared fixtures/records rather than maintain parallel formulas.
- Assembly explode/compose and custom entries are a promising route for named wall runs, rooms, utility walls, and whole-house templates—after serialization is lossless.

The lowest-risk next content is therefore more *reviewed wall/interior variants and build metadata*, not a complete automatic house-services designer.

## Incorporating OSE wiki content

The wiki is a rich discovery index, not a clean canonical database. Its [SEH 4 overview](https://wiki.opensourceecology.org/wiki/Seed_Eco-Home_4) links design, CAD, wiring/plumbing, BOM, cut-list, build, and lifecycle material. The [3D CAD page](https://wiki.opensourceecology.org/wiki/Seed_Eco-Home_4_3D_CAD) contains extensive FreeCAD assets and build cheatsheets, including many exterior/interior modules, utility-wall/MEP assemblies, roof/PV/floor/stair details, and module generators. It also labels several assets incomplete, outdated, or positionally incorrect. The [module breakdown page](https://wiki.opensourceecology.org/wiki/Seed_Eco-Home_4_Module_Breakdown) is mostly an external-document pointer, so it cannot be treated as a stable machine-readable inventory.

Use an import ledger for every wiki-derived artifact:

```text
source_url, MediaWiki oldid/revision, retrieved_at, license,
source_asset checksum, claimed design/build version,
verification status, reviewer, supersedes/superseded_by
```

Imported assets should start quarantined as `reference` or `wip`; a human-approved normalized schema plus tests—not the downloaded FCStd alone—promotes them to `active`.

| Wiki content | Good first use in Iconic CAD | Data/schema changes needed |
|---|---|---|
| SEH exterior/interior wall modules and cheatsheets | Expand the reviewed wall catalog; map named modules 1–47 and interiors to reusable framing variants plus design-specific instances | Separate `module_type` from `design_instance`; explicit 3D member stacks, openings, channels/blocking, interfaces, story applicability, source revision, status and approvals |
| Module generators and detail files | Evidence/fixtures for parameter ranges and exact expected coordinates | Parameter schemas with units/ranges; operation records for notches, holes and cuts; golden member/bounds/volume tests; no opaque spreadsheet/name parsing |
| Floor joist blocking/covers, second-story framing, sills, stairs and landings | First complete inter-storey assembly and explicit vertical section | Floor/roof-style planar assembly entities; span/bearing direction, joist/rim profiles, layers, openings, support edges, connection ports, load/design assumptions, level datum |
| Tapered roof, top band, EPDM, PV rack/panels/ledger brackets, trellis and carport | Roof/solar assemblies placed on a host building envelope | Roof planes/polygons, slope and drainage, layered membranes, edge profiles, penetrations, host attachment points, equipment arrays, clearance/load zones, assembly transforms |
| Foundation plumbing, footers, flashing and foundation cheatsheet | Reference assemblies tied to a validated footprint; not automatic engineering | Foundation system variants, site/climate/geotechnical inputs, slab/beam/insulation layer solids, penetrations/sleeves, elevations, reinforcement placeholders, engineering-review state |
| Utility wall and “quad modules” combining structure + MEP | High-value composite modules after host/port support exists | Typed host relationships; component/segment graph; connection ports with media/size/direction; clearances; penetrations/firestops; structural blocking dependencies; cross-trade clash checks |
| Electrical part library, boxes, circuits, panels, disconnects and heat-pump/PV equipment | A catalog of typed devices and authored circuit templates | Electrical device/product IDs, voltage/phase/rating, circuits and conductors, panel slots, route segments, box fill/clearance, hosts/elevations, code edition/jurisdiction, simplified display vs fabrication geometry. The wiki itself notes its master is missing items on the [electrical library page](https://wiki.opensourceecology.org/wiki/SH4_Electrical_Part_Library). |
| Plumbing fittings, drains, supply, fixtures and rough dimensions | Typed part catalog and reviewed authored utility-wall runs | Nominal size/material/system, connector geometry, slope, flow direction, fittings, fixture units, vents/cleanouts, route/host, penetration and test state. The [SEH 4 plumbing page](https://wiki.opensourceecology.org/wiki/SEH_4_Plumbing) explicitly says the fully updated positionally correct model is not done. |
| BOM spreadsheets, shopping lists and as-built corrections | Normalize material identities and compare model-derived quantities against as-built procurement | Stable material/product IDs, dimensional units, package/stock sizes, quantity basis, waste/kerf, supplier/region/currency, price timestamp, substitutions, revision and provenance. The [BOM page](https://wiki.opensourceecology.org/wiki/Seed_Eco-Home_4_BOM) points to multiple “final,” master, staging, workshop and event lists; preserve those meanings rather than merging blindly. |
| Build working documents, photos, cheatsheets and QC notes | Versioned procedures attached to module/member/assembly IDs; acceptance checks in generated build packs | Procedure steps, prerequisites, dependencies, tools/PPE, inputs/outputs, referenced entities, media/source revision, role/crew, estimated time, hazard, hold points and measurable QC results. The [build-instructions page](https://wiki.opensourceecology.org/wiki/Seed_Eco-Home_4_Build_Instructions) spans foundation skirt through roof/PV/MEP/finishing and includes checks such as water pressure testing. |
| Other OSE houses | New construction-system/design packages using the same generic library interfaces | Namespaced systems, compatibility constraints, design templates, migrations and source/revision lineage; never mix their details into SEH defaults by filename similarity |
| Other OSE machines/GVCS designs | Share an external part/module/assembly catalog and validation framework | General interface/port, material, BOM, procedure and provenance schemas can be shared; machine-specific kinematics, hydraulics, controls, tolerances and analysis need separate editors/compilers rather than additions to the wall-layout document |

## What not to attempt yet

1. **Do not call generated output permit-ready, code-compliant, or engineered.** Header selection, wind/seismic/snow loads, foundations, roof spans, stairs, electrical, plumbing, and energy details require jurisdiction/site-specific design and qualified review. The current climate fields are intent, not analysis.
2. **Do not bulk-import every wiki FCStd or scrape it directly into the active palette.** The wiki openly contains incomplete, duplicated, migrated, and positionally incorrect assets. Normalize, checksum, review, and validate one bounded family at a time.
3. **Do not enable two-storey fabrication or roof/foundation automation before support assemblies exist.** A transparent floor plane and wall-top-derived elevation are not a floor system; the foundation skirt currently demonstrates the danger of controls not tied to solids.
4. **Do not implement automatic MEP routing first.** Start with authored devices, ports, runs and clash detection. Routing needs code constraints, slopes, bend radii, access/clearance, structural penetrations and cross-trade coordination that the current entity model cannot express.
5. **Do not broaden IFC claims beyond tested semantic coverage.** A geometrically visible box is not automatically the right IFC entity, type, containment, material, opening, system, or property set.
6. **Do not force tractors, fabrication machines, or other GVCS products into the house wall placer.** Reuse the library ontology and validators, then give each domain an appropriate composition model.
7. **Do not scale AI-authored module generation ahead of acceptance tests and review workflow.** AI can accelerate schema/fixture drafting, but promotion to `active` needs source provenance, collision/envelope checks, BOM reconciliation, render/export parity, and a named human approval.

## Suggested milestone definition

Call the next milestone complete when one corrected exterior wall, one corrected exterior aperture, and the measured interior door all travel this exact path with no exceptions:

```text
reviewed entry schema
  -> generated runtime catalog + explicit 3D member/operation records
  -> identical WebGL / browser FCStd / Python FCStd construction state
  -> cut list + packed purchase list + build procedure
  -> strict validators and save/load golden
```

Once that vertical slice is trustworthy, expand across the SEH wall library, then implement one complete floor/roof or utility-wall family rather than several shallow trade demos.
