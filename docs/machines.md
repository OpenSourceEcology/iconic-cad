# Machine workbench

`web/machines.html` is a static, offline-capable assembly workbench for the
baked GVCS machine catalog. It has its own versioned document format and does
not read or change the house editor's state.

The catalog is `web/data/gvcs-machines.json`. Its stable contract is:

```json
{"version":1,"units":"mm","entries":[{"id":"safe-id","title":"…","family":"…","variant":"…","description":"…","source_url":"…","source_revision":"…","validation":{"geometry":"passed","engineering":"unreviewed"},"bounds_mm":[1,1,1],"parts":[{"id":"part","label":"…","mesh":"assets/gvcs/example.mesh.json","brep":"assets/gvcs/example.brp","color":"#112233"}]}],"demos":[{"id":"demo","title":"…","description":"…","instances":[{"id":"machine-1","entry_id":"safe-id","position_mm":[0,0,0],"rotation_deg":0}]}]}
```

Mesh JSON is a triangle payload with `vertices` (XYZ triples in entry-local
millimetres) and `triangles` (indices). The preview only renders this source
mesh. It does not infer dimensions or validate engineering.

Saved workspaces use `{ "version": 1, "units": "mm", "instances": [...] }`.
Loads are validated before replacing the current workspace, so an invalid file
leaves the current assembly intact.

FreeCAD export packages each baked local BREP unchanged as a `Part::Feature`
sidecar. The object's FreeCAD `Placement` holds the instance XYZ translation
and its rotation about Z. This preserves the source geometry and keeps assembly
placement inspectable in FreeCAD. The BOM CSV includes entry/part counts plus
the source URL and revision for provenance.

Run the focused checks from the repository root:

```sh
node tests/machine_workspace.mjs
node tests/machine_fcstd.mjs
```
