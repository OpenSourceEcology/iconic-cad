// =====================================================
// UI — sidebar, toolbar, tab switching, hotkeys, and canvas event handlers.
// All DOM wiring lives here; initUI() attaches listeners (module scope means
// no inline onclick, so buttons are wired by id).
// =====================================================
import { doc, ui, view, history, future, ensureLevel2 } from './state.js';
import {
  MODULES, INTERIOR_MODULES, APERTURE_MODULES, INT_APERTURE_MODULES,
  DIRECTIONS, ROTATE_CW, DIR_COLORS, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP,
} from './constants.js';
import { getModuleBBox, isHorizontal } from './geometry.js';
import { mmToPx, pxToMm } from './view.js';
import { findSnap, wouldOverlap } from './snap.js';
import { regionForLevel } from './region.js';
import { markModelChanged, requestDraw } from './app.js';
import { setViewport, resize3d, set3dPreviewEnabled } from './render3d.js';
import { cardHover, cardLeave } from './card_preview3d.js';
import { exportJSON, saveLayout, loadLayout } from './io.js';
import { exportFcstd } from './fcstd.js';
import { exportFabDrawings } from './render_fab.js';
import { generateBuildSummary } from './render_summary.js';
import { framingEditable } from './trades.js';

const canvas = document.getElementById('design-canvas');

// =====================================================
// SIDEBAR
// =====================================================
// Begin placing a module facing `dir`.
function pickModule(mod, dir) {
  if (!framingEditable()) return; // framing locked after advancing — no placing
  // Interior partitions have no inside/outside face, so they need only TWO
  // orientations: horizontal (north) or vertical (east). Collapse any N/S→north,
  // E/W→east; R toggles between the two (see rotateCW).
  if (mod.interior) dir = isHorizontal(dir) ? 'north' : 'east';
  ui.dragState = { mod, dir };
  ui.snapTarget = null;
  ui.eraseMode = false;
  document.getElementById('btn-erase').classList.remove('active');
  canvas.style.cursor = 'copy';
  requestDraw();
}

// ---- Library category tabs (Walls / Windows / Doors / Interior) -------------
const LIB_TABS = [
  { id: 'walls',    label: 'Walls' },
  { id: 'windows',  label: 'Windows' },
  { id: 'doors',    label: 'Doors' },
  { id: 'interior', label: 'Interior' },
];

function categoryMods(cat) {
  switch (cat) {
    case 'windows':  return APERTURE_MODULES.filter(m => m.aperture.type === 'window');
    case 'doors':    return APERTURE_MODULES.filter(m => m.aperture.type !== 'window');
    case 'interior': return [...INTERIOR_MODULES, ...INT_APERTURE_MODULES];
    case 'walls':
    default:         return MODULES;
  }
}

function buildLibTabs() {
  const el = document.getElementById('lib-tabs');
  el.innerHTML = '';
  LIB_TABS.forEach(t => {
    const b = document.createElement('button');
    b.className = 'lib-tab' + (ui.libCategory === t.id ? ' active' : '');
    b.textContent = t.label;
    b.addEventListener('click', () => {
      ui.libCategory = t.id;
      buildLibTabs();
      buildDirSelector();   // collapse to N/S + E/W for interior; full NESW otherwise
      buildSidebar();
    });
    el.appendChild(b);
  });
}

function buildSidebar() {
  const lib = document.getElementById('module-library');
  lib.innerHTML = '';
  const mods = categoryMods(ui.libCategory);
  const make = ui.libMode === 'iso' ? isoCard : iconCard;
  mods.forEach(mod => lib.appendChild(make(mod)));
}

// Short "where it's used" hint shown under each card label.
function moduleHint(mod) {
  if (mod.aperture) {
    const t = mod.aperture.type;
    if (t === 'window') return 'Window rough opening';
    if (mod.interior)   return 'Interior door opening';
    if (t === 'garage')      return 'Garage door opening';
    if (t === 'sliding')     return 'Sliding patio door';
    if (t === 'double_door') return 'Double exterior door';
    return 'Exterior door opening';
  }
  return mod.interior ? 'Interior partition wall' : 'Exterior load-bearing wall';
}

