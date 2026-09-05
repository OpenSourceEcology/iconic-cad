#!/usr/bin/env node
import { ALL_MODULES } from '/Users/cct/code/iconic-cad/web/js/constants.js';
import { enumerateMembers } from '/Users/cct/code/iconic-cad/web/js/members.js';

for (const mod of ALL_MODULES) {
  const count = enumerateMembers(mod).filter(m => m.role === 'top_plate').length;
  console.log(`${mod.id}: ${count} top_plate member`);
}
