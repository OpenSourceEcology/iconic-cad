/**
 * CAD-AUD-002 regression: cut-list labels must carry fractional inches, not
 * whole-inch rounding. A 81.5" jack must print "81½″", never "82″".
 *
 * Run from repo root: node tests/cutlist_frac.mjs   (no FreeCAD needed)
 */
import { cutListGrouped } from '../web/js/bom.js';
import { ALL_MODULES } from '../web/js/constants.js';

let passed = 0, failed = 0;
const fail = m => { console.error(`  FAIL ${m}`); failed++; };
const ok = m => { passed++; if (process.env.VERBOSE) console.log(`  ok ${m}`); };
const mod = id => ALL_MODULES.find(m => m.id === id);

// (module, fractional length that must appear, wrong whole-inch that must NOT)
const CASES = [
  ['door_4x8_2x6_38x83', '4¼″', '4″'],
  ['door_4x8_2x6_38x83', '81½″', '82″'],
  ['window_4x8_2x6_36x48', '15¼″', '15″'],
  // note: window_4x10 also has a genuine 39" member, so only assert 39¼ appears
  ['window_4x10_2x6_36x48', '39¼″', null],
  ['window_4x8_2x6_36x48', '70½″', '70″'],
];

for (const [id, want, wrong] of CASES) {
  const labels = cutListGrouped([{ kind: 'wall', mod: mod(id) }]).map(r => r.lengthLabel);
  if (labels.includes(want)) ok(`${id} prints ${want}`);
  else fail(`${id} missing fractional label ${want} — got: ${labels.join(', ')}`);
  // the bare whole-inch rounding must not appear for that member
  if (wrong !== null) {
    if (labels.includes(wrong)) fail(`${id} still prints rounded ${wrong}`);
    else ok(`${id} no rounded ${wrong}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
