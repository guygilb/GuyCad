// Assembly model: component poses and the mate solver.
import * as THREE from 'three';

export const MATE_TYPES = {
  coincident: { label: 'Coincident', icon: 'mateCoincident', refs: ['plane', 'plane'] },
  parallel: { label: 'Parallel', icon: 'mateParallel', refs: ['plane', 'plane'] },
  perpendicular: { label: 'Perpendicular', icon: 'matePerpendicular', refs: ['plane', 'plane'] },
  distance: { label: 'Distance', icon: 'mateDistance', refs: ['plane', 'plane'], value: true },
  concentric: { label: 'Concentric', icon: 'mateConcentric', refs: ['axis', 'axis'] },
};

export function componentMatrix(c) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...c.position), new THREE.Quaternion(...c.quaternion), new THREE.Vector3(1, 1, 1));
}

// A mate reference from a kernel face/edge description, in the component's local coordinates.
export function refFromPick(pick) {
  const info = pick.info || {};
  if (pick.kind === 'face' && info.type === 'PLANE') return { kind: 'plane', point: [...pick.localPoint], normal: [...info.normal] };
  if (pick.kind === 'face' && info.type === 'CYLINDRE') return { kind: 'axis', point: [...info.axisOrigin], dir: [...info.axis], radius: info.radius };
  if (pick.kind === 'edge' && info.type === 'CIRCLE') return { kind: 'axis', point: [...info.center], dir: [...info.axis], radius: info.radius };
  return null;
}

export function mateTypesFor(r1, r2) {
  if (!r1 || !r2) return [];
  return Object.entries(MATE_TYPES).filter(([, m]) => m.refs[0] === r1.kind && m.refs[1] === r2.kind).map(([k]) => k);
}

function worldRef(ref, pos, quat) {
  const p = new THREE.Vector3(...ref.point).applyQuaternion(quat).add(pos);
  const d = new THREE.Vector3(...(ref.normal || ref.dir)).applyQuaternion(quat).normalize();
  return { p, d };
}

function mateResiduals(m, A, B) {
  const sign = m.flip ? -1 : 1;
  switch (m.type) {
    case 'coincident':
    case 'distance': {
      // planes face each other by default (normals opposed); flip makes them aligned
      const n = A.d.clone().add(B.d.clone().multiplyScalar(sign));
      const gap = B.p.clone().sub(A.p).dot(A.d);
      const target = m.type === 'distance' ? m.value || 0 : 0;
      return [n.x, n.y, n.z, gap - target];
    }
    case 'parallel': {
      const c = A.d.clone().cross(B.d);
      return [c.x, c.y, c.z];
    }
    case 'perpendicular':
      return [A.d.dot(B.d)];
    case 'concentric': {
      const c = A.d.clone().cross(B.d);
      const off = B.p.clone().sub(A.p).cross(A.d);
      return [c.x, c.y, c.z, off.x, off.y, off.z];
    }
    default:
      return [];
  }
}

/**
 * Moves floating components so that all active mates are satisfied, changing poses as little
 * as possible. Mutates component.position / component.quaternion. Returns { ok, residual }.
 */
export function solveMates(components, mates, { maxIter = 80 } = {}) {
  const active = mates.filter((m) => !m.suppressed);
  const byId = new Map(components.map((c) => [c.id, c]));
  const floating = components.filter((c) => !c.fixed && !c.suppressed && active.some((m) => m.a.comp === c.id || m.b.comp === c.id));
  if (!active.length) return { ok: true, residual: 0 };
  const index = new Map(floating.map((c, i) => [c.id, i]));
  const base = floating.map((c) => ({ p: new THREE.Vector3(...c.position), q: new THREE.Quaternion(...c.quaternion) }));
  const n = floating.length * 6;

  const pose = (x, id) => {
    const c = byId.get(id);
    const i = index.get(id);
    if (i == null) return { p: new THREE.Vector3(...c.position), q: new THREE.Quaternion(...c.quaternion) };
    const o = i * 6;
    const rv = new THREE.Vector3(x[o + 3], x[o + 4], x[o + 5]);
    const ang = rv.length();
    const dq = ang > 1e-12 ? new THREE.Quaternion().setFromAxisAngle(rv.clone().divideScalar(ang), ang) : new THREE.Quaternion();
    return { p: base[i].p.clone().add(new THREE.Vector3(x[o], x[o + 1], x[o + 2])), q: dq.multiply(base[i].q.clone()) };
  };
  const f = (x) => {
    const r = [];
    for (const m of active) {
      const ca = byId.get(m.a.comp), cb = byId.get(m.b.comp);
      if (!ca || !cb) continue;
      const pa = pose(x, ca.id), pb = pose(x, cb.id);
      r.push(...mateResiduals(m, worldRef(m.a.ref, pa.p, pa.q), worldRef(m.b.ref, pb.p, pb.q)));
    }
    return r;
  };

  let x = new Array(n).fill(0);
  let r = f(x);
  let norm = Math.hypot(...r);
  let lambda = 1e-6;
  for (let it = 0; it < maxIter && norm > 1e-9 && n; it++) {
    const m = r.length;
    const J = Array.from({ length: m }, () => new Float64Array(n));
    for (let j = 0; j < n; j++) {
      const hstep = 1e-6;
      const xj = x[j];
      x[j] = xj + hstep;
      const r1 = f(x);
      x[j] = xj;
      for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r[i]) / hstep;
    }
    // minimum-norm damped step (moves components as little as possible)
    const A = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, k) => {
      let s = 0;
      for (let j = 0; j < n; j++) s += J[i][j] * J[k][j];
      return s + (i === k ? lambda : 0);
    }));
    const y = gauss(A, r.slice());
    const dx = new Array(n).fill(0).map((_, j) => { let s = 0; for (let i = 0; i < m; i++) s -= J[i][j] * y[i]; return s; });
    let step = 1, improved = false;
    for (let k = 0; k < 14; k++) {
      const xn = x.map((v, j) => v + dx[j] * step);
      const rn = f(xn);
      const nn = Math.hypot(...rn);
      if (nn < norm) { x = xn; r = rn; norm = nn; improved = true; break; }
      step /= 2;
    }
    if (!improved) { lambda *= 10; if (lambda > 1e4) break; } else lambda = Math.max(1e-10, lambda / 3);
  }
  const ok = norm < 1e-5;
  if (ok) {
    for (const c of floating) {
      const p = pose(x, c.id);
      c.position = p.p.toArray();
      c.quaternion = p.q.normalize().toArray();
    }
  }
  return { ok, residual: norm };
}

function gauss(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    if (Math.abs(A[p][i]) < 1e-15) continue;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) {
      const fct = A[k][i] / A[i][i];
      if (!fct) continue;
      for (let j = i; j < n; j++) A[k][j] -= fct * A[i][j];
      b[k] -= fct * b[i];
    }
  }
  const out = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(A[i][i]) < 1e-15) continue;
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * out[j];
    out[i] = s / A[i][i];
  }
  return out;
}

// Pose as axis/angle (degrees) for STEP export through the kernel.
export function poseOf(c) {
  const q = new THREE.Quaternion(...c.quaternion).normalize();
  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, q.w)));
  const s = Math.sqrt(1 - q.w * q.w);
  const axis = s < 1e-9 ? [0, 0, 1] : [q.x / s, q.y / s, q.z / s];
  return { position: [...c.position], axis, angle: (angle * 180) / Math.PI };
}
