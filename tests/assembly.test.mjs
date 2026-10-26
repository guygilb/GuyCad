// Mate solver tests: node tests/assembly.test.mjs
import * as THREE from 'three';
import { solveMates } from '../src/assembly.js';

const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
  if (!cond) process.exitCode = 1;
};
const near = (a, b, t = 1e-5) => Math.abs(a - b) <= t;

// Base plate (fixed): top face at y=10, a hole axis along Y at (30, *, 0).
// Pin (floating), modelled along its local Z: bottom face z=0 (normal -Z), axis through origin.
const comps = () => [
  { id: 'base', fixed: true, position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  { id: 'pin', fixed: false, position: [80, 40, 25], quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.7, 0.1)).toArray() },
];
const mates = [
  { type: 'concentric', a: { comp: 'base', ref: { kind: 'axis', point: [30, 0, 0], dir: [0, 1, 0] } }, b: { comp: 'pin', ref: { kind: 'axis', point: [0, 0, 0], dir: [0, 0, 1] } } },
  { type: 'coincident', a: { comp: 'base', ref: { kind: 'plane', point: [0, 10, 0], normal: [0, 1, 0] } }, b: { comp: 'pin', ref: { kind: 'plane', point: [0, 0, 0], normal: [0, 0, -1] } } },
];
let c = comps();
let res = solveMates(c, mates);
const pin = c[1];
const q = new THREE.Quaternion(...pin.quaternion);
const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
check('mates converge', res.ok, res.residual.toExponential(2));
check('pin axis is vertical', near(Math.abs(axis.y), 1), axis.toArray().map((v) => v.toFixed(5)).join(','));
check('pin sits on top face at the hole', near(pin.position[0], 30) && near(pin.position[1], 10) && near(pin.position[2], 0), pin.position.map((v) => v.toFixed(5)).join(','));
check('fixed part did not move', c[0].position.every((v) => v === 0));

// distance mate lifts the pin 5 mm above the face
c = comps();
res = solveMates(c, [mates[0], { ...mates[1], type: 'distance', value: 5 }]);
check('distance mate', res.ok && near(c[1].position[1], 15), c[1].position[1].toFixed(5));

// conflicting mates are reported and poses kept
c = comps();
const before = JSON.stringify(c);
res = solveMates(c, [...mates, { type: 'distance', value: 7, a: mates[1].a, b: mates[1].b }]);
check('conflict reported, nothing moved', !res.ok && JSON.stringify(c) === before);
