#!/usr/bin/env node
import { ALL_MODULES } from '/Users/cct/code/iconic-cad/web/js/constants.js';
import { enumerateMembers } from '/Users/cct/code/iconic-cad/web/js/members.js';
import { panelHeightMM } from '/Users/cct/code/iconic-cad/web/js/designs.js';
import { FLOOR_TO_FLOOR_MM } from '/Users/cct/code/iconic-cad/web/js/state.js';

const mod = ALL_MODULES.find(m => m.id === 'wall_4x8_2x6_16oc');
const exporterL2Base = panelHeightMM(enumerateMembers(mod));
console.log(`levels[L2].z_mm: ${FLOOR_TO_FLOOR_MM}`);
console.log(`browser/Python exporter L2 base for an 8 ft L1: ${exporterL2Base}`);
console.log(`vertical disagreement: ${FLOOR_TO_FLOOR_MM - exporterL2Base} mm`);
process.exit(Math.abs(FLOOR_TO_FLOOR_MM - exporterL2Base) > 1e-6 ? 1 : 0);