// ---- ISO MODE: one baked isometric thumbnail per module; NESW selector sets
// the placement direction (one image instead of four per module). ------------
function isoCard(mod) {
  const item = document.createElement('div');
  item.className = 'iso-item' + (mod.interior ? ' interior' : '');
  item.title = `${mod.label} — places facing ${ui.placeDir}; press R to rotate`;
  item.innerHTML =
    `<img src="thumbs/${mod.id}.png" alt="${mod.label}" loading="lazy">` +
    `<div class="iso-text">` +
      `<div class="iso-label">${mod.label}</div>` +
      `<div class="iso-hint">${moduleHint(mod)}</div>` +
    `</div>`;
  item.addEventListener('click',      () => pickModule(mod, ui.placeDir));
  item.addEventListener('mouseenter', () => cardHover(item, mod));
  item.addEventListener('mouseleave', () => cardLeave(item));
  return item;
}

// ---- ICON MODE: Marcin's per-direction SVG icons (4 per module). ------------
function apertureThumb(mod) {
  const t = mod.aperture.type;
  const arc = 'fill="none" stroke="rgba(120,160,200,0.6)" stroke-width="1.2"';
  const jamb = (x) => `<line x1="${x}" y1="14" x2="${x}" y2="30" stroke="#4fc3f7" stroke-width="1.5"/>`;
  let body;
  if (t === 'window') {
    body = `<line x1="14" y1="20" x2="30" y2="20" stroke="#9fd8ff" stroke-width="1.5"/>
            <line x1="14" y1="24" x2="30" y2="24" stroke="#9fd8ff" stroke-width="1.5"/>${jamb(14)}${jamb(30)}`;
  } else if (t === 'double_door') {
    body = `<line x1="14" y1="30" x2="14" y2="18" stroke="#4fc3f7" stroke-width="1.5"/>
            <line x1="30" y1="30" x2="30" y2="18" stroke="#4fc3f7" stroke-width="1.5"/>
            <path d="M14 30 A8 8 0 0 1 22 22" ${arc}/><path d="M30 30 A8 8 0 0 0 22 22" ${arc}/>`;
  } else if (t === 'sliding') {
    body = `<line x1="13" y1="21" x2="23" y2="21" stroke="#4fc3f7" stroke-width="2"/>
            <line x1="21" y1="25" x2="31" y2="25" stroke="#4fc3f7" stroke-width="2"/>`;
  } else if (t === 'garage') {
    body = `<line x1="13" y1="19" x2="31" y2="19" stroke="#4fc3f7" stroke-width="1"/>
            <line x1="13" y1="23" x2="31" y2="23" stroke="#4fc3f7" stroke-width="1"/>
            <line x1="13" y1="27" x2="31" y2="27" stroke="#4fc3f7" stroke-width="1"/>`;
  } else {
    const out = mod.aperture.swing === 'out';
    body = out
      ? `${jamb(14)}<path d="M14 14 A16 16 0 0 0 30 30" ${arc}/>`
      : `${jamb(14)}<path d="M14 30 A16 16 0 0 1 30 14" ${arc}/>`;
  }
  const col = mod.interior ? '#bb86fc' : '#4fc3f7';
  return `<svg width="44" height="44" viewBox="0 0 44 44">
    <rect x="6" y="14" width="32" height="16" fill="none" stroke="${col}" stroke-width="1.5"
      ${mod.interior ? 'stroke-dasharray="3,2"' : ''}/>${body}</svg>`;
}

// ---- ICON MODE (legacy): per-direction SVG icons; apertures use a single
// schematic thumb. One card per module. ---------------------------------------
function iconCard(mod) {
  const group = document.createElement('div');
  group.className = 'module-group';
  group.innerHTML = `<h3>${mod.label}</h3>`;
  const grid = document.createElement('div');
  grid.className = 'module-grid';
  if (mod.aperture) {
    const item = document.createElement('div');
    item.className = 'module-item';
    item.title = `${mod.label} — pick, then press R to rotate`;
    if (mod.interior) item.style.borderColor = '#665';
    item.innerHTML = apertureThumb(mod);
    item.addEventListener('click', () => pickModule(mod, 'north'));
    grid.appendChild(item);
  } else {
    const dirs = mod.interior ? ['north', 'east'] : DIRECTIONS;
    dirs.forEach(dir => {
      const item = document.createElement('div');
      item.className = 'module-item';
      item.title = `${mod.label} — ${dir}`;
      if (mod.interior) item.style.borderColor = '#665';
      const img = document.createElement('img');
      img.src = `../icons/${mod.id}_${dir}.svg`;
      item.appendChild(img);
      item.addEventListener('click', () => pickModule(mod, dir));
      grid.appendChild(item);
    });
  }
  group.appendChild(grid);
  return group;
}

