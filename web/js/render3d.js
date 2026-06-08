// =====================================================
// RENDER 3D — three.js preview / experiment view.
//
// Manual spherical orbit (Z-up). No OrbitControls.
//   azimuth  — auto-increments; mouse drag X changes speed/direction;
//              speed damps back to DEFAULT_SPEED (preserving sign) on release.
//   polar    — mouse drag Y tilts up/down; no damp, stays where you leave it.
//   radius   — scroll wheel zoom.
// rAF runs ONLY while preview is enabled — toggle-off = zero GPU work.
// =====================================================
import * as THREE from 'three';
import { doc } from './state.js';
import { IN_TO_MM, STUD_DEPTH, OSB_THICK } from './constants.js';
import { enumerateMembers } from './members.js';
import { panelHeightMM } from './designs.js';
import { regionForLevel } from './region.js';
import { getModuleBBox } from './geometry.js';

// One revolution every ~35 s at 60 fps.
const DEFAULT_SPEED = 2 * Math.PI / (35 * 60);

let renderer, scene, camera, modelRoot;
let hasFitted = false;
let _previewEnabled = true;
let _dirty = false;
let _rafId = null;

// Spherical state (Z-up: polar=0 → top, polar=PI/2 → equator)
const _target        = new THREE.Vector3();
let _azimuth         = 0;
let _polar           = Math.PI * 5 / 12;  // 75° from top ≈ 15° above horizontal
let _radius          = 5000;
let _azimuthSpeed    = DEFAULT_SPEED;
let _minRadius       = 500;
let _maxRadius       = 100000;

// Drag tracking
let _dragStartX        = null;
let _dragStartY        = null;
let _speedAtDragStart  = DEFAULT_SPEED;
let _polarAtDragStart  = Math.PI * 5 / 12;

const matLumber      = new THREE.MeshLambertMaterial({ color: 0xdaa520 });
const matOSB         = new THREE.MeshLambertMaterial({ color: 0x8fbc8f });
const matIWallLumber = new THREE.MeshLambertMaterial({ color: 0xc4a882 });

// Transparent framing variants — the foundation REVIEW mode ghosts the walls
// (same 0.18 opacity the L2 floor standin uses) so the solid foundation reads
// clearly beneath them.
const TMAT = { transparent: true, opacity: 0.18, depthWrite: false };
const matLumberT      = new THREE.MeshLambertMaterial({ color: 0xdaa520, ...TMAT });
const matOSBT         = new THREE.MeshLambertMaterial({ color: 0x8fbc8f, ...TMAT });
const matIWallLumberT = new THREE.MeshLambertMaterial({ color: 0xc4a882, ...TMAT });

// Foundation materials — concrete gray slab/beam, EPS-foam pink skirt.
const matConcrete = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });
// EPS skirt — always a touch transparent in every view (sidebar preview,
// foundation review, 3d preview) so it reads as foam, not concrete.
const matEPS      = new THREE.MeshLambertMaterial({ color: 0xd98cb3, transparent: true, opacity: 0.6 });

// Render mode: 'solid' (default — framing + foundation solid, the 3D PREVIEW
// trade) vs 'foundation-review' (framing transparent, foundation solid). Set by
// trades.js when entering/leaving the foundation trade. buildWall3D reads the
// derived _framingTransparent flag set in rebuildModel3D.
let _renderMode = 'solid';
let _framingTransparent = false;
export function setRenderMode(mode) {
  _renderMode = mode;
  rebuildModel3D();
}

