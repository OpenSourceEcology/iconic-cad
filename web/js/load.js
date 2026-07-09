// =====================================================
// LOAD — PURE document mutation for a parsed layout. No DOM, no three.js, no
// events. Split out of io.js so it can be unit-tested without the 3D/app chain.
// io.js owns the FileReader + markModelChanged + events; this owns the model.
// =====================================================
import { doc, ui, ensureLevel2, resetDoc } from './state.js';
import { ALL_MODULES } from './constants.js';
import { findSystemModule, setActiveSystem, systemIds } from './systems.js';

// Reset stale session state, then apply the file's project/levels/entities.
// The reset-before-apply order is the one and only place loads enter the model:
// a load can never inherit stale level/trade/undo state from the current session
// (e.g. loading a legacy single-story file while the app sits on L2 must not drop
// its walls onto a hidden L2). resetDoc() clears entities, restores the single
// default L1, activeLevel/activeLayer, the trade frontier, and history/future.
export function applyLoadedData(data) {
  resetDoc();
  // Project setup intent. Older files lack `project` entirely; missing
  // sub-fields fall back individually so partial saves still open clean.
  // Defaults mirror state.js (single story, Zone 5 / Missouri).
  const dp = data.project || {};
  const dc = dp.climate || {};
  const system = dp.system || 'seh';
  if (!systemIds().includes(system)) {
    throw new Error(`Unknown construction system: ${system}`);
  }
  setActiveSystem(system);
  doc.project = {
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
  if (Array.isArray(data.levels) && data.levels.length) {
    doc.levels = data.levels;
  }
  ensureLevel2();

  // Accept v2 (entities) or legacy flat (modules) format.
  const list = data.entities || data.modules || [];
  for (const m of list) {
    if (m.kind === 'foundation') {
      // Derived entity — params only, no module. Geometry rebuilds from the
      // L1 silhouette at render/BOM time.
      doc.entities.push({
        id: m.id || `foundation_${ui.nextId++}`,
        kind: 'foundation',
        layer: m.layer || 'foundation',
        level: m.level || 'L1',
        params: m.params || {},
      });
      ui.nextId++;
      continue;
    }
    const entitySystem = m.system || system;
    if (entitySystem !== system) {
      throw new Error(`Mixed construction systems are not supported: project ${system}, entity ${entitySystem}`);
    }
    const mod = system === 'seh'
      ? ALL_MODULES.find(x => x.id === m.module)
      : findSystemModule(m.module, system);
    if (!mod) { console.warn(`Unknown module: ${m.module}`); continue; }
    doc.entities.push({
      kind: m.kind || (mod.interior ? 'iwall' : 'wall'),
      mod,
      system,
      dir: m.direction,
      x_mm: m.x_mm,
      y_mm: m.y_mm,
      level: m.level || 'L1', // legacy entities default to L1, never current UI level
      layer: m.layer || 'structural',
      id: m.id || `wall_${ui.nextId}`,
      owner: m.owner || null, // claim: initials/name, set in the design file; null = unclaimed
      connections: m.connections || [],
      props: m.props || {},
    });
    ui.nextId++;
  }
}
