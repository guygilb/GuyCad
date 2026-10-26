// Sketch tool tests (trim, sketch fillet, slot, offset, mirror): node tests/sketch-tools.test.mjs
import { Sketcher, slotEntities } from '../src/sketcher.js';
import { extractLoops } from '../src/geometry.js';
import { analyze } from '../src/constraints.js';

const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
  if (!cond) process.exitCode = 1;
};
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

// A Sketcher without a viewport: geometry operations only.
function headless(entities, constraints = []) {
  const sk = Object.create(Sketcher.prototype);
  Object.assign(sk, {
    feature: { entities, constraints },
    vp: { worldPerPixel: () => 0.05 },
    app: { toast: (m) => { sk.lastToast = m; }, settings: { sketchFilletRadius: 3 }, onSketchChanged() {} },
    selected: new Set(), selPoints: [], selConstraint: -1, dimPicks: [], pts: [], undoStack: [], redoStack: [],
  });
  sk.redraw = () => {};
  sk.changed = () => sk.reanalyze();
  return sk;
}

// trim: two crossing lines; clicking one end of the horizontal line removes it up to the crossing
let sk = headless([{ type: 'line', a: [0, 0], b: [20, 0] }, { type: 'line', a: [10, -5], b: [10, 5] }]);
sk.trimAt([17, 0]);
check('trim line to intersection', near(sk.entities[0].b[0], 10) && near(sk.entities[0].a[0], 0), JSON.stringify(sk.entities[0]));
check('trim keeps the end on the cutting line', sk.constraints.some((c) => c.type === 'onLine'));
sk = headless([{ type: 'line', a: [0, 0], b: [30, 0] }, { type: 'line', a: [10, -5], b: [10, 5] }, { type: 'line', a: [20, -5], b: [20, 5] }]);
sk.trimAt([15, 0]);
check('trim middle splits the line', sk.entities.length === 4 && near(sk.entities[0].b[0], 10) && near(sk.entities[3].a[0], 20));
sk = headless([{ type: 'circle', c: [0, 0], r: 10 }, { type: 'line', a: [-20, 0], b: [20, 0] }]);
sk.trimAt([0, 10]);
check('trim circle -> lower half arc', sk.entities[0].type === 'arc' && near(sk.entities[0].r, 10), JSON.stringify(sk.entities[0]));

// sketch fillet: an L corner of two lines meeting at the origin
sk = headless([{ type: 'line', a: [20, 0], b: [0, 0] }, { type: 'line', a: [0, 0], b: [0, 20] }],
  [{ type: 'coincident', p1: { e: 0, p: 'b' }, p2: { e: 1, p: 'a' } }]);
sk.filletAt([0, 0]);
const arc = sk.entities[2];
check('sketch fillet adds a tangent arc', arc?.type === 'arc' && near(arc.r, 3) && near(arc.c[0], 3) && near(arc.c[1], 3), JSON.stringify(arc));
check('fillet trims the lines', near(sk.entities[0].b[0], 3) && near(sk.entities[1].a[1], 3));
check('fillet makes a connected profile chain', extractLoops(sk.entities).open.length === 1);

// slot: closed, with consistent relations (5 DOF: two centers + width)
const slot = slotEntities([0, 0], [30, 0], [10, 4]);
sk = headless([]);
sk.addSlot(slot, null, null);
const loops = extractLoops(sk.entities).loops;
const a = analyze(sk.entities, sk.constraints);
check('slot is one closed loop', loops.length === 1 && loops[0].segs.length === 4);
check('slot relations leave 5 DOF', a.status === 'under' && a.dof === 5, `${a.status} ${a.dof}`);

// offset a closed square outward (reverse) by 2 -> 24 x 24 square with sharp corners
sk = headless([[0, 0, 20, 0], [20, 0, 20, 20], [20, 20, 0, 20], [0, 20, 0, 0]].map(([x0, y0, x1, y1]) => ({ type: 'line', a: [x0, y0], b: [x1, y1] })));
sk.selected = new Set([0, 1, 2, 3]);
sk.offsetSelected(2, true);
const off = sk.entities.slice(4);
const xs = off.flatMap((e) => [e.a[0], e.b[0]]);
check('offset square outward with joined corners', off.length === 4 && near(Math.min(...xs), -2) && near(Math.max(...xs), 22) && extractLoops(off).loops.length === 1, JSON.stringify(off.map((e) => e.a)));

// mirror a circle across a vertical centerline
sk = headless([{ type: 'centerline', a: [0, -10], b: [0, 10] }, { type: 'circle', c: [5, 2], r: 1 }]);
sk.selected = new Set([0, 1]);
sk.mirrorSelected();
check('mirror entities', near(sk.entities[2].c[0], -5) && near(sk.entities[2].c[1], 2));

// three-click shapes and tangent arcs
import { threeClickShape, tangentArc } from '../src/sketcher.js';
const ell = threeClickShape('ellipse', [0, 0], [10, 0], [3, 4]);
check('ellipse from 3 clicks', near(ell.rx, 10) && near(ell.ry, 4) && near(ell.rot, 0));
const r3 = threeClickShape('rect3', [0, 0], [10, 10], [0, 5]);
check('3-point rectangle is a closed loop', extractLoops(r3).loops.length === 1);
const ta = tangentArc([10, 0], [1, 0], [10, 20]);
check('tangent arc leaves along the line', near(ta.r, 10) && near(ta.c[0], 10) && near(ta.c[1], 10), JSON.stringify(ta));
