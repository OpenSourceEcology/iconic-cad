# Machine workbench

`web/machines.html` is a static, offline-capable assembly workbench for the
baked GVCS machine catalog. It has its own versioned document format and does
not read or change the house editor's state.

The catalog is `web/data/gvcs-machines.json`. Its stable contract is:

```json
{"version":1,"units":"mm","entries":[{"id":"safe-id","title":"…","family":"…","variant":"…","description":"…","source_url":"…","source_revision":"…","license_review":"pending","validation":{"geometry":"passed","engineering":"unreviewed"},"bounds_mm":[1,1,1],"parts":[{"id":"part","label":"…","mesh":"assets/gvcs/example.mesh.json","brep":"assets/gvcs/example.brp","color":"#112233"}]}],"demos":[{"id":"demo","title":"…","description":"…","instances":[{"id":"machine-1","entry_id":"safe-id","position_mm":[0,0,0],"rotation_deg":0}]}]}
```

Mesh JSON is a triangle payload with `vertices` (XYZ triples in entry-local
millimetres) and `triangles` (indices). The preview only renders this source
mesh. It does not infer dimensions or validate engineering. Catalogs may add
`validation.assembly: "failed"` and a string `validation.issues` list; the
workbench keeps these sources inspectable and exportable while marking them
"Source intersections need review".

Saved workspaces use `{ "version": 1, "units": "mm", "instances": [...] }`.
Loads are validated before replacing the current workspace, so an invalid file
leaves the current assembly intact.

FreeCAD export packages each baked local BREP unchanged as a `Part::Feature`
sidecar. The object's FreeCAD `Placement` holds the instance XYZ translation
and its rotation about Z. This preserves the source geometry and keeps assembly
placement inspectable in FreeCAD. The Component BOM CSV includes fixed catalog
component counts plus the source URL and revision for provenance. It does not
derive a material, fabrication, or price estimate. Catalog source licensing is
recorded as review-pending rather than assumed.

Run the focused checks from the repository root:

```sh
node tests/machine_workspace.mjs
node tests/machine_fcstd.mjs
```

## FreeCAD placement fixture

When the local catalog and source assets are available, generate an external
FreeCAD parity input with nonzero XYZ placement and a 90° Z rotation for every
catalog entry:

```sh
node tests/machine_fcstd_fixture.mjs --output-dir /tmp/iconic-machine-fixture
```

It writes `machine-placement-fixture.FCStd` and
`machine-placement-expected.json`. The JSON records each source mesh's local
bounding box and the bounding box expected after object Placement. These are
inputs for a FreeCAD-side check; they do not assert that a source mesh and BREP
are geometrically equivalent.