// ---- Library mode toggle (Iso 3D default; Icons = "legacy") -----------------
function buildLibMode() {
  const el = document.getElementById('lib-mode');
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; align-items:center; justify-content:flex-start; gap:6px;';

  const label = document.createElement('span');
  label.textContent = 'Legacy';
  label.style.cssText = 'font-size:11px; color:#9ab; font-weight:bold; letter-spacing:1px;';

  const toggle = document.createElement('button');
  toggle.className = 'panel-toggle' + (ui.libMode === 'icons' ? ' active' : '');
  toggle.innerHTML = '<span class="tgl-off"></span><span class="tgl-on"></span>';
  toggle.addEventListener('click', () => {
    ui.libMode = ui.libMode === 'iso' ? 'icons' : 'iso';
    try { localStorage.setItem('iconic.libMode', ui.libMode); } catch (e) { /* ignore */ }
    buildLibMode();
    buildSidebar();
  });

  wrap.appendChild(label);
  wrap.appendChild(toggle);
  el.appendChild(wrap);
}

// ---- NESW direction selector (top-left of grid) -----------------------------
function buildDirSelector() {
  const el = document.getElementById('dir-selector');
  el.innerHTML = '';
  // Interior partitions have no inside/outside face → only TWO orientations:
  // horizontal (N/S) and vertical (E/W). Collapse the selector to two buttons
  // and normalise placeDir into the {north, east} pair.
  const opts = ui.libCategory === 'interior'
    ? [{ dir: 'north', label: 'N/S', title: 'Horizontal run (N/S)' },
       { dir: 'east',  label: 'E/W', title: 'Vertical run (E/W)' }]
    : ['north', 'east', 'south', 'west'].map(dir =>
        ({ dir, label: dir[0].toUpperCase(), title: `Place facing ${dir}` }));
  if (ui.libCategory === 'interior') ui.placeDir = isHorizontal(ui.placeDir) ? 'north' : 'east';
  for (const o of opts) {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.title = o.title;
    b.dataset.dir = o.dir;
    b.style.background = DIR_COLORS[o.dir];
    b.addEventListener('click', () => setPlaceDir(o.dir));
    el.appendChild(b);
  }
  refreshDirSelector();
}

function refreshDirSelector() {
  document.querySelectorAll('#dir-selector button').forEach(b =>
    b.classList.toggle('active', b.dataset.dir === ui.placeDir));
}

function setPlaceDir(dir) {
  ui.placeDir = dir;
  if (ui.dragState) ui.dragState.dir = dir;
  refreshDirSelector();
  requestDraw();
}

// =====================================================
// TOOLBAR ACTIONS
// =====================================================
function clearAll() {
  if (!framingEditable()) return; // framing locked after advancing
  doc.entities.length = 0;
  history.length = 0;
  future.length = 0;
  ui.nextId = 0;
  ui.dragState = null;
  ui.snapTarget = null;
  markModelChanged();
}

// Robust removal of ALL Level-2 entities + their undo/redo history. Used when a
// Story-1 edit is about to change the floor silhouette the L2 walls stand on —
// rather than leave orphaned / overhanging L2 walls, clear Story 2 wholesale.
export function clearLevel2() {
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    if (doc.entities[i].level === 'L2') doc.entities.splice(i, 1);
  }
  const isL2 = a => a.module && a.module.level === 'L2';
  for (let i = history.length - 1; i >= 0; i--) if (isL2(history[i])) history.splice(i, 1);
  for (let i = future.length - 1; i >= 0; i--) if (isL2(future[i])) future.splice(i, 1);
}

