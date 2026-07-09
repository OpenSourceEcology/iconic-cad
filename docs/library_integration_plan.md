# Library Integration Plan

Goal: connect Iconic CAD (the interface) to validated part libraries built on
the [Schema Canon](https://wiki.opensourceecology.org/wiki/Schema_Canon)
structure, as implemented in
[vcs-library](https://github.com/OpenSourceEcology/vcs-library). Three
milestones, each independently shippable. Tracking issues: L1 / L2 / L3 on the
issue tracker.

Standing constraints:

- The M0 "Geometry Trust" milestone (issues #1–7) is unchanged and still the
  gate for calling any output build-ready. L1–L3 add validation and plumbing;
  they must not silently alter existing framing geometry. Where a validator
  exposes an M0-class geometry problem, record it against the relevant issue
  instead of patching around it.
- Web behavior parity: after L2 the browser app must produce byte-identical
  `specs.json` semantics and identical geometry for the existing 15 modules
  (existing parity + BREP-verify CI jobs are the judges).
- `libtools` comes from vcs-library as a dependency
  (`pip install git+https://github.com/OpenSourceEcology/vcs-library`), not a
  copy. Anything missing from libtools gets added upstream in vcs-library,
  keeping it library-agnostic.

## L1 — Validate Iconic CAD's own modules (SEH library)

Iconic CAD's 15 modules exist only as `wall_instances.yaml` entries; nothing
validates their compiled geometry beyond compiler-vs-compiler parity. L1
expresses each module as a library entry and runs both validator tiers in CI.

Layout (in this repo):

```
library/
  modules/<yaml id>/          # one entry per wall_instances.yaml instance
    schema.py                 # SCHEMA mirroring the YAML instance parameters
    compiler.py               # def compile(schema, doc) -> list; thin wrapper
    meta.yaml                 # owner: Collin DeSantis; provenance: wall_instances.yaml + wiki
    expect.yaml               # envelope, member roles/counts, overlap, params
seh_lib/                      # shared family builders the thin compilers call
```

Contracts:

- `seh_lib` reuses `generate_wall_library.py`'s geometry logic (refactor the
  reusable core into `seh_lib`, keep `generate_wall_library.py` as a thin
  caller so the existing pipeline is untouched). Entry compilers may import
  `seh_lib` (repo-local shared code is allowed here; the vcs-library
  self-contained rule applies to that repo's seeded entries, not to this one).
- A drift test (fast CI) asserts: set of entry ids == set of YAML instance
  ids, and each entry's SCHEMA parameters == the YAML instance parameters.
  `wall_instances.yaml` remains the authored source of truth in L1; entries
  are its validated projection.
- expect.yaml member-role counts come from `docs/aperture_framing_reference.md`
  and the YAML params (stud counts from spacing math). Known M0 deviations
  (e.g. single top plate, #1) get expect values matching CURRENT behavior plus
  a `known_issues` note in meta.yaml naming the M0 issue — the entry validates
  what the code does today; the M0 fix updates both together.
- CI: fast job runs `validate-code`; the existing FreeCAD job additionally
  runs `validate-output` for `library/**` / `seh_lib/**` changes.

Done when: all 15 entries pass both tiers in CI; drift test green; M0
deviations recorded not masked.

## L2 — Palette from the library

`build_lib.py` currently derives every web asset from `wall_instances.yaml`.
L2 rebases derivation onto the library entries so the palette is generated
from validated entries only.

- `build_lib.py` gains an entry-driven path: enumerate `library/modules/`,
  refuse to bake any entry that fails validation (validators become the gate
  in the asset pipeline, not just CI), then produce the same artifacts as
  today: `cad_library/*.FCStd`, `web/assets/lib/*__{n,s,e,w}.brp`,
  `specs.json`, `volumes.json`, thumbnails.
- `wall_instances.yaml` becomes generated FROM the entries (inverting L1's
  drift direction) or is retired; pick whichever keeps
  `docs/adding_modules.md`'s five-touch-point workflow simplest, and update
  that doc.
- Parity gates (existing CI) must stay green with zero geometry diffs.

Done when: `python build_lib.py --verify` passes with the entry-driven path
as default and a failing entry blocks the bake with a clear message.

## L3 — Multiple construction systems in the editor (VCS demonstrator)

The editor currently hardcodes one construction system (SEH panelized: module
widths, 16/24" OC, port derivation in `snap.js`/`constants.js`). L3 makes the
system a data question and demonstrates it by loading VCS 12-ft wall modules
from vcs-library as a second palette.

vcs-library side (upstream, done first):

- Optional `interface:` section in `meta.yaml`:
  `interface: {system: vcs12, role: wall|roof|floor|assembly, width_in, height_in, depth_in, exterior_face: -y}` for entries that are placeable
  modules. Validators treat `interface` as optional and check only internal
  consistency (dims positive, role known). Ontology doc gains an "Interface
  metadata" section.
- `libtools export-json` already emits the schema; the bake tooling consumes
  the JSON export plus BREPs compiled from the entries.

iconic-cad side:

- A system manifest per construction system:
  `web/data/systems/{seh.json,vcs12.json}` — module grid (in), stud spacing,
  wall depth, snap rules id, palette entries (id, thumb, BREP base name,
  dims). `constants.js` values used by snapping move behind the active
  manifest (SEH manifest reproduces current constants exactly).
- Bake step for external libraries: a script that, given a checkout of
  vcs-library, compiles its wall-role entries under FreeCAD, bakes
  per-direction BREPs and thumbnails into `web/assets/lib/vcs12/`, and emits
  the vcs12 manifest. VCS entries that fail validation are refused, same as
  L2.
- Editor: a system selector (project option, default SEH, stored in the
  layout doc as `project.system`). Placement, snapping, and 3D for VCS wall
  modules work at demonstrator level: corner-port snapping on the 12-ft grid.
  Explicitly out of scope for the demonstrator, disabled with visible notices
  when the VCS system is active: interior-wall blocking flow, BOM pricing,
  fab cards, foundation generation, FCStd/IFC export. Mixed-system layouts
  are rejected on load and on palette switch.
- A layout saved in one system round-trips (save/load) losslessly.

Done when: a user can pick VCS-12, place Catarina's wall modules with corner
snapping, see them in 3D, save/load the layout; SEH behavior is bit-identical
to before when SEH is active (parity CI green).

## Sequencing and risk

L1 → L2 strictly ordered (L2 bakes from L1's entries). The vcs-library
interface-metadata work can proceed in parallel with L1. L3 editor work
starts after L2 lands. If L3 uncovers geometry problems in VCS entries
(likely — their `expect.yaml` envelopes were derived from schema math, not
from placement in a shared coordinate frame), findings go to vcs-library
`known_issues` for the entry owner, and the demonstrator ships with whatever
subset passes.
