// 2D geometric constraint solver for sketches: relations (coincident, horizontal, tangent...)
// and driving dimensions, solved with damped minimum-norm Newton steps.
import { arcEnds } from './geometry.js';

// ---------------------------------------------------------------- parameters

// Parameter layout per entity type (indices into the flat variable vector).
const LAYOUT = {
  line: ['a0', 'a1', 'b0', 'b1'],
  centerline: ['a0', 'a1', 'b0', 'b1'],
  rect: ['a0', 'a1', 'b0', 'b1'],
  circle: ['c0', 'c1', 'r'],
  arc: ['c0', 'c1', 'r', 'a0ang', 'a1ang'],
  polygon: ['c0', 'c1', 'r', 'rot'],
  point: ['p0', 'p1'],
  ellipse: ['c0', 'c1', 'rx', 'ry', 'rot'],
};

// Splines have one x/y pair per through-point.
const layoutOf = (e) => (e.type === 'spline' ? e.pts.flatMap((_, i) => [`s${i}x`, `s${i}y`]) : LAYOUT[e.type] || []);

function readParam(e, k) {
  if (k[0] === 's' && e.type === 'spline') return e.pts[Number(k.slice(1, -1))][k.endsWith('x') ? 0 : 1];
  switch (k) {
    case 'p0': return e.p[0]; case 'p1': return e.p[1];
    case 'a0': return e.a[0]; case 'a1': return e.a[1];
    case 'b0': return e.b[0]; case 'b1': return e.b[1];
    case 'c0': return e.c[0]; case 'c1': return e.c[1];
    case 'r': return e.r; case 'rot': return e.rot;
    case 'rx': return e.rx; case 'ry': return e.ry;
    case 'a0ang': return e.a0; case 'a1ang': return e.a1;
    default: return 0;
  }
}

function writeParam(e, k, v) {
  if (k[0] === 's' && e.type === 'spline') { e.pts[Number(k.slice(1, -1))][k.endsWith('x') ? 0 : 1] = v; return; }
  switch (k) {
    case 'p0': e.p[0] = v; break; case 'p1': e.p[1] = v; break;
    case 'a0': e.a[0] = v; break; case 'a1': e.a[1] = v; break;
    case 'b0': e.b[0] = v; break; case 'b1': e.b[1] = v; break;
    case 'c0': e.c[0] = v; break; case 'c1': e.c[1] = v; break;
    case 'r': e.r = v; break; case 'rot': e.rot = v; break;
    case 'rx': e.rx = v; break; case 'ry': e.ry = v; break;
    case 'a0ang': e.a0 = v; break; case 'a1ang': e.a1 = v; break;
    default: break;
  }
}

export function buildVars(entities) {
  const offsets = [];
  const x = [];
  entities.forEach((e) => {
    offsets.push(x.length);
    for (const k of layoutOf(e)) x.push(readParam(e, k));
  });
  return { x, offsets };
}

export function writeVars(entities, x, offsets) {
  entities.forEach((e, i) => {
    layoutOf(e).forEach((k, j) => writeParam(e, k, x[offsets[i] + j]));
  });
}

