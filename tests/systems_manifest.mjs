import { IN_TO_MM, MODULES, WALL_DEPTH } from '../web/js/constants.js';
import { getSystemManifest, manifestPaletteModules } from '../web/js/systems.js';

let passed = 0, failed = 0;
const fail = m => { console.error(`  FAIL ${m}`); failed++; };
const ok = m => { passed++; if (process.env.VERBOSE) console.log(`  ok ${m}`); };
const eq = (got, want, label) => got === want ? ok(`${label} = ${want}`) : fail(`${label} = ${got}, want ${want}`);

const seh = getSystemManifest('seh');
eq(seh.id, 'seh', 'seh id');
eq(seh.module_grid_in, 12, 'seh grid');
eq(seh.wall_depth_in, 5.9375, 'seh wall depth in');
eq(WALL_DEPTH, 5.9375 * IN_TO_MM, 'WALL_DEPTH regression');

const modules = manifestPaletteModules('seh');
eq(JSON.stringify(MODULES), JSON.stringify(modules), 'SEH MODULES from manifest');
eq(MODULES.find(m => m.id === 'wall_4x8_2x6_16oc').width_mm, 48 * IN_TO_MM, '4ft width');
eq(MODULES.find(m => m.id === 'wall_3x8.5_2x6_16oc').width_mm, 36 * IN_TO_MM, '3ft width');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
