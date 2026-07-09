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
import { foundationSolids } from './foundation_geom.js';

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
// EPS skirt — more transparent than the beam/slab so it clearly reads as foam.
const matEPS      = new THREE.MeshLambertMaterial({ color: 0xd98cb3, transparent: true, opacity: 0.35 });

// Foundation layer visibility (toggled from the foundation-review UI).
let _showBeam  = true;
let _showSkirt = true;

export function setFoundationLayerVisible(layer, on) {
  if (layer === 'beam')  _showBeam  = on;
  if (layer === 'skirt') _showSkirt = on;
  rebuildModel3D();
}

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
  if (mod.system === 'vcs12') return buildManifestWall3D(mod, dir, xPos, yPos, zPos);
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

function buildManifestWall3D(mod, dir, xPos, yPos, zPos = 0) {
  const group = new THREE.Group();
  const W = mod.width_mm;
  const D = mod.depth_mm;
  const H = mod.height_mm || 96 * IN_TO_MM;
  const matFrame = _framingTransparent ? matLumberT : matLumber;
  const matFace = _framingTransparent ? matOSBT : matOSB;
  const horiz = (dir === 'north' || dir === 'south');
  if (horiz) {
    addBoxTo(group, W, D, H, W / 2, D / 2, H / 2, matFrame);
    const faceY = (dir === 'north') ? 1 : D - 1;
    addBoxTo(group, W, 2, H, W / 2, faceY, H / 2, matFace);
  } else {
    addBoxTo(group, D, W, H, D / 2, -W / 2, H / 2, matFrame);
    const faceX = (dir === 'west') ? 1 : D - 1;
    addBoxTo(group, 2, W, H, faceX, -W / 2, H / 2, matFace);
  }
  group.position.x = xPos;
  if (dir === 'north') group.position.y = -(yPos + D);
  else if (dir === 'south') group.position.y = -yPos;
  else group.position.y = -yPos;
  group.position.z = zPos;
  return group;
}

// Build the foundation's three.js meshes from its params + the L1 silhouette.
// The geometry is DERIVED entirely by the shared pure module foundationSolids
// (foundation_geom.js) — the same source of truth the FreeCAD exporter uses.
// This function is now ONLY the render-side adapter: build the silhouette the
// pure function needs, then map each piece → addBoxTo. Pieces are world plan mm,
// z-DOWN (top of slab = z=0, centers negative); we apply the same min-origin
// offset + Y-mirror as the walls (see buildWall3D). Concrete-gray slab/beam,
// EPS-pink skirt.
function buildFoundation3D(foundation, minX, minY) {
  const region = regionForLevel('L1');
  const l1Walls = doc.entities.filter(e => e.kind === 'wall' && (e.level || 'L1') === 'L1');
  const silhouette = {
    rects: region.rects,
    walls: l1Walls.map(w => ({ id: w.id, x_mm: w.x_mm, y_mm: w.y_mm, mod: w.mod, dir: w.dir })),
    containsPoint: region.containsPoint,
    cell_mm: region.cells ? region.cells.cell_mm : undefined,
  };

  for (const pc of foundationSolids(foundation.params, silhouette)) {
    if (pc.kind === 'beam'  && !_showBeam)  continue;
    if (pc.kind === 'skirt' && !_showSkirt) continue;
    const mat = pc.kind === 'skirt' ? matEPS : matConcrete;
    addBoxTo(modelRoot, pc.dims.dx_mm, pc.dims.dy_mm, pc.dims.dz_mm,
      pc.center.x_mm - minX,
      -(pc.center.y_mm - minY), // scene Y is negated (see buildWall3D)
      pc.center.z_mm, mat);
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
    ? Math.max(...l1Walls.map(p => p.mod.system === 'vcs12'
      ? (p.mod.height_mm || 96 * IN_TO_MM)
      : panelHeightMM(enumerateMembers(p.mod)))) : 0;
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