// Accessors reading entity geometry from the variable vector.
function view(entities, x, offsets) {
  const P = (i, j) => x[offsets[i] + j];
  return {
    type: (i) => entities[i]?.type,
    // point reference: { e: -1 } is the sketch origin
    point(ref) {
      if (ref.e < 0) return [0, 0];
      const e = entities[ref.e];
      if (!e) return [NaN, NaN];
      const i = ref.e;
      switch (e.type) {
        case 'line': case 'centerline':
          if (ref.p === 'a') return [P(i, 0), P(i, 1)];
          if (ref.p === 'b') return [P(i, 2), P(i, 3)];
          return [(P(i, 0) + P(i, 2)) / 2, (P(i, 1) + P(i, 3)) / 2];
        case 'rect':
          if (ref.p === 'a') return [P(i, 0), P(i, 1)];
          if (ref.p === 'b') return [P(i, 2), P(i, 3)];
          if (ref.p === 'ab') return [P(i, 0), P(i, 3)];
          if (ref.p === 'ba') return [P(i, 2), P(i, 1)];
          return [(P(i, 0) + P(i, 2)) / 2, (P(i, 1) + P(i, 3)) / 2];
        case 'circle': return [P(i, 0), P(i, 1)];
        case 'point': return [P(i, 0), P(i, 1)];
        case 'ellipse': return [P(i, 0), P(i, 1)];
        case 'spline': {
          const last = e.pts.length - 1;
          const k = ref.p === 'a' ? 0 : ref.p === 'b' ? last : Number(String(ref.p).slice(1)) || 0;
          return [P(i, 2 * k), P(i, 2 * k + 1)];
        }
        case 'arc': {
          if (ref.p === 'c') return [P(i, 0), P(i, 1)];
          const ang = ref.p === 'p0' ? P(i, 3) : P(i, 4);
          return [P(i, 0) + P(i, 2) * Math.cos(ang), P(i, 1) + P(i, 2) * Math.sin(ang)];
        }
        case 'polygon': {
          if (ref.p === 'c') return [P(i, 0), P(i, 1)];
          const k = ref.p === 'v0' ? 0 : Number(String(ref.p).slice(1)) || 0;
          const ang = P(i, 3) + (k / e.n) * Math.PI * 2;
          return [P(i, 0) + P(i, 2) * Math.cos(ang), P(i, 1) + P(i, 2) * Math.sin(ang)];
        }
        default: return [NaN, NaN];
      }
    },
    line(i) { return [[P(i, 0), P(i, 1)], [P(i, 2), P(i, 3)]]; },
    center(i) { return [P(i, 0), P(i, 1)]; },
    radius(i) { return P(i, 2); },
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const isRound = (t) => t === 'circle' || t === 'arc';
const isLine = (t) => t === 'line' || t === 'centerline';

// Residuals of one constraint (each should be 0 when satisfied).
function residuals(c, V) {
  switch (c.type) {
    case 'coincident': {
      const p = V.point(c.p1), q = V.point(c.p2);
      return [p[0] - q[0], p[1] - q[1]];
    }
    case 'horizontal':
      if (c.e != null) { const [a, b] = V.line(c.e); return [a[1] - b[1]]; }
      return [V.point(c.p1)[1] - V.point(c.p2)[1]];
    case 'vertical':
      if (c.e != null) { const [a, b] = V.line(c.e); return [a[0] - b[0]]; }
      return [V.point(c.p1)[0] - V.point(c.p2)[0]];
    case 'parallel': {
      const [a, b] = V.line(c.e1), [p, q] = V.line(c.e2);
      const d1 = sub(b, a), d2 = sub(q, p);
      return [cross(d1, d2) / (len(d1) * len(d2) || 1)];
    }
    case 'perpendicular': {
      const [a, b] = V.line(c.e1), [p, q] = V.line(c.e2);
      const d1 = sub(b, a), d2 = sub(q, p);
      return [dot(d1, d2) / (len(d1) * len(d2) || 1)];
    }
    case 'equal': {
      if (isRound(V.type(c.e1))) return [V.radius(c.e1) - V.radius(c.e2)];
      const [a, b] = V.line(c.e1), [p, q] = V.line(c.e2);
      return [len(sub(b, a)) - len(sub(q, p))];
    }
    case 'concentric': {
      const a = V.center(c.e1), b = V.center(c.e2);
      return [a[0] - b[0], a[1] - b[1]];
    }
    case 'tangent': {
      if (isLine(V.type(c.e1))) {
        const [a, b] = V.line(c.e1);
        const d = sub(b, a);
        return [Math.abs(cross(d, sub(V.center(c.e2), a))) / (len(d) || 1) - V.radius(c.e2)];
      }
      const dc = len(sub(V.center(c.e1), V.center(c.e2)));
      const r1 = V.radius(c.e1), r2 = V.radius(c.e2);
      return [c.inner ? dc - Math.abs(r1 - r2) : dc - (r1 + r2)];
    }
    case 'midpoint': {
      const p = V.point(c.p), [a, b] = V.line(c.e);
      return [p[0] - (a[0] + b[0]) / 2, p[1] - (a[1] + b[1]) / 2];
    }
    case 'onLine': {
      const p = V.point(c.p), [a, b] = V.line(c.e);
      const d = sub(b, a);
      return [cross(d, sub(p, a)) / (len(d) || 1)];
    }
    case 'onCircle': {
      const p = V.point(c.p);
      return [len(sub(p, V.center(c.e))) - V.radius(c.e)];
    }
    case 'fix': {
      const p = V.point(c.p);
      return [p[0] - c.at[0], p[1] - c.at[1]];
    }
    // ---- driving dimensions
    case 'distance': {
      const d = sub(V.point(c.p2), V.point(c.p1));
      if (c.mode === 'h') return [Math.abs(d[0]) - c.value];
      if (c.mode === 'v') return [Math.abs(d[1]) - c.value];
      return [len(d) - c.value];
    }
    case 'length': {
      const [a, b] = V.line(c.e);
      return [len(sub(b, a)) - c.value];
    }
    case 'radius': return [V.radius(c.e) - c.value];
    case 'diameter': return [2 * V.radius(c.e) - c.value];
    case 'angle': {
      const [a, b] = V.line(c.e1), [p, q] = V.line(c.e2);
      const d1 = sub(b, a), d2 = sub(q, p);
      const ang = Math.abs(Math.atan2(cross(d1, d2), dot(d1, d2)));
      const target = (c.value * Math.PI) / 180;
      return [(c.supplement ? Math.PI - ang : ang) - target];
    }
    case 'pointLine': {
      const p = V.point(c.p), [a, b] = V.line(c.e);
      const d = sub(b, a);
      return [Math.abs(cross(d, sub(p, a))) / (len(d) || 1) - c.value];
    }
    default:
      return [];
  }
}

export const DIMENSION_TYPES = new Set(['distance', 'length', 'radius', 'diameter', 'angle', 'pointLine']);

// Current measured value of a dimension (for creating one from existing geometry).
export function measure(c, entities) {
  const { x, offsets } = buildVars(entities);
  const V = view(entities, x, offsets);
  const probe = { ...c, value: 0, supplement: false };
  const v = residuals(probe, V)[0];
  if (c.type === 'angle') return (v * 180) / Math.PI;
  return v;
}

// ---------------------------------------------------------------- solver

function evalAll(constraints, entities, x, offsets, extra) {
  const V = view(entities, x, offsets);
  const r = [];
  for (const c of constraints) for (const v of residuals(c, V)) r.push(v);
  if (extra) for (const v of extra(V)) r.push(v);
  return r;
}

function solveLinear(A, b) {
  // Gaussian elimination with partial pivoting on a small dense system (A is modified).
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    if (Math.abs(A[p][i]) < 1e-14) continue;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      if (!f) continue;
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const out = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(A[i][i]) < 1e-14) continue;
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * out[j];
    out[i] = s / A[i][i];
  }
  return out;
}

