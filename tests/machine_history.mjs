import { addMachineInstance, createMachineHistory, newMachineWorkspace, recordMachineWorkspace, redoMachineWorkspace, undoMachineWorkspace, validateMachineWorkspace } from '../web/js/machine-core.js';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const assert = (test, message) => test ? ok(message) : fail(message);
const catalog = { entries: [{ id: 'axis', title: 'Axis', family: 'motion', variant: 'v1', description: 'fixture', source_url: 'https://example.test/axis', source_revision: '1', license_review: 'pending', validation: { geometry: 'passed', engineering: 'unreviewed' }, bounds_mm: [1, 1, 1], parts: [{ id: 'part', label: 'Part', mesh: 'assets/gvcs/part.mesh.json', brep: 'assets/gvcs/part.brp', color: '#112233' }] }] };
const legacy = { version: 1, units: 'mm', instances: [{ id: 'axis-1', entry_id: 'axis', position_mm: [0, 0, 0], rotation_deg: 0 }] };
assert(validateMachineWorkspace(legacy, catalog).ok, 'loads legacy v1 workspaces without X/Y rotations');
let history = createMachineHistory(legacy, catalog);
const placed = addMachineInstance(legacy, 'axis', [100, 20, 5]);
history = recordMachineWorkspace(history, placed, catalog);
assert(history.past.length === 1 && history.future.length === 0 && history.present.instances.length === 2, 'records an immutable placement edit and clears redo');
placed.instances[1].position_mm[0] = 999;
assert(history.present.instances[1].position_mm[0] === 100, 'history clones the recorded workspace');
history = undoMachineWorkspace(history);
assert(history.present.instances.length === 1 && history.future.length === 1, 'undo restores the previous workspace state');
history = redoMachineWorkspace(history);
assert(history.present.instances.length === 2 && history.future.length === 0, 'redo restores the undone workspace state');
history = undoMachineWorkspace(history);
history = recordMachineWorkspace(history, newMachineWorkspace(), catalog);
assert(history.future.length === 0 && history.present.instances.length === 0, 'new workspace is an undoable edit that invalidates redo');
try { recordMachineWorkspace(history, { version: 1, units: 'mm', instances: [{ id: 'bad', entry_id: 'axis', position_mm: [0, 0, 0], rotation_deg: 0, rotation_x_deg: Infinity }] }, catalog); fail('rejects invalid history state'); }
catch { ok('rejects invalid history state'); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
