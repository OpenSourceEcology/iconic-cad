#!/usr/bin/env node
import { ALL_MODULES, IN_TO_MM } from '/Users/cct/code/iconic-cad/web/js/constants.js';
import { enumerateMembers } from '/Users/cct/code/iconic-cad/web/js/members.js';
import { stockKeyFor } from '/Users/cct/code/iconic-cad/web/js/bom.js';

for (const id of ['double_door_8x8_2x6_72x83', 'garage_9x8_2x6_96x84']) {
  const mod = ALL_MODULES.find(m => m.id === id);
  const plateLenFt = mod.width_mm / IN_TO_MM / 12;
  console.log(id);
  for (const m of enumerateMembers(mod).filter(m => m.role === 'top_plate' || m.role === 'bottom_plate')) {
    console.log(`  ${m.role} ${m.length_mm / IN_TO_MM} in -> ${stockKeyFor(m, false, plateLenFt)}`);
  }
}