function undoLast() {
  if (!framingEditable()) return; // framing locked after advancing
  if (history.length === 0) return;
  // GUARD: undoing a Story-1 EXTERIOR wall while Story-2 walls exist would change
  // the floor silhouette they sit on. Confirm; on yes, clear Story 2 and drop back
  // to Story 1 so the undo lands where the user can see it. Interior (iwall) and
  // L2 actions don't affect the silhouette, so they undo freely.
  const top = history[history.length - 1];
  const topIsL1Exterior = top.module && top.module.kind === 'wall' && (top.module.level || 'L1') === 'L1';
  if (topIsL1Exterior && doc.entities.some(e => e.level === 'L2')) {
    if (!confirm('Undoing Story 1 will clear ALL Story 2 walls. Continue?')) return;
    clearLevel2();
    if (doc.activeLevel === 'L2') { doc.activeLevel = 'L1'; refreshFloorSwitch(); }
  }
  const action = history.pop();
  if (action.type === 'place') {
    const idx = doc.entities.indexOf(action.module);
    if (idx >= 0) doc.entities.splice(idx, 1);
  } else if (action.type === 'erase') {
    doc.entities.splice(action.index, 0, action.module);
  }
  future.push(action);
  markModelChanged();
}

function redoLast() {
  if (!framingEditable()) return; // framing locked after advancing
  if (future.length === 0) return;
  const action = future.pop();
  if (action.type === 'place') {
    doc.entities.push(action.module);
  } else if (action.type === 'erase') {
    const idx = doc.entities.indexOf(action.module);
    if (idx >= 0) doc.entities.splice(idx, 1);
  }
  history.push(action);
  markModelChanged();
}

function toggleErase() {
  if (!framingEditable()) return; // framing locked after advancing
  ui.eraseMode = !ui.eraseMode;
  const btn = document.getElementById('btn-erase');
  btn.classList.toggle('active', ui.eraseMode);
  if (ui.eraseMode) {
    ui.dragState = null;
    ui.snapTarget = null;
    canvas.style.cursor = 'not-allowed';
  } else {
    canvas.style.cursor = 'crosshair';
  }
  requestDraw();
}

function rotateCW() {
  if (!framingEditable()) return; // framing locked after advancing
  if (!ui.dragState) return;
  // Interior walls toggle horizontal↔vertical (north↔east) only; exterior walls
  // cycle the full NESW.
  ui.dragState.dir = ui.dragState.mod.interior
    ? (isHorizontal(ui.dragState.dir) ? 'east' : 'north')
    : ROTATE_CW[ui.dragState.dir];
  ui.placeDir = ui.dragState.dir;   // keep the NESW selector in sync
  ui.snapTarget = null;
  refreshDirSelector();
  requestDraw();
}

function findModuleAt(px_x, px_y) {
  const mx = pxToMm(px_x - view.offsetX);
  const my = pxToMm(px_y - view.offsetY);
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    const p = doc.entities[i];
    if (p.kind === 'foundation') continue; // derived 3D-only object, not eraseable in 2D
    if (p.level !== doc.activeLevel) continue; // only active level — L1 ghosts on L2 are not eraseable
    const bb = getModuleBBox(p.mod, p.dir);
    if (mx >= p.x_mm && mx <= p.x_mm + bb.w &&
        my >= p.y_mm && my <= p.y_mm + bb.h) {
      return i;
    }
  }
  return -1;
}

// =====================================================
// FLOOR SWITCHER (second story)
// Pill toggle overlaid top-right on the build grid. Shown ONLY for 2-story
// projects. LEVEL 2 is gated on Story 1 being a closed shell (§3).
// =====================================================
let _warnTimer = null;

// Show/hide + sync the pill to doc.activeLevel and doc.project.stories.
export function refreshFloorSwitch() {
  const sw = document.getElementById('floor-switch');
  if (!sw) return;
  const twoStory = doc.project.stories === 2;
  sw.style.display = twoStory ? '' : 'none';
  if (!twoStory) return;
  const pill = document.getElementById('floor-pill');
  const l1 = document.getElementById('floor-l1');
  const l2 = document.getElementById('floor-l2');
  const onL2 = doc.activeLevel === 'L2';
  pill.dataset.pos = onL2 ? 'right' : 'left';
  l1.classList.toggle('active', !onL2);
  l2.classList.toggle('active', onL2);
}

// Briefly flash the gate warning under the pill, then fade it.
function flashStoryWarn() {
  const warn = document.getElementById('floor-warn');
  if (!warn) return;
  warn.classList.add('show');
  clearTimeout(_warnTimer);
  _warnTimer = setTimeout(() => warn.classList.remove('show'), 1800);
}

