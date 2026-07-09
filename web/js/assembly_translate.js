const IN_TO_MM = 25.4;
const ROUND_MM = 1e-6;

const SIDE_TO_DIR = {
  front: 'north',
  back: 'south',
  left: 'west',
  right: 'east',
};

const DIR_TO_SIDE = {
  north: 'front',
  south: 'back',
  west: 'left',
  east: 'right',
};

const DECORATIVE_TYPES = new Set(['floor', 'top_plate', 'top-plate', 'top plate']);

export function explodeAssembly(schema, manifest, originMM = { x_mm: 0, y_mm: 0 }) {
  if (!schema || typeof schema !== 'object') throw new Error('assembly schema must be an object');
  if (!Array.isArray(schema.walls)) throw new Error('assembly schema missing walls');
  const typeToModule = moduleTypeMap(manifest);
  const moduleWidthIn = commonModuleWidthIn(schema, manifest);
  const wallDepthMM = wallDepthIn(schema, manifest) * IN_TO_MM;
  const floor = schema.floor || {};
  const floorWidthMM = numberOrNull(floor.width_in) === null ? null : floor.width_in * IN_TO_MM;
  const floorDepthMM = numberOrNull(floor.depth_in) === null ? null : floor.depth_in * IN_TO_MM;
  const originX = numberOrNull(originMM.x_mm) || 0;
  const originY = numberOrNull(originMM.y_mm) || 0;
  const warnings = [];
  const entities = [];

  if (schema.floor) warnings.push('floor not placed');
  for (const key of ['top_plate', 'top_plates', 'topPlate']) {
    if (schema[key]) warnings.push(`${key} not placed`);
  }

  let nextId = 1;
  for (const wall of schema.walls) {
    validateWall(wall);
    const dir = SIDE_TO_DIR[wall.side];
    const startOffsetIn = numberOrNull(wall.start_offset_in) || 0;

    wall.modules.forEach((module, index) => {
      if (!module || typeof module !== 'object') {
        throw new Error(`${wall.name || wall.side} module ${index + 1} must be an object`);
      }
      if (DECORATIVE_TYPES.has(module.type)) {
        warnings.push(`${wall.name || wall.side} module ${index + 1} ${module.type} not placed`);
        return;
      }
      const paletteModule = typeToModule.get(module.type);
      if (!paletteModule) {
        throw new Error(`${wall.name || wall.side} module ${index + 1} unknown type: ${module.type}`);
      }
      const runOffsetMM = (startOffsetIn + index * moduleWidthIn) * IN_TO_MM;
      const widthMM = paletteModule.width_mm;

      let x = originX;
      let y = originY;
      if (wall.side === 'front') {
        x += runOffsetMM;
      } else if (wall.side === 'back') {
        if (floorDepthMM === null) throw new Error(`${wall.name || wall.side} needs floor.depth_in for back placement`);
        x += runOffsetMM;
        y += floorDepthMM - wallDepthMM;
      } else if (wall.side === 'left') {
        y += index * widthMM;
      } else if (wall.side === 'right') {
        if (floorWidthMM === null) throw new Error(`${wall.name || wall.side} needs floor.width_in for right placement`);
        x += floorWidthMM - wallDepthMM;
        y += index * widthMM;
      }

      entities.push({
        id: `${schema.name || schema.schema_name || 'assembly'}_${wall.name || wall.side}_${index + 1}`,
        kind: 'wall',
        mod: paletteModule,
        system: manifest.id,
        dir,
        x_mm: roundMM(x),
        y_mm: roundMM(y),
        level: 'L1',
        layer: 'structural',
        connections: [],
        props: {
          assembly: {
            wall: wall.name || wall.side,
            side: wall.side,
            module: clone(module),
          },
        },
      });
    });
  }

  return { entities, warnings };
}

export function composeAssembly(entities, meta = {}) {
  if (!Array.isArray(entities)) throw new Error('entities must be an array');
  const manifest = meta.manifest || meta.systemManifest;
  if (!manifest || !manifest.id) throw new Error('composeAssembly requires meta.manifest');
  const moduleToType = moduleIdTypeMap(manifest);
  const wallDepth = wallDepthIn(meta.schema || {}, manifest) * IN_TO_MM;
  const moduleWidthIn = commonModuleWidthIn(meta.schema || {}, manifest);
  const wallEntities = entities.map(entity => normalizeEntity(entity, manifest, moduleToType));
  const bbox = entityBBox(wallEntities, wallDepth);
  const floorWidthIn = roundIn((bbox.maxX - bbox.minX) / IN_TO_MM);
  const floorDepthIn = roundIn((bbox.maxY - bbox.minY) / IN_TO_MM);

  const walls = [];
  for (const dir of ['west', 'east', 'north', 'south']) {
    const side = DIR_TO_SIDE[dir];
    const sideEntities = wallEntities
      .filter(e => e.dir === dir)
      .sort((a, b) => runPositionMM(a) - runPositionMM(b));
    if (!sideEntities.length) continue;
    const firstRunIn = roundIn((runPositionMM(sideEntities[0]) - (dir === 'north' || dir === 'south' ? bbox.minX : bbox.minY)) / IN_TO_MM);
    const wall = {
      name: titleSide(side),
      side,
      modules: sideEntities.map(e => clone(e.sourceModule || { type: e.type })),
    };
    if ((side === 'front' || side === 'back' || firstRunIn !== 0) && Math.abs(firstRunIn) > 1e-9) {
      wall.start_offset_in = firstRunIn;
    }
    walls.push(wall);
  }

  return {
    schema_name: meta.schemaName || meta.schema_name || safeSchemaName(meta.id || 'Custom_Assembly'),
    units: 'in',
    document_name: meta.documentName || meta.document_name || safeSchemaName(meta.id || 'Custom_Assembly'),
    name: meta.name || meta.title || meta.id || 'Custom Assembly',
    floor: {
      width_in: floorWidthIn,
      depth_in: floorDepthIn,
    },
    common_wall: {
      module_width_in: moduleWidthIn,
      stud_spacing_in: manifest.stud_spacing_in,
      lumber: wallDepthIn({}, manifest) >= 5.5 ? '2x6' : '2x4',
    },
    walls,
  };
}

