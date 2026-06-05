// =====================================================
// CARD PREVIEW 3D — orbital spin on iso-library card hover.
//
// Single shared WebGL renderer (re-parented per hover).
// No user controls — pure auto-rotation.
// =====================================================
import * as THREE from 'three';
import { buildWall3D } from './render3d.js';

const IMG_H       = 76;
const SPEED       = 2 * Math.PI / (7 * 60);  // one rev per ~7 s at 60 fps
const _POLAR      = Math.PI * 9 / 32;        // 51° from zenith = 39° above horizontal
const START_AZIM  = Math.PI * 0.25;          // consistent start pose matching iso thumbnail angle

let _renderer = null;
let _scene, _camera, _modelRoot;
let _azimuth = 0;
const _target = new THREE.Vector3();
let _radius   = 5000;
let _rafId    = null;
let _activeCard = null;
let _activeImg  = null;

function ensureRenderer(w) {
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setClearColor(0x111828);

    const el = _renderer.domElement;
    el.style.cssText =
      'position:absolute;top:4px;left:4px;z-index:5;pointer-events:none;border-radius:3px;';

    _scene = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
    _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(2000, 3000, 4000);
    _scene.add(dl);
    _modelRoot = new THREE.Group();
    _scene.add(_modelRoot);
  }
  _renderer.setSize(w, IMG_H);
  _camera.aspect = w / IMG_H;
  _camera.updateProjectionMatrix();
}

function loadMod(mod) {
  _modelRoot.traverse(obj => { if (obj.isMesh && obj.geometry) obj.geometry.dispose(); });
  _modelRoot.clear();
  _modelRoot.add(buildWall3D(mod, 'north', 0, 0));

  const box  = new THREE.Box3().setFromObject(_modelRoot);
  box.getCenter(_target);
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 3000;
  _radius = maxDim * 1.56;
}

function startLoop() {
  if (_rafId !== null) return;
  const tick = () => {
    _rafId = requestAnimationFrame(tick);
    _azimuth += SPEED;
    const sp = Math.sin(_POLAR), cp = Math.cos(_POLAR);
    const sa = Math.sin(_azimuth), ca = Math.cos(_azimuth);
    _camera.position.set(
      _target.x + _radius * sp * ca,
      _target.y + _radius * sp * sa,
      _target.z + _radius * cp
    );
    _camera.up.set(0, 0, 1);
    _camera.lookAt(_target);
    _renderer.render(_scene, _camera);
  };
  _rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
}

export function cardHover(card, mod) {
  if (_activeCard === card) return;
  if (_activeCard) cardLeave(_activeCard);
  _activeCard = card;

  const w = Math.max(card.offsetWidth - 8, 60);
  ensureRenderer(w);
  _azimuth = START_AZIM;
  loadMod(mod);

  _activeImg = card.querySelector('img');
  if (_activeImg) _activeImg.style.visibility = 'hidden';

  card.appendChild(_renderer.domElement);
  startLoop();
}

export function cardLeave(card) {
  if (_activeCard !== card) return;
  stopLoop();
  if (_activeImg) { _activeImg.style.visibility = ''; _activeImg = null; }
  const el = _renderer?.domElement;
  if (el?.parentNode) el.remove();
  _activeCard = null;
}
