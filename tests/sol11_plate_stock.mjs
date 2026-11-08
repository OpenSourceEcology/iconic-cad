/**
 * SOL-11 regression (docs/audits/sol-audit-2026-09-02/02-findings.md): plate
 * stock was chosen from the panel width, so a 12" door bottom-plate stub was
 * bought as a full 12 ft board. Plates must be bought by their own cut length,
 * and short plate cuts in one panel must share a board.
 *
 * Run from repo root: node tests/sol11_plate_stock.mjs
 */
import { stockKeyFor, lineItemsForEntity, packCuts } from '../web/js/bom.js';
import { enumerateMembers } from '../web/js/members.js';
import { ALL_MODULES, IN_TO_MM } from '../web/js/constants.js';

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failed++; console.error(`  FAIL ${msg}`); } };
const PLATE = new Set(['bottom_plate', 'top_plate', 'sill', 'subheader', 'sill_block']);

// 1. The audit repro: every plate maps to the smallest board covering ITS length.
for (const id of ['double_door_8x8_2x6_72x83', 'garage_9x8_2x6_96x84']) {
  const mod = ALL_MODULES.find(m => m.id === id);
  const plateLenFt = mod.width_mm / IN_TO_MM / 12;
  for (const m of enumerateMembers(mod).filter(x => PLATE.has(x.role))) {
    const inches = m.length_mm / IN_TO_MM;
    const key = stockKeyFor(m, false, plateLenFt);
    const ft = Number(key.match(/_(\d+)ft$/)[1]);
    check(ft * 12 + 1e-6 >= inches, `${id} ${m.role} ${inches}" -> ${key} is too short`);
    if (inches <= 96 + 1e-6) check(key === '2x6_8ft', `${id} ${m.role} ${inches}" -> ${key}, expected 2x6_8ft`);
  }
}

// 2. Packing: two 12" stubs and a 96" plate need two 8 ft boards, not three.
check(JSON.stringify(packCuts('2x6', [12, 12, 96])) === JSON.stringify({ '2x6_8ft': 2 }),
  `packCuts([12,12,96]) = ${JSON.stringify(packCuts('2x6', [12, 12, 96]))}`);
// A cut longer than any stocked board is an error, not silently the longest board.
let threw = false;
try { packCuts('2x6', [200]); } catch { threw = true; }
check(threw, 'packCuts accepted a 200" cut longer than any 2x6 stock');

// 3. Through the BOM line items: the double door's plates are two 8 ft boards.
const dd = ALL_MODULES.find(m => m.id === 'double_door_8x8_2x6_72x83');
const plateItems = lineItemsForEntity({ kind: 'wall', mod: dd })
  .filter(li => /^2x6_/.test(li.material_key));
const studCount = enumerateMembers(dd).filter(m => !PLATE.has(m.role) && m.nominal === '2x6')
  .reduce((n, m) => n + (m.plies || 1), 0);
const total = plateItems.reduce((n, li) => n + li.qty, 0);
check(!plateItems.some(li => li.material_key === '2x6_12ft'), 'double door still buys 2x6_12ft');
check(total === studCount + 2, `double door 2x6 qty ${total}, expected studs ${studCount} + 2 plate boards`);

// 4. Every module's plate purchase covers its plate cut length.
for (const mod of ALL_MODULES) {
  const nominal = mod.interior ? '2x4' : '2x6';
  const cuts = enumerateMembers(mod).filter(m => PLATE.has(m.role) && m.nominal === nominal)
    .flatMap(m => Array(m.plies || 1).fill(m.length_mm / IN_TO_MM));
  const packed = packCuts(nominal, cuts);
  const boughtIn = Object.entries(packed).reduce((s, [k, q]) => s + Number(k.match(/_(\d+)ft$/)[1]) * 12 * q, 0);
  const cutIn = cuts.reduce((s, c) => s + c, 0);
  check(boughtIn + 1e-6 >= cutIn, `${mod.id} buys ${boughtIn}" of plate for ${cutIn}" of cuts`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
