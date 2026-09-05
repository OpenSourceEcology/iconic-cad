#!/usr/bin/env node
import { ALL_MODULES } from '/Users/cct/code/iconic-cad/web/js/constants.js';
import { enumerateMembers } from '/Users/cct/code/iconic-cad/web/js/members.js';

const overlap = (a, b) => {
  const x = Math.min(a.x_mm + a.w_mm, b.x_mm + b.w_mm) - Math.max(a.x_mm, b.x_mm);
  const z = Math.min(a.z_mm + a.h_mm, b.z_mm + b.h_mm) - Math.max(a.z_mm, b.z_mm);
  return x > 1e-6 && z > 1e-6 ? { x_mm: x, z_mm: z } : null;
};

let count = 0;
for (const mod of ALL_MODULES) {
  const members = enumerateMembers(mod).filter(m => m.role !== 'sheathing');
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const hit = overlap(members[i], members[j]);
      if (!hit) continue;
      count++;
      console.log(JSON.stringify({
        module: mod.id,
        roles: [members[i].role, members[j].role],
        overlap: hit,
      }));
    }
  }
}
console.log(`positive framing overlaps: ${count}`);
process.exit(count ? 1 : 0);