// setActiveLevel — update the active level and refresh views. markModelChanged
// rebuilds 3D (region plane / both-story Z) and redraws the 2D plan. (Lives here,
// not in state.js, to avoid a state→app import cycle; see spec §2 note.)
function setActiveLevel(levelId) {
  doc.activeLevel = levelId;
  refreshFloorSwitch();
  markModelChanged();
}

function wireFloorSwitch() {
  document.getElementById('floor-l1')?.addEventListener('click', () => {
    if (doc.activeLevel !== 'L1') setActiveLevel('L1'); // always switchable back
  });
  document.getElementById('floor-l2')?.addEventListener('click', () => {
    if (doc.activeLevel === 'L2') return;
    // GATE: Story 1 must be a closed shell before you can frame Story 2.
    if (!regionForLevel('L1').isEnclosed) { flashStoryWarn(); return; }
    ensureLevel2();
    setActiveLevel('L2');
  });
  // Reflect project changes (Options GO / load) without a model edit.
  window.addEventListener('iconic:project', refreshFloorSwitch);
  refreshFloorSwitch();
}

// Brief red-flag flash at a canvas point for a rejected placement (§5).
let _rejectTimer = null;
function flashReject(cx, cy) {
  ui.rejectFlash = { x: cx, y: cy };
  requestDraw();
  clearTimeout(_rejectTimer);
  _rejectTimer = setTimeout(() => { ui.rejectFlash = null; requestDraw(); }, 450);
}

// =====================================================
// TABS
// =====================================================
let _preview3dOn = true;

// Switch the build-grid view (2D canvas vs 3D viewport). The trade rail buttons'
// highlight is owned by trades.js (refreshTradeUI), not here. Exported so the
// trade flow can drive the view per trade.
export function switchTab(name) {
  ui.activeTab = name;
  const is3d = name === '3d';
  document.getElementById('canvas-wrap').style.display = is3d ? 'none' : 'block';
  document.getElementById('canvas3d-wrap').style.display = is3d ? 'block' : 'none';
  if (is3d) {
    // Renderer moves to big viewport — enable regardless of sidebar toggle.
    set3dPreviewEnabled(true);
    document.getElementById('preview-wrap').style.display = 'none';
  } else {
    // Restore sidebar preview state.
    document.getElementById('preview-wrap').style.display = '';
    set3dPreviewEnabled(_preview3dOn);
  }
  setViewport(name);
}

