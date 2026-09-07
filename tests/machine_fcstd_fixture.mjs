/**
 * Generates a placement-sensitive FCStd fixture from the committed machine
 * catalog for an external FreeCAD parity check. This is intentionally a
 * fixture generator, not a claim that source meshes and BREP solids agree.
 *
 * From repo root:
 *   node tests/machine_fcstd_fixture.mjs --output-dir /tmp/iconic-machine-fixture
 *
 * The output directory receives:
 *   - machine-placement-fixture.FCStd
 *   - machine-placement-expected.json (local and transformed mesh bounds)
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from '../web/vendor/jszip.min.mjs';
import { validateCatalog } from '../web/js/machine-core.js';
import { buildMachineFcstd, fcstdParts } from '../web/js/machine-fcstd.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(repoRoot, 'web/data/gvcs-machines.json');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--output-dir');
const outputDir = outIndex >= 0 ? args[outIndex + 1] : null;
if (outIndex >= 0 && (!outputDir || outputDir.startsWith('--'))) throw new Error('--output-dir needs a directory path.');
if (!outputDir) {
  console.log('SKIP machine FCStd fixture generation (pass --output-dir to generate parity inputs)');
  process.exit(0);
}
try { await access(catalogPath, fsConstants.R_OK); }
catch { throw new Error(`Machine catalog is not present at ${catalogPath}. Generate or restore source assets first.`); }

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const catalogValidation = validateCatalog(catalog);
if (!catalogValidation.ok) throw new Error(`Machine catalog is invalid: ${catalogValidation.errors.join(' ')}`);

function bounds(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length % 3 || !vertices.every(Number.isFinite)) throw new Error('Mesh vertices must be finite XYZ triples.');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], vertices[i + axis]); max[axis] = Math.max(max[axis], vertices[i + axis]); }
  return { min_mm: min, max_mm: max };
}
function placedBounds(vertices, instance) {
  const [ax,ay,az]=[instance.rotation_x_deg || 0,instance.rotation_y_deg || 0,instance.rotation_deg].map(n=>n*Math.PI/180);
  const points=[];
  for(let i=0;i<vertices.length;i+=3) {
    const [x,y,z]=vertices.slice(i,i+3);
    const y1=y*Math.cos(ax)-z*Math.sin(ax), z1=y*Math.sin(ax)+z*Math.cos(ax);
    const x2=x*Math.cos(ay)+z1*Math.sin(ay), z2=-x*Math.sin(ay)+z1*Math.cos(ay);
    points.push(x2*Math.cos(az)-y1*Math.sin(az)+instance.position_mm[0],x2*Math.sin(az)+y1*Math.cos(az)+instance.position_mm[1],z2+instance.position_mm[2]);
  }
  return bounds(points);
}

// Each entry receives a separate, nonzero XYZ placement. Spacing keeps
// fixtures readable in FreeCAD while covering legacy Z and mixed XYZ rotation; every part in an instance inherits the same object Placement.
const workspace = {
  version: 1,
  units: 'mm',
  instances: catalog.entries.flatMap((entry, index) => [
    { id: `${entry.id}-legacy-z`, entry_id: entry.id, position_mm: [125 + index * 5000, -250 - index * 3000, 75 + index * 100], rotation_deg: 90 },
    { id: `${entry.id}-xyz`, entry_id: entry.id, position_mm: [-350 + index * 5000, 500 - index * 3000, -175 + index * 100], rotation_x_deg: 27, rotation_y_deg: -35, rotation_deg: 73 }
  ]),
};
const fetchText = async assetPath => readFile(resolve(repoRoot, 'web', assetPath), 'utf8');
const bytes = await buildMachineFcstd(workspace, catalog, fetchText, JSZip);
const breps = Object.fromEntries(await Promise.all([...new Set(catalog.entries.flatMap(entry => entry.parts.map(part => part.brep)))].map(async assetPath => [assetPath, await fetchText(assetPath)])));
const fcstd = fcstdParts(workspace, catalog, breps);
const expectedParts = [];
for (const [index, instance] of workspace.instances.entries()) {
  const entry = catalog.entries.find(entry => entry.id === instance.entry_id);
  for (const part of entry.parts) {
    const mesh = JSON.parse(await readFile(resolve(repoRoot, 'web', part.mesh), 'utf8'));
    const localBounds = bounds(mesh.vertices);
    const fcstdPart = fcstd.find(candidate => candidate.label === `${entry.title} — ${part.label} (${instance.id})`);
    expectedParts.push({ object_name: fcstdPart.name, instance_id: instance.id, entry_id: entry.id, part_id: part.id, mesh_path: part.mesh, brep_path: part.brep, placement: { position_mm: instance.position_mm, rotation_x_deg: instance.rotation_x_deg || 0, rotation_y_deg: instance.rotation_y_deg || 0, rotation_deg: instance.rotation_deg }, local_mesh_bounds_mm: localBounds, placed_mesh_bounds_mm: placedBounds(mesh.vertices, instance) });
  }
}
const target = resolve(process.cwd(), outputDir);
await mkdir(target, { recursive: true });
await writeFile(resolve(target, 'machine-placement-fixture.FCStd'), bytes);
await writeFile(resolve(target, 'machine-placement-expected.json'), JSON.stringify({ fixture_version: 1, units: 'mm', note: 'Expected bounds derive from source preview meshes after the listed object Placement. They are parity inputs for FreeCAD inspection, not a BREP correctness assertion.', catalog: { source: 'web/data/gvcs-machines.json', version: catalog.version }, parts: expectedParts }, null, 2) + '\n');
console.log(`Generated ${expectedParts.length} placed part fixture(s) in ${target}`);
