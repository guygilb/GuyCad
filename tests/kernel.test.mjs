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
const build = async (doc) => {
  const r = await rebuildPart(doc);
  return { ...r, data: r.shape ? serializeShape(r.shape) : null };
};
const vol = (r) => r.data?.mass.volume ?? 0;

// 1) 100x50 rectangle extruded 20
const box = [
  { id: 's1', type: 'sketch', plane: 'Front', entities: [{ type: 'rect', a: [0, 0], b: [100, 50] }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 20 },
];
let r = await build({ features: box });
check('box volume', near(vol(r), 100000, 1e-6), vol(r).toFixed(3));
check('box topology', r.data.faces.length === 6 && r.data.edges.length === 12, `${r.data.faces.length} faces, ${r.data.edges.length} edges`);

// 2) through-all cut, exact circle
const holed = [...box,
  { id: 's2', type: 'sketch', plane: 'Front', entities: [{ type: 'circle', c: [50, 25], r: 10 }] },
  { id: 'c1', type: 'extrude', sketch: 's2', endCondition: 'throughAllBoth', depth: 10, cut: true }];
r = await build({ features: holed });
check('cut hole volume (exact)', near(vol(r), 100000 - Math.PI * 100 * 20, 1e-6), vol(r).toFixed(4));
check('cylindrical face found', r.data.faces.some((f) => f.type === 'CYLINDRE' && near(f.radius, 10, 1e-9)));

// 3) linear pattern
r = await build({ features: [...holed, { id: 'p1', type: 'linpattern', targets: ['c1'], direction: 'X', spacing: 25, count: 2, reverse: true }] });
check('pattern volume', near(vol(r), 100000 - 2 * Math.PI * 100 * 20, 1e-6), vol(r).toFixed(3));

// 4) revolve (exact annulus) and partial revolve
const ring = (angle) => ({ features: [
  { id: 's1', type: 'sketch', plane: 'Front', entities: [
    { type: 'line', a: [10, 0], b: [20, 0] }, { type: 'line', a: [20, 0], b: [20, 30] },
    { type: 'line', a: [20, 30], b: [10, 30] }, { type: 'line', a: [10, 30], b: [10, 0] }] },
  { id: 'r1', type: 'revolve', sketch: 's1', axis: 'y', angle },
] });
r = await build(ring(360));
check('revolve volume', near(vol(r), Math.PI * 300 * 30, 1e-6), vol(r).toFixed(3));
r = await build(ring(90));
check('partial revolve volume', near(vol(r), (Math.PI * 300 * 30) / 4, 1e-6), vol(r).toFixed(3));

// 5) arcs in profiles (slot = rectangle + two half discs)
r = await build({ features: [
  { id: 's1', type: 'sketch', plane: 'Top', entities: [
    { type: 'line', a: [-5, -15], b: [-5, 15] }, { type: 'arc', c: [0, 15], r: 5, a0: 0, a1: Math.PI },
    { type: 'line', a: [5, 15], b: [5, -15] }, { type: 'arc', c: [0, -15], r: 5, a0: Math.PI, a1: Math.PI * 2 }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 10 },
] });
check('slot volume (exact arcs)', near(vol(r), (30 * 10 + Math.PI * 25) * 10, 1e-6), vol(r).toFixed(3));

// 6) mirror body and offset plane + circular pattern
r = await build({ features: [
  { id: 's1', type: 'sketch', plane: 'Front', entities: [{ type: 'rect', a: [10, 0], b: [30, 10] }] },
  { id: 'e1', type: 'extrude', sketch: 's1', endCondition: 'blind', depth: 5 },
  { id: 'm1', type: 'mirror', targets: [], plane: 'Right' },
] });
check('mirror volume', near(vol(r), 2000, 1e-6), vol(r).toFixed(3));
r = await build({ features: [
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
r = await build({ features: [...cube, { id: 'f1', type: 'fillet', radius: 4, edges: [[20, 20, 10]] }] });
check('fillet removes (4-pi)r^2*L', near(vol(r), 8000 - (16 - Math.PI * 4) * 20, 1e-3), vol(r).toFixed(3));
r = await build({ features: [...cube, { id: 'c1', type: 'chamfer', distance: 4, edges: [[20, 20, 10]] }] });
check('chamfer removes r^2/2*L', near(vol(r), 8000 - 8 * 20, 1e-3), vol(r).toFixed(3));
r = await build({ features: [...cube, { id: 'sh', type: 'shell', thickness: 2, faces: [[10, 10, 20]] }] });
check('shell open-top box', near(vol(r), 8000 - 16 * 16 * 18, 1e-3), vol(r).toFixed(3));
r = await build({ features: [...cube, { id: 'f1', type: 'fillet', radius: 4, edges: [[99, 99, 99]] }] });
check('lost edge reference is reported', !!r.errors.f1, r.errors.f1);

// 7b) sweep, loft, draft, hole wizard, splines, import
r = await build({ features: [
  { id: 'p', type: 'sketch', plane: 'Front', entities: [{ type: 'line', a: [0, 0], b: [0, 50] }, { type: 'arc', c: [20, 50], r: 20, a0: Math.PI / 2, a1: Math.PI }] },
  { id: 's', type: 'sketch', plane: 'Top', entities: [{ type: 'circle', c: [0, 0], r: 3 }] },
  { id: 'w', type: 'sweep', profile: 's', path: 'p' },
] });
const pathLen = 50 + Math.PI * 20 / 2;
check('sweep circle along line+arc', near(vol(r), Math.PI * 9 * pathLen, 0.5), `${vol(r).toFixed(2)} vs ${(Math.PI * 9 * pathLen).toFixed(2)}`);
r = await build({ features: [
  { id: 'a', type: 'sketch', plane: 'Top', entities: [{ type: 'rect', a: [-10, -10], b: [10, 10] }] },
  { id: 'pl', type: 'plane', base: 'Top', offset: 30, flip: false },
  { id: 'b', type: 'sketch', plane: 'pl', entities: [{ type: 'rect', a: [-5, -5], b: [5, 5] }] },
  { id: 'l', type: 'loft', sections: ['a', 'b'], ruled: true },
] });
check('ruled loft = square frustum', near(vol(r), (30 / 3) * (400 + 100 + 200), 1e-3), vol(r).toFixed(3));
r = await build({ features: [...cube, { id: 'd', type: 'draft', angle: 5, faces: [[20, 10, 10]], neutral: 'Front', reverse: false }] });
check('draft changes one face', !Object.keys(r.errors).length && Math.abs(vol(r) - 8000) > 1, `${vol(r).toFixed(2)} ${JSON.stringify(r.errors)}`);
const holeBase = [...cube, { id: 'hs', type: 'sketch', plane: 'face', frame: { origin: [0, 0, 20], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, entities: [{ type: 'point', p: [10, 10] }] }];
r = await build({ features: [...holeBase, { id: 'h', type: 'hole', sketch: 'hs', holeType: 'simple', diameter: 6, depth: 10, through: true }] });
check('through hole', near(vol(r), 8000 - Math.PI * 9 * 20, 1e-3), vol(r).toFixed(3));
r = await build({ features: [...holeBase, { id: 'h', type: 'hole', sketch: 'hs', holeType: 'cbore', diameter: 6, depth: 10, through: true, cboreDiameter: 10, cboreDepth: 4 }] });
check('counterbored hole', near(vol(r), 8000 - Math.PI * 9 * 20 - Math.PI * (25 - 9) * 4, 1e-3), vol(r).toFixed(3));
r = await build({ features: [...holeBase, { id: 'h', type: 'hole', sketch: 'hs', holeType: 'csink', diameter: 6, depth: 10, through: true, csinkDiameter: 12, csinkAngle: 90 }] });
const cone = (Math.PI * 3 / 3) * (36 + 9 + 18) - Math.PI * 9 * 3; // countersink cone (h=3) beyond the hole
check('countersunk hole', near(vol(r), 8000 - Math.PI * 9 * 20 - cone, 1e-3), vol(r).toFixed(3));
r = await build({ features: [
  { id: 's', type: 'sketch', plane: 'Front', entities: [
    { type: 'spline', pts: [[0, 0], [10, 8], [20, 0]] }, { type: 'line', a: [20, 0], b: [0, 0] }] },
  { id: 'e', type: 'extrude', sketch: 's', endCondition: 'blind', depth: 5 },
] });
check('spline profile extrudes', !Object.keys(r.errors).length && vol(r) > 300 && vol(r) < 1000, vol(r).toFixed(2));
// round-trip: STEP and BREP export, then import as a new part
{
  const { exportShape } = await import('../src/kernel/part.js');
  const base = await rebuildPart({ features: cube });
  const step = await exportShape(base.shape, 'step').arrayBuffer();
  const b64 = Buffer.from(step).toString('base64');
  r = await build({ features: [{ id: 'i', type: 'import', format: 'step', data: b64 }] });
  check('STEP round trip', near(vol(r), 8000, 1e-3), vol(r).toFixed(3));
  const brep = await exportShape(base.shape, 'brep').text();
  r = await build({ features: [{ id: 'i', type: 'import', format: 'brep', data: brep }, ...holeBase.slice(2), { id: 'h', type: 'hole', sketch: 'hs', holeType: 'simple', diameter: 6, through: true, depth: 1 }] });
  check('BREP round trip + features on imported body', near(vol(r), 8000 - Math.PI * 9 * 20, 1e-3), vol(r).toFixed(3));
}

// 8) every sample rebuilds cleanly
for (const [id, s] of Object.entries(SAMPLES)) {
  const parts = s.doc.type === 'assembly' ? s.doc.components.map((c) => [`${id}/${c.name}`, c.part]) : [[id, s.doc]];
  for (const [label, doc] of parts) {
    r = await build(doc);
    check(`sample ${label}`, !Object.keys(r.errors).length && vol(r) > 0, `${JSON.stringify(r.errors)} vol=${vol(r).toFixed(1)}`);
  }
}

// 9) incremental cache: editing the last feature reuses earlier results
const t0 = performance.now();
await build({ features: [...holed, { id: 'f9', type: 'fillet', radius: 2, edges: [[100, 50, 10]] }] });
const t1 = performance.now();
const again = await build({ features: [...holed, { id: 'f9', type: 'fillet', radius: 3, edges: [[100, 50, 10]] }] });
const t2 = performance.now();
check('incremental rebuild', !Object.keys(again.errors).length, `first ${(t1 - t0).toFixed(0)} ms, edit ${(t2 - t1).toFixed(0)} ms`);

// 10) drawing projection: front view of the holed box shows the hole as a visible circle
{
  const { projectViews } = await import('../src/kernel/part.js');
  const b = await rebuildPart({ features: holed });
  const [front, top] = projectViews(b.shape, [{ id: 'f', dir: [0, 0, 1], x: [1, 0, 0] }, { id: 't', dir: [0, 1, 0], x: [1, 0, 0] }]);
  check('front view: circle + outline', front.circles.length >= 1 && near(front.circles[0].r, 10, 1e-6) && near(front.bbox[2] - front.bbox[0], 100, 1e-6), JSON.stringify(front.bbox));
  check('top view: hole is hidden', top.hidden.length >= 2 && near(top.bbox[3] - top.bbox[1], 20, 1e-6), `${top.hidden.length} hidden edges`);
}
