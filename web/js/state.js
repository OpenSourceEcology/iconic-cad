// =====================================================
// STATE — the document model + transient view/UI state.
// Data only; no behaviour, no DOM, no imports of other app modules.
// =====================================================
import { ZOOM_DEFAULT } from './constants.js';
import { setActiveSystem } from './systems.js';

// ---- The document ---------------------------------------------------------
// `doc` is the single source of truth and the thing we serialise. Entities
// carry ORTHOGONAL attributes (level + layer + side), so the UI can later view
// the same data by story, by trade, or by room without restructuring it.
//
// Entity shape (in-memory):
//   { id, kind:'wall'|'iwall', mod:<module ref>, dir, x_mm, y_mm,
//     level:<levelId>, layer:<layerId>, owner:<initials|null>, connections:[], props:{} }
// `owner` is the claim: a builder's name/initials set in the design file (no
// claim UI yet). Absent/null = unclaimed. Round-tripped through io.js.
// On export `mod` is written as its module id string.
export const doc = {
  version: 2,
  units: 'mm',

  // Stories/levels. Single default level for now; full multi-level editing is
  // the next punch — the slot exists so entities already carry a `level`.
  levels: [{ id: 'L1', name: 'Level 1', z_mm: 0 }],
  activeLevel: 'L1',

  // Trade layers. Only `structural` is authored today; the rest are reserved
  // slots so adding a trade is a feature, not a model rewrite.
  layers: [
    { id: 'structural', name: 'Structural', color: '#4fc3f7', visible: true },
    { id: 'foundation', name: 'Foundation', color: '#a1887f', visible: true },
    { id: 'electrical', name: 'Electrical', color: '#ffd54f', visible: true },
    { id: 'plumbing',   name: 'Plumbing',   color: '#80cbc4', visible: true },
    { id: 'hvac',       name: 'HVAC',        color: '#81c784', visible: true },
    { id: 'solar',      name: 'Solar / PV',  color: '#ff8a65', visible: true },
  ],
  activeLayer: 'structural',

  // Project-level intent captured ONCE by the Project Options modal (options.js)
  // at design-start. Write-once setup data; later features (second-story,
  // foundation frost-skirt) READ this but it mutates nothing here on its own.
  // NOTE: `stories` is intent only — it does NOT create doc.levels[1]. Level
  // construction is the second-story feature's job. `climate` is latent: stored
  // here, consumed by no enumerator/library/3D code yet. Round-tripped through io.js.
  project: {
    name: 'Untitled Eco Home',
    system: 'seh',
    stories: 1,                       // 1 | 2  (intent only — no doc.levels mutation)
    climate: { iecc_zone: 5, frost_mm: 750, snow_psf: 30, wind_mph: 115, seismic_class: 'B' },
  },

  entities: [], // was `placed`
};

// ---- Second-story level construction -------------------------------------
// Floor-to-floor rise (L1 base z=0 → L2 base z). This is the ONE allowed
// hardcoded geometry constant for the second-story feature (spec §2):
// 1st-floor wall + double top plate + bearing gap + 2×12 joist depth +
// ¾" subfloor. Refined later by the flooring/height features — not engineered.
export const FLOOR_TO_FLOOR_MM = 3095.63;

// Create Level 2 on demand. Idempotent. ONLY when the project is 2-story — the
// Project Options page deliberately writes `stories` intent but does NOT create
// doc.levels[1]; that is this feature's job. Called on first switch to L2 and on
// load when stories === 2 (so older 2-story files without an explicit L2 gain
// one). No demote path exists, so there is no inverse / cleanup.
export function ensureLevel2() {
  if (doc.project.stories !== 2) return;
  if (doc.levels.some(l => l.id === 'L2')) return;
  doc.levels.push({ id: 'L2', name: 'Level 2', z_mm: FLOOR_TO_FLOOR_MM });
}

// ---- New-design reset ------------------------------------------------------
// Wipe the document back to a blank single-story plan. Called when the user
// starts a fresh design (home.js "Design new home") so a previously LOADED
// layout's geometry/levels/project intent do not bleed into the new project.
// Resets doc + the transient placement counters + undo/redo. Does NOT touch
// `view` (camera) or library/tab UI prefs — those are not document data.
export function resetDoc() {
  doc.entities.length = 0;
  doc.levels = [{ id: 'L1', name: 'Level 1', z_mm: 0 }];
  doc.activeLevel = 'L1';
  doc.activeLayer = 'structural';
  doc.project = {
    name: 'Untitled Eco Home',
    system: 'seh',
    stories: 1,
    climate: { iecc_zone: 5, frost_mm: 750, snow_psf: 30, wind_mph: 115, seismic_class: 'B' },
  };
  setActiveSystem('seh');
  history.length = 0;
  future.length = 0;
  ui.nextId = 0;
  ui.dragState = null;
  ui.snapTarget = null;
  ui.eraseMode = false;
  ui.activeTrade = 'framing';
  ui.reachedTrade = 0;
}

// ---- View (camera over the 2D plan) --------------------------------------
export const view = {
  zoom: ZOOM_DEFAULT, // PX_PER_MM
  offsetX: 400,
  offsetY: 300,
};

// ---- Transient UI state (not serialised) ---------------------------------
export const ui = {
  dragState: null,     // { mod, dir }
  snapTarget: null,    // { x_mm, y_mm, connection? } or null
  eraseMode: false,
  mouseCanvasX: 0,
  mouseCanvasY: 0,
  blockingMode: 'C',   // 'C' or 'T'
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  nextId: 0,
  activeTab: '2d',     // '2d' | '3d'
  rejectFlash: null,   // { x, y } canvas px — transient red flag for a rejected L2 drop
  placeDir: 'north',   // direction applied to a module picked in iso-library mode
  libMode: 'iso',      // 'iso' (one thumbnail + NESW selector) | 'icons' (4 per module)
  libCategory: 'walls', // library tab: 'walls' | 'windows' | 'doors' | 'interior'

  // Trade flow (see trades.js). The fixed order is FRAMING → FOUNDATION → 3D
  // PREVIEW. `activeTrade` records WHERE the user is looking; `reachedTrade` is
  // the index of the FURTHEST trade committed via NEXT TRADE. A trade behind the
  // frontier (index < reachedTrade) is LOCKED: read-only, with an EDIT/REGENERATE
  // button that un-generates everything ahead before unlocking it. Per-trade
  // done-ness is still DERIVED from the model (region enclosure / foundation).
  activeTrade: 'framing', // 'framing' | 'foundation' | '3d'
  reachedTrade: 0,        // index into TRADES of the frontier (0 = framing)
};

// ---- Undo / redo ----------------------------------------------------------
export const history = []; // { type:'place'|'erase', module, index? }
export const future = [];
