// =====================================================
// RENDER 3D — three.js preview / experiment view.
//
// Performance model (the old version rebuilt the whole scene + leaked GPU
// memory on every mousemove). Now:
//   • rebuildModel3D() runs ONLY on model change; it disposes old geometry.
//   • render is on-demand (controls 'change', rebuild, tab switch, resize) —
//     no perpetual requestAnimationFrame burning the GPU while idle.
//   • damping is off, so render-on-change is sufficient.
//   • one renderer hops between the small preview panel and the big 3D tab.
// =====================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { doc } from './state.js';
import { IN_TO_MM, STUD_DEPTH, OSB_THICK } from './constants.js';
import { enumerateMembers } from './members.js';

let renderer, scene, camera, controls, modelRoot;
let hasFitted = false;
let _previewEnabled = true;
let _dirty = false;

export function set3dPreviewEnabled(on) {
  _previewEnabled = on;
  if (on && _dirty) { _dirty = false; rebuildModel3D(); }
}

const matLumber = new THREE.MeshLambertMaterial({ color: 0xdaa520 });
const matOSB = new THREE.MeshLambertMaterial({ color: 0x8fbc8f });
const matIWallLumber = new THREE.MeshLambertMaterial({ color: 0xc4a882 });

export function init3d() {
  const previewContainer = document.getElementById('preview-container');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(196, 196);
  renderer.setClearColor(0x111828);
  previewContainer.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
  camera.position.set(3000, 3000, 4000);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;            // render-on-change, no idle rAF
  controls.addEventListener('change', renderOnce);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(2000, 3000, 4000);
  scene.add(dirLight);

  modelRoot = new THREE.Group();
  scene.add(modelRoot);

  rebuildModel3D();
}

export function renderOnce() {
  if (renderer && _previewEnabled) renderer.render(scene, camera);
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
  // dispose + clear previous meshes
  modelRoot.traverse(obj => { if (obj.isMesh && obj.geometry) obj.geometry.dispose(); });
  modelRoot.clear();

  const placed = doc.entities;
  if (placed.length === 0) {
    hasFitted = false;
    renderOnce();
    return;
  }

  const minX = Math.min(...placed.map(p => p.x_mm));
  const minY = Math.min(...placed.map(p => p.y_mm));
  for (const p of placed) {
    modelRoot.add(buildWall3D(p.mod, p.dir, p.x_mm - minX, p.y_mm - minY));
  }

  // Fit the camera ONCE (when going from empty to populated) so it doesn't
  // snap back / fight the user's orbit on every edit.
  if (!hasFitted) {
    const box = new THREE.Box3().setFromObject(modelRoot);
    const center = new THREE.Vector3(); box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 3000;
    controls.target.copy(center);
    camera.position.set(center.x + maxDim, center.y + maxDim, maxDim * 1.2);
    controls.update();
    hasFitted = true;
  }
  renderOnce();
}

// Recenter on demand (e.g. a "fit" button or tab switch after big edits).
export function fitCamera() { hasFitted = false; rebuildModel3D(); }

// Move the single renderer between the small preview and the big 3D tab.
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
    renderer.setSize(196, 196);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    renderOnce();
  }
}

export function resize3d() {
  const wrap = document.getElementById('canvas3d-wrap');
  if (!wrap || wrap.clientWidth === 0) return;
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  camera.aspect = wrap.clientWidth / wrap.clientHeight;
  camera.updateProjectionMatrix();
  renderOnce();
}
