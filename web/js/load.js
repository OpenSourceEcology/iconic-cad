// =====================================================
// LOAD — PURE document mutation for a parsed layout. No DOM, no three.js, no
// events. Split out of io.js so it can be unit-tested without the 3D/app chain.
// io.js owns the FileReader + markModelChanged + events; this owns the model.
// =====================================================
import { doc, ui, ensureLevel2, resetDoc } from './state.js';
import { ALL_MODULES } from './constants.js';
import { findSystemModule, setActiveSystem, systemIds } from './systems.js';

// Normalize and check the entire file before touching the live document or UI.
// A rejected import must leave the previous design and undo history usable.
export function applyLoadedData(input) {
  const candidate = prepareLayout(input);
  resetDoc();
  setActiveSystem(candidate.project.system);
  doc.project = candidate.project;
  doc.levels = candidate.levels;
  for (const entity of candidate.entities) doc.entities.push(entity);
  ui.nextId = candidate.nextId;
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object`);
  }
  return value;
}

function prepareLayout(input) {
  record(input, 'layout');
  // Saved JSON has no shared mutable references with the editing session.
  const data = JSON.parse(JSON.stringify(input));
  const candidate = { project: null, levels: [{ id: 'L1', name: 'Level 1', z_mm: 0 }], entities: [], nextId: 0 };
  // Project setup intent. Older files lack `project` entirely; missing
  // sub-fields fall back individually so partial saves still open clean.
  // Defaults mirror state.js (single story, Zone 5 / Missouri).
  const dp = data.project == null ? {} : record(data.project, 'project');
  const dc = dp.climate == null ? {} : record(dp.climate, 'climate');
  const system = dp.system || 'seh';
  if (!systemIds().includes(system)) {
    throw new Error(`Unknown construction system: ${system}`);
  }
  candidate.project = {
    name: dp.name ?? 'Untitled Eco Home',
    system,
    stories: dp.stories ?? 1,
    climate: {
      iecc_zone: dc.iecc_zone ?? 5,
      frost_mm: dc.frost_mm ?? 750,
      snow_psf: dc.snow_psf ?? 30,
      wind_mph: dc.wind_mph ?? 115,
      seismic_class: dc.seismic_class ?? 'B',
    },
  };
  // Levels round-trip: restore the saved stack (so L2 + its z_mm reload), then
  // ensureLevel2() so an older 2-story file without an explicit L2 still gains
  // one (§9). Falls back to the single default level for legacy files.
  if (data.levels != null) {
    if (!Array.isArray(data.levels)) throw new Error('Invalid levels: expected an array');
    for (const level of data.levels) record(level, 'level');
    if (data.levels.length) candidate.levels = data.levels;
  }
  ensureLevel2(candidate);

  // Accept v2 (entities) or legacy flat (modules) format.
  const list = data.entities ?? data.modules ?? [];
  if (!Array.isArray(list)) throw new Error('Invalid entities: expected an array');
  for (const m of list) {
    record(m, 'entity');
    if (m.kind === 'foundation') {
      // Derived entity — params only, no module. Geometry rebuilds from the
      // L1 silhouette at render/BOM time.
      candidate.entities.push({
        id: m.id || `foundation_${candidate.nextId++}`,
        kind: 'foundation',
        layer: m.layer || 'foundation',
        level: m.level || 'L1',
        params: m.params || {},
      });
      candidate.nextId++;
      continue;
    }
    const entitySystem = m.system || system;
    if (entitySystem !== system) {
      throw new Error(`Mixed construction systems are not supported: project ${system}, entity ${entitySystem}`);
    }
    const mod = system === 'seh'
      ? ALL_MODULES.find(x => x.id === m.module)
      : findSystemModule(m.module, system);
    if (!mod) throw new Error(`Unknown module: ${m.module}`);
    candidate.entities.push({
      kind: m.kind || (mod.interior ? 'iwall' : 'wall'),
      mod,
      system,
      dir: m.direction,
      x_mm: m.x_mm,
      y_mm: m.y_mm,
      level: m.level || 'L1', // legacy entities default to L1, never current UI level
      layer: m.layer || 'structural',
      id: m.id || `wall_${candidate.nextId}`,
      owner: m.owner || null, // claim: initials/name, set in the design file; null = unclaimed
      connections: m.connections || [],
      props: m.props || {},
    });
    candidate.nextId++;
  }
  return candidate;
}
