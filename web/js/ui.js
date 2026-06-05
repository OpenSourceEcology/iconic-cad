// =====================================================
// UI — sidebar, toolbar, tab switching, hotkeys, and canvas event handlers.
// All DOM wiring lives here; initUI() attaches listeners (module scope means
// no inline onclick, so buttons are wired by id).
// =====================================================
import { doc, ui, view, history, future } from './state.js';
import {
  MODULES, INTERIOR_MODULES, APERTURE_MODULES, INT_APERTURE_MODULES,
  DIRECTIONS, ROTATE_CW, DIR_COLORS, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP,
} from './constants.js';
import { getModuleBBox } from './geometry.js';
import { mmToPx, pxToMm } from './view.js';
import { findSnap } from './snap.js';
import { markModelChanged, requestDraw } from './app.js';
import { setViewport, resize3d } from './render3d.js';
import { exportJSON, saveLayout, loadLayout } from './io.js';
import { exportFcstd } from './fcstd.js';
import { exportFabDrawings } from './render_fab.js';

const canvas = document.getElementById('design-canvas');

// =====================================================
// SIDEBAR
// =====================================================
// Begin placing a module facing `dir`.
function pickModule(mod, dir) {
  ui.dragState = { mod, dir };
  ui.snapTarget = null;
  ui.eraseMode = false;
  document.getElementById('btn-erase').classList.remove('active');
  canvas.style.cursor = 'copy';
  requestDraw();
}

function buildSidebar() {
  const lib = document.getElementById('module-library');
  lib.innerHTML = '';
  if (ui.libMode === 'iso') buildIsoLibrary(lib);
  else buildIconLibrary(lib);
}

