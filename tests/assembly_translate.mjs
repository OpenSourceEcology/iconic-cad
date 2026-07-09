import { strict as assert } from 'node:assert';
import { explodeAssembly, composeAssembly } from '../web/js/assembly_translate.js';
import { getSystemManifest } from '../web/js/systems.js';
import { placedWallEntity } from '../web/js/placement.js';
import { entityPlanRect, planBounds } from '../web/js/plan_rects.js';

const manifest = getSystemManifest('vcs12');

const cabinSchema = {
  schema_name: 'Cabin_Floor_Walls_Assembly',
  units: 'in',
  document_name: 'Cabin_155x144_Floor_Walls_Only',
  name: 'Cabin_155x144_Floor_Walls_Only',
  floor: {
    width_in: 155,
    depth_in: 144,
    framing_lumber: '2x8',
    joist_spacing_in: 24,
    double_rim_joists: true,
    sheet_width_in: 48,
    sheet_length_in: 96,
    top_sheathing_material: 'OSB',
    top_osb_thickness_in: 0.75,
    bottom_sheathing_material: 'Pressure_Treated_Plywood',
    bottom_osb_thickness_in: 0.75,
  },
  common_wall: {
    module_width_in: 48,
    stud_height_in: 92.625,
    stud_spacing_in: 24,
    lumber: '2x6',
    osb_thickness_in: 0.5,
    osb_sheet_width_in: 48,
    osb_sheet_height_in: 96,
    include_osb: true,
  },
  walls: [
    {
      name: 'Left_Wall',
      side: 'left',
      modules: [
        { type: 'standard', right_corner_reinforcement: true, left_corner_reinforcement: false },
        { type: 'standard', right_corner_reinforcement: false, left_corner_reinforcement: false },
        { type: 'standard', right_corner_reinforcement: false, left_corner_reinforcement: true },
      ],
    },
    {
      name: 'Right_Wall',
      side: 'right',
      modules: [
        { type: 'standard', left_corner_reinforcement: true, right_corner_reinforcement: false },
        { type: 'standard', left_corner_reinforcement: false, right_corner_reinforcement: false },
        { type: 'standard', left_corner_reinforcement: false, right_corner_reinforcement: true },
      ],
    },
    {
      name: 'Front_Wall',
      side: 'front',
      start_offset_in: 5.5,
      modules: [
        { type: 'window', window_rough_width_in: 30, window_rough_height_in: 60, window_sill_height_in: 24, window_left_in: null },
        { type: 'door', door_rough_width_in: 38.25, door_rough_height_in: 82, door_left_in: null },
        { type: 'window', window_rough_width_in: 30, window_rough_height_in: 60, window_sill_height_in: 24, window_left_in: null },
      ],
    },
    {
      name: 'Back_Wall',
      side: 'back',
      start_offset_in: 5.5,
      modules: [
        { type: 'standard', left_corner_reinforcement: false, right_corner_reinforcement: false },
        { type: 'door', door_rough_width_in: 38.25, door_rough_height_in: 82, door_left_in: null },
        { type: 'standard', left_corner_reinforcement: false, right_corner_reinforcement: false },
      ],
    },
  ],
};

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    if (process.env.VERBOSE) console.log(`  ok ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

test('explode places a two-wall assembly at exact mm coordinates', () => {
  const schema = {
    units: 'in',
    floor: { width_in: 96, depth_in: 96 },
    common_wall: { module_width_in: 48 },
    walls: [
      { name: 'Front_Wall', side: 'front', modules: [{ type: 'standard' }, { type: 'window' }] },
      { name: 'Right_Wall', side: 'right', modules: [{ type: 'door' }] },
    ],
  };
  const { entities, warnings } = explodeAssembly(schema, manifest, { x_mm: 100, y_mm: 200 });
  assert.deepEqual(warnings, ['floor not placed']);
  assert.equal(entities.length, 3);
  assert.deepEqual(
    entities.map(e => [e.mod.id, e.dir, e.x_mm, e.y_mm]),
    [
      ['extwall_standard', 'north', 100, 200],
      ['extwall_window', 'north', 1319.2, 200],
      ['extwall_single_door', 'east', 2386, 200],
    ],
  );
});

test('explode one-module assemblies match the editor placement entity convention', () => {
  const mod = manifest.palette.find(item => item.type === 'standard');
  const paletteMod = {
    id: mod.id,
    label: mod.label,
    thumb: mod.thumb,
    brep_base: mod.brep_base,
    width_mm: mod.width_in * 25.4,
    height_mm: mod.height_in * 25.4,
    depth_mm: mod.depth_in * 25.4,
    exterior_face: mod.exterior_face,
    system: manifest.id,
    type: mod.type,
  };
  const origin = { x_mm: 240, y_mm: 360 };
  const cases = [
    { side: 'front', dir: 'north', floor: { width_in: 96, depth_in: 96 }, x_mm: origin.x_mm, y_mm: origin.y_mm },
    { side: 'back', dir: 'south', floor: { width_in: 96, depth_in: 96 }, x_mm: origin.x_mm, y_mm: origin.y_mm + (96 - 6) * 25.4 },
    { side: 'left', dir: 'west', floor: { width_in: 96, depth_in: 96 }, x_mm: origin.x_mm, y_mm: origin.y_mm },
    { side: 'right', dir: 'east', floor: { width_in: 96, depth_in: 96 }, x_mm: origin.x_mm + (96 - 6) * 25.4, y_mm: origin.y_mm },
  ];

  for (const item of cases) {
    const schema = {
      units: 'in',
      floor: item.floor,
      common_wall: { module_width_in: 48 },
      walls: [{ name: `${item.side}_wall`, side: item.side, modules: [{ type: 'standard' }] }],
    };
    const actual = stripGeneratedId(explodeAssembly(schema, manifest, origin).entities[0]);
    const expected = stripGeneratedId(placedWallEntity({
      id: 'manual_0',
      mod: paletteMod,
      system: manifest.id,
      dir: item.dir,
      x_mm: item.x_mm,
      y_mm: item.y_mm,
      level: 'L1',
      layer: 'structural',
      connections: [],
      props: {
        assembly: {
          wall: `${item.side}_wall`,
          side: item.side,
          module: { type: 'standard' },
        },
      },
    }));
    assert.deepEqual(actual, expected, item.dir);
  }
});

test('unknown module types throw with wall/module name', () => {
  assert.throws(
    () => explodeAssembly({ walls: [{ name: 'Front_Wall', side: 'front', modules: [{ type: 'mystery' }] }] }, manifest),
    /Front_Wall module 1 unknown type: mystery/,
  );
});

test('floor modules warn instead of throwing', () => {
  const { entities, warnings } = explodeAssembly({
    walls: [{ name: 'Front_Wall', side: 'front', modules: [{ type: 'floor' }, { type: 'standard' }] }],
  }, manifest);
  assert.equal(entities.length, 1);
  assert.deepEqual(warnings, ['Front_Wall module 1 floor not placed']);
});

test('compose after explode preserves cabin wall/module structure', () => {
  const { entities } = explodeAssembly(cabinSchema, manifest);
  const composed = composeAssembly(entities, { manifest, id: 'cabin_walls_floor' });
  assert.deepEqual(normalizeWalls(composed.walls), normalizeWalls(cabinSchema.walls));
  assert.equal(composed.floor.width_in, 155);
  assert.equal(composed.floor.depth_in, 144);
});

test('exploded cabin render-derived rects form the expected closed perimeter', () => {
  const { entities } = explodeAssembly(cabinSchema, manifest);
  const rects = entities.map(e => ({ ...entityPlanRect(e), dir: e.dir }));
  const bounds = planBounds(entities);
  assert.equal(roundIn(bounds.width_mm), 155);
  assert.equal(roundIn(bounds.depth_mm), 144);

  const north = rects.filter(r => r.dir === 'north');
  const south = rects.filter(r => r.dir === 'south');
  const west = rects.filter(r => r.dir === 'west');
  const east = rects.filter(r => r.dir === 'east');
  assert.equal(north.length, 3);
  assert.equal(south.length, 3);
  assert.equal(west.length, 3);
  assert.equal(east.length, 3);
  assert.ok(north.every(r => r.w_mm > r.h_mm && roundIn(r.y0) === 0 && roundIn(r.y1) === 6));
  assert.ok(south.every(r => r.w_mm > r.h_mm && roundIn(r.y0) === 138 && roundIn(r.y1) === 144));
  assert.ok(west.every(r => r.h_mm > r.w_mm && roundIn(r.x0) === 0 && roundIn(r.x1) === 6));
  assert.ok(east.every(r => r.h_mm > r.w_mm && roundIn(r.x0) === 149 && roundIn(r.x1) === 155));
  assert.deepEqual(runSpansIn(north, 'x'), [[5.5, 53.5], [53.5, 101.5], [101.5, 149.5]]);
  assert.deepEqual(runSpansIn(south, 'x'), [[5.5, 53.5], [53.5, 101.5], [101.5, 149.5]]);
  assert.deepEqual(runSpansIn(west, 'y'), [[0, 48], [48, 96], [96, 144]]);
  assert.deepEqual(runSpansIn(east, 'y'), [[0, 48], [48, 96], [96, 144]]);
});

test('composeAssembly rejects foreign entities with entity id', () => {
  assert.throws(
    () => composeAssembly([{ id: 'foreign_1', kind: 'iwall', mod: { id: 'x', system: 'seh', width_mm: 1 }, dir: 'north', x_mm: 0, y_mm: 0 }], { manifest }),
    /foreign_1 is not a wall module/,
  );
});

function normalizeWalls(walls) {
  return walls.map(wall => ({
    side: wall.side,
    start_offset_in: wall.start_offset_in || 0,
    modules: wall.modules,
  }));
}

function stripGeneratedId(entity) {
  const out = JSON.parse(JSON.stringify(entity));
  delete out.id;
  return out;
}

function runSpansIn(rects, axis) {
  return rects
    .map(r => axis === 'x' ? [roundIn(r.x0), roundIn(r.x1)] : [roundIn(r.y0), roundIn(r.y1)])
    .sort((a, b) => a[0] - b[0]);
}

function roundIn(mm) {
  return Math.round((mm / 25.4) * 1000) / 1000;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