// =====================================================
// EVENT HANDLERS
// =====================================================
function wireCanvas() {
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldZoom = view.zoom;
    if (e.deltaY < 0) view.zoom = Math.min(ZOOM_MAX, view.zoom * ZOOM_STEP);
    else              view.zoom = Math.max(ZOOM_MIN, view.zoom / ZOOM_STEP);
    const scale = view.zoom / oldZoom;
    view.offsetX = mx - (mx - view.offsetX) * scale;
    view.offsetY = my - (my - view.offsetY) * scale;
    requestDraw();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      ui.isPanning = true;
      ui.panStartX = e.clientX;
      ui.panStartY = e.clientY;
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    ui.mouseCanvasX = e.clientX - rect.left;
    ui.mouseCanvasY = e.clientY - rect.top;

    if (ui.isPanning) {
      view.offsetX += e.clientX - ui.panStartX;
      view.offsetY += e.clientY - ui.panStartY;
      ui.panStartX = e.clientX;
      ui.panStartY = e.clientY;
      requestDraw();
      return;
    }

    if (ui.dragState) {
      const mx = pxToMm(ui.mouseCanvasX - view.offsetX);
      const my = pxToMm(ui.mouseCanvasY - view.offsetY);
      ui.snapTarget = findSnap(mx, my, ui.dragState.mod, ui.dragState.dir);
      requestDraw();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 1 && ui.isPanning) {
      ui.isPanning = false;
      canvas.style.cursor = ui.dragState ? 'copy' : 'crosshair';
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!framingEditable()) return; // framing locked after advancing — read-only
    if (ui.eraseMode) {
      const rect = canvas.getBoundingClientRect();
      const idx = findModuleAt(e.clientX - rect.left, e.clientY - rect.top);
      if (idx >= 0) {
        const mod = doc.entities.splice(idx, 1)[0];
        history.push({ type: 'erase', module: mod, index: idx });
        future.length = 0;
        markModelChanged();
      }
      return;
    }
    if (ui.dragState) {
      const rect = canvas.getBoundingClientRect();
      const mx = pxToMm((e.clientX - rect.left) - view.offsetX);
      const my = pxToMm((e.clientY - rect.top) - view.offsetY);

      const onL2 = doc.activeLevel === 'L2';
      const mod = ui.dragState.mod, dir = ui.dragState.dir;
      const bb = getModuleBBox(mod, dir);
      let pos = ui.snapTarget;
      // Free placement at cursor when nothing snaps: the empty canvas, or on L2
      // (where the only placed walls may be the non-interactive L1 ghosts).
      if (!pos && (doc.entities.length === 0 || onL2)) {
        pos = { x_mm: mx - bb.w / 2, y_mm: my - bb.h / 2 };
      }
      // INTERIOR free placement on L1: an interior wall that didn't snap may drop
      // free INSIDE the enclosed shell — but only if the shell is closed, the
      // footprint lies fully inside the region, and it doesn't bury into / stack
      // on any wall. No connection → no blocking until it later abuts a wall.
      if (!pos && mod.interior && !onL2) {
        const region = regionForLevel(doc.activeLevel);
        const cand = { x_mm: mx - bb.w / 2, y_mm: my - bb.h / 2 };
        if (region.isEnclosed &&
            region.containsFootprint(mod, dir, cand.x_mm, cand.y_mm) &&
            !wouldOverlap(cand.x_mm, cand.y_mm, bb, mod, dir)) {
          pos = cand;
        }
      }
      // L2 GATE: a new L2 module must sit entirely inside the L1 build region.
      // Off-region drops are REJECTED with the red-flag feedback (§5).
      if (pos && onL2 &&
          !regionForLevel('L1').containsFootprint(mod, dir, pos.x_mm, pos.y_mm)) {
        flashReject(ui.mouseCanvasX, ui.mouseCanvasY);
        return;
      }
      if (!pos && mod.interior) {
        // No snap AND free-placement guards failed — never a silent no-op.
        flashReject(ui.mouseCanvasX, ui.mouseCanvasY);
        return;
      }
      if (pos) {
        const entity = {
          kind: ui.dragState.mod.interior ? 'iwall' : 'wall',
          mod: ui.dragState.mod,
          dir: ui.dragState.dir,
          x_mm: pos.x_mm,
          y_mm: pos.y_mm,
          level: doc.activeLevel,
          layer: doc.activeLayer,
          id: `${ui.dragState.mod.interior ? 'iwall' : 'wall'}_${ui.nextId++}`,
          connections: pos.connection ? [pos.connection] : [],
          props: {},
        };
        doc.entities.push(entity);
        history.push({ type: 'place', module: entity });
        future.length = 0;
        ui.snapTarget = null;
        markModelChanged();
      }
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (ui.dragState) {
      ui.dragState = null;
      ui.snapTarget = null;
      requestDraw();
    }
  });
}

// =====================================================
// HOTKEYS
// =====================================================
const HOTKEYS = [
  { key: 'Escape', ctrl: false, shift: false, action: () => {
      ui.dragState = null; ui.snapTarget = null; ui.eraseMode = false;
      document.getElementById('btn-erase').classList.remove('active');
      canvas.style.cursor = 'crosshair'; requestDraw();
  }},
  { key: 'z', ctrl: true,  shift: false, action: undoLast },
  { key: 'z', ctrl: true,  shift: true,  action: redoLast },
  { key: 'r', ctrl: false, shift: false, action: rotateCW },
  { key: 'c', ctrl: false, shift: false, action: () => { ui.blockingMode = 'C'; requestDraw(); }},
  { key: 't', ctrl: false, shift: false, action: () => { ui.blockingMode = 'T'; requestDraw(); }},
];

function wireHotkeys() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    for (const hk of HOTKEYS) {
      if (e.key.toLowerCase() === hk.key.toLowerCase() &&
          !!e.ctrlKey === hk.ctrl &&
          !!e.shiftKey === hk.shift) {
        e.preventDefault();
        hk.action();
        return;
      }
    }
  });
}

