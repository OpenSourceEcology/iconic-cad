/**
 * CAD-AUD-007 regression: loading a legacy file resets stale level/trade/undo
 * state. App sitting on L2 loads a single-story file with no levels and no
 * per-entity level → activeLevel returns to L1 and walls land on L1, not the
 * hidden L2.
 *
 * Run from repo root: node tests/load_reset.mjs   (no FreeCAD needed)
 */
import { doc, ui, history, future } from '../web/js/state.js';
import assert from 'node:assert/strict';
import { activeSystem } from '../web/js/systems.js';
import { applyLoadedData } from '../web/js/load.js';

let passed = 0, failed = 0;
const fail = m => { console.error(`  FAIL ${m}`); failed++; };
const ok = m => { passed++; if (process.env.VERBOSE) console.log(`  ok ${m}`); };
const eq = (got, want, label) => got === want ? ok(`${label} = ${want}`) : fail(`${label} = ${got}, want ${want}`);

// --- simulate a session deep into a two-story project, sitting on L2 ---
doc.project.stories = 2;
doc.levels = [{ id: 'L1', name: 'Level 1', z_mm: 0 }, { id: 'L2', name: 'Level 2', z_mm: 3095.63 }];
doc.activeLevel = 'L2';
doc.activeLayer = 'foundation';
ui.reachedTrade = 2;
ui.activeTrade = '3d';
history.push({ type: 'place' });
future.push({ type: 'erase' });

// --- load a legacy single-story file: no project, no levels, no entity level ---
const legacy = { entities: [{ module: 'wall_4x8_2x6_16oc', direction: 'north', x_mm: 0, y_mm: 0 }] };
applyLoadedData(legacy);

eq(doc.activeLevel, 'L1', 'activeLevel');
eq(doc.activeLayer, 'structural', 'activeLayer');
eq(doc.levels.length, 1, 'levels count');
eq(doc.levels[0].id, 'L1', 'sole level id');
eq(doc.project.stories, 1, 'project.stories');
eq(ui.reachedTrade, 0, 'reachedTrade');
eq(ui.activeTrade, 'framing', 'activeTrade');
eq(history.length, 0, 'history cleared');
eq(future.length, 0, 'future cleared');

const wall = doc.entities.find(e => e.kind === 'wall');
if (wall) ok('wall loaded'); else fail('no wall loaded');
eq(wall && wall.level, 'L1', 'loaded wall level');

// A rejected file must preserve both the design and its editing session.
applyLoadedData({ project: { name: 'Keep me', system: 'vcs12', stories: 2 },
  entities: [{ module: 'extwall_standard', system: 'vcs12', id: 'saved', direction: 'north', x_mm: 0, y_mm: 0 }] });
doc.activeLevel = 'L2';
ui.activeTrade = '3d';
ui.reachedTrade = 2;
ui.dragState = { marker: 'keep drag' };
ui.snapTarget = { marker: 'keep snap' };
ui.eraseMode = true;
history.push({ type: 'place', marker: 'keep undo' });
future.push({ type: 'erase', marker: 'keep redo' });
const stable = { doc: structuredClone(doc), ui: structuredClone(ui), history: structuredClone(history), future: structuredClone(future), system: activeSystem().id };
const refs = { project: doc.project, levels: doc.levels, entities: doc.entities, entity: doc.entities[0] };
const first = { module: 'wall_4x8_2x6_16oc', system: 'seh', id: 'partial', direction: 'north', x_mm: 0, y_mm: 0 };
for (const [label, data] of [
  ['late mixed system', { project: { name: 'Bad import', system: 'seh' }, entities: [first, { ...first, system: 'vcs12' }] }],
  ['unknown module', { entities: [first, { ...first, module: 'missing-module' }] }],
  ['unknown system', { project: { system: 'missing-system' }, entities: [] }],
  ['invalid entity list', { entities: {} }],
  ['null entity', { entities: [first, null] }],
  ['invalid levels', { levels: [null], project: { stories: 2 }, entities: [] }],
  ['null document', null],
]) {
  try {
    assert.throws(() => applyLoadedData(data));
    assert.deepEqual({ doc, ui, history, future, system: activeSystem().id }, stable);
    assert.equal(doc.project, refs.project);
    assert.equal(doc.levels, refs.levels);
    assert.equal(doc.entities, refs.entities);
    assert.equal(doc.entities[0], refs.entity);
    ok(`${label} preserves design and editing session`);
  } catch (error) { fail(`${label}: ${error.message}`); }
}

// A valid replacement still resets the session and creates legacy L2 without
// modifying the supplied saved data, even when its level array is frozen.
const levels = Object.freeze([Object.freeze({ id: 'L1', name: 'Ground', z_mm: 0 })]);
try {
  applyLoadedData({ project: { name: 'Replacement', stories: 2 }, levels,
    modules: [first, { kind: 'foundation', id: 'base', params: { depth: 20 } }] });
  assert.equal(doc.project.name, 'Replacement');
  assert.equal(doc.entities.length, 2);
  assert.equal(doc.levels.length, 2);
  assert.equal(levels.length, 1);
  assert.equal(doc.activeLevel, 'L1');
  assert.equal(activeSystem().id, 'seh');
  assert.equal(history.length, 0);
  assert.equal(future.length, 0);
  assert.equal(ui.dragState, null);
  assert.equal(ui.activeTrade, 'framing');
  ok('valid legacy/foundation replacement commits and resets');
} catch (error) { fail(`valid replacement: ${error.message}`); }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
