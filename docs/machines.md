# Machine workbench

`web/machines.html` is a static, offline-capable assembly workbench for the
baked GVCS machine catalog. It has its own versioned document format and does
not read or change the house editor's state.

The catalog is `web/data/gvcs-machines.json`. Its stable contract is:

```json
{"version":1,"units":"mm","entries":[{"id":"safe-id","title":"…","family":"…","variant":"…","description":"…","source_url":"…","source_revision":"…","license_review":"pending","validation":{"geometry":"passed","engineering":"unreviewed"},"bounds_mm":[1,1,1],"parts":[{"id":"part","label":"…","mesh":"assets/gvcs/example.mesh.json","brep":"assets/gvcs/example.brp","color":"#112233"}]}],"demos":[{"id":"demo","title":"…","description":"…","instances":[{"id":"machine-1","entry_id":"safe-id","position_mm":[0,0,0],"rotation_deg":0}]}]}
```

When that primary catalog is missing with HTTP 404, the workbench loads the
bundled `web/data/machine-example.json` instead and visibly identifies it as
“Example library — GVCS source library not installed.” This original project
example is for trying the tools; it is not a GVCS machine. A malformed primary
catalog, a network failure, or any HTTP response other than 404 remains a
visible catalog error and never falls back. Imported source entries use
`license_review: "pending"`; project-owned examples may use
`license_review: "cleared"` with their stated license.

The generated GVCS catalog and source assets are normally ignored by Git; the
bundled original example remains source-controlled for the public fallback.
Build the GVCS library from the sibling `gvcs-library` using `libtools bake-web`, then run
`python scripts/install_demo.py --iconic-web ../iconic-cad/web` from that library.
Its README records source hashes, versions, validation and release status.
Three.js 0.170.0 and its OrbitControls are vendored under `web/vendor/three/`
with their MIT license; loading the machine workbench needs no CDN requests.

Mesh JSON is a triangle payload with `vertices` (XYZ triples in entry-local
millimetres) and `triangles` (indices). The preview only renders this source
mesh. It does not infer dimensions or validate engineering. Catalogs may add
`validation.assembly: "failed"` and a string `validation.issues` list; the
workbench keeps these sources inspectable and exportable while marking them
"Source intersections need review".

Saved workspaces use `{ "version": 1, "units": "mm", "instances": [...] }`.
Loads are validated before replacing the current workspace, so an invalid file
leaves the current assembly intact. Existing v1 files with only `rotation_deg`
continue to load as Z-only rotations. Newer saved instances may add optional
`rotation_x_deg` and `rotation_y_deg`; the preview applies X, then Y, then Z
(`Rz * Ry * Rx`).

The workbench records place, duplicate, delete, transform, demo, new, and load
actions in local undo/redo history. Camera and selection are view state, so they
do not change the saved workspace. The filter searches local catalog title,
family, variant, description, and id. Iso, Front, Top, and Side controls frame
the current source geometry; the yellow selection outline and placed-instance
list make small or occluded components selectable.

FreeCAD export packages each baked local BREP as a `Part::Feature` sidecar and
appends the instance XYZ translation and X/Y/Z rotation as an OCCT Location. The
source BREP's existing top Location is retained in the resulting composite
Location. XML object Placement remains identity because FreeCAD restores Shape
after XML properties. The Component BOM CSV includes fixed catalog
component counts plus the source URL and revision for provenance. It does not
derive a material, fabrication, or price estimate. Imported catalog licensing
is review-pending rather than assumed; project-owned examples show their
cleared status and stated license.

Run the focused checks from the repository root:

```sh
node tests/machine_workspace.mjs
node tests/machine_fcstd.mjs
node tests/machine_catalog_fallback.mjs
node tests/machine_history.mjs
node tests/machine_rotation.mjs
```

## FreeCAD placement fixture

When the local catalog and source assets are available, generate an external
FreeCAD parity input with nonzero XYZ placement for every catalog entry. Each
component appears twice: once with a legacy 90° Z rotation and once with mixed
X/Y/Z rotation:

```sh
node tests/machine_fcstd_fixture.mjs --output-dir /tmp/iconic-machine-fixture
```

It writes `machine-placement-fixture.FCStd` and
`machine-placement-expected.json`. The JSON records each source mesh's local
bounding box and the bounding box expected after object Placement. These are
inputs for a FreeCAD-side check; they do not assert that a source mesh and BREP
are geometrically equivalent.