// =====================================================
// INIT
// =====================================================
export function initUI() {
  try { ui.libMode = localStorage.getItem('iconic.libMode') || ui.libMode; } catch (e) { /* ignore */ }
  buildDirSelector();
  buildLibMode();
  buildLibTabs();
  buildSidebar();
  wireCanvas();
  wireFloorSwitch();
  wireHotkeys();

  // Save Work — one-click download of the current layout.
  document.getElementById('btn-save-work').addEventListener('click', () => saveLayout());

  // Toolbar
  document.getElementById('btn-clear').addEventListener('click', clearAll);
  document.getElementById('btn-undo').addEventListener('click', undoLast);
  document.getElementById('btn-redo').addEventListener('click', redoLast);
  document.getElementById('btn-erase').addEventListener('click', toggleErase);
  document.getElementById('btn-rotate').addEventListener('click', rotateCW);

  // Load input (hidden file picker)
  document.getElementById('load-input').addEventListener('change', loadLayout);

  // Sidebar panel toggles (independent on/off)
  document.getElementById('btn-toggle-3d').addEventListener('click', () => {
    _preview3dOn = !_preview3dOn;
    document.getElementById('btn-toggle-3d').classList.toggle('active', _preview3dOn);
    document.getElementById('preview-container').style.display = _preview3dOn ? '' : 'none';
    set3dPreviewEnabled(_preview3dOn);
  });
  document.getElementById('btn-toggle-bom').addEventListener('click', () => {
    const on = document.getElementById('btn-toggle-bom').classList.toggle('active');
    document.getElementById('bom-content').style.display = on ? '' : 'none';
  });

  // Export modal
  const exportModal = document.getElementById('export-modal');
  const filenamePrompt = document.getElementById('filename-prompt');
  const filenameInput = document.getElementById('filename-prompt-input');
  const filenameExt = document.getElementById('filename-prompt-ext');
  let _pendingExport = null;
  let _pendingExt = '';

  function promptFilename(defaultName, cb) {
    const dot = defaultName.lastIndexOf('.');
    const base = dot > 0 ? defaultName.slice(0, dot) : defaultName;
    _pendingExt = dot > 0 ? defaultName.slice(dot) : '';
    filenameInput.value = base;
    filenameExt.textContent = _pendingExt;
    filenamePrompt.classList.add('open');
    _pendingExport = cb;
    requestAnimationFrame(() => { filenameInput.select(); filenameInput.focus(); });
  }

  function confirmFilename() {
    const base = filenameInput.value.trim() || 'export';
    filenamePrompt.classList.remove('open');
    if (_pendingExport) { _pendingExport(base + _pendingExt); _pendingExport = null; }
  }

  function cancelFilename() {
    filenamePrompt.classList.remove('open');
    _pendingExport = null;
  }

  document.getElementById('btn-filename-confirm').addEventListener('click', confirmFilename);
  document.getElementById('btn-filename-cancel').addEventListener('click', cancelFilename);
  filenameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmFilename();
    if (e.key === 'Escape') { e.stopPropagation(); cancelFilename(); }
  });

  document.getElementById('btn-export-menu').addEventListener('click', () => exportModal.classList.add('open'));
  document.getElementById('btn-export-modal-close').addEventListener('click', () => exportModal.classList.remove('open'));
  exportModal.addEventListener('click', (e) => { if (e.target === exportModal) exportModal.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') exportModal.classList.remove('open'); });

  function closeAndExport(fn) { exportModal.classList.remove('open'); fn(); }

  document.getElementById('btn-modal-fcstd').addEventListener('click', () =>
    promptFilename('house.FCStd', (f) => closeAndExport(() => exportFcstd(f))));
  document.getElementById('btn-modal-export-json').addEventListener('click', () =>
    promptFilename('layout.json', (f) => closeAndExport(() => exportJSON(f))));
  document.getElementById('btn-modal-fab').addEventListener('click', () =>
    promptFilename('fab-drawings.html', (f) => closeAndExport(() => exportFabDrawings(f))));
  document.getElementById('btn-modal-summary').addEventListener('click', () =>
    promptFilename('build-summary.html', (f) => closeAndExport(() => generateBuildSummary(f))));

  // Trade rail buttons (FRAMING / FOUNDATION / 3D PREVIEW) are wired by
  // trades.js (initTrades), which drives the view + render mode per trade.

  // Keep the big 3D viewport sized to its container.
  window.addEventListener('resize', () => { if (ui.activeTab === '3d') resize3d(); });

  switchTab('2d');
}
