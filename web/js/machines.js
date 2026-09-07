import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { addMachineInstance, bomCsv, bomRows, newMachineWorkspace, validateCatalog, validateMachineWorkspace, workspaceFromDemo } from './machine-core.js';
import { buildMachineFcstd } from './machine-fcstd.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['viewport', 'catalog-list', 'demo-list', 'catalog-status', 'empty-state', 'component-list', 'selected-name', 'selected-detail', 'position-x', 'position-y', 'position-z', 'rotation-z', 'apply-transform', 'duplicate-instance', 'delete-instance', 'new-workspace', 'save-workspace', 'load-workspace', 'load-file', 'export-bom', 'export-fcstd', 'message'].map(id => [id, $(id)]));
let catalog = null;
let workspace = newMachineWorkspace();
let selectedId = null;
let buildToken = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a111a');
const camera = new THREE.PerspectiveCamera(45, 1, 1, 200000);
camera.position.set(2100, 1700, 2100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
ui.viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .07; controls.screenSpacePanning = false;
controls.target.set(0, 0, 500);
scene.add(new THREE.HemisphereLight(0xcceaff, 0x17212b, 2.1));
const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1600, 2400, 1200); scene.add(key);
const grid = new THREE.GridHelper(7000, 70, 0x38576e, 0x1d3446); grid.material.opacity = .52; grid.material.transparent = true; scene.add(grid);
const axes = new THREE.AxesHelper(450); scene.add(axes);
const assembly = new THREE.Group(); scene.add(assembly);
const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pointerStart = null;
const entryMeshCache = new Map();

function message(text, kind = '') { ui.message.textContent = text; ui.message.className = `message ${kind}`; }
function entryFor(id) { return catalog?.entries.find(entry => entry.id === id); }
function instanceFor(id) { return workspace.instances.find(instance => instance.id === id); }
function download(textOrBytes, filename, type) { const url = URL.createObjectURL(new Blob([textOrBytes], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
function fileStem() { return 'iconic-machines-assembly'; }

function resize() { const { width, height } = ui.viewport.getBoundingClientRect(); if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); }
new ResizeObserver(resize).observe(ui.viewport);
function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); } animate();

async function meshGroup(entry) {
  if (entryMeshCache.has(entry.id)) return entryMeshCache.get(entry.id);
  const loading = Promise.all(entry.parts.map(async part => {
    const response = await fetch(part.mesh, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${part.label} mesh could not be read (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.vertices) || data.vertices.length < 9 || data.vertices.length % 3 || !Array.isArray(data.triangles) || data.triangles.length < 3 || data.triangles.length % 3 || !data.vertices.every(Number.isFinite) || !data.triangles.every(Number.isInteger)) throw new Error(`${part.label} mesh has an invalid triangle payload.`);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
    geometry.setIndex(data.triangles); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: part.color, roughness: .67, metalness: .12 });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = part.label; return mesh;
  })).then(meshes => { const group = new THREE.Group(); meshes.forEach(mesh => group.add(mesh)); return group; });
  entryMeshCache.set(entry.id, loading);
  return loading;
}

async function redrawAssembly() {
  const token = ++buildToken;
  assembly.clear();
  ui['empty-state'].hidden = workspace.instances.length > 0;
  for (const instance of workspace.instances) {
    const entry = entryFor(instance.entry_id); if (!entry) continue;
    try {
      const group = (await meshGroup(entry)).clone(true);
      if (token !== buildToken) return;
      group.position.fromArray(instance.position_mm); group.rotation.z = THREE.MathUtils.degToRad(instance.rotation_deg);
      group.userData.instanceId = instance.id;
      group.traverse(node => { if (node.isMesh) node.userData.instanceId = instance.id; });
      assembly.add(group);
    } catch (error) { if (token === buildToken) message(`Preview issue: ${error.message}`, 'error'); }
  }
}

