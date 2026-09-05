/**
 * Demonstrate that foundationEstimate(entities) reads the global document for
 * slab area, even when its explicit entities argument contains no walls.
 * Run from the repository root:
 *   node ../GoodAncestor/projects/iconic-cad/work/sol-audit-2026-09-02/04-repro/check-foundation-estimate-purity.mjs
 */
import { doc } from '../../../../../../code/iconic-cad/web/js/state.js';
import { ALL_MODULES } from '../../../../../../code/iconic-cad/web/js/constants.js';
import { invalidateRegion } from '../../../../../../code/iconic-cad/web/js/region.js';
import { foundationEstimate } from '../../../../../../code/iconic-cad/web/js/bom.js';

const std = ALL_MODULES.find(m => m.id === 'wall_4x8_2x6_16oc');
const W = std.width_mm;
let n = 0;
const wall = (dir, x, y) => ({
  id: `r${n++}`, kind: 'wall', mod: std, dir, x_mm: x, y_mm: y, level: 'L1',
});
const shell = [
  wall('north', 0, 0), wall('north', W, 0),
  wall('south', 0, 2 * W), wall('south', W, 2 * W),
  wall('west', 0, 0), wall('west', 0, W),
  wall('east', 2 * W, 0), wall('east', 2 * W, W),
];
const foundation = {
  id: 'f1', kind: 'foundation', level: 'L1',
  params: {
    slab_thickness_mm: 152, beam_w_mm: 305, beam_d_mm: 610,
    skirt_depth_mm: 1219, skirt_thickness_mm: 51,
  },
};

doc.entities = shell;
invalidateRegion();
const noWallsArgument = foundationEstimate([foundation]);

doc.entities = [];
invalidateRegion();
const sameArgumentBlankDoc = foundationEstimate([foundation]);

console.log('explicit argument wall count:', 0);
console.log('with global shell concrete_m3:', noWallsArgument.concrete_m3);
console.log('with blank global doc concrete_m3:', sameArgumentBlankDoc.concrete_m3);
console.log('same explicit argument, same result:',
  noWallsArgument.concrete_m3 === sameArgumentBlankDoc.concrete_m3);

if (noWallsArgument.concrete_m3 <= 0 || sameArgumentBlankDoc.concrete_m3 !== 0) {
  throw new Error('unexpected fixture result');
}
