/**
 * CAD-AUD-011 guard: the project-setup modal captures only name/system/stories/climate.
 * doc.project must NOT carry a phantom per-story wall-height field (the old code
 * comment falsely advertised one).
 *
 * Run from repo root: node tests/project_shape.mjs   (no FreeCAD needed)
 */
import { doc } from '../web/js/state.js';

let passed = 0, failed = 0;
const fail = m => { console.error(`  FAIL ${m}`); failed++; };
const ok = m => { passed++; if (process.env.VERBOSE) console.log(`  ok ${m}`); };

const keys = Object.keys(doc.project).sort();
const want = ['climate', 'name', 'stories', 'system'];
if (JSON.stringify(keys) === JSON.stringify(want)) ok(`project keys = ${want.join(',')}`);
else fail(`project keys = ${keys.join(',')}, want ${want.join(',')}`);

for (const phantom of ['wall_height', 'wallHeight', 'wall_height_mm', 'per_story_height', 'story_height_mm']) {
  if (phantom in doc.project) fail(`phantom wall-height field present: ${phantom}`);
  else ok(`no ${phantom}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
