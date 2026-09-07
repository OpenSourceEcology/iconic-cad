import { buildMachineFcstd, fcstdParts, machineDocumentXml, rigidZTransformBrep, zPlacement } from '../web/js/machine-fcstd.js';
import { workspaceFromDemo } from '../web/js/machine-core.js';
import JSZip from '../web/vendor/jszip.min.mjs';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const assert = (test, message) => test ? ok(message) : fail(message);
const catalog = { version: 1, units: 'mm', entries: [{ id: 'press', title: 'CEB Press', family: 'fabrication', variant: 'demo', description: 'source geometry', source_url: 'https://example.test/press', source_revision: 'rev-7', license_review: 'pending', validation: { geometry: 'passed', engineering: 'unreviewed' }, bounds_mm: [1, 1, 1], parts: [{ id: 'body', label: 'Body', mesh: 'assets/gvcs/press.mesh.json', brep: 'assets/gvcs/press.brp', color: '#334455' }] }], demos: [{ id: 'demo', title: 'Demo', description: '', instances: [{ id: 'press-1', entry_id: 'press', position_mm: [125, -50, 8], rotation_deg: 90 }] }] };
const workspace = workspaceFromDemo(catalog.demos[0], catalog);
const sourceBrep = `DBRep_DrawableShape

CASCADE Topology V1, (c) Matra-Datavision
Locations 1
1
              1               0               0 10
              0               1               0 20
              0               0               1 30
Curve2ds 0
+1 1
`;
const placement = zPlacement([125, -50, 8], 90);
assert(Math.abs(placement.q2 - Math.SQRT1_2) < 1e-12 && Math.abs(placement.q3 - Math.SQRT1_2) < 1e-12, 'uses a Z-axis quaternion for placement rotation');
const transformed = rigidZTransformBrep(sourceBrep, [125, -50, 8], 90);
assert(transformed.includes('Locations 3') && transformed.includes('2 1 1 2 1 0'), 'appends a composite BREP Location without replacing the source top Location');
assert(transformed.includes('0               -1               0 125') && transformed.includes('1               0               0 -50'), 'writes the requested rigid Z transform into the appended BREP Location');
assert((() => { try { rigidZTransformBrep('not a BREP', [0, 0, 0], 0); return false; } catch { return true; } })(), 'fails closed when a BREP has no location header');
const parts = fcstdParts(workspace, catalog, { 'assets/gvcs/press.brp': sourceBrep });
const xml = machineDocumentXml(parts);
assert(xml.includes('Px="0" Py="0" Pz="0"') && xml.includes('Q2="0" Q3="1" A="0" Ox="0" Oy="0" Oz="1"'), 'keeps XML Placement at identity so Shape restore cannot replace the assembly transform');
assert(parts[0].brep.includes('0               -1               0 125') && parts[0].brep.includes('0               0               1 30'), 'keeps source Location data and adds the assembly transform in BREP');
const archive = await buildMachineFcstd(workspace, catalog, async path => path === 'assets/gvcs/press.brp' ? sourceBrep : '', JSZip);
const zip = await JSZip.loadAsync(archive);
assert(Object.keys(zip.files).some(name => name === 'Document.xml') && Object.keys(zip.files).some(name => name.endsWith('.brp')), 'archive contains FCStd document and source BREP sidecar');
assert((await zip.file('Document.xml').async('string')).includes('SourceRevision'), 'archive records source provenance');
assert((await zip.file(Object.keys(zip.files).find(name => name.endsWith('.brp'))).async('string')).includes('Locations 3'), 'archive contains the transformed BREP payload');
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
