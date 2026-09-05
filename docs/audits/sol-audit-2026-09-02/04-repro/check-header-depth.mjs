#!/usr/bin/env node
import { ALL_MODULES, IN_TO_MM } from '/Users/cct/code/iconic-cad/web/js/constants.js';
import { enumerateMembers } from '/Users/cct/code/iconic-cad/web/js/members.js';

for (const mod of ALL_MODULES.filter(m => m.aperture)) {
  const header = enumerateMembers(mod).find(m => m.role === 'header');
  const renderedDepthIn = mod.interior ? 3.5 : 5.5;
  const lumberDepthIn = 1.5 * header.plies;
  console.log(`${mod.id}: ${header.plies} plies require ${lumberDepthIn} in across wall; renderers use ${renderedDepthIn} in`);
}
