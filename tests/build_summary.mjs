/**
 * Build-summary tests (no FreeCAD, no browser):
 *   1. runs.js is pure + deterministic — a fixed entity set yields stable runs,
 *      tags, owners, and position strings; the documented left→right /
 *      top→bottom rule holds.
 *   2. bay computation derives 14½ / 14½ / 13 from real stud faces (§0).
 *   3. cut-list parity: one panel's card cut-list totals equal the framing the
 *      enumerator emits; the whole-build total equals the sum over instances.
 *   4. cardSVG renders (derived-only, no template) without throwing.
 *
 * Run from repo root: node tests/build_summary.mjs
 */
import { ALL_MODULES, IN_TO_MM } from '../web/js/constants.js';
import { enumerateMembers } from '../web/js/members.js';
import { computeRuns, tagsByEntityId } from '../web/js/runs.js';
import { computeRegion } from '../web/js/region.js';
import { bayGapsMM, inFrac, designIdFor } from '../web/js/designs.js';
import { cutListGrouped } from '../web/js/bom.js';
import { cardSVG } from '../web/js/render_fab.js';

let passed = 0, failed = 0;
const mod = id => ALL_MODULES.find(m => m.id === id);
const fail = m => { console.error(`  FAIL ${m}`); failed++; };
const ok = m => { passed++; if (process.env.VERBOSE) console.log(`  ok ${m}`); };
const eq = (a, b, label) => { if (a === b) { ok(label); } else fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

const IN48 = 48 * IN_TO_MM;

// ---- fixture: 4 north panels in a row + 2 east panels stacked on the right --
function fixture() {
  const std = mod('wall_4x8_2x6_16oc');
  const win = mod('window_4x8_2x6_36x48');
  const door = mod('door_4x8_2x6_38x83');
  const E = (5.5 + 0.4375) * IN_TO_MM; // exterior depth
  let n = 0;
  const e = (m, dir, x, y, owner) =>
    ({ id: `w${n++}`, kind: 'wall', mod: m, dir, x_mm: x, y_mm: y, ...(owner ? { owner } : {}) });
  return [
    e(std, 'north', 0 * IN48, 0),
    e(win, 'north', 1 * IN48, 0, 'Marcin J.'),
    e(std, 'north', 2 * IN48, 0),
    e(door, 'north', 3 * IN48, 0),
    e(std, 'east', 4 * IN48, 0),          // right wall, top
    e(std, 'east', 4 * IN48, 1 * IN48),   // right wall, below it
  ];
}

// ---- 1. runs: structure, tags, ordering, owners, position strings ----------
{
  const ents = fixture();
  const runs = computeRuns(ents);
  eq(runs.length, 2, 'two runs detected');
  const [A, B] = runs;
  eq(A.letter, 'A', 'top run lettered A');
  eq(A.horiz, true, 'run A is horizontal');
  eq(A.modules.length, 4, 'run A has 4 modules');
  eq(A.modules.map(m => m.tag).join(','), 'A-1,A-2,A-3,A-4', 'run A tags');
  eq(A.modules[0].positionString, '1st from left · Run A', 'A-1 position string');
  eq(A.modules[2].positionString, '3rd from left · Run A', 'A-3 position string');
  eq(A.modules[1].owner, 'Marcin J.', 'A-2 owner carried');
  eq(A.modules[0].owner, null, 'A-1 unclaimed');
  eq(B.letter, 'B', 'right run lettered B');
  eq(B.horiz, false, 'run B is vertical');
  eq(B.modules.length, 2, 'run B has 2 modules');
  eq(B.modules.map(m => m.tag).join(','), 'B-1,B-2', 'run B tags');
  eq(B.modules[0].positionString, '1st from top · Run B', 'B-1 position string (vertical)');
  // design id wiring: standard=W-01, window=W-02, door=W-03
  eq(A.modules[0].designId, 'W-01', 'standard -> W-01');
  eq(A.modules[1].designId, 'W-02', 'window -> W-02');
  eq(A.modules[3].designId, 'W-03', 'door -> W-03');
  // tag lookup keyed by entity id agrees
  const tm = tagsByEntityId(runs);
  eq(tm[ents[1].id].tag, 'A-2', 'tagsByEntityId maps A-2');
  eq(tm[ents[1].id].owner, 'Marcin J.', 'tagsByEntityId carries owner');
}

// ---- 1b. determinism: identical input -> identical tags/positions -----------
{
  const a = computeRuns(fixture());
  const b = computeRuns(fixture());
  const flat = rs => rs.flatMap(r => r.modules.map(m => `${m.tag}|${m.positionString}|${m.designId}`)).join(';');
  eq(flat(a), flat(b), 'computeRuns deterministic');
}

// ---- 1c. two-level: per-level partition + CONTINUOUS lettering (§7) ---------
{
  const std = mod('wall_4x8_2x6_16oc');
  let n = 0;
  const e = (m, dir, x, y, level) =>
    ({ id: `w${n++}`, kind: 'wall', mod: m, dir, x_mm: x, y_mm: y, level });
  // L1: 4 north (run) + 2 east (run) = A, B. L2: 2 north (one run) = C.
  const ents = [
    e(std, 'north', 0 * IN48, 0, 'L1'),
    e(std, 'north', 1 * IN48, 0, 'L1'),
    e(std, 'north', 2 * IN48, 0, 'L1'),
    e(std, 'north', 3 * IN48, 0, 'L1'),
    e(std, 'east', 4 * IN48, 0, 'L1'),
    e(std, 'east', 4 * IN48, 1 * IN48, 'L1'),
    e(std, 'north', 0 * IN48, 0, 'L2'),
    e(std, 'north', 1 * IN48, 0, 'L2'),
  ];
  const runs = computeRuns(ents);
  eq(runs.length, 3, 'three runs across two levels');
  eq(runs.map(r => r.letter).join(','), 'A,B,C', 'continuous lettering A,B,C (no reset)');
  eq(runs.map(r => r.level).join(','), 'L1,L1,L2', 'runs ordered L1, L1, L2');
  eq(runs[2].modules.map(m => m.tag).join(','), 'C-1,C-2', 'L2 run continues as C-*');
  // determinism with levels present
  const flat = rs => rs.flatMap(r => r.modules.map(m => `${m.tag}|${r.level}`)).join(';');
  eq(flat(computeRuns(ents)), flat(runs), 'two-level computeRuns deterministic');
}

// ---- 1d. region.js: pure flood-fill — rect, L-shape, open shell (§1) --------
{
  const std = mod('wall_4x8_2x6_16oc');
  let n = 0;
  const e = (dir, x, y) => ({ id: `r${n++}`, kind: 'wall', mod: std, dir, x_mm: x, y_mm: y });
  const W = std.width_mm; // 48"

  // closed 2×2 rectangular shell: N top, S bottom, W left, E right
  const rect = [
    e('north', 0, 0), e('north', W, 0),
    e('south', 0, 2 * W), e('south', W, 2 * W),
    e('west', 0, 0), e('west', 0, W),
    e('east', 2 * W, 0), e('east', 2 * W, W),
  ];
  const rr = computeRegion(rect);
  eq(rr.isEnclosed, true, 'closed rectangle is enclosed');
  // the region is the FILLED silhouette: interior AND on-wall points are inside;
  // a point far outside is not.
  eq(rr.containsPoint(W, W), true, 'rect: interior point in region');
  eq(rr.containsPoint(W, 1), true, 'rect: on-wall point in region (silhouette)');
  eq(rr.containsPoint(-5 * W, -5 * W), false, 'rect: far-outside point not in region');
  // a wall placed directly on top of an L1 wall (same footprint) is allowed;
  // a wall hanging off the outside is rejected (overhang).
  eq(rr.containsFootprint(std, 'north', 0, 0), true, 'rect: footprint on top of L1 wall allowed');
  eq(rr.containsFootprint(std, 'north', -2 * W, 0), false, 'rect: overhanging footprint rejected');

  // open shell: drop the right wall → flood leaks in → not enclosed
  const open = rect.filter(w => w.dir !== 'east');
  eq(computeRegion(open).isEnclosed, false, 'open shell (missing wall) not enclosed');

  // L-shape stays an L (NOT its bbox): a 2×2 square with the top-right cell
  // removed (a notch). The notch is inside the wall bbox but must be OUTSIDE the
  // region — proving the region is the true enclosed shape, not the bounding box.
  const lshape = [
    e('north', 0, 0),        // top of top-left cell
    e('east', W, 0),         // right of top-left cell (left of the notch)
    e('north', W, W),        // top of bottom-right cell (bottom of the notch)
    e('east', 2 * W, W),     // right of bottom-right cell
    e('south', W, 2 * W),    // bottom of bottom-right cell
    e('south', 0, 2 * W),    // bottom of bottom-left cell
    e('west', 0, W),         // left of bottom-left cell
    e('west', 0, 0),         // left of top-left cell
  ];
  const lr = computeRegion(lshape);
  eq(lr.isEnclosed, true, 'L-shape enclosed');
  eq(lr.containsPoint(W / 2, 1.5 * W), true, 'L-shape: bottom-left cell in region');
  eq(lr.containsPoint(1.5 * W, 1.5 * W), true, 'L-shape: bottom-right cell in region');
  eq(lr.containsPoint(1.5 * W, W / 2), false, 'L-shape: NOTCH (top-right) not in region (not bbox)');
}

// ---- 2. bay gaps derive 14½ / 14½ / 13 from stud faces ---------------------
{
  const gaps = bayGapsMM(enumerateMembers(mod('wall_4x8_2x6_16oc'))).map(g => inFrac(g / IN_TO_MM));
  eq(gaps.join(' / '), '14½ / 14½ / 13', 'standard panel bays = 14½/14½/13 (computed)');
}

// ---- 3. cut-list parity ----------------------------------------------------
const totalQty = rows => rows.reduce((s, r) => s + r.qty, 0);
const memberCount = m => enumerateMembers(m.mod).reduce((s, x) => s + (x.plies || 1), 0);
{
  // one panel: card cut list (cutListGrouped) totals == enumerated framing
  for (const id of ['wall_4x8_2x6_16oc', 'window_4x8_2x6_36x48', 'door_4x8_2x6_38x83']) {
    const e = { kind: 'wall', mod: mod(id) };
    eq(totalQty(cutListGrouped([e])), memberCount(e), `cut-list total == members for ${id}`);
  }
  // whole build: aggregate total == sum over instances
  const ents = fixture();
  const whole = totalQty(cutListGrouped(ents));
  const summed = ents.reduce((s, e) => s + totalQty(cutListGrouped([e])), 0);
  eq(whole, summed, 'whole-build cut-list total == sum over instances');
}

// SOL-02: the derived cut list and fabrication card carry the shortened
// subheader-supported lower-cripple cut length (19½", formerly 21").
{
  const e = { kind: 'wall', mod: mod('window_4x8_2x6_36x48') };
  const cripple = cutListGrouped([e]).find(row => row.part === 'Cripple' && row.lengthLabel === '19½″');
  eq(cripple?.qty, 2, 'window cut list has two 19½″ lower cripples');
  const svg = cardSVG(e, { label: 'A-1', templates: null });
  if (svg.includes('19½″')) ok('window fabrication card prints 19½″ cripple cut length');
  else fail('window fabrication card missing 19½″ cripple cut length');
}

// ---- 4. cardSVG renders derived-only (no template) -------------------------
{
  try {
    const svg = cardSVG({ kind: 'wall', mod: mod('wall_4x8_2x6_16oc') }, { label: 'A-1', templates: null });
    if (typeof svg === 'string' && svg.includes('<svg') && svg.includes('W-01')) ok('cardSVG renders (derived-only)');
    else fail('cardSVG output missing <svg>/design id');
  } catch (e) { fail(`cardSVG threw: ${e.message}`); }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
