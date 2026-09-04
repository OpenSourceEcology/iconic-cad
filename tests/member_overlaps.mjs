/** SOL-01/SOL-02 regression: pin all positive-volume framing overlaps. */
import { ALL_MODULES } from '../web/js/constants.js';
import { enumerateMembers } from '../web/js/members.js';

const overlap = (a, b) => {
  const x = Math.min(a.x_mm + a.w_mm, b.x_mm + b.w_mm) - Math.max(a.x_mm, b.x_mm);
  const z = Math.min(a.z_mm + a.h_mm, b.z_mm + b.h_mm) - Math.max(a.z_mm, b.z_mm);
  return x > 1e-6 && z > 1e-6;
};

const actual = new Map();
for (const mod of ALL_MODULES) {
  const members = enumerateMembers(mod).filter(m => m.role !== 'sheathing');
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (!overlap(members[i], members[j])) continue;
      const roles = [members[i].role, members[j].role].sort().join('+');
      const key = `${mod.id}:${roles}`;
      actual.set(key, (actual.get(key) || 0) + 1);
    }
  }
}

// SOL-02 removed all six window lower-cripple/subheader intersections. The one
// remaining positive-volume overlap is the separately ruled SOL-03 garage case.
const expected = new Map([
  ['garage_9x8_2x6_96x84:header+top_plate', 1],
]);

const normalize = map => JSON.stringify([...map].sort(([a], [b]) => a.localeCompare(b)));
if (normalize(actual) !== normalize(expected)) {
  console.error('  FAIL positive-volume overlap set changed');
  console.error(`  got      ${normalize(actual)}`);
  console.error(`  expected ${normalize(expected)}`);
  process.exit(1);
}

for (const id of [
  'window_4x8_2x6_36x48',
  'window_4x9_2x6_36x48',
  'window_4x10_2x6_36x48',
]) {
  const members = enumerateMembers(ALL_MODULES.find(mod => mod.id === id));
  const subheader = members.find(m => m.role === 'subheader');
  const sill = members.find(m => m.role === 'sill');
  const cripples = members.filter(m => m.role === 'lower_cripple');
  if (!subheader || !sill || cripples.length !== 2) {
    console.error(`  FAIL ${id}: expected one subheader, one sill, and two lower cripples`);
    process.exit(1);
  }
  const subheaderTop = subheader.z_mm + subheader.h_mm;
  const expectedCrippleH = sill.z_mm - subheaderTop;
  if (members.indexOf(subheader) > members.indexOf(cripples[0])) {
    console.error(`  FAIL ${id}: subheader must be emitted before lower cripples`);
    process.exit(1);
  }
  for (const cripple of cripples) {
    if (Math.abs(cripple.z_mm - subheaderTop) > 1e-6) {
      console.error(`  FAIL ${id}: subheader top ${subheaderTop} != cripple bottom ${cripple.z_mm}`);
      process.exit(1);
    }
    if (Math.abs(cripple.h_mm - expectedCrippleH) > 1e-6) {
      console.error(`  FAIL ${id}: cripple height ${cripple.h_mm} != sill underside minus subheader top ${expectedCrippleH}`);
      process.exit(1);
    }
  }
}

const overlapCount = [...actual.values()].reduce((sum, count) => sum + count, 0);
console.log(`positive-volume framing overlaps: 7 before SOL-02 -> ${overlapCount} after SOL-02`);
console.log('\n4 passed, 0 failed');