// ---- ISO MODE: one baked isometric thumbnail per module; NESW selector sets
// the placement direction (one image instead of four per module). ------------
function buildIsoLibrary(lib) {
  const section = (title, mods) => {
    const header = document.createElement('h2');
    header.textContent = title;
    lib.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'iso-grid';
    mods.forEach(mod => {
      const item = document.createElement('div');
      item.className = 'iso-item' + (mod.interior ? ' interior' : '');
      item.title = `${mod.label} — places facing ${ui.placeDir}; press R to rotate`;
      item.innerHTML =
        `<img src="thumbs/${mod.id}.png" alt="${mod.label}" loading="lazy">` +
        `<div class="iso-label">${mod.label}</div>`;
      item.addEventListener('click', () => pickModule(mod, ui.placeDir));
      grid.appendChild(item);
    });
    lib.appendChild(grid);
  };
  section('EXTERIOR', MODULES);
  section('INTERIOR', INTERIOR_MODULES);
  section('WINDOWS + DOORS', APERTURE_MODULES);
  section('INTERIOR DOORS', INT_APERTURE_MODULES);
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

function buildIconLibrary(lib) {
  const addModuleSection = (title, mods, dirs) => {
    const header = document.createElement('h2');
    header.textContent = title;
    lib.appendChild(header);
    mods.forEach(mod => {
      const group = document.createElement('div');
      group.className = 'module-group';
      group.innerHTML = `<h3>${mod.label}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'module-grid';
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
      group.appendChild(grid);
      lib.appendChild(group);
    });
  };
  const addApertureSection = (title, mods) => {
    const header = document.createElement('h2');
    header.textContent = title;
    lib.appendChild(header);
    mods.forEach(mod => {
      const group = document.createElement('div');
      group.className = 'module-group';
      group.innerHTML = `<h3>${mod.label}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'module-grid';
      const item = document.createElement('div');
      item.className = 'module-item';
      item.title = `${mod.label} — pick, then press R to rotate`;
      if (mod.interior) item.style.borderColor = '#665';
      item.innerHTML = apertureThumb(mod);
      item.addEventListener('click', () => pickModule(mod, 'north'));
      grid.appendChild(item);
      group.appendChild(grid);
      lib.appendChild(group);
    });
  };
  addModuleSection('EXTERIOR', MODULES, DIRECTIONS);
  addModuleSection('INTERIOR', INTERIOR_MODULES, ['north', 'east']);
  addApertureSection('WINDOWS + DOORS', APERTURE_MODULES);
  addApertureSection('INTERIOR DOORS', INT_APERTURE_MODULES);
}

// ---- Library mode toggle (Iso | Icons) --------------------------------------
function buildLibMode() {
  const el = document.getElementById('lib-mode');
  el.innerHTML = '';
  for (const [mode, label] of [['iso', 'Iso 3D'], ['icons', 'Icons']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.toggle('active', ui.libMode === mode);
    b.addEventListener('click', () => {
      ui.libMode = mode;
      try { localStorage.setItem('iconic.libMode', mode); } catch (e) { /* ignore */ }
      buildLibMode();
      buildSidebar();
    });
    el.appendChild(b);
  }
}

// ---- NESW direction selector (top-left of grid) -----------------------------
function buildDirSelector() {
  const el = document.getElementById('dir-selector');
  el.innerHTML = '';
  for (const dir of ['north', 'east', 'south', 'west']) {
    const b = document.createElement('button');
    b.textContent = dir[0].toUpperCase();
    b.title = `Place facing ${dir}`;
    b.dataset.dir = dir;
    b.style.background = DIR_COLORS[dir];
    b.addEventListener('click', () => setPlaceDir(dir));
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
  doc.entities.length = 0;
  history.length = 0;
  future.length = 0;
  ui.nextId = 0;
  ui.dragState = null;
  ui.snapTarget = null;
  markModelChanged();
}

function undoLast() {
  if (history.length === 0) return;
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
  if (!ui.dragState) return;
  ui.dragState.dir = ROTATE_CW[ui.dragState.dir];
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
    const bb = getModuleBBox(p.mod, p.dir);
    if (mx >= p.x_mm && mx <= p.x_mm + bb.w &&
        my >= p.y_mm && my <= p.y_mm + bb.h) {
      return i;
    }
  }
  return -1;
}

// =====================================================
// TABS
// =====================================================
function switchTab(name) {
  ui.activeTab = name;
  const is3d = name === '3d';
  document.getElementById('canvas-wrap').style.display = is3d ? 'none' : 'block';
  document.getElementById('canvas3d-wrap').style.display = is3d ? 'block' : 'none';
  document.getElementById('preview-wrap').style.display = is3d ? 'none' : 'block';
  document.getElementById('btn-tab-framing').classList.toggle('active', !is3d);
  document.getElementById('btn-tab-3d').classList.toggle('active', is3d);
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

      let pos = ui.snapTarget;
      if (!pos && doc.entities.length === 0) {
        const bb = getModuleBBox(ui.dragState.mod, ui.dragState.dir);
        pos = { x_mm: mx - bb.w / 2, y_mm: my - bb.h / 2 };
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
  buildSidebar();
  wireCanvas();
  wireHotkeys();

  // Toolbar
  document.getElementById('btn-clear').addEventListener('click', clearAll);
  document.getElementById('btn-undo').addEventListener('click', undoLast);
  document.getElementById('btn-redo').addEventListener('click', redoLast);
  document.getElementById('btn-erase').addEventListener('click', toggleErase);
  document.getElementById('btn-rotate').addEventListener('click', rotateCW);

  // Load input (hidden file picker)
  document.getElementById('load-input').addEventListener('change', loadLayout);

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
  document.getElementById('btn-modal-save').addEventListener('click', () =>
    promptFilename('layout-save.json', (f) => closeAndExport(() => saveLayout(f))));
  document.getElementById('btn-modal-fab').addEventListener('click', () =>
    promptFilename('fab-drawings.html', (f) => closeAndExport(() => exportFabDrawings(f))));
  document.getElementById('btn-modal-load').addEventListener('click', () => { exportModal.classList.remove('open'); document.getElementById('load-input').click(); });

  // Tabs
  document.getElementById('btn-tab-framing').addEventListener('click', () => switchTab('2d'));
  document.getElementById('btn-tab-3d').addEventListener('click', () => switchTab('3d'));

  // Keep the big 3D viewport sized to its container.
  window.addEventListener('resize', () => { if (ui.activeTab === '3d') resize3d(); });

  switchTab('2d');
}
