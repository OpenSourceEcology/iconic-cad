const compilerTemplate = `import math

import FreeCAD
import Part


IN = 25.4
LUMBER_SIZES = {
    "2x4": 3.5,
    "2x6": 5.5,
    "2x8": 7.25,
    "2x10": 9.25,
    "2x12": 11.25,
}


def add_box(doc, name, x, y, z, dx, dy, dz, placement):
    shape = Part.makeBox(dx * IN, dy * IN, dz * IN)
    obj = doc.addObject("Part::Feature", name)
    obj.Shape = shape
    obj.Placement = placement.multiply(FreeCAD.Placement(FreeCAD.Vector(x * IN, y * IN, z * IN), FreeCAD.Rotation()))
    return obj


def placement(origin, angle_degrees):
    return FreeCAD.Placement(
        FreeCAD.Vector(origin[0] * IN, origin[1] * IN, origin[2] * IN),
        FreeCAD.Rotation(FreeCAD.Vector(0, 0, 1), angle_degrees),
    )


def floor_total_height_in(floor_schema):
    if not floor_schema:
        return 0
    joist_depth = LUMBER_SIZES.get(floor_schema.get("framing_lumber", "2x8"), 7.25)
    return floor_schema.get("bottom_osb_thickness_in", 0) + joist_depth + floor_schema.get("top_osb_thickness_in", 0)


def compile_floor(doc, schema):
    if not schema:
        return 0
    width = schema["width_in"]
    depth = schema["depth_in"]
    height = floor_total_height_in(schema)
    add_box(doc, "Floor_Envelope", 0, 0, 0, width, depth, height, placement((0, 0, 0), 0))
    return height


def compile_wall_module(doc, common, module, base, prefix):
    module_width = common.get("module_width_in", 48)
    wall_depth = common.get("wall_depth_in", 6)
    stud_height = common.get("stud_height_in", 92.625)
    plate_thickness = 1.5
    add_box(doc, prefix + "_Bottom_Plate", 0, 0, 0, module_width, wall_depth, plate_thickness, base)
    add_box(doc, prefix + "_Top_Plate", 0, 0, plate_thickness + stud_height, module_width, wall_depth, plate_thickness, base)
    if module["type"] == "window":
        add_box(doc, prefix + "_Window_Header", 8, 0, 80, module_width - 16, wall_depth, 7.25, base)
    elif module["type"] == "door":
        add_box(doc, prefix + "_Door_Header", 5, 0, 82, module_width - 10, wall_depth, 7.25, base)
    else:
        add_box(doc, prefix + "_Standard_Stud_A", 0, 0, plate_thickness, 1.5, wall_depth, stud_height, base)
        add_box(doc, prefix + "_Standard_Stud_B", module_width - 1.5, 0, plate_thickness, 1.5, wall_depth, stud_height, base)


def module_placement_for_wall(schema, wall, module_index):
    floor = schema.get("floor", {})
    width = floor.get("width_in", 0)
    depth = floor.get("depth_in", 0)
    floor_t = floor_total_height_in(floor)
    module_w = schema.get("common_wall", {}).get("module_width_in", 48)
    side = wall["side"]
    if side == "front":
        x = wall.get("start_offset_in", 0) + module_index * module_w
        return placement((x, 0, floor_t), 0)
    if side == "back":
        x = wall.get("start_offset_in", 0) + (module_index + 1) * module_w
        return placement((x, depth, floor_t), 180)
    if side == "right":
        y = wall.get("start_offset_in", 0) + module_index * module_w
        return placement((width, y, floor_t), 90)
    if side == "left":
        y = wall.get("start_offset_in", 0) + (module_index + 1) * module_w
        return placement((0, y, floor_t), -90)
    raise ValueError("Unknown wall side: " + side)


def compile(schema, doc):
    compile_floor(doc, schema.get("floor", {}))
    common = dict(schema.get("common_wall", {}))
    common.setdefault("wall_depth_in", 6)
    for wall in schema.get("walls", []):
        for index, module in enumerate(wall.get("modules", [])):
            module_schema = dict(common)
            module_schema.update(module)
            module_type = module_schema["type"]
            if module_type not in ("standard", "window", "door"):
                raise ValueError("Unknown module type: " + module_type)
            prefix = "%s_Module_%d_%s" % (wall.get("name", wall["side"]), index + 1, module_type.capitalize())
            compile_wall_module(doc, common, module_schema, module_placement_for_wall(schema, wall, index), prefix)
    doc.recompute()
    return list(doc.Objects)
`;

