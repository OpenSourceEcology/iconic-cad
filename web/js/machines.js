import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { addMachineInstance, bomCsv, bomRows, createMachineHistory, newMachineWorkspace, normalizeDegrees, recordMachineWorkspace, redoMachineWorkspace, undoMachineWorkspace, validateCatalog, validateMachineWorkspace, validateMeshPayload, workspaceFromDemo } from './machine-core.js';
import { buildMachineFcstd } from './machine-fcstd.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['viewport', 'catalog-list', 'catalog-filter', 'demo-list', 'catalog-status', 'empty-state', 'component-list', 'instance-list', 'selected-name', 'selected-detail', 'transform-form', 'position-x', 'position-y', 'position-z', 'rotation-x', 'rotation-y', 'rotation-z', 'apply-transform', 'duplicate-instance', 'delete-instance', 'new-workspace', 'undo-workspace', 'redo-workspace', 'fit-view', 'save-workspace', 'load-workspace', 'load-file', 'export-bom', 'export-fcstd', 'message'].map(id => [id, $(id)]));
let catalog = null;
let workspace = newMachineWorkspace();
let workspaceHistory = createMachineHistory(workspace, null);
let selectedId = null;
let buildToken = 0;
let catalogFilter = '';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a111a');
const camera = new THREE.PerspectiveCamera(45, 1, 1, 200000);
camera.up.set(0, 0, 1);
camera.position.set(2100, -1700, 1500);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
ui.viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .07; controls.screenSpacePanning = false;
controls.target.set(0, 0, 300);
scene.add(new THREE.HemisphereLight(0xcceaff, 0x17212b, 2.1));
const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1600, -2400, 1800); scene.add(key);
const grid = new THREE.GridHelper(7000, 70, 0x38576e, 0x1d3446); grid.rotation.x = Math.PI / 2; grid.material.opacity = .52; grid.material.transparent = true; scene.add(grid);
const axes = new THREE.AxesHelper(450); scene.add(axes);
const assembly = new THREE.Group(); scene.add(assembly);
const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pointerStart = null;
const entryMeshCache = new Map();
let selectionHighlight = null;

function message(text, kind = '') { ui.message.textContent = text; ui.message.className = `message ${kind}`; }
function entryFor(id) { return catalog?.entries.find(entry => entry.id === id); }
function instanceFor(id) { return workspace.instances.find(instance => instance.id === id); }
function download(textOrBytes, filename, type) { const url = URL.createObjectURL(new Blob([textOrBytes], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
function fileStem() { return 'iconic-machines-assembly'; }
function reconcileSelection() { if (!instanceFor(selectedId)) selectedId = workspace.instances[0]?.id || null; }
function changeWorkspace(nextWorkspace) { workspaceHistory = recordMachineWorkspace(workspaceHistory, nextWorkspace, catalog); workspace = workspaceHistory.present; reconcileSelection(); }

function resize() { const { width, height } = ui.viewport.getBoundingClientRect(); if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); }
new ResizeObserver(resize).observe(ui.viewport);
function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); } animate();

function fitAssembly() {
  const box = new THREE.Box3().setFromObject(assembly);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distance = Math.max(sphere.radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.22, 20);
  camera.up.set(0, 0, 1);
  const viewDirection = camera.position.clone().sub(controls.target);
  if (viewDirection.lengthSq() < 1e-6) viewDirection.set(1, -1, 1);
  camera.position.copy(sphere.center).add(viewDirection.normalize().multiplyScalar(distance));
  controls.target.copy(sphere.center);
  camera.near = Math.max(distance / 1000, 0.01); camera.far = Math.max(distance * 100, 1000);
  // Keep inspection helpers useful from a 20 mm spacer to a large assembly.
  // GridHelper starts on XZ; its existing X rotation makes this a Z-up XY grid.
  const helperRadius = Math.max(sphere.radius, 1);
  grid.scale.setScalar(Math.max(helperRadius * 3, 10) / 7000);
  grid.position.set(sphere.center.x, sphere.center.y, box.min.z);
  axes.scale.setScalar(Math.max(helperRadius * .45, 2) / 450);
  axes.position.set(box.min.x, box.min.y, box.min.z);
  camera.updateProjectionMatrix(); controls.update();
}
function canonicalView(name) {
  const box = new THREE.Box3().setFromObject(assembly);
  if (box.isEmpty()) return message('Place a machine before choosing a camera view.', 'error');
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distance = Math.max(sphere.radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.22, 20);
  // Keep Z-up for every view: OrbitControls cached this axis at construction.
  // A tiny Y component avoids a collinear up/view vector at exact top-down.
  const directions = { iso: [1, -1, 1], front: [0, -1, 0], top: [0, -.0001, 1], side: [1, 0, 0] };
  camera.up.set(0, 0, 1);
  camera.position.copy(sphere.center).add(new THREE.Vector3(...directions[name]).normalize().multiplyScalar(distance));
  controls.target.copy(sphere.center); camera.near = Math.max(distance / 1000, .01); camera.far = Math.max(distance * 100, 1000);
  camera.updateProjectionMatrix(); controls.update();
}
function formatMM(value) { const precision = Math.abs(value) < 10 ? 2 : 1; return Number(value.toFixed(precision)).toString(); }
function formatBounds(bounds) { return bounds.map(formatMM).join(' × '); }

