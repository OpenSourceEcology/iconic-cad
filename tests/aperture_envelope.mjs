/** Regression coverage for the SOL-03 aperture-envelope guard. */
import assert from 'node:assert/strict';
import { ALL_MODULES, IN_TO_MM, LUMBER_DEPTH } from '../web/js/constants.js';

const round = value => Math.round(value * 1e9) / 1e9;

const results = ALL_MODULES.map(mod => {
  const aperture = mod.aperture;
  const roTopIn = aperture ? aperture.sill_in + aperture.ro_h_in : 0;
  const headerDepthIn = aperture ? LUMBER_DEPTH[aperture.header_nominal] / IN_TO_MM : 0;
  assert.ok(Number.isFinite(headerDepthIn), `${mod.id}: known header nominal`);

  // Exterior modules are assessed with the required double plate even where a
  // grandfathered authored field still says one; interiors retain one plate.
  const plateCount = mod.interior ? mod.top_plate_count : Math.max(mod.top_plate_count, 2);
  const headroomIn = round(mod.height_mm / IN_TO_MM - roTopIn - headerDepthIn - plateCount * 1.5);
  return { id: mod.id, headroomIn };
});

const clear = results.filter(result => result.headroomIn >= 0);
const short = results
  .filter(result => result.headroomIn < 0)
  .map(result => ({ id: result.id, shortByIn: -result.headroomIn }));

assert.equal(clear.length, 13, 'complete clear-module count');
assert.deepEqual(clear.map(result => result.id), [
  'wall_4x8_2x6_16oc',
  'wall_4x8_2x6_24oc',
  'wall_3x8.5_2x6_16oc',
  'iwall_4x8_2x4_16oc',
  'iwall_4x8_2x4_24oc',
  'iwall_3x8.5_2x4_single',
  'window_4x8_2x6_36x48',
  'window_4x9_2x6_36x48',
  'window_4x10_2x6_36x48',
  'door_4x8_2x6_38x83',
  'door_out_4x8_2x6_38x83',
  'sliding_8x8_2x6_72x80',
  'idoor_4x8_2x4_38x83',
]);
assert.deepEqual(short, [
  { id: 'double_door_8x8_2x6_72x83', shortByIn: 1.25 },
  { id: 'garage_9x8_2x6_96x84', shortByIn: 2.25 },
]);

for (const mod of ALL_MODULES.filter(mod => mod.interior)) {
  assert.equal(mod.depth_mm, LUMBER_DEPTH['2x4'], `${mod.id}: 2x4 framing depth`);
  assert.equal(mod.top_plate_count, 1, `${mod.id}: single top plate`);
  assert.ok(results.find(result => result.id === mod.id).headroomIn >= 0, `${mod.id}: clears envelope`);
}

console.log('13 modules clear; SOL-03 exceptions are short by exactly 1.25 in and 2.25 in');
