import * as THREE from '../web/vendor/three/three.module.js';
import { normalizeDegrees, rotationMatrixXYZ } from '../web/js/machine-core.js';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const close = (a, b) => Math.abs(a - b) < 1e-12;
const degrees = [23, -37, 71];
const expected = rotationMatrixXYZ(...degrees);
const euler = new THREE.Euler(...degrees.map(value => THREE.MathUtils.degToRad(value)), 'ZYX');
const elements = new THREE.Matrix4().makeRotationFromEuler(euler).elements;
const preview = [elements[0], elements[4], elements[8], elements[1], elements[5], elements[9], elements[2], elements[6], elements[10]];
if (expected.every((value, index) => close(value, preview[index]))) ok('Three ZYX preview rotation matches Rz * Ry * Rx'); else fail(`preview matrix ${preview} differs from ${expected}`);
const sequential = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(degrees[2])).multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(degrees[1]))).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(degrees[0]))).elements;
const sequentialRows = [sequential[0], sequential[4], sequential[8], sequential[1], sequential[5], sequential[9], sequential[2], sequential[6], sequential[10]];
if (expected.every((value, index) => close(value, sequentialRows[index]))) ok('production rotation matrix matches independent sequential rotations'); else fail('production rotation matrix differs from sequential rotations');
try { rotationMatrixXYZ(0, Infinity, 0); fail('rejects non-finite rotation'); } catch { ok('rejects non-finite rotation'); }
if (normalizeDegrees(1080.5) === .5 && normalizeDegrees(-720) === 0) ok('normalizes finite degree values before conversion'); else fail('degree normalization is incorrect');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