function moduleTypeMap(manifest) {
  validateManifest(manifest);
  const out = new Map();
  for (const item of manifest.palette) {
    if (!item.type) continue;
    out.set(item.type, paletteModule(manifest, item));
  }
  return out;
}

function moduleIdTypeMap(manifest) {
  validateManifest(manifest);
  const out = new Map();
  for (const item of manifest.palette) {
    if (item.type) out.set(item.id, item.type);
  }
  return out;
}

function paletteModule(manifest, item) {
  return {
    id: item.id,
    label: item.label,
    thumb: item.thumb,
    brep_base: item.brep_base,
    width_mm: item.width_in * IN_TO_MM,
    height_mm: item.height_in * IN_TO_MM,
    depth_mm: item.depth_in * IN_TO_MM,
    exterior_face: item.exterior_face,
    system: manifest.id,
    type: item.type,
  };
}

function normalizeEntity(entity, manifest, moduleToType) {
  if (!entity || typeof entity !== 'object') throw new Error('entity must be an object');
  if (entity.kind !== 'wall') throw new Error(`${entity.id || 'entity'} is not a wall module`);
  const mod = entity.mod;
  const modId = mod && mod.id;
  const system = entity.system || (mod && mod.system);
  if (system && system !== manifest.id) throw new Error(`${entity.id || modId || 'entity'} is not in system ${manifest.id}`);
  const type = moduleToType.get(modId);
  if (!type) throw new Error(`${entity.id || modId || 'entity'} is not an assembly wall module`);
  if (!DIR_TO_SIDE[entity.dir]) throw new Error(`${entity.id || modId || 'entity'} has unsupported direction ${entity.dir}`);
  return {
    id: entity.id,
    dir: entity.dir,
    x_mm: requiredNumber(entity.x_mm, `${entity.id || modId}.x_mm`),
    y_mm: requiredNumber(entity.y_mm, `${entity.id || modId}.y_mm`),
    mod,
    type,
    sourceModule: entity.props && entity.props.assembly && entity.props.assembly.module,
  };
}

function entityBBox(entities, wallDepth) {
  if (!entities.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entities) {
    const horizontal = e.dir === 'north' || e.dir === 'south';
    const w = horizontal ? e.mod.width_mm : wallDepth;
    const h = horizontal ? wallDepth : e.mod.width_mm;
    minX = Math.min(minX, e.x_mm);
    minY = Math.min(minY, e.y_mm);
    maxX = Math.max(maxX, e.x_mm + w);
    maxY = Math.max(maxY, e.y_mm + h);
  }
  return { minX, minY, maxX, maxY };
}

function runPositionMM(entity) {
  return entity.dir === 'north' || entity.dir === 'south' ? entity.x_mm : entity.y_mm;
}

function validateWall(wall) {
  if (!wall || typeof wall !== 'object') throw new Error('wall must be an object');
  if (!SIDE_TO_DIR[wall.side]) throw new Error(`${wall.name || 'wall'} unknown side: ${wall.side}`);
  if (!Array.isArray(wall.modules)) throw new Error(`${wall.name || wall.side} missing modules`);
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest must be an object');
  if (!manifest.id) throw new Error('manifest missing id');
  if (!Array.isArray(manifest.palette)) throw new Error(`${manifest.id} manifest missing palette`);
}

function commonModuleWidthIn(schema, manifest) {
  const fromSchema = schema.common_wall && numberOrNull(schema.common_wall.module_width_in);
  if (fromSchema !== null) return fromSchema;
  const firstTyped = manifest.palette.find(p => p.type);
  return firstTyped ? firstTyped.width_in : 48;
}

function wallDepthIn(schema, manifest) {
  const lumber = schema.common_wall && schema.common_wall.lumber;
  if (lumber === '2x4') return 4;
  return numberOrNull(manifest.wall_depth_in) || 6;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function requiredNumber(value, field) {
  if (!Number.isFinite(value)) throw new Error(`${field} must be a number`);
  return value;
}

function roundMM(value) {
  return Math.round(value / ROUND_MM) * ROUND_MM;
}

function roundIn(value) {
  return Math.round(value * 1e9) / 1e9;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function titleSide(side) {
  return `${side[0].toUpperCase()}${side.slice(1)}_Wall`;
}

function safeSchemaName(value) {
  return String(value).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^([^A-Za-z_])/, '_$1');
}
