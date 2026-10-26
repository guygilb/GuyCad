// Pure-JS geometry shared by the UI and the kernel worker:
// reference frames, sketch entity geometry and closed-profile extraction.
import * as THREE from 'three';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v) => [v.x, v.y, v.z];
const TOL = 1e-3;

// ---------------------------------------------------------------- frames

export function frameFromNormal(normal, origin = [0, 0, 0]) {
  const n = V3(normal).normalize();
  const up = Math.abs(n.y) > 0.999
    ? new THREE.Vector3(0, 0, n.y > 0 ? -1 : 1)
    : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, n).normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();
  return { origin: [...origin], xDir: arr(x), yDir: arr(y), normal: arr(n) };
}

export const STD_PLANES = {
  Front: frameFromNormal([0, 0, 1]),
  Top: frameFromNormal([0, 1, 0]),
  Right: frameFromNormal([1, 0, 0]),
};

export function frameMatrix(f) {
  const m = new THREE.Matrix4().makeBasis(V3(f.xDir), V3(f.yDir), V3(f.normal));
  m.setPosition(V3(f.origin));
  return m;
}

export function frameToWorld(f, p) {
  return [
    f.origin[0] + f.xDir[0] * p[0] + f.yDir[0] * p[1],
    f.origin[1] + f.xDir[1] * p[0] + f.yDir[1] * p[1],
    f.origin[2] + f.xDir[2] * p[0] + f.yDir[2] * p[1],
  ];
}

// Plane reference: 'Front' | 'Top' | 'Right' | 'face' (uses explicit frame) | <plane feature id>
export function resolvePlane(ref, frame, planes) {
  if (STD_PLANES[ref]) return STD_PLANES[ref];
  if (ref === 'face') {
    if (!frame) throw new Error('Face reference is missing');
    return frame;
  }
  if (planes[ref]) return planes[ref];
  throw new Error('Reference plane is missing or failed');
}

export function planeFeatureFrame(f, planes) {
  const base = resolvePlane(f.base, f.baseFrame, planes);
  const n = V3(base.normal);
  const o = V3(base.origin).addScaledVector(n, f.offset * (f.flip ? -1 : 1));
  return frameFromNormal(arr(f.flip ? n.negate() : n), arr(o));
}

// Frames of reference planes and sketches, computed without the solid kernel.
export function computeFrames(doc, limit = null) {
  const planes = {}, frames = {}, errors = {};
  const end = limit ?? doc.features.length;
  for (let i = 0; i < end; i++) {
    const f = doc.features[i];
    if (f.suppressed) continue;
    try {
      if (f.type === 'plane') frames[f.id] = planes[f.id] = planeFeatureFrame(f, planes);
      else if (f.type === 'sketch') frames[f.id] = resolvePlane(f.plane, f.frame, planes);
    } catch (e) {
      errors[f.id] = e.message;
    }
  }
  return { planes, frames, errors };
}

// ---------------------------------------------------------------- sketch entities

export function arcSweep(e) {
  let s = e.a1 - e.a0;
  while (s <= 1e-9) s += Math.PI * 2;
  while (s > Math.PI * 2 + 1e-9) s -= Math.PI * 2;
  return s;
}

export function arcEnds(e) {
  return [
    [e.c[0] + e.r * Math.cos(e.a0), e.c[1] + e.r * Math.sin(e.a0)],
    [e.c[0] + e.r * Math.cos(e.a1), e.c[1] + e.r * Math.sin(e.a1)],
  ];
}

export function arcMid(e) {
  const a = e.a0 + arcSweep(e) / 2;
  return [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)];
}

export function polygonVertices(e) {
  const pts = [];
  for (let i = 0; i < e.n; i++) {
    const a = e.rot + (i / e.n) * Math.PI * 2;
    pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
  }
  return pts;
}

// A spline through points, as Catmull-Rom cubic Béziers: [{ a, c1, c2, b }].
// The same curves are drawn in the sketch and built by the kernel, so they match exactly.
export function splineBeziers(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    out.push({
      a: [...p1], b: [...p2],
      c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
    });
  }
  return out;
}

export function bezierPoint(s, t) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((k) => w[0] * s.a[k] + w[1] * s.c1[k] + w[2] * s.c2[k] + w[3] * s.b[k]);
}

