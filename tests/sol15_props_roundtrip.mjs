/**
 * SOL-15 regression (docs/audits/sol-audit-2026-09-02/02-findings.md): Save and
 * Export dropped entity.props, so an exploded assembly lost its per-module
 * options (window sizes, corner reinforcement) after explode -> save -> load ->
 * compose. The serializer must write props and the round trip must be exact.
 *
 * Run from repo root: node tests/sol15_props_roundtrip.mjs
 */
import { strict as assert } from 'node:assert';
import { explodeAssembly, composeAssembly } from '../web/js/assembly_translate.js';
import { getSystemManifest } from '../web/js/systems.js';
import { doc } from '../web/js/state.js';
import { applyLoadedData } from '../web/js/load.js';
import { serializeDoc } from '../web/js/serialize.js';

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

const { entities } = explodeAssembly(cabinSchema, manifest);
const direct = composeAssembly(entities, { manifest, id: 'cabin' });

// Put the exploded assembly in the live document, as the editor does.
applyLoadedData({ project: { system: 'vcs12' }, entities: [] });
doc.entities.push(...entities);

for (const includeMeta of [false, true]) { // Save, then Export
  const label = includeMeta ? 'export' : 'save';
  const file = JSON.parse(JSON.stringify(serializeDoc(doc, includeMeta)));
  const withProps = file.entities.filter(e => e.props && e.props.assembly);
  assert.equal(withProps.length, entities.length, `${label}: ${withProps.length}/${entities.length} entities carry props`);

  applyLoadedData(file);
  const reloaded = composeAssembly(doc.entities, { manifest, id: 'cabin' });
  assert.deepEqual(reloaded.walls, direct.walls, `${label}: walls differ after save/load`);
  // The exact overrides the audit named survive.
  const front = reloaded.walls.find(w => w.side === 'front');
  assert.equal(front.modules[0].window_rough_width_in, 30, `${label}: window width lost`);
  const left = reloaded.walls.find(w => w.side === 'left');
  assert.equal(left.modules[0].right_corner_reinforcement, true, `${label}: corner reinforcement lost`);
  console.log(`ok ${label} round trip preserves assembly props`);
}

// Entities without props stay prop-free in the file (no empty bags).
applyLoadedData({ entities: [{ id: 'w', module: 'wall_4x8_2x6_16oc', direction: 'north', x_mm: 0, y_mm: 0 }] });
assert.equal('props' in serializeDoc(doc, false).entities[0], false, 'empty props serialized');
console.log('ok empty props omitted');
