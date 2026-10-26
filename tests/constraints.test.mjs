// Sketch constraint solver tests: node tests/constraints.test.mjs
import { solve, analyze, measure, remapAfterDelete, inferCoincidences } from '../src/constraints.js';

const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
  if (!cond) process.exitCode = 1;
};
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

// A sloppy closed 4-line loop that should become a 40 x 25 rectangle anchored at the origin.
const ents = () => [
  { type: 'line', a: [0.3, -0.2], b: [38, 1] },
  { type: 'line', a: [38, 1], b: [41, 27] },
  { type: 'line', a: [41, 27], b: [-1, 24] },
  { type: 'line', a: [-1, 24], b: [0.3, -0.2] },
];
const loop = [
  { type: 'coincident', p1: { e: 0, p: 'b' }, p2: { e: 1, p: 'a' } },
  { type: 'coincident', p1: { e: 1, p: 'b' }, p2: { e: 2, p: 'a' } },
  { type: 'coincident', p1: { e: 2, p: 'b' }, p2: { e: 3, p: 'a' } },
  { type: 'coincident', p1: { e: 3, p: 'b' }, p2: { e: 0, p: 'a' } },
  { type: 'horizontal', e: 0 }, { type: 'horizontal', e: 2 },
  { type: 'vertical', e: 1 }, { type: 'vertical', e: 3 },
];
let e = ents();
let res = solve(e, loop);
check('relations converge', res.ok, res.residual.toExponential(2));
let a = analyze(e, loop);
check('rectangle by relations is under-defined (4 DOF)', a.status === 'under' && a.dof === 4, `${a.status} dof=${a.dof}`);

const full = [...loop,
  { type: 'coincident', p1: { e: 0, p: 'a' }, p2: { e: -1 } },
  { type: 'length', e: 0, value: 40 },
  { type: 'length', e: 1, value: 25 }];
res = solve(e, full);
a = analyze(e, full);
check('fully defined after origin + 2 dims', res.ok && a.status === 'full' && a.dof === 0 && a.defined.size === 4, `${a.status} dof=${a.dof}`);
check('geometry correct', near(e[1].a[0], 40) && near(e[2].a[1], 25) && near(e[0].a[0], 0), JSON.stringify(e[1]));

// change a driving dimension
full[full.length - 2].value = 60;
res = solve(e, full);
check('dimension edit propagates', res.ok && near(e[0].b[0], 60) && near(e[1].a[0], 60) && near(e[2].a[0], 60));

// conflicting dimension is rejected and geometry unchanged
const before = JSON.stringify(e);
res = solve(e, [...full, { type: 'length', e: 2, value: 10 }]);
check('conflict rejected', !res.ok && JSON.stringify(e) === before);
a = analyze(e, [...full, { type: 'length', e: 2, value: 10 }]);
check('conflict reported as over-defined', a.status === 'over', a.status);

// tangent line-circle, concentric, equal radii, angle
const e2 = [
  { type: 'circle', c: [0, 0], r: 10 },
  { type: 'line', a: [-20, 13], b: [20, 11] },
  { type: 'circle', c: [1, 1], r: 4 },
  { type: 'arc', c: [30, 0], r: 6, a0: 0, a1: Math.PI },
];
res = solve(e2, [
  { type: 'tangent', e1: 1, e2: 0 }, { type: 'horizontal', e: 1 },
  { type: 'concentric', e1: 0, e2: 2 }, { type: 'equal', e1: 2, e2: 3 },
]);
check('tangent / concentric / equal', res.ok && near(Math.abs(e2[1].a[1] - e2[0].c[1]), e2[0].r) && near(e2[2].c[0], e2[0].c[0]) && near(e2[3].r, e2[2].r));
const e3 = [{ type: 'line', a: [0, 0], b: [10, 0] }, { type: 'line', a: [0, 0], b: [10, 3] }];
res = solve(e3, [{ type: 'horizontal', e: 0 }, { type: 'coincident', p1: { e: 0, p: 'a' }, p2: { e: 1, p: 'a' } }, { type: 'angle', e1: 0, e2: 1, value: 30 }]);
check('angle dimension', res.ok && near(measure({ type: 'angle', e1: 0, e2: 1 }, e3), 30, 1e-6), measure({ type: 'angle', e1: 0, e2: 1 }, e3).toFixed(6));

// bookkeeping
const remapped = remapAfterDelete(loop, new Set([1]));
// deleting line 1 drops its 3 constraints; former line 2/3 become 1/2
const idx = remapped.flatMap((c) => [c.e, c.p1?.e, c.p2?.e]).filter((v) => v != null);
check('delete remaps constraints', remapped.length === 5 && Math.max(...idx) === 2 && remapped.some((c) => c.type === 'vertical' && c.e === 2), JSON.stringify(remapped.map((c) => c.type)));
check('legacy sketches get coincidences', inferCoincidences(ents()).length === 4);
