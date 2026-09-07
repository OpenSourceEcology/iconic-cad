// Machine workspace document and catalog helpers.  This deliberately has no
// dependency on the house-editor document: a machine assembly is portable on
// its own and uses millimetres throughout.
export const MACHINE_WORKSPACE_VERSION = 1;

const finite = n => typeof n === 'number' && Number.isFinite(n);
const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(v);
const copy = value => JSON.parse(JSON.stringify(value));

export function validateCatalog(value) {
  const errors = [];
  if (!value || typeof value !== 'object') errors.push('Catalog must be an object.');
  if (value?.version !== 1) errors.push('Catalog version must be 1.');
  if (value?.units !== 'mm') errors.push('Catalog units must be mm.');
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  const demos = Array.isArray(value?.demos) ? value.demos : [];
  if (!entries.length) errors.push('Catalog needs at least one entry.');
  const entryIds = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') { errors.push('Each catalog entry must be an object.'); continue; }
    if (!id(entry.id) || entryIds.has(entry.id)) errors.push('Each catalog entry needs a unique safe id.');
    entryIds.add(entry.id);
    for (const key of ['title', 'family', 'variant', 'description', 'source_url']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) errors.push(`Entry ${entry.id || '(unnamed)'} needs ${key}.`);
    }
    if (!(typeof entry.source_revision === 'string' && entry.source_revision.trim()) && !Number.isSafeInteger(entry.source_revision)) errors.push(`Entry ${entry.id || '(unnamed)'} needs a nonempty source revision string or integer.`);
    if (entry.license_review !== 'pending') errors.push(`Entry ${entry.id || '(unnamed)'} must record license_review as pending.`);
    if (!entry.validation || !['passed', 'failed'].includes(entry.validation.geometry) || entry.validation.engineering !== 'unreviewed') errors.push(`Entry ${entry.id || '(unnamed)'} has invalid validation status.`);
    if (entry.validation?.assembly != null && !['passed', 'failed'].includes(entry.validation.assembly)) errors.push(`Entry ${entry.id || '(unnamed)'} has invalid assembly validation status.`);
    if (entry.validation?.issues != null && (!Array.isArray(entry.validation.issues) || !entry.validation.issues.every(issue => typeof issue === 'string' && issue.trim()))) errors.push(`Entry ${entry.id || '(unnamed)'} has invalid validation issues.`);
    if (!Array.isArray(entry.bounds_mm) || entry.bounds_mm.length !== 3 || !entry.bounds_mm.every(n => finite(n) && n > 0)) errors.push(`Entry ${entry.id || '(unnamed)'} needs positive [width, depth, height] bounds_mm.`);
    if (!Array.isArray(entry.parts) || !entry.parts.length) errors.push(`Entry ${entry.id || '(unnamed)'} needs at least one part.`);
    const partIds = new Set();
    for (const part of (Array.isArray(entry.parts) ? entry.parts : [])) {
      if (!part || typeof part !== 'object') { errors.push(`Entry ${entry.id || '(unnamed)'} has a non-object part.`); continue; }
      if (!id(part.id) || partIds.has(part.id)) errors.push(`Entry ${entry.id || '(unnamed)'} has invalid or duplicate part id.`);
      partIds.add(part.id);
      if (typeof part.label !== 'string' || !part.label.trim()) errors.push(`Part ${part.id || '(unnamed)'} needs a label.`);
      if (typeof part.mesh !== 'string' || !part.mesh.startsWith('assets/gvcs/')) errors.push(`Part ${part.id || '(unnamed)'} mesh must be a local gvcs asset.`);
      if (typeof part.brep !== 'string' || !part.brep.startsWith('assets/gvcs/')) errors.push(`Part ${part.id || '(unnamed)'} BREP must be a local gvcs asset.`);
      if (!hex(part.color)) errors.push(`Part ${part.id || '(unnamed)'} needs a #rrggbb color.`);
    }
  }
  if (!Array.isArray(value?.demos)) errors.push('Catalog demos must be an array.');
  const demoIds = new Set();
  for (const demo of demos) {
    if (!demo || typeof demo !== 'object') { errors.push('Each demo must be an object.'); continue; }
    if (!id(demo.id) || typeof demo.title !== 'string' || typeof demo.description !== 'string' || !Array.isArray(demo.instances)) errors.push('Each demo needs id, title, description, and instances.');
    if (demoIds.has(demo.id)) errors.push('Each demo needs a unique id.');
    demoIds.add(demo.id);
    for (const inst of (Array.isArray(demo.instances) ? demo.instances : [])) {
      if (!inst || typeof inst !== 'object') { errors.push(`Demo ${demo.id || '(unnamed)'} has a non-object instance.`); continue; }
      if (!id(inst.id) || !entryIds.has(inst.entry_id) || !Array.isArray(inst.position_mm) || inst.position_mm.length !== 3 || !inst.position_mm.every(finite) || !finite(inst.rotation_deg)) errors.push(`Demo ${demo.id || '(unnamed)'} has an invalid instance.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function newMachineWorkspace() {
  return { version: MACHINE_WORKSPACE_VERSION, units: 'mm', instances: [] };
}

export function validateMachineWorkspace(value, catalog) {
  const errors = [];
  if (!value || typeof value !== 'object' || value.version !== MACHINE_WORKSPACE_VERSION || value.units !== 'mm' || !Array.isArray(value.instances)) errors.push('This is not a version 1 millimetre machine workspace.');
  const entries = new Set((Array.isArray(catalog?.entries) ? catalog.entries : []).filter(entry => entry && typeof entry === 'object').map(entry => entry.id));
  const ids = new Set();
  for (const inst of (Array.isArray(value?.instances) ? value.instances : [])) {
    if (!inst || typeof inst !== 'object') { errors.push('Each workspace instance must be an object.'); continue; }
    if (!id(inst.id) || ids.has(inst.id)) errors.push('Each instance must have a unique safe id.');
    ids.add(inst.id);
    if (!entries.has(inst.entry_id)) errors.push(`Instance ${inst.id || '(unnamed)'} references an unavailable catalog entry.`);
    if (!Array.isArray(inst.position_mm) || inst.position_mm.length !== 3 || !inst.position_mm.every(finite)) errors.push(`Instance ${inst.id || '(unnamed)'} needs finite XYZ millimetre coordinates.`);
    if (!finite(inst.rotation_deg)) errors.push(`Instance ${inst.id || '(unnamed)'} needs a finite Z rotation.`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateMeshPayload(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || !Array.isArray(value.vertices) || value.vertices.length < 9 || value.vertices.length % 3 || !value.vertices.every(finite)) errors.push('Mesh vertices must be finite XYZ triples.');
  const vertexCount = Array.isArray(value?.vertices) ? value.vertices.length / 3 : 0;
  if (!Array.isArray(value?.triangles) || value.triangles.length < 3 || value.triangles.length % 3 || !value.triangles.every(index => Number.isInteger(index) && index >= 0 && index < vertexCount)) errors.push('Mesh triangles must be in-range vertex indices grouped as triples.');
  return { ok: errors.length === 0, errors };
}

export function workspaceFromDemo(demo, catalog) {
  const next = { version: MACHINE_WORKSPACE_VERSION, units: 'mm', instances: copy(demo?.instances || []) };
  const valid = validateMachineWorkspace(next, catalog);
  if (!valid.ok) throw new Error(valid.errors.join(' '));
  return next;
}

export function nextInstanceId(workspace, entryId) {
  const used = new Set(workspace.instances.map(i => i.id));
  for (let n = 1; n < 100000; n++) {
    const candidate = `${entryId}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate an instance id.');
}

export function addMachineInstance(workspace, entryId, position = [0, 0, 0]) {
  return { ...workspace, instances: [...workspace.instances, { id: nextInstanceId(workspace, entryId), entry_id: entryId, position_mm: [...position], rotation_deg: 0 }] };
}

export function bomRows(workspace, catalog) {
  const byId = new Map(catalog.entries.map(entry => [entry.id, entry]));
  const rows = new Map();
  for (const inst of workspace.instances) {
    const entry = byId.get(inst.entry_id);
    if (!entry) continue;
    for (const part of entry.parts) {
      const key = `${entry.id}/${part.id}`;
      const row = rows.get(key) || { entry_id: entry.id, entry_title: entry.title, part_id: part.id, part_label: part.label, source_url: entry.source_url, source_revision: entry.source_revision, quantity: 0 };
      row.quantity += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.entry_title.localeCompare(b.entry_title) || a.part_label.localeCompare(b.part_label));
}

const csvCell = v => `"${String(v).replaceAll('"', '""')}"`;
export function bomCsv(workspace, catalog) {
  const header = ['entry_id', 'entry_title', 'part_id', 'part_label', 'quantity', 'source_url', 'source_revision'];
  return [header, ...bomRows(workspace, catalog).map(row => header.map(key => row[key]))].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}

export const machineTest = { finite, id };