function renderCatalog() {
  ui['catalog-list'].replaceChildren(); ui['demo-list'].replaceChildren();
  for (const demo of catalog.demos) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'demo-card';
    button.innerHTML = `<span class="card-title"></span><span class="card-detail"></span>`;
    button.querySelector('.card-title').textContent = demo.title; button.querySelector('.card-detail').textContent = demo.description;
    button.addEventListener('click', () => { workspace = workspaceFromDemo(demo, catalog); selectedId = workspace.instances[0]?.id || null; refresh(); message(`Loaded ${demo.title}.`, 'success'); }); ui['demo-list'].append(button);
  }
  for (const entry of catalog.entries) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-card';
    button.innerHTML = `<span class="card-title"></span><span class="card-detail"></span><span class="badge">Geometry ${entry.validation.geometry}</span>`;
    button.querySelector('.card-title').textContent = `Place ${entry.title}`;
    button.querySelector('.card-detail').textContent = `${entry.family} · ${entry.variant} · ${entry.bounds_mm.join(' × ')} mm`;
    if (entry.validation.assembly === 'failed') { const warning = document.createElement('span'); warning.className = 'badge review'; warning.textContent = 'Source intersections need review'; button.append(warning); }
    button.addEventListener('click', () => { workspace = addMachineInstance(workspace, entry.id); selectedId = workspace.instances.at(-1).id; refresh(); message(`${entry.title} placed at the origin.`, 'success'); }); ui['catalog-list'].append(button);
  }
}

function renderInspector() {
  const selected = instanceFor(selectedId); const entry = selected && entryFor(selected.entry_id); const hasSelection = Boolean(selected);
  ui['selected-name'].textContent = entry ? `${entry.title} · ${selected.id}` : 'Nothing selected';
  ui['selected-detail'].textContent = entry ? `Catalog bounds: ${entry.bounds_mm.join(' × ')} mm. Geometry ${entry.validation.geometry}.${entry.validation.assembly === 'failed' ? ' Source intersections need review.' : ''} Engineering and license review pending.` : 'Select a placed machine to inspect its catalog bounds.';
  for (const element of [ui['position-x'], ui['position-y'], ui['position-z'], ui['rotation-z'], ui['apply-transform'], ui['duplicate-instance'], ui['delete-instance']]) element.disabled = !hasSelection;
  if (selected) { ui['position-x'].value = selected.position_mm[0]; ui['position-y'].value = selected.position_mm[1]; ui['position-z'].value = selected.position_mm[2]; ui['rotation-z'].value = selected.rotation_deg; }
  ui['component-list'].replaceChildren(); const rows = bomRows(workspace, catalog);
  if (!rows.length) ui['component-list'].innerHTML = '<p class="muted">No placed components.</p>';
  for (const row of rows) { const el = document.createElement('div'); el.className = 'component-row'; const title = document.createElement('strong'); title.textContent = `${row.quantity} × ${row.part_label}`; const meta = document.createElement('span'); const sourceEntry = entryFor(row.entry_id); meta.textContent = `${row.entry_title} · bounds ${sourceEntry.bounds_mm.join(' × ')} mm · ${row.source_revision}`; const source = document.createElement('a'); source.href = row.source_url; source.target = '_blank'; source.rel = 'noopener'; source.textContent = 'source ↗'; meta.append(' · ', source); el.append(title, meta); ui['component-list'].append(el); }
}
function refresh() { renderInspector(); redrawAssembly(); }

