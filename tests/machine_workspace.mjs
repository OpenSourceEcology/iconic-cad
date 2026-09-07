import { addMachineInstance, bomCsv, bomRows, newMachineWorkspace, validateCatalog, validateMachineWorkspace, workspaceFromDemo } from '../web/js/machine-core.js';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const assert = (test, message) => test ? ok(message) : fail(message);

const catalog = { version: 1, units: 'mm', entries: [{ id: 'axis', title: 'Universal Axis', family: 'motion', variant: 'demo', description: 'source geometry', source_url: 'https://example.test/axis', source_revision: 'r1', validation: { geometry: 'passed', engineering: 'unreviewed' }, bounds_mm: [100, 200, 300], parts: [{ id: 'frame', label: 'Frame', mesh: 'assets/gvcs/axis.mesh.json', brep: 'assets/gvcs/axis.brp', color: '#112233' }, { id: 'motor', label: 'Motor', mesh: 'assets/gvcs/motor.mesh.json', brep: 'assets/gvcs/motor.brp', color: '#445566' }] }], demos: [{ id: 'axis-demo', title: 'Axis demo', description: 'one axis', instances: [{ id: 'axis-1', entry_id: 'axis', position_mm: [0, 0, 0], rotation_deg: 0 }] }] };
assert(validateCatalog(catalog).ok, 'accepts complete catalog contract');
assert(!validateCatalog({ ...catalog, units: 'in' }).ok, 'rejects catalog with non-mm units');
const workspace = workspaceFromDemo(catalog.demos[0], catalog);
assert(validateMachineWorkspace(workspace, catalog).ok, 'accepts demo workspace');
const expanded = addMachineInstance(workspace, 'axis', [100, 0, 25]);
assert(expanded.instances[1].id === 'axis-2', 'allocates unique deterministic instance ids');
assert(bomRows(expanded, catalog).every(row => row.quantity === 2), 'BOM aggregates parts across instances');
assert(bomCsv(expanded, catalog).includes('"source_url"') && bomCsv(expanded, catalog).includes('"https://example.test/axis"'), 'BOM CSV preserves provenance');
assert(!validateMachineWorkspace({ ...newMachineWorkspace(), instances: [{ id: 'bad id', entry_id: 'axis', position_mm: [0, 0, 0], rotation_deg: 0 }] }, catalog).ok, 'rejects unsafe instance ids transactionally');
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
