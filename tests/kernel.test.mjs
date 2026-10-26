// Kernel tests (OpenCascade via replicad): node tests/kernel.test.mjs
import opencascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { fileURLToPath } from 'node:url';
import { rebuildPart, serializeShape } from '../src/kernel/part.js';
import { SAMPLES } from '../src/library.js';

const wasm = fileURLToPath(import.meta.resolve('replicad-opencascadejs/wasm'));
setOC(await opencascade({ locateFile: () => wasm }));

const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
  if (!cond) process.exitCode = 1;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const build = (doc) => {
  const r = rebuildPart(doc);
  return { ...r, data: r.shape ? serializeShape(r.shape) : null };
};
const vol = (r) => r.data?.mass.volume ?? 0;

// 1) 100x50 rectangle extruded 20
const box = [
  { id: 's1', type: 'sketch', plane: 'Front', entities: [{ type: 'rect', a: [0, 0], b: [100, 50] }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 20 },
];
let r = build({ features: box });
check('box volume', near(vol(r), 100000, 1e-6), vol(r).toFixed(3));
check('box topology', r.data.faces.length === 6 && r.data.edges.length === 12, `${r.data.faces.length} faces, ${r.data.edges.length} edges`);

// 2) through-all cut, exact circle
const holed = [...box,
  { id: 's2', type: 'sketch', plane: 'Front', entities: [{ type: 'circle', c: [50, 25], r: 10 }] },
  { id: 'c1', type: 'extrude', sketch: 's2', endCondition: 'throughAllBoth', depth: 10, cut: true }];
r = build({ features: holed });
check('cut hole volume (exact)', near(vol(r), 100000 - Math.PI * 100 * 20, 1e-6), vol(r).toFixed(4));
check('cylindrical face found', r.data.faces.some((f) => f.type === 'CYLINDRE' && near(f.radius, 10, 1e-9)));

// 3) linear pattern
r = build({ features: [...holed, { id: 'p1', type: 'linpattern', targets: ['c1'], direction: 'X', spacing: 25, count: 2, reverse: true }] });
check('pattern volume', near(vol(r), 100000 - 2 * Math.PI * 100 * 20, 1e-6), vol(r).toFixed(3));

// 4) revolve (exact annulus) and partial revolve
const ring = (angle) => ({ features: [
  { id: 's1', type: 'sketch', plane: 'Front', entities: [
    { type: 'line', a: [10, 0], b: [20, 0] }, { type: 'line', a: [20, 0], b: [20, 30] },
    { type: 'line', a: [20, 30], b: [10, 30] }, { type: 'line', a: [10, 30], b: [10, 0] }] },
  { id: 'r1', type: 'revolve', sketch: 's1', axis: 'y', angle },
] });
r = build(ring(360));
check('revolve volume', near(vol(r), Math.PI * 300 * 30, 1e-6), vol(r).toFixed(3));
r = build(ring(90));
check('partial revolve volume', near(vol(r), (Math.PI * 300 * 30) / 4, 1e-6), vol(r).toFixed(3));

// 5) arcs in profiles (slot = rectangle + two half discs)
r = build({ features: [
  { id: 's1', type: 'sketch', plane: 'Top', entities: [
    { type: 'line', a: [-5, -15], b: [-5, 15] }, { type: 'arc', c: [0, 15], r: 5, a0: 0, a1: Math.PI },
    { type: 'line', a: [5, 15], b: [5, -15] }, { type: 'arc', c: [0, -15], r: 5, a0: Math.PI, a1: Math.PI * 2 }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 10 },
] });
check('slot volume (exact arcs)', near(vol(r), (30 * 10 + Math.PI * 25) * 10, 1e-6), vol(r).toFixed(3));

// 6) mirror body and offset plane + circular pattern
r = build({ features: [
  { id: 's1', type: 'sketch', plane: 'Front', entities: [{ type: 'rect', a: [10, 0], b: [30, 10] }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 5 },
  { id: 'm1', type: 'mirror', targets: [], plane: 'Right' },
] });
check('mirror volume', near(vol(r), 2000, 1e-6), vol(r).toFixed(3));
r = build({ features: [
  { id: 'pl', type: 'plane', base: 'Top', offset: 5, flip: false },
  { id: 's1', type: 'sketch', plane: 'pl', entities: [{ type: 'circle', c: [20, 0], r: 3 }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 10 },
  { id: 'cp', type: 'cirpattern', targets: ['e1'], axis: 'Y', count: 4, angle: 360, equal: true },
] });
check('circular pattern volume', near(vol(r), 4 * Math.PI * 9 * 10, 1e-6), vol(r).toFixed(3));
check('offset plane height', near(r.data.bbox.min[1], 5, 1e-6), r.data.bbox.min[1].toFixed(4));

// 7) fillet, chamfer, shell (references are points on the edge / face)
const cube = [
  { id: 's1', type: 'sketch', plane: 'Front', entities: [{ type: 'rect', a: [0, 0], b: [20, 20] }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 20 },
];
r = build({ features: [...cube, { id: 'f1', type: 'fillet', radius: 4, edges: [[20, 20, 10]] }] });
check('fillet removes (4-pi)r^2*L', near(vol(r), 8000 - (16 - Math.PI * 4) * 20, 1e-3), vol(r).toFixed(3));
r = build({ features: [...cube, { id: 'c1', type: 'chamfer', distance: 4, edges: [[20, 20, 10]] }] });
check('chamfer removes r^2/2*L', near(vol(r), 8000 - 8 * 20, 1e-3), vol(r).toFixed(3));
r = build({ features: [...cube, { id: 'sh', type: 'shell', thickness: 2, faces: [[10, 10, 20]] }] });
check('shell open-top box', near(vol(r), 8000 - 16 * 16 * 18, 1e-3), vol(r).toFixed(3));
r = build({ features: [...cube, { id: 'f1', type: 'fillet', radius: 4, edges: [[99, 99, 99]] }] });
check('lost edge reference is reported', !!r.errors.f1, r.errors.f1);

// 8) every sample rebuilds cleanly
for (const [id, s] of Object.entries(SAMPLES)) {
  const parts = s.doc.type === 'assembly' ? s.doc.components.map((c) => [`${id}/${c.name}`, c.part]) : [[id, s.doc]];
  for (const [label, doc] of parts) {
    r = build(doc);
    check(`sample ${label}`, !Object.keys(r.errors).length && vol(r) > 0, `${JSON.stringify(r.errors)} vol=${vol(r).toFixed(1)}`);
  }
}

// 9) incremental cache: editing the last feature reuses earlier results
const t0 = performance.now();
build({ features: [...holed, { id: 'f9', type: 'fillet', radius: 2, edges: [[100, 50, 10]] }] });
const t1 = performance.now();
const again = build({ features: [...holed, { id: 'f9', type: 'fillet', radius: 3, edges: [[100, 50, 10]] }] });
const t2 = performance.now();
check('incremental rebuild', !Object.keys(again.errors).length, `first ${(t1 - t0).toFixed(0)} ms, edit ${(t2 - t1).toFixed(0)} ms`);