ui['new-workspace'].addEventListener('click', () => { workspace = newMachineWorkspace(); selectedId = null; refresh(); message('Started a new machine workspace.', 'success'); });
ui['duplicate-instance'].addEventListener('click', () => { const original = instanceFor(selectedId); if (!original) return; const withDuplicate = addMachineInstance(workspace, original.entry_id, [original.position_mm[0] + 150, original.position_mm[1] + 150, original.position_mm[2]]); const duplicate = { ...withDuplicate.instances.at(-1), rotation_deg: original.rotation_deg }; workspace = { ...withDuplicate, instances: [...withDuplicate.instances.slice(0, -1), duplicate] }; selectedId = duplicate.id; refresh(); message('Duplicated selected machine with a 150 mm offset.', 'success'); });
ui['delete-instance'].addEventListener('click', () => { workspace = { ...workspace, instances: workspace.instances.filter(instance => instance.id !== selectedId) }; selectedId = workspace.instances[0]?.id || null; refresh(); message('Removed selected instance.', 'success'); });
ui['transform-form'].addEventListener('submit', event => { event.preventDefault(); const selected = instanceFor(selectedId); const values = [Number(ui['position-x'].value), Number(ui['position-y'].value), Number(ui['position-z'].value), Number(ui['rotation-z'].value)]; if (!selected || !values.every(Number.isFinite)) return message('Use finite numeric values for XYZ and rotation.', 'error'); workspace = { ...workspace, instances: workspace.instances.map(instance => instance.id === selectedId ? { ...instance, position_mm: values.slice(0, 3), rotation_deg: values[3] } : instance) }; refresh(); message('Applied transform.', 'success'); });
ui['save-workspace'].addEventListener('click', () => { download(JSON.stringify(workspace, null, 2), `${fileStem()}.json`, 'application/json'); message('Machine workspace saved.', 'success'); });
ui['load-workspace'].addEventListener('click', () => ui['load-file'].click());
ui['load-file'].addEventListener('change', async () => { const file = ui['load-file'].files[0]; ui['load-file'].value = ''; if (!file) return; try { const candidate = JSON.parse(await file.text()); const valid = validateMachineWorkspace(candidate, catalog); if (!valid.ok) throw new Error(valid.errors.join(' ')); workspace = candidate; selectedId = workspace.instances[0]?.id || null; refresh(); message('Machine workspace loaded.', 'success'); } catch (error) { message(`Could not load workspace: ${error.message}`, 'error'); } });
ui['export-bom'].addEventListener('click', () => { if (!workspace.instances.length) return message('Place a machine before exporting a component BOM.', 'error'); download(bomCsv(workspace, catalog), `${fileStem()}-component-bom.csv`, 'text/csv'); message('Component BOM CSV exported. It does not estimate materials or prices.', 'success'); });
ui['export-fcstd'].addEventListener('click', async () => { try { ui['export-fcstd'].disabled = true; message('Building FreeCAD archive from local source BREPs…'); const { default: JSZip } = await import('../vendor/jszip.min.mjs'); const bytes = await buildMachineFcstd(workspace, catalog, async path => { const response = await fetch(path, { cache: 'no-store' }); if (!response.ok) throw new Error(`${path} could not be read (${response.status}).`); return response.text(); }, JSZip); download(bytes, `${fileStem()}.FCStd`, 'application/vnd.freecad'); message('FreeCAD archive exported.', 'success'); } catch (error) { message(`Could not export FreeCAD: ${error.message}`, 'error'); } finally { ui['export-fcstd'].disabled = false; } });

renderer.domElement.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('pointerup', event => { const start = pointerStart; pointerStart = null; if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return; const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(assembly.children, true)[0]; if (hit?.object.userData.instanceId) { selectedId = hit.object.userData.instanceId; renderInspector(); message('Selected instance.', 'success'); } else { selectedId = null; renderInspector(); message('Selection cleared.'); } });
renderer.domElement.addEventListener('pointercancel', () => { pointerStart = null; });
window.addEventListener('keydown', event => { if (event.target.matches('input')) return; if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) ui['delete-instance'].click(); });

async function initialize() {
  try { const response = await fetch('data/gvcs-machines.json', { cache: 'no-store' }); if (!response.ok) throw new Error(`catalog returned ${response.status}`); const candidate = await response.json(); const valid = validateCatalog(candidate); if (!valid.ok) throw new Error(valid.errors.join(' ')); catalog = candidate; renderCatalog(); renderInspector(); ui['catalog-status'].textContent = `${catalog.entries.length} source entries · ${catalog.demos.length} demos`; ui['catalog-status'].className = 'status'; } catch (error) { ui['catalog-status'].textContent = `Catalog unavailable: ${error.message}`; ui['catalog-status'].className = 'status error'; message('The machine workbench needs its local catalog assets. Serve the web directory over HTTP.', 'error'); } finally { resize(); } }
initialize();