// Polyline (array of [x, y]) for display, hit-testing and nesting tests.
export function entityPoints(e, seg = 72) {
  switch (e.type) {
    case 'line':
    case 'centerline':
      return [e.a, e.b];
    case 'point':
      return [e.p];
    case 'ellipse': {
      const pts = [];
      const cr = Math.cos(e.rot), sr = Math.sin(e.rot);
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI * 2, x = e.rx * Math.cos(t), y = e.ry * Math.sin(t);
        pts.push([e.c[0] + x * cr - y * sr, e.c[1] + x * sr + y * cr]);
      }
      return pts;
    }
    case 'spline': {
      const pts = [e.pts[0]];
      for (const s of splineBeziers(e.pts)) for (let i = 1; i <= 16; i++) pts.push(bezierPoint(s, i / 16));
      return pts;
    }
    case 'rect': {
      const [x0, y0] = e.a, [x1, y1] = e.b;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    }
    case 'circle': {
      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
      }
      return pts;
    }
    case 'polygon': {
      const v = polygonVertices(e);
      return [...v, v[0]];
    }
    case 'arc': {
      const sweep = arcSweep(e);
      const steps = Math.max(4, Math.ceil((seg * sweep) / (Math.PI * 2)));
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = e.a0 + (sweep * i) / steps;
        pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
      }
      const [p0, p1] = arcEnds(e);
      pts[0] = p0;
      pts[pts.length - 1] = p1;
      return pts;
    }
    default:
      return [];
  }
}

export function revolveAxisOptions(entities) {
  const opts = [];
  entities.forEach((e, i) => { if (e.type === 'centerline') opts.push({ value: `cl:${i}`, label: `Centerline ${opts.length + 1}` }); });
  opts.push({ value: 'x', label: 'Sketch X axis' }, { value: 'y', label: 'Sketch Y axis' });
  return opts;
}

// ---------------------------------------------------------------- profiles

const d2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Exact boundary segments of an entity: lines and 3-point arcs.
function entitySegments(e) {
  switch (e.type) {
    case 'line': return [{ kind: 'line', a: [...e.a], b: [...e.b] }];
    case 'arc': {
      const [a, b] = arcEnds(e);
      return [{ kind: 'arc', a, b, m: arcMid(e) }];
    }
    case 'rect': {
      const p = entityPoints(e);
      return p.slice(0, 4).map((q, i) => ({ kind: 'line', a: [...q], b: [...p[i + 1]] }));
    }
    case 'polygon': {
      const v = polygonVertices(e);
      return v.map((q, i) => ({ kind: 'line', a: q, b: v[(i + 1) % v.length] }));
    }
    case 'spline':
      return splineBeziers(e.pts).map((s) => ({ kind: 'bezier', ...s }));
    default: return [];
  }
}

const reverseSeg = (s) => (s.kind === 'bezier' ? { ...s, a: s.b, b: s.a, c1: s.c2, c2: s.c1 } : { ...s, a: s.b, b: s.a });

// Chains sketch entities into closed loops. Each loop has exact segments (or a circle)
// plus a sampled polyline used for nesting tests.
export function extractLoops(entities) {
  const loops = [];
  const open = [];
  const pieces = [];
  for (const e of entities) {
    if (e.type === 'centerline' || e.type === 'point' || e.construction) continue;
    if (e.type === 'circle') {
      if (e.r > 1e-9) loops.push({ circle: { c: [...e.c], r: e.r }, pts: entityPoints(e).slice(0, -1) });
    } else if (e.type === 'ellipse') {
      if (e.rx > 1e-9 && e.ry > 1e-9) loops.push({ ellipse: { c: [...e.c], rx: e.rx, ry: e.ry, rot: e.rot }, pts: entityPoints(e).slice(0, -1) });
    } else if (e.type === 'rect' || e.type === 'polygon') {
      const segs = entitySegments(e).filter((s) => d2(s.a, s.b) > 1e-9);
      if (segs.length >= 3) loops.push({ segs, pts: entityPoints(e).slice(0, -1) });
    } else {
      for (const s of entitySegments(e)) if (d2(s.a, s.b) > 1e-9) pieces.push({ seg: s, pts: entityPoints(e), used: false });
    }
  }
  for (const p of pieces) {
    if (p.used) continue;
    p.used = true;
    const segs = [p.seg];
    const pts = [...p.pts];
    let closed = false;
    for (;;) {
      const end = segs[segs.length - 1].b;
      if (segs.length > 1 && d2(end, segs[0].a) < TOL) { closed = true; break; }
      let next = null, rev = false;
      for (const q of pieces) {
        if (q.used) continue;
        if (d2(q.seg.a, end) < TOL) { next = q; break; }
        if (d2(q.seg.b, end) < TOL) { next = q; rev = true; break; }
      }
      if (!next) break;
      next.used = true;
      const s = rev ? reverseSeg(next.seg) : { ...next.seg };
      s.a = [...end]; // weld exactly
      segs.push(s);
      pts.push(...(rev ? [...next.pts].reverse() : next.pts).slice(1));
    }
    if (closed && (segs.length >= 2 || segs[0].kind !== 'line')) {
      segs[segs.length - 1].b = [...segs[0].a];
      loops.push({ segs, pts: dedupe(pts) });
    } else {
      open.push(pts);
    }
  }
  return { loops: loops.filter((l) => l.circle || l.ellipse || l.pts.length >= 2), open };
}

