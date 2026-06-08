/**
 * CAD-AUD-007 regression: loading a legacy file resets stale level/trade/undo
 * state. App sitting on L2 loads a single-story file with no levels and no
 * per-entity level → activeLevel returns to L1 and walls land on L1, not the
 * hidden L2.
 *
 * Run from repo root: node tests/load_reset.mjs   (no FreeCAD needed)
 */
import { doc, ui, history, future } from '../web/js/state.js';
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