function jacobian(f, x, r0) {
  const m = r0.length, n = x.length;
  const J = Array.from({ length: m }, () => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    const h = 1e-7 * Math.max(1, Math.abs(x[j]));
    const xj = x[j];
    x[j] = xj + h;
    const r1 = f(x);
    x[j] = xj;
    for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r0[i]) / h;
  }
  return J;
}

/**
 * Solves the sketch in place. `extra(V)` may add temporary residuals (e.g. a dragged point).
 * Returns { ok, residual }. On failure the entities are left unchanged.
 */
export function solve(entities, constraints, { extra = null, maxIter = 60, tol = 1e-9 } = {}) {
  if (!constraints.length && !extra) return { ok: true, residual: 0 };
  const { x, offsets } = buildVars(entities);
  if (!x.length) return { ok: true, residual: 0 };
  const start = x.slice();
  const f = (xx) => evalAll(constraints, entities, xx, offsets, extra);
  let r = f(x);
  let norm = Math.hypot(...r);
  let lambda = 1e-6;
  for (let it = 0; it < maxIter && norm > tol; it++) {
    const J = jacobian(f, x, r);
    const m = r.length, n = x.length;
    // minimum-norm damped step: dx = -J^T (J J^T + λI)^-1 r
    const JJt = Array.from({ length: m }, (_, i) => {
      const row = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += J[i][j] * J[k][j];
        row[k] = s;
      }
      row[i] += lambda;
      return Array.from(row);
    });
    const y = solveLinear(JJt, r.slice());
    const dx = new Float64Array(n);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += J[i][j] * y[i]; dx[j] = -s; }
    // backtracking line search
    let step = 1, improved = false;
    for (let k = 0; k < 12; k++) {
      const xn = x.map((v, j) => v + step * dx[j]);
      const rn = f(xn);
      const nn = Math.hypot(...rn);
      if (nn < norm) {
        for (let j = 0; j < n; j++) x[j] = xn[j];
        r = rn; norm = nn; improved = true;
        break;
      }
      step /= 2;
    }
    if (!improved) { lambda *= 10; if (lambda > 1e3) break; } else lambda = Math.max(1e-9, lambda / 3);
  }
  const ok = norm < 1e-6;
  if (ok) {
    for (const e of entities) if (e.type === 'circle' || e.type === 'arc' || e.type === 'polygon') e.r = Math.abs(e.r);
    writeVars(entities, x, offsets);
    for (const e of entities) if (e.r != null) e.r = Math.abs(e.r);
  } else writeVars(entities, start, offsets);
  return { ok, residual: norm };
}

// ---------------------------------------------------------------- degrees of freedom

/**
 * Analyses how constrained the sketch is.
 * Returns { dof, status: 'under'|'full'|'over', defined: Set<entity index> }.
 */