// The single open chain of a sketch (lines, arcs, splines joined end to end), used as a sweep path.
// Chains extend from the first entity in both directions.
export function extractPath(entities) {
  const pieces = [];
  for (const e of entities) {
    if (e.type === 'point' || e.type === 'centerline' || e.construction) continue;
    if (['circle', 'ellipse', 'rect', 'polygon'].includes(e.type)) throw new Error('A sweep path must be an open chain of lines, arcs or splines');
    for (const s of entitySegments(e)) if (d2(s.a, s.b) > 1e-9) pieces.push({ seg: s, used: false });
  }
  if (!pieces.length) throw new Error('The path sketch is empty');
  pieces[0].used = true;
  const segs = [{ ...pieces[0].seg }];
  const grow = (atEnd) => {
    for (;;) {
      const tip = atEnd ? segs[segs.length - 1].b : segs[0].a;
      let found = null;
      for (const q of pieces) {
        if (q.used) continue;
        if (d2(atEnd ? q.seg.a : q.seg.b, tip) < TOL) { found = { ...q.seg }; }
        else if (d2(atEnd ? q.seg.b : q.seg.a, tip) < TOL) { found = reverseSeg(q.seg); }
        if (found) { q.used = true; break; }
      }
      if (!found) return;
      if (atEnd) { found.a = [...tip]; segs.push(found); } else { found.b = [...tip]; segs.unshift(found); }
    }
  };
  grow(true);
  grow(false);
  if (pieces.some((p) => !p.used)) throw new Error('The path must be one connected chain');
  return segs;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || d2(out[out.length - 1], p) > 1e-7) out.push(p);
  if (out.length > 1 && d2(out[0], out[out.length - 1]) < 1e-7) out.pop();
  return out;
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}

// Nest loops into regions (outer + holes) using even/odd containment.
export function buildRegions(loops) {
  const items = loops.map((l) => ({ loop: l, area: polyArea(l.pts), parents: [] }));
  items.forEach((it, i) => {
    const probe = it.loop.pts.length > 1
      ? [(it.loop.pts[0][0] + it.loop.pts[1][0]) / 2, (it.loop.pts[0][1] + it.loop.pts[1][1]) / 2]
      : it.loop.pts[0];
    items.forEach((other, j) => {
      if (i !== j && other.area > it.area && pointInPolygon(probe, other.loop.pts)) it.parents.push(j);
    });
  });
  const regions = [];
  const regionOf = new Map();
  items.forEach((it, i) => {
    if (it.parents.length % 2 === 0) { regionOf.set(i, regions.length); regions.push({ outer: it.loop, holes: [] }); }
  });
  items.forEach((it) => {
    if (it.parents.length % 2 === 1) {
      const parent = it.parents.reduce((best, j) => (best < 0 || items[j].area < items[best].area ? j : best), -1);
      const r = regionOf.get(parent);
      if (r !== undefined) regions[r].holes.push(it.loop);
    }
  });
  return regions;
}

export function sketchRegions(entities) {
  const { loops, open } = extractLoops(entities);
  if (!loops.length) {
    throw new Error(open.length ? 'Sketch profile is open — connect the endpoints' : 'Sketch has no closed profile');
  }
  return buildRegions(loops);
}
