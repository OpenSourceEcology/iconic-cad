// =====================================================
// LOAD — PURE document mutation for a parsed layout. No DOM, no three.js, no
// events. Split out of io.js so it can be unit-tested without the 3D/app chain.
// io.js owns the FileReader + markModelChanged + events; this owns the model.
// =====================================================
import { doc, ui, ensureLevel2, resetDoc } from './state.js';
import { ALL_MODULES } from './constants.js';
import { findSystemModule, setActiveSystem, systemIds } from './systems.js';

// Validate the whole file into a detached candidate, then reset stale session
// state and apply it. The reset-before-apply order is the one and only place
// loads enter the model: a load can never inherit stale level/trade/undo state
// from the current session (e.g. loading a legacy single-story file while the
// app sits on L2 must not drop its walls onto a hidden L2). resetDoc() clears
// entities, restores the single default L1, activeLevel/activeLayer, the trade
// frontier, and history/future.
//
// Transactional (SOL-14): every problem in the file is collected first and the
// load throws ONE error listing them all before resetDoc() runs, so a bad file
// never destroys the open design or leaves it half-loaded, and an unknown
// module is an error rather than a silently dropped entity.
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object`);
  }
  return value;
}

export function applyLoadedData(input) {
  record(input, 'layout');
  // Saved JSON shares no mutable references with the editing session (a
  // frozen or reused input must not be modified by ensureLevel2 or edits).
  const data = JSON.parse(JSON.stringify(input));
  const errors = [];
  // Project setup intent. Older files lack `project` entirely; missing
  // sub-fields fall back individually so partial saves still open clean.
  // Defaults mirror state.js (single story, Zone 5 / Missouri).
  const dp = data.project == null ? {} : record(data.project, 'project');
  const dc = dp.climate == null ? {} : record(dp.climate, 'climate');
  const system = dp.system || 'seh';
  if (!systemIds().includes(system)) {
    throw new Error(`Unknown construction system: ${system}`);
  }
  const project = {
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

  // Accept v2 (entities) or legacy flat (modules) format. Entities are built
  // with placeholder ids (null) where the file has none; ids are assigned from
  // ui.nextId only after the reset, exactly as before.
  const list = data.entities ?? data.modules ?? [];
  if (!Array.isArray(list)) throw new Error('Invalid entities: expected an array');
  let levels = null;
  if (data.levels != null) {
    if (!Array.isArray(data.levels)) throw new Error('Invalid levels: expected an array');
    data.levels.forEach((l, i) => {
      if (!l || typeof l !== 'object' || typeof l.id !== 'string') errors.push(`level ${i}: expected an object with a string id`);
    });
    if (data.levels.length) levels = data.levels;
  }
  const candidates = [];
  const seenIds = new Set();
  list.forEach((m, i) => {
    const where = `entity ${i}${m && m.id ? ` (${m.id})` : ''}`;
    if (!m || typeof m !== 'object') { errors.push(`${where}: not an object`); return; }
    if (m.id != null) {
      if (seenIds.has(m.id)) errors.push(`Duplicate entity id: ${m.id}`);
      seenIds.add(m.id);
    }
    if (m.kind === 'foundation') {
      // Derived entity — params only, no module. Geometry rebuilds from the
      // L1 silhouette at render/BOM time.
      candidates.push({ prefix: 'foundation', entity: {
        id: m.id || null,
        kind: 'foundation',
        layer: m.layer || 'foundation',
        level: m.level || 'L1',
        params: m.params || {},
      } });
      return;
    }
    const entitySystem = m.system || system;
    if (entitySystem !== system) {
      errors.push(`Mixed construction systems are not supported: project ${system}, entity ${entitySystem}`);
      return;
    }
    const mod = system === 'seh'
      ? ALL_MODULES.find(x => x.id === m.module)
      : findSystemModule(m.module, system);
    if (!mod) { errors.push(`${where}: Unknown module: ${m.module}`); return; }
    for (const k of ['x_mm', 'y_mm']) {
      if (typeof m[k] !== 'number' || !Number.isFinite(m[k])) errors.push(`${where}: ${k} is not a finite number`);
    }
    candidates.push({ prefix: 'wall', entity: {
      kind: m.kind || (mod.interior ? 'iwall' : 'wall'),
      mod,
      system,
      dir: m.direction,
      x_mm: m.x_mm,
      y_mm: m.y_mm,
      level: m.level || 'L1', // legacy entities default to L1, never current UI level
      layer: m.layer || 'structural',
      id: m.id || null,
      owner: m.owner || null, // claim: initials/name, set in the design file; null = unclaimed
      connections: m.connections || [],
      props: m.props || {},
    } });
  });
  if (errors.length) {
    throw new Error(errors.length === 1 ? errors[0] : `${errors.length} problems:\n${errors.join('\n')}`);
  }

  // ---- commit: nothing above touched the live document ----
  resetDoc();
  setActiveSystem(system);
  doc.project = project;
  // Levels round-trip: restore the saved stack (so L2 + its z_mm reload), then
  // ensureLevel2() so an older 2-story file without an explicit L2 still gains
  // one (§9). Falls back to the single default level for legacy files.
  if (levels) doc.levels = levels;
  ensureLevel2();
  for (const { prefix, entity } of candidates) {
    if (entity.id === null) {
      entity.id = `${prefix}_${ui.nextId}`;
      if (prefix === 'foundation') ui.nextId++; // id sequence as before the SOL-14 rewrite
    }
    doc.entities.push(entity);
    ui.nextId++;
  }
}
