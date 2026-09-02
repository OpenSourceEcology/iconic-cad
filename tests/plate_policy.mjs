/** Regression coverage for SOL-01 plate stacks and SOL-09 field authority. */
import { readFileSync } from 'node:fs';
import { ALL_MODULES, IN_TO_MM, STUD_THICK } from '../web/js/constants.js';
import { enumerateMembers } from '../web/js/members.js';

const specs = JSON.parse(readFileSync(new URL('../web/assets/lib/specs.json', import.meta.url), 'utf8'));

let passed = 0, failed = 0;
const fail = msg => { console.error(`  FAIL ${msg}`); failed++; };
const ok = msg => { passed++; if (process.env.VERBOSE) console.log(`  ok ${msg}`); };
const near = (a, b) => Math.abs(a - b) <= 1e-6;

for (const mod of ALL_MODULES) {
  const spec = specs[mod.id];
  const catalogMatches = spec
    && near(mod.height_mm, spec.h * 12 * IN_TO_MM)
    && near(mod.stud_spacing_mm, spec.oc * IN_TO_MM)
    && mod.top_plate_count === spec.top_plate_count;
  if (catalogMatches) ok(`${mod.id}: runtime and authored schema fields agree`);
  else fail(`${mod.id}: runtime fields disagree with generated schema specs`);

  const members = enumerateMembers(mod);
  const plates = members.filter(m => m.role === 'top_plate').sort((a, b) => a.z_mm - b.z_mm);
  if (plates.length === mod.top_plate_count) ok(`${mod.id}: authored top-plate count`);
  else fail(`${mod.id}: ${plates.length} top plates, expected ${mod.top_plate_count}`);

  const envelopeException = ['double_door', 'garage'].includes(mod.aperture?.type);
  const expectedPolicy = mod.interior || envelopeException ? 1 : 2;
  if (mod.top_plate_count === expectedPolicy) ok(`${mod.id}: family policy`);
  else fail(`${mod.id}: policy ${mod.top_plate_count}, expected ${expectedPolicy}`);

  const stackBottom = mod.height_mm - mod.top_plate_count * STUD_THICK;
  for (let i = 0; i < plates.length; i++) {
    const expectedZ = stackBottom + i * STUD_THICK;
    if (near(plates[i].z_mm, expectedZ)) ok(`${mod.id}: top plate ${i + 1} has distinct stack Z`);
    else fail(`${mod.id}: top plate ${i + 1} z=${plates[i].z_mm}, expected ${expectedZ}`);
  }

  const overallHeight = members.reduce((max, m) => Math.max(max, m.z_mm + m.h_mm), 0);
  if (near(overallHeight, mod.height_mm)) ok(`${mod.id}: overall height unchanged`);
  else fail(`${mod.id}: overall height ${overallHeight / IN_TO_MM}in, expected ${mod.height_mm / IN_TO_MM}in`);

  for (const m of members.filter(m => ['stud', 'king', 'top_cripple'].includes(m.role))) {
    if (near(m.z_mm + m.h_mm, stackBottom)) ok(`${mod.id}: ${m.role} ends at plate stack`);
    else fail(`${mod.id}: ${m.role} ends at ${m.z_mm + m.h_mm}, stack begins ${stackBottom}`);
  }

  const renamed = JSON.parse(JSON.stringify(mod));
  renamed.id = 'renamed_4x10_24oc_geometry_must_not_change';
  if (JSON.stringify(enumerateMembers(renamed)) === JSON.stringify(members)) ok(`${mod.id}: ID rename invariant`);
  else fail(`${mod.id}: geometry changed after ID-only rename`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