function updateSelectedHighlight() {
  if (selectionHighlight) { scene.remove(selectionHighlight); selectionHighlight.geometry.dispose(); selectionHighlight.material.dispose(); selectionHighlight = null; }
  const selectedGroup = assembly.children.find(group => group.userData.instanceId === selectedId);
  if (!selectedGroup) return;
  selectionHighlight = new THREE.BoxHelper(selectedGroup, 0xffdf6d);
  selectionHighlight.material.depthTest = false; selectionHighlight.material.transparent = true; selectionHighlight.material.opacity = .95;
  selectionHighlight.renderOrder = 10; selectionHighlight.update(); scene.add(selectionHighlight);
}

async function meshGroup(entry) {
  if (entryMeshCache.has(entry.id)) return entryMeshCache.get(entry.id);
  const loading = Promise.all(entry.parts.map(async part => {
    const response = await fetch(part.mesh, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${part.label} mesh could not be read (${response.status}).`);
    const data = await response.json();
    if (!validateMeshPayload(data).ok) throw new Error(`${part.label} mesh has an invalid triangle payload.`);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
    geometry.setIndex(data.triangles); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: part.color, roughness: .67, metalness: .12, flatShading: true });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = part.label; return mesh;
  })).then(meshes => { const group = new THREE.Group(); meshes.forEach(mesh => group.add(mesh)); return group; });
  entryMeshCache.set(entry.id, loading);
  try { return await loading; }
  catch (error) { if (entryMeshCache.get(entry.id) === loading) entryMeshCache.delete(entry.id); throw error; }
}

async function redrawAssembly(fitWhenReady = false) {
  const token = ++buildToken;
  assembly.clear();
  updateSelectedHighlight();
  ui['empty-state'].hidden = workspace.instances.length > 0;
  for (const instance of workspace.instances) {
    const entry = entryFor(instance.entry_id); if (!entry) continue;
    try {
      const group = (await meshGroup(entry)).clone(true);
      if (token !== buildToken) return;
      group.position.fromArray(instance.position_mm);
      // Three's ZYX intrinsic Euler order yields Rz * Ry * Rx: X, then Y, then Z.
      group.rotation.set(THREE.MathUtils.degToRad(normalizeDegrees(instance.rotation_x_deg ?? 0)), THREE.MathUtils.degToRad(normalizeDegrees(instance.rotation_y_deg ?? 0)), THREE.MathUtils.degToRad(normalizeDegrees(instance.rotation_deg)), 'ZYX');
      group.userData.instanceId = instance.id;
      group.traverse(node => { if (node.isMesh) node.userData.instanceId = instance.id; });
      assembly.add(group);
    } catch (error) { if (token === buildToken) message(`Preview issue: ${error.message}`, 'error'); }
  }
  if (token === buildToken) { updateSelectedHighlight(); if (fitWhenReady) fitAssembly(); }
}

function renderCatalog() {
  ui['catalog-list'].replaceChildren(); ui['demo-list'].replaceChildren();
  for (const demo of catalog.demos) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'demo-card';
    button.innerHTML = `<span class="card-title"></span><span class="card-detail"></span>`;
    button.querySelector('.card-title').textContent = demo.title; button.querySelector('.card-detail').textContent = demo.description;
    button.addEventListener('click', () => { changeWorkspace(workspaceFromDemo(demo, catalog)); selectedId = workspace.instances[0]?.id || null; refresh({ fit: true }); message(`Loaded ${demo.title}.`, 'success'); }); ui['demo-list'].append(button);
  }
  const query = catalogFilter.trim().toLocaleLowerCase();
  const entries = catalog.entries.filter(entry => !query || [entry.title, entry.family, entry.variant, entry.description, entry.id].join(' ').toLocaleLowerCase().includes(query));
  if (!entries.length) ui['catalog-list'].innerHTML = '<p class="muted">No source entries match this filter.</p>';
  for (const entry of entries) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-card';
    button.innerHTML = `<span class="card-title"></span><span class="card-detail"></span><span class="badge">Geometry ${entry.validation.geometry}</span>`;
    button.querySelector('.card-title').textContent = `Place ${entry.title}`;
    button.querySelector('.card-detail').textContent = `${entry.family} · ${entry.variant} · ${formatBounds(entry.bounds_mm)} mm`;
    if (entry.validation.assembly === 'failed') { const warning = document.createElement('span'); warning.className = 'badge review'; warning.textContent = 'Source intersections need review'; button.append(warning); }
    button.addEventListener('click', () => { changeWorkspace(addMachineInstance(workspace, entry.id)); selectedId = workspace.instances.at(-1).id; refresh({ fit: true }); message(`${entry.title} placed at the origin.`, 'success'); }); ui['catalog-list'].append(button);
  }
}

function renderInspector() {
  const selected = instanceFor(selectedId); const entry = selected && entryFor(selected.entry_id); const hasSelection = Boolean(selected);
  ui['selected-name'].textContent = entry ? `${entry.title} · ${selected.id}` : 'Nothing selected';
  ui['selected-detail'].textContent = entry ? `Catalog bounds: ${formatBounds(entry.bounds_mm)} mm. Geometry ${entry.validation.geometry}.${entry.validation.assembly === 'failed' ? ' Source intersections need review.' : ''} Engineering and license review pending.` : 'Select a placed machine to inspect its catalog bounds.';
  ui['undo-workspace'].disabled = !workspaceHistory.past.length; ui['redo-workspace'].disabled = !workspaceHistory.future.length;
  for (const element of [ui['position-x'], ui['position-y'], ui['position-z'], ui['rotation-x'], ui['rotation-y'], ui['rotation-z'], ui['apply-transform'], ui['duplicate-instance'], ui['delete-instance']]) element.disabled = !hasSelection;
  if (selected) { ui['position-x'].value = selected.position_mm[0]; ui['position-y'].value = selected.position_mm[1]; ui['position-z'].value = selected.position_mm[2]; ui['rotation-x'].value = selected.rotation_x_deg ?? 0; ui['rotation-y'].value = selected.rotation_y_deg ?? 0; ui['rotation-z'].value = selected.rotation_deg; }
  ui['instance-list'].replaceChildren();
  if (!workspace.instances.length) ui['instance-list'].innerHTML = '<p class="muted">No machines placed.</p>';
  for (const instance of workspace.instances) { const option = document.createElement('button'); option.type = 'button'; option.className = 'instance-item'; option.setAttribute('aria-pressed', String(instance.id === selectedId)); const instanceEntry = entryFor(instance.entry_id); option.textContent = `${instanceEntry.title} · ${instance.id}`; option.addEventListener('click', () => { selectedId = instance.id; renderInspector(); message('Selected instance.', 'success'); }); ui['instance-list'].append(option); }
  ui['component-list'].replaceChildren(); const rows = bomRows(workspace, catalog);
  if (!rows.length) ui['component-list'].innerHTML = '<p class="muted">No placed components.</p>';
  for (const row of rows) { const el = document.createElement('div'); el.className = 'component-row'; const title = document.createElement('strong'); title.textContent = `${row.quantity} × ${row.part_label}`; const meta = document.createElement('span'); const sourceEntry = entryFor(row.entry_id); meta.textContent = `${row.entry_title} · bounds ${formatBounds(sourceEntry.bounds_mm)} mm · ${row.source_revision}`; const source = document.createElement('a'); source.href = row.source_url; source.target = '_blank'; source.rel = 'noopener'; source.textContent = 'source ↗'; meta.append(' · ', source); el.append(title, meta); ui['component-list'].append(el); }
  updateSelectedHighlight();
}
function refresh({ fit = false } = {}) { renderInspector(); redrawAssembly(fit); }

ui['new-workspace'].addEventListener('click', () => { changeWorkspace(newMachineWorkspace()); selectedId = null; refresh(); message('Started a new machine workspace.', 'success'); });
ui['undo-workspace'].addEventListener('click', () => { workspaceHistory = undoMachineWorkspace(workspaceHistory); workspace = workspaceHistory.present; reconcileSelection(); refresh(); message('Undid workspace change.', 'success'); });
ui['redo-workspace'].addEventListener('click', () => { workspaceHistory = redoMachineWorkspace(workspaceHistory); workspace = workspaceHistory.present; reconcileSelection(); refresh(); message('Redid workspace change.', 'success'); });
ui['fit-view'].addEventListener('click', fitAssembly);
ui['duplicate-instance'].addEventListener('click', () => { const original = instanceFor(selectedId); if (!original) return; const withDuplicate = addMachineInstance(workspace, original.entry_id, [original.position_mm[0] + 150, original.position_mm[1] + 150, original.position_mm[2]]); const duplicate = { ...withDuplicate.instances.at(-1), rotation_x_deg: original.rotation_x_deg ?? 0, rotation_y_deg: original.rotation_y_deg ?? 0, rotation_deg: original.rotation_deg }; changeWorkspace({ ...withDuplicate, instances: [...withDuplicate.instances.slice(0, -1), duplicate] }); selectedId = duplicate.id; refresh(); message('Duplicated selected machine with a 150 mm offset.', 'success'); });
ui['delete-instance'].addEventListener('click', () => { changeWorkspace({ ...workspace, instances: workspace.instances.filter(instance => instance.id !== selectedId) }); reconcileSelection(); refresh(); message('Removed selected instance.', 'success'); });
ui['transform-form'].addEventListener('submit', event => { event.preventDefault(); const selected = instanceFor(selectedId); const values = [Number(ui['position-x'].value), Number(ui['position-y'].value), Number(ui['position-z'].value), Number(ui['rotation-x'].value), Number(ui['rotation-y'].value), Number(ui['rotation-z'].value)]; if (!selected || !values.every(Number.isFinite)) return message('Use finite numeric values for XYZ and rotation.', 'error'); changeWorkspace({ ...workspace, instances: workspace.instances.map(instance => instance.id === selectedId ? { ...instance, position_mm: values.slice(0, 3), rotation_x_deg: values[3], rotation_y_deg: values[4], rotation_deg: values[5] } : instance) }); refresh(); message('Applied transform.', 'success'); });
ui['save-workspace'].addEventListener('click', () => { download(JSON.stringify(workspace, null, 2), `${fileStem()}.json`, 'application/json'); message('Machine workspace saved.', 'success'); });
ui['load-workspace'].addEventListener('click', () => ui['load-file'].click());
ui['load-file'].addEventListener('change', async () => { const file = ui['load-file'].files[0]; ui['load-file'].value = ''; if (!file) return; try { const candidate = JSON.parse(await file.text()); const valid = validateMachineWorkspace(candidate, catalog); if (!valid.ok) throw new Error(valid.errors.join(' ')); changeWorkspace(candidate); selectedId = workspace.instances[0]?.id || null; refresh({ fit: true }); message('Machine workspace loaded.', 'success'); } catch (error) { message(`Could not load workspace: ${error.message}`, 'error'); } });
ui['export-bom'].addEventListener('click', () => { if (!workspace.instances.length) return message('Place a machine before exporting a component BOM.', 'error'); download(bomCsv(workspace, catalog), `${fileStem()}-component-bom.csv`, 'text/csv'); message('Component BOM CSV exported. It does not estimate materials or prices.', 'success'); });
ui['export-fcstd'].addEventListener('click', async () => { try { ui['export-fcstd'].disabled = true; message('Building FreeCAD archive from local source BREPs…'); const { default: JSZip } = await import('../vendor/jszip.min.mjs'); const bytes = await buildMachineFcstd(workspace, catalog, async path => { const response = await fetch(path, { cache: 'no-store' }); if (!response.ok) throw new Error(`${path} could not be read (${response.status}).`); return response.text(); }, JSZip); download(bytes, `${fileStem()}.FCStd`, 'application/vnd.freecad'); message('FreeCAD archive exported.', 'success'); } catch (error) { message(`Could not export FreeCAD: ${error.message}`, 'error'); } finally { ui['export-fcstd'].disabled = false; } });

renderer.domElement.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('pointerup', event => { const start = pointerStart; pointerStart = null; if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return; const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(assembly.children, true)[0]; if (hit?.object.userData.instanceId) { selectedId = hit.object.userData.instanceId; renderInspector(); message('Selected instance.', 'success'); } else { selectedId = null; renderInspector(); message('Selection cleared.'); } });
renderer.domElement.addEventListener('pointercancel', () => { pointerStart = null; });
ui['catalog-filter'].addEventListener('input', () => { catalogFilter = ui['catalog-filter'].value; if (catalog) renderCatalog(); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => canonicalView(button.dataset.view)));
window.addEventListener('keydown', event => { if (event.target.matches('input')) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) ui['redo-workspace'].click(); else ui['undo-workspace'].click(); } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) ui['delete-instance'].click(); });

async function initialize() {
  try { const response = await fetch('data/gvcs-machines.json', { cache: 'no-store' }); if (!response.ok) throw new Error(`catalog returned ${response.status}`); const candidate = await response.json(); const valid = validateCatalog(candidate); if (!valid.ok) throw new Error(valid.errors.join(' ')); catalog = candidate; renderCatalog(); renderInspector(); ui['catalog-status'].textContent = `${catalog.entries.length} source entries · ${catalog.demos.length} demos`; ui['catalog-status'].className = 'status'; } catch (error) { ui['catalog-status'].textContent = `Catalog unavailable: ${error.message}`; ui['catalog-status'].className = 'status error'; message('The machine workbench needs its local catalog assets. Serve the web directory over HTTP.', 'error'); } finally { resize(); } }
initialize();