export function buildEntryFiles(schema, meta = {}, expectInputs = {}) {
  if (!schema || typeof schema !== 'object') throw new Error('schema must be an object');
  schema = jsonCompatible(schema);
  const id = entryId(meta.id || schema.name || schema.schema_name || 'custom_assembly');
  const title = meta.title || schema.name || id;
  const owner = meta.owner || meta.author || 'Unknown';
  const author = meta.author || owner;
  const system = meta.system || (meta.manifest && meta.manifest.id) || 'vcs12';
  const interfaceData = {
    system,
    role: 'assembly',
  };
  const canonical = {
    id,
    layer: 'assembly',
    title,
    owner,
    version: '0.1.0',
    status: 'wip',
    units: schema.units || 'in',
    schema,
    provenance: {
      author,
      source: 'layout editor',
      system,
    },
    interface: interfaceData,
  };

  return {
    'schema.py': schemaSource(schema),
    'compiler.py': compilerTemplate,
    'meta.yaml': metaYaml({ id, title, owner, author, system }),
    'expect.yaml': expectYaml(expectInputs),
    [`${id}.json`]: `${JSON.stringify(canonical, null, 2)}\n`,
    'README.txt': `Custom assembly entry generated from a layout editor selection.\nValidate with: python -m libtools validate-code --root <library-root> ${id}\n`,
  };
}

export function parseEntryJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`json: ${err.message}`);
  }
  requireObject(data, 'entry');
  for (const field of ['id', 'layer', 'title', 'owner', 'status']) {
    if (typeof data[field] !== 'string' || data[field].length === 0) {
      throw new Error(`${field} must be a non-empty string`);
    }
  }
  if (data.layer !== 'assembly') throw new Error('layer must be assembly');
  requireObject(data.schema, 'schema');
  requireObject(data.interface, 'interface');
  if (typeof data.interface.system !== 'string' || data.interface.system.length === 0) {
    throw new Error('interface.system must be a non-empty string');
  }
  return {
    id: data.id,
    layer: data.layer,
    title: data.title,
    owner: data.owner,
    status: data.status,
    schema: data.schema,
    interface: data.interface,
  };
}

function schemaSource(schema) {
  return `"""Data-only assembly schema."""\n\nSCHEMA = ${pyLiteral(schema, 0)}\n`;
}

function pyLiteral(value, depth) {
  const indent = '    '.repeat(depth);
  const next = '    '.repeat(depth + 1);
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('schema contains non-finite number');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(item => `${next}${pyLiteral(item, depth + 1)}`).join(',\n')},\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([key, item]) => `${next}${JSON.stringify(key)}: ${pyLiteral(item, depth + 1)}`).join(',\n')},\n${indent}}`;
  }
  throw new Error(`unsupported schema value: ${typeof value}`);
}

function metaYaml({ id, title, owner, author, system }) {
  return [
    `id: ${yamlScalar(id)}`,
    'layer: assembly',
    `title: ${yamlScalar(title)}`,
    `owner: ${yamlScalar(owner)}`,
    'license: OSE',
    'version: 0.1.0',
    'status: wip',
    'provenance:',
    `  author: ${yamlScalar(author)}`,
    '  source: "layout editor"',
    `  system: ${yamlScalar(system)}`,
    'interface:',
    `  system: ${yamlScalar(system)}`,
    '  role: assembly',
    '',
  ].join('\n');
}

function expectYaml(inputs) {
  const bbox = inputs.bbox_in || { x: [0, 0], y: [0, 0], z: [0, 0] };
  const minCount = Number.isFinite(inputs.solidsLowerBound) ? inputs.solidsLowerBound : 0;
  return [
    'envelope:',
    '  bbox_in:',
    `    x: [${bbox.x[0]}, ${bbox.x[1]}]`,
    `    y: [${bbox.y[0]}, ${bbox.y[1]}]`,
    `    z: [${bbox.z[0]}, ${bbox.z[1]}]`,
    '  tolerance_in: 0.5',
    'solids:',
    `  min_count: ${minCount}`,
    'overlap:',
    '  tolerance_in3: 0.01',
    '  allowed_contact:',
    '    - ["*_Corner_U_*_Leg", "*_Stud_*"]',
    '    - ["*_End_Stud", "*_Corner_U_*_Leg"]',
    'params: []',
    '',
  ].join('\n');
}

function yamlScalar(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_. -]+$/.test(text) && !/^\s|\s$/.test(text)) return text;
  return JSON.stringify(text);
}

function entryId(value) {
  const id = String(value).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!id) throw new Error('id must contain letters or numbers');
  return id;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function jsonCompatible(value) {
  if (Array.isArray(value)) return value.map(jsonCompatible);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = jsonCompatible(item);
    }
    return out;
  }
  return value;
}
