/** SOL-01 regression: the new plate stack must introduce no positive-volume overlaps. */
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

// These seven pre-existing SOL-02/SOL-03 intersections are deliberately out of
// this lane. Pinning the complete multiset proves the plate change adds none.
const expected = new Map([
  ['window_4x8_2x6_36x48:lower_cripple+subheader', 2],
  ['window_4x9_2x6_36x48:lower_cripple+subheader', 2],
  ['window_4x10_2x6_36x48:lower_cripple+subheader', 2],
  ['garage_9x8_2x6_96x84:header+top_plate', 1],
]);

const normalize = map => JSON.stringify([...map].sort(([a], [b]) => a.localeCompare(b)));
if (normalize(actual) !== normalize(expected)) {
  console.error('  FAIL positive-volume overlap set changed');
  console.error(`  got      ${normalize(actual)}`);
  console.error(`  expected ${normalize(expected)}`);
  process.exit(1);
}

console.log('\n1 passed, 0 failed');
