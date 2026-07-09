const IN_TO_MM = 25.4;

const SEH = {
  id: 'seh',
  label: 'SEH Panelized',
  module_grid_in: 12,
  stud_spacing_in: 16,
  wall_depth_in: 5.9375,
  palette: [
    { id: 'wall_4x8_2x6_16oc', label: '4x8 16OC', thumb: 'thumbs/wall_4x8_2x6_16oc.png', brep_base: 'assets/lib/wall_4x8_2x6_16oc', width_in: 48, height_in: 96, depth_in: 5.9375, exterior_face: '-y' },
    { id: 'wall_4x8_2x6_24oc', label: '4x8 24OC', thumb: 'thumbs/wall_4x8_2x6_24oc.png', brep_base: 'assets/lib/wall_4x8_2x6_24oc', width_in: 48, height_in: 96, depth_in: 5.9375, exterior_face: '-y' },
    { id: 'wall_3x8.5_2x6_16oc', label: '3x8.5 16OC', thumb: 'thumbs/wall_3x8.5_2x6_16oc.png', brep_base: 'assets/lib/wall_3x8.5_2x6_16oc', width_in: 36, height_in: 102, depth_in: 5.9375, exterior_face: '-y' },
  ],
};

const VCS12 = {
  id: 'vcs12',
  label: 'VCS 12-ft Demonstrator',
  module_grid_in: 12,
  stud_spacing_in: 24,
  wall_depth_in: 6,
  palette: [
    { id: 'extwall_front_rake', label: 'Exterior wall front rake module', thumb: 'assets/lib/vcs12/extwall_front_rake.svg', brep_base: 'assets/lib/vcs12/extwall_front_rake', width_in: 48, height_in: 60, depth_in: 6, exterior_face: '-y' },
    { id: 'extwall_side_rake', label: 'Exterior wall side rake module', thumb: 'assets/lib/vcs12/extwall_side_rake.svg', brep_base: 'assets/lib/vcs12/extwall_side_rake', width_in: 48, height_in: 60, depth_in: 6, exterior_face: '-y' },
    { id: 'extwall_single_door', type: 'door', label: 'Exterior wall single door module', thumb: 'assets/lib/vcs12/extwall_single_door.svg', brep_base: 'assets/lib/vcs12/extwall_single_door', width_in: 48, height_in: 96, depth_in: 6, exterior_face: '-y' },
    { id: 'extwall_standard', type: 'standard', label: 'Standard exterior wall module', thumb: 'assets/lib/vcs12/extwall_standard.svg', brep_base: 'assets/lib/vcs12/extwall_standard', width_in: 48, height_in: 96, depth_in: 6, exterior_face: '-y' },
    { id: 'extwall_window', type: 'window', label: 'Exterior wall window module', thumb: 'assets/lib/vcs12/extwall_window.svg', brep_base: 'assets/lib/vcs12/extwall_window', width_in: 48, height_in: 96, depth_in: 6, exterior_face: '-y' },
  ],
};

const manifests = new Map([['seh', SEH], ['vcs12', VCS12]]);
let activeSystemId = 'seh';

export function systemIds() {
  return [...manifests.keys()];
}

export function getSystemManifest(id = activeSystemId) {
  return manifests.get(id) || null;
}

export function activeSystem() {
  return getSystemManifest(activeSystemId);
}

export function setActiveSystem(id) {
  if (!manifests.has(id)) throw new Error(`Unknown construction system: ${id}`);
  activeSystemId = id;
  return activeSystem();
}

export function isVcs12Active() {
  return activeSystemId === 'vcs12';
}

export function exteriorWallDepthMM() {
  return activeSystem().wall_depth_in * IN_TO_MM;
}

export function moduleGridMM() {
  return activeSystem().module_grid_in * IN_TO_MM;
}

export function manifestPaletteModules(id = activeSystemId) {
  const manifest = getSystemManifest(id);
  if (!manifest) return [];
  return manifest.palette.map(p => ({
    id: p.id,
    label: p.label,
    thumb: p.thumb,
    brep_base: p.brep_base,
    width_mm: p.width_in * IN_TO_MM,
    height_mm: p.height_in * IN_TO_MM,
    depth_mm: p.depth_in * IN_TO_MM,
    exterior_face: p.exterior_face,
    system: manifest.id,
    ...(p.type ? { type: p.type } : {}),
  }));
}

export function findSystemModule(moduleId, systemId = activeSystemId) {
  return manifestPaletteModules(systemId).find(m => m.id === moduleId) || null;
}

export async function loadSystemManifests(base = 'data/systems') {
  if (typeof fetch !== 'function') return manifests;
  for (const id of ['seh', 'vcs12']) {
    const resp = await fetch(`${base}/${id}.json`, { cache: 'reload' });
    if (!resp.ok) throw new Error(`Unable to load construction system ${id}: HTTP ${resp.status}`);
    const manifest = await resp.json();
    validateManifest(manifest);
    manifests.set(manifest.id, manifest);
  }
  return manifests;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid construction system manifest');
  if (!manifest.id || !manifest.label) throw new Error('Construction system manifest missing id or label');
  for (const key of ['module_grid_in', 'stud_spacing_in', 'wall_depth_in']) {
    if (!(Number(manifest[key]) > 0)) throw new Error(`${manifest.id} manifest has invalid ${key}`);
  }
  if (!Array.isArray(manifest.palette)) throw new Error(`${manifest.id} manifest missing palette`);
}
