"""Generate an original test box under FreeCAD; no wiki assets are used.

GVCS_FIXTURE_DIR selects the output directory. Dimensions are 10 x 20 x 30 mm.
The checked-in BREP and mesh let browser CI run without FreeCAD installed.
"""
import json
import os
from pathlib import Path
import Part

output = Path(os.environ['GVCS_FIXTURE_DIR'])
output.mkdir(parents=True, exist_ok=True)
shape = Part.makeBox(10, 20, 30)
assert shape.isValid() and shape.isClosed() and len(shape.Solids) == 1
shape.exportBrep(str(output / 'box.brp'))
vertices, triangles = shape.tessellate(0.1)
(output / 'box.mesh.json').write_text(json.dumps({
    'vertices': [value for point in vertices for value in (point.x, point.y, point.z)],
    'triangles': [index for triangle in triangles for index in triangle]
}) + '\n')