function updateCamera() {
  const sp = Math.sin(_polar), cp = Math.cos(_polar);
  const sa = Math.sin(_azimuth), ca = Math.cos(_azimuth);
  camera.position.set(
    _target.x + _radius * sp * ca,
    _target.y + _radius * sp * sa,
    _target.z + _radius * cp
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(_target);
}

function startLoop() {
  if (_rafId !== null || !renderer || !scene || !_previewEnabled) return;
  const tick = () => {
    _rafId = requestAnimationFrame(tick);
    if (_dragStartX === null) {
      // Damp azimuth speed toward DEFAULT_SPEED, preserve direction.
      const sign = _azimuthSpeed >= 0 ? 1 : -1;
      _azimuthSpeed += (DEFAULT_SPEED * sign - _azimuthSpeed) * 0.008;
    }
    _azimuth += _azimuthSpeed;
    updateCamera();
    renderer.render(scene, camera);
  };
  _rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
}

export function set3dPreviewEnabled(on) {
  _previewEnabled = on;
  if (on) {
    if (_dirty) { _dirty = false; rebuildModel3D(); }
    else startLoop();
  } else {
    stopLoop();
  }
}

export function init3d() {
  const previewContainer = document.getElementById('preview-container');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(236, 236);
  renderer.setClearColor(0x111828);
  previewContainer.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(2000, 3000, 4000);
  scene.add(dirLight);

  modelRoot = new THREE.Group();
  scene.add(modelRoot);

  const el = renderer.domElement;
  el.style.userSelect = 'none';

  el.addEventListener('mousedown', e => {
    e.preventDefault();
    _dragStartX       = e.clientX;
    _dragStartY       = e.clientY;
    _speedAtDragStart = _azimuthSpeed;
    _polarAtDragStart = _polar;
  });
  el.addEventListener('mousemove', e => {
    if (_dragStartX === null) return;
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartY;
    _azimuthSpeed = _speedAtDragStart + dx * 0.00015;
    _polar = Math.max(0.05, Math.min(Math.PI - 0.05,
      _polarAtDragStart + dy * 0.004));
  });
  el.addEventListener('mouseup',    () => { _dragStartX = null; _dragStartY = null; });
  el.addEventListener('mouseleave', () => { _dragStartX = null; _dragStartY = null; });

  el.addEventListener('wheel', e => {
    e.preventDefault();
    _radius *= 1 + e.deltaY * 0.001;
    _radius  = Math.max(_minRadius, Math.min(_radius, _maxRadius));
  }, { passive: false });

  rebuildModel3D();
}

export function renderOnce() {
  if (renderer && _previewEnabled && _rafId === null) {
    updateCamera();
    renderer.render(scene, camera);
  }
}

function addBoxTo(group, sx, sy, sz, px, py, pz, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(px, py, pz);
  group.add(m);
}

// Build a panel's three.js group from its member list (the one source of truth,
// see members.js). Members are panel-local flat (x across width, z vertical);
// this maps them into the scene by `dir`, choosing the OSB face side, exactly as
// the old hand-written loops did. 3D output is identical by construction.
export function buildWall3D(mod, dir, xPos, yPos, zPos = 0) {
  const group = new THREE.Group();
  const isInt = mod.interior;
  const D = isInt ? (3.5 * IN_TO_MM) : STUD_DEPTH;
  const O = isInt ? 0 : OSB_THICK;
  const wallMat = _framingTransparent ? (isInt ? matIWallLumberT : matLumberT)
                                      : (isInt ? matIWallLumber : matLumber);
  const osbMat  = _framingTransparent ? matOSBT : matOSB;
  const horiz = (dir === 'north' || dir === 'south');
  const osbAt = (dir === 'south' || dir === 'west') ? -O / 2 : D + O / 2;

  for (const m of enumerateMembers(mod)) {
    const cx = m.x_mm + m.w_mm / 2;
    const cz = m.z_mm + m.h_mm / 2;
    if (m.role === 'sheathing') {
      if (O <= 0) continue;
      if (horiz) addBoxTo(group, m.w_mm, O, m.h_mm, cx, osbAt, cz, osbMat);
      else       addBoxTo(group, O, m.w_mm, m.h_mm, osbAt, -cx, cz, osbMat);
    } else {
      if (horiz) addBoxTo(group, m.w_mm, D, m.h_mm, cx, D / 2, cz, wallMat);
      else       addBoxTo(group, D, m.w_mm, m.h_mm, D / 2, -cx, cz, wallMat);
    }
  }

  group.position.x = xPos;
  if (dir === 'north') group.position.y = -(yPos + D + O);
  else if (dir === 'south') group.position.y = -(yPos + D);
  else group.position.y = -yPos;
  group.position.z = zPos; // level base z (L1 = 0, L2 = FLOOR_TO_FLOOR_MM)

  return group;
}

// Build the foundation's three.js meshes from its params + the L1 silhouette.
// DERIVED (nothing baked on the entity): slab fills the region rects; the grade
// beam + frost skirt trace each L1 exterior-wall footprint. Ground datum z=0 =
// top of slab, so everything extrudes downward (center z negative). The skirt's
// outside face is found by probing which side of the wall is NOT enclosed.
function buildFoundation3D(foundation, minX, minY) {
  const p = foundation.params;
  const region = regionForLevel('L1');
  const cell = region.cells ? region.cells.cell_mm : 76.2;
  const probe = cell * 0.75; // ~¾ cell past a wall face — clear of the over-mark

  // SLAB — fill the L1 silhouette (region.rects), extruded down from z=0.
  for (const r of region.rects) {
    addBoxTo(modelRoot, r.w_mm, r.h_mm, p.slab_thickness_mm,
      r.x_mm - minX + r.w_mm / 2,
      -(r.y_mm - minY + r.h_mm / 2),
      -p.slab_thickness_mm / 2, matConcrete);
  }

  // Perimeter grade beam + frost skirt, one box each per L1 exterior wall.
  const l1Walls = doc.entities.filter(e => e.kind === 'wall' && (e.level || 'L1') === 'L1');
  for (const w of l1Walls) {
    const bb = getModuleBBox(w.mod, w.dir);
    const horiz = bb.w >= bb.h;        // wall runs along X
    const len = horiz ? bb.w : bb.h;
    const cx = w.x_mm + bb.w / 2;      // footprint center (world plan mm)
    const cy = w.y_mm + bb.h / 2;

    // GRADE BEAM — along the run, beam_w across, beam_d deep, top at z=0.
    addBoxTo(modelRoot,
      horiz ? len : p.beam_w_mm,
      horiz ? p.beam_w_mm : len,
      p.beam_d_mm,
      cx - minX, -(cy - minY), -p.beam_d_mm / 2, matConcrete);

    // FROST SKIRT — thin EPS panel on the wall's OUTSIDE face. Outside = the side
    // whose just-past-the-face probe is NOT inside the silhouette.
    if (horiz) {
      const topOut = !region.containsPoint(cx, w.y_mm - probe);
      const fy = topOut ? w.y_mm - p.skirt_thickness_mm / 2
                        : w.y_mm + bb.h + p.skirt_thickness_mm / 2;
      addBoxTo(modelRoot, len, p.skirt_thickness_mm, p.skirt_depth_mm,
        cx - minX, -(fy - minY), -p.skirt_depth_mm / 2, matEPS);
    } else {
      const leftOut = !region.containsPoint(w.x_mm - probe, cy);
      const fx = leftOut ? w.x_mm - p.skirt_thickness_mm / 2
                         : w.x_mm + bb.w + p.skirt_thickness_mm / 2;
      addBoxTo(modelRoot, p.skirt_thickness_mm, len, p.skirt_depth_mm,
        fx - minX, -(cy - minY), -p.skirt_depth_mm / 2, matEPS);
    }
  }
}

// Rebuild the scene from the document. Disposes prior geometry (no leak).
export function rebuildModel3D() {
  if (!_previewEnabled) { _dirty = true; return; }
  modelRoot.traverse(obj => { if (obj.isMesh && obj.geometry) obj.geometry.dispose(); });
  modelRoot.clear();

  _framingTransparent = _renderMode === 'foundation-review';

  // Framing entities drive the scene extent; the foundation derives from them.
  const placed = doc.entities.filter(e => e.kind === 'wall' || e.kind === 'iwall');
  const foundation = doc.entities.find(e => e.kind === 'foundation');
  if (placed.length === 0) {
    hasFitted = false;
    startLoop();
    return;
  }

  const minX = Math.min(...placed.map(p => p.x_mm));
  const minY = Math.min(...placed.map(p => p.y_mm));
  // L2 sits directly on top of the Story-1 walls (no joist gap modelled yet): the
  // L2 base Z = the tallest L1 wall top. Derived from the real L1 panels, not the
  // doc floor-to-floor constant, so the standin floor + L2 walls land flush on
  // the L1 top plate. (Refined when the flooring/height features add the gap.)
  const l1Walls = placed.filter(p => (p.level || 'L1') === 'L1');
  const l2BaseZ = l1Walls.length
    ? Math.max(...l1Walls.map(p => panelHeightMM(enumerateMembers(p.mod)))) : 0;
  const zForLevel = id => (id === 'L2' ? l2BaseZ : 0);
  // Every level at its real Z: L1 walls at z=0, L2 walls flush on the L1 top (§6).
  for (const p of placed) {
    modelRoot.add(buildWall3D(p.mod, p.dir, p.x_mm - minX, p.y_mm - minY, zForLevel(p.level)));
  }

  // L2 floor standin: a flat, transparent plane over the L1 build region at the
  // L2 base Z (the L1 wall top) — the placeholder the user will later replace
  // with real joists.
  // ▸ FUTURE FLOORING SLOT: the flooring tab attaches real geometry + BOM here
  //   (joists, rim, subfloor). Emit ONLY the transparent plane now — no solids,
  //   no joists, no BOM. (§6 / §0)
  const l2 = doc.levels.find(l => l.id === 'L2');
  if (l2) {
    const region = regionForLevel('L1');
    if (region.isEnclosed) {
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x9aa4b8, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false,
      });
      for (const r of region.rects) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(r.w_mm, r.h_mm), planeMat);
        plane.position.set(
          r.x_mm - minX + r.w_mm / 2,
          -(r.y_mm - minY + r.h_mm / 2), // scene Y is negated (see buildWall3D)
          l2BaseZ,
        );
        modelRoot.add(plane);
      }
    }
  }

  // Foundation: a single derived entity (params only). Geometry is recomputed
  // here from the L1 silhouette + params, exactly like the floor standin — so a
  // regenerate is free. Rendered SOLID in both modes; only the framing ghosts.
  if (foundation) buildFoundation3D(foundation, minX, minY);

  const box    = new THREE.Box3().setFromObject(modelRoot);
  const center = new THREE.Vector3(); box.getCenter(center);
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 3000;

  _target.copy(center);

  _minRadius = maxDim * 3.25;
  _maxRadius = maxDim * 12;

  if (!hasFitted) {
    _radius = _minRadius;
    hasFitted = true;
  } else {
    _radius = Math.max(_minRadius, Math.min(_radius, _maxRadius));
  }

  startLoop();
}

// Recenter + refit radius (e.g. "fit" button or tab switch after big edits).
export function fitCamera() { hasFitted = false; rebuildModel3D(); }

// Move the single renderer between the small preview panel and the big 3D tab.
export function setViewport(tab) {
  if (!renderer) return;
  const el = renderer.domElement;
  if (tab === '3d') {
    const wrap = document.getElementById('canvas3d-wrap');
    wrap.appendChild(el);
    resize3d();
  } else {
    const prev = document.getElementById('preview-container');
    prev.appendChild(el);
    renderer.setSize(236, 236);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
}

export function resize3d() {
  const wrap = document.getElementById('canvas3d-wrap');
  if (!wrap || wrap.clientWidth === 0) return;
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  camera.aspect = wrap.clientWidth / wrap.clientHeight;
  camera.updateProjectionMatrix();
}
