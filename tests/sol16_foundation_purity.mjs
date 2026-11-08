/**
 * SOL-16 regression (docs/audits/sol-audit-2026-09-02/02-findings.md):
 * foundationEstimate(entities) took slab area from the cached global document
 * (regionForLevel), so the same argument gave different results depending on
 * unrelated global state. It must be pure over its entities argument.
 *
 * Run from repo root: node tests/sol16_foundation_purity.mjs
 */
import { strict as assert } from 'node:assert';
import { doc } from '../web/js/state.js';
import { ALL_MODULES } from '../web/js/constants.js';
import { invalidateRegion } from '../web/js/region.js';
import { foundationEstimate } from '../web/js/bom.js';

const std = ALL_MODULES.find(m => m.id === 'wall_4x8_2x6_16oc');
const W = std.width_mm;
let n = 0;
const wall = (dir, x, y) => ({ id: `r${n++}`, kind: 'wall', mod: std, dir, x_mm: x, y_mm: y, level: 'L1' });
const shell = [
  wall('north', 0, 0), wall('north', W, 0),
  wall('south', 0, 2 * W), wall('south', W, 2 * W),
  wall('west', 0, 0), wall('west', 0, W),
  wall('east', 2 * W, 0), wall('east', 2 * W, W),
];
const foundation = {
  id: 'f1', kind: 'foundation', level: 'L1',
  params: { slab_thickness_mm: 152, beam_w_mm: 305, beam_d_mm: 610, skirt_depth_mm: 1219, skirt_thickness_mm: 51 },
};

// 1. The audit repro: identical argument, different global doc.
doc.entities = shell; invalidateRegion();
const a = foundationEstimate([foundation]);
doc.entities = []; invalidateRegion();
const b = foundationEstimate([foundation]);
assert.equal(a.concrete_m3, b.concrete_m3, `same argument gave ${a.concrete_m3} vs ${b.concrete_m3}`);
assert.equal(a.concrete_m3, 0, 'no walls in the argument must mean no slab');

// 2. The argument's walls drive the slab even when the global doc is empty
//    (and the stale cache is not consulted).
const withShell = foundationEstimate([foundation, ...shell]);
doc.entities = shell; invalidateRegion();
const withShellGlobal = foundationEstimate([foundation, ...shell]);
assert.ok(withShell.concrete_m3 > 0, 'shell in argument produced no concrete');
assert.equal(withShell.concrete_m3, withShellGlobal.concrete_m3, 'result depends on global doc');
console.log('ok foundationEstimate is pure over its argument');