export function analyze(entities, constraints) {
  const { x, offsets } = buildVars(entities);
  const n = x.length;
  if (!n) return { dof: 0, status: 'full', defined: new Set() };
  const f = (xx) => evalAll(constraints, entities, xx, offsets, null);
  const r0 = f(x);
  const residual = Math.hypot(...r0);
  const J = r0.length ? jacobian(f, x.slice(), r0) : [];
  // row-reduce J to find rank and a nullspace basis
  const R = J.map((row) => Array.from(row));
  const pivots = [];
  let row = 0;
  for (let col = 0; col < n && row < R.length; col++) {
    let p = row;
    for (let k = row + 1; k < R.length; k++) if (Math.abs(R[k][col]) > Math.abs(R[p][col])) p = k;
    if (Math.abs(R[p][col]) < 1e-7) continue;
    [R[row], R[p]] = [R[p], R[row]];
    const pv = R[row][col];
    for (let j = col; j < n; j++) R[row][j] /= pv;
    for (let k = 0; k < R.length; k++) {
      if (k === row || !R[k][col]) continue;
      const fct = R[k][col];
      for (let j = col; j < n; j++) R[k][j] -= fct * R[row][j];
    }
    pivots.push(col);
    row++;
  }
  const rank = pivots.length;
  const free = [];
  for (let j = 0; j < n; j++) if (!pivots.includes(j)) free.push(j);
  // a variable is determined if it has no component in any nullspace vector
  const undetermined = new Set(free);
  pivots.forEach((pc, ri) => { for (const fc of free) if (Math.abs(R[ri][fc]) > 1e-7) undetermined.add(pc); });
  const defined = new Set();
  entities.forEach((e, i) => {
    const k = layoutOf(e).length;
    let ok = true;
    for (let j = 0; j < k; j++) if (undetermined.has(offsets[i] + j)) ok = false;
    if (ok) defined.add(i);
  });
  const redundant = r0.length - rank;
  const status = residual > 1e-5 ? 'over' : rank === n ? 'full' : 'under';
  return { dof: n - rank, status, defined, redundant };
}

// ---------------------------------------------------------------- bookkeeping

const refsOf = (c) => [c.p, c.p1, c.p2].filter(Boolean);
const entsOf = (c) => [c.e, c.e1, c.e2].filter((v) => v != null);

export function constraintEntities(c) {
  return [...entsOf(c), ...refsOf(c).map((r) => r.e).filter((e) => e >= 0)];
}

// Removes constraints that touch deleted entities and renumbers the rest.
export function remapAfterDelete(constraints, deleted) {
  const map = (i) => i - [...deleted].filter((d) => d < i).length;
  return constraints
    .filter((c) => !constraintEntities(c).some((i) => deleted.has(i)))
    .map((c) => {
      const o = JSON.parse(JSON.stringify(c));
      for (const k of ['e', 'e1', 'e2']) if (o[k] != null) o[k] = map(o[k]);
      for (const k of ['p', 'p1', 'p2']) if (o[k] && o[k].e >= 0) o[k].e = map(o[k].e);
      return o;
    });
}

// For sketches made before constraints existed: connect endpoints that already touch.
export function inferCoincidences(entities) {
  const pts = [];
  entities.forEach((e, i) => {
    const add = (p, key) => pts.push({ ref: { e: i, p: key }, at: p });
    if (e.type === 'line' || e.type === 'centerline') { add(e.a, 'a'); add(e.b, 'b'); }
    else if (e.type === 'arc') { const [p0, p1] = arcEnds(e); add(p0, 'p0'); add(p1, 'p1'); }
  });
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[i].ref.e !== pts[j].ref.e && Math.hypot(pts[i].at[0] - pts[j].at[0], pts[i].at[1] - pts[j].at[1]) < 1e-6) {
        out.push({ type: 'coincident', p1: pts[i].ref, p2: pts[j].ref });
      }
    }
  }
  return out;
}

export const RELATION_LABELS = {
  coincident: 'Coincident', horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Parallel',
  perpendicular: 'Perpendicular', equal: 'Equal', concentric: 'Concentric', tangent: 'Tangent',
  midpoint: 'Midpoint', onLine: 'Coincident (on line)', onCircle: 'Coincident (on circle)', fix: 'Fix',
  distance: 'Distance', length: 'Length', radius: 'Radius', diameter: 'Diameter', angle: 'Angle', pointLine: 'Distance',
};

export const RELATION_GLYPHS = {
  horizontal: '—', vertical: '|', parallel: '∥', perpendicular: '⊥', equal: '=', concentric: '◎',
  tangent: 'T', midpoint: 'M', fix: '⚓', coincident: '•', onLine: '•', onCircle: '•',
};
