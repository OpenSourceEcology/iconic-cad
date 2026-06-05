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
export function buildWall3D(mod, dir, xPos, yPos) {
  const group = new THREE.Group();
  const isInt = mod.interior;
  const D = isInt ? (3.5 * IN_TO_MM) : STUD_DEPTH;
  const O = isInt ? 0 : OSB_THICK;
  const wallMat = isInt ? matIWallLumber : matLumber;
  const horiz = (dir === 'north' || dir === 'south');
  const osbAt = (dir === 'south' || dir === 'west') ? -O / 2 : D + O / 2;

  for (const m of enumerateMembers(mod)) {
    const cx = m.x_mm + m.w_mm / 2;
    const cz = m.z_mm + m.h_mm / 2;
    if (m.role === 'sheathing') {
      if (O <= 0) continue;
      if (horiz) addBoxTo(group, m.w_mm, O, m.h_mm, cx, osbAt, cz, matOSB);
      else       addBoxTo(group, O, m.w_mm, m.h_mm, osbAt, -cx, cz, matOSB);
    } else {
      if (horiz) addBoxTo(group, m.w_mm, D, m.h_mm, cx, D / 2, cz, wallMat);
      else       addBoxTo(group, D, m.w_mm, m.h_mm, D / 2, -cx, cz, wallMat);
    }
  }

  group.position.x = xPos;
  if (dir === 'north') group.position.y = -(yPos + D + O);
  else if (dir === 'south') group.position.y = -(yPos + D);
  else group.position.y = -yPos;

  return group;
}

// Rebuild the scene from the document. Disposes prior geometry (no leak).
export function rebuildModel3D() {
  if (!_previewEnabled) { _dirty = true; return; }
  modelRoot.traverse(obj => { if (obj.isMesh && obj.geometry) obj.geometry.dispose(); });
  modelRoot.clear();

  const placed = doc.entities;
  if (placed.length === 0) {
    hasFitted = false;
    startLoop();
    return;
  }

  const minX = Math.min(...placed.map(p => p.x_mm));
  const minY = Math.min(...placed.map(p => p.y_mm));
  for (const p of placed) {
    modelRoot.add(buildWall3D(p.mod, p.dir, p.x_mm - minX, p.y_mm - minY));
  }

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
