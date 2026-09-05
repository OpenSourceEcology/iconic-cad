#!/usr/bin/env node
import { ALL_MODULES } from '/Users/cct/code/iconic-cad/web/js/constants.js';
import { enumerateMembers } from '/Users/cct/code/iconic-cad/web/js/members.js';

const base = ALL_MODULES.find(m => m.id === 'wall_4x8_2x6_16oc');
const changedHeight = { ...base, height_mm: 108 * 25.4 };
const changedId = { ...base, id: 'renamed_wall' };
const height = ms => Math.max(...ms.map(m => m.z_mm + m.h_mm));
const studXs = ms => ms.filter(m => m.role === 'stud').map(m => m.x_mm / 25.4);

console.log(`declared height_mm after schema-like change: ${changedHeight.height_mm}`);
console.log(`enumerated height_mm: ${height(enumerateMembers(changedHeight))}`);
console.log(`16oc module stud X (in): ${studXs(enumerateMembers(base)).join(', ')}`);
console.log(`same data after id rename stud X (in): ${studXs(enumerateMembers(changedId)).join(', ')}`);
