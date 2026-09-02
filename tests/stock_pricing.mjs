/**
 * CAD-AUD-006 regression: stock selection is length-aware and every header
 * material key resolves to a nonzero price.
 *
 * Run from repo root: node tests/stock_pricing.mjs   (no FreeCAD needed)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stockKeyFor } from '../web/js/bom.js';
import { enumerateMembers } from '../web/js/members.js';
import { ALL_MODULES, APERTURE_MODULES, INT_APERTURE_MODULES, IN_TO_MM } from '../web/js/constants.js';

const pricing = JSON.parse(readFileSync(fileURLToPath(new URL('../web/pricing.json', import.meta.url))));
const catalog = { ...pricing.lumber, ...pricing.hardware };

let passed = 0, failed = 0;
const fail = m => { console.error(`  FAIL ${m}`); failed++; };
const ok = m => { passed++; if (process.env.VERBOSE) console.log(`  ok ${m}`); };

// 1. A 117" (9.75ft) king stud must NOT map to an 8ft key.
const king = { role: 'king', nominal: '2x6', length_mm: 117 * IN_TO_MM };
const kkey = stockKeyFor(king, false, 4);
if (kkey === '2x6_8ft') fail(`117" king stud mapped to ${kkey} (should be >=10ft)`);
else ok(`117" king -> ${kkey}`);
if (kkey !== '2x6_10ft') fail(`117" king expected 2x6_10ft, got ${kkey}`);
else ok('117" king -> 2x6_10ft');

// 2. Every header member across every aperture module prices nonzero.
for (const mod of [...APERTURE_MODULES, ...INT_APERTURE_MODULES]) {
  const is2x4 = !!mod.interior;
  for (const m of enumerateMembers(mod).filter(x => x.role === 'header')) {
    const key = stockKeyFor(m, is2x4, 4);
    const price = catalog[key] && catalog[key].unit_price;
    if (price > 0) ok(`${mod.id} header ${m.nominal} -> ${key} @ $${price}`);
    else fail(`${mod.id} header ${m.nominal} -> ${key} prices ${price}`);
  }
}

// 3. Every authored top plate becomes one priced stock item. This is the BOM
// quantity regression for the exterior double-stack/interior single-stack rule.
for (const mod of ALL_MODULES) {
  const plates = enumerateMembers(mod).filter(m => m.role === 'top_plate');
  if (plates.length === mod.top_plate_count) ok(`${mod.id} BOM sees ${plates.length} top plate(s)`);
  else fail(`${mod.id} BOM sees ${plates.length} top plates, policy requires ${mod.top_plate_count}`);
  const plateLenFt = mod.width_mm / IN_TO_MM / 12;
  for (const plate of plates) {
    const key = stockKeyFor(plate, !!mod.interior, plateLenFt);
    const price = catalog[key] && catalog[key].unit_price;
    if (price > 0) ok(`${mod.id} top plate -> ${key} @ $${price}`);
    else fail(`${mod.id} top plate -> ${key} prices ${price}`);
  }
}

// 4. SOL-02 shortens both lower cripples from 21" to 19½". That changes the
// cut length but legitimately leaves their 8 ft stock key and quantity intact.
const windowMod = ALL_MODULES.find(m => m.id === 'window_4x8_2x6_36x48');
const lowerCripples = enumerateMembers(windowMod).filter(m => m.role === 'lower_cripple');
if (lowerCripples.length === 2) ok('window BOM sees two lower cripples');
else fail(`window BOM sees ${lowerCripples.length} lower cripples, expected 2`);
for (const m of lowerCripples) {
  if (Math.abs(m.length_mm / IN_TO_MM - 19.5) < 1e-6) ok('lower cripple cut length is 19½"');
  else fail(`lower cripple cut length is ${m.length_mm / IN_TO_MM}", expected 19.5"`);
  const key = stockKeyFor(m, false, 4);
  if (key === '2x6_8ft') ok('19½" lower cripple remains 2x6_8ft stock');
  else fail(`19½" lower cripple mapped to ${key}, expected 2x6_8ft`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
