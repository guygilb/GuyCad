// Interactive 2D sketch editing on a plane: drawing tools, Smart Dimension, relations and
// constraint-driven dragging.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { entityPoints, arcEnds, polygonVertices, frameMatrix } from './geometry.js';
import { solve, analyze, measure, remapAfterDelete, inferCoincidences, DIMENSION_TYPES, RELATION_GLYPHS, constraintEntities } from './constraints.js';
import { units } from './units.js';

export const SKETCH_TOOLS = {
  select: { label: 'Select', icon: 'select', key: 'Escape' },
  dimension: { label: 'Smart Dimension', icon: 'dimension', key: 'd', hint: 'Click a line, circle or arc — or two entities/points — then click to place the dimension and type its value.' },
  line: { label: 'Line', icon: 'line', key: 'l', hint: 'Click to place points. Double-click, right-click or Esc to end the chain.' },
  centerline: { label: 'Centerline', icon: 'centerline', hint: 'Click two points. Centerlines are construction geometry and can be used as revolve axes.' },
  rect: { label: 'Corner Rectangle', icon: 'rect', key: 'r', hint: 'Click the first corner, then the opposite corner.' },
  crect: { label: 'Center Rectangle', icon: 'crect', hint: 'Click the center, then a corner.' },
  circle: { label: 'Circle', icon: 'circle', key: 'c', hint: 'Click the center, then a point on the circle.' },
  arc: { label: '3 Point Arc', icon: 'arc', key: 'a', hint: 'Click the start point, the end point, then a point on the arc.' },
  polygon: { label: 'Polygon', icon: 'polygon', key: 'p', hint: 'Click the center, then a vertex.' },
};

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const clone = (o) => JSON.parse(JSON.stringify(o));
const TWO_PI = Math.PI * 2;
const modAngle = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
const isRound = (e) => e && (e.type === 'circle' || e.type === 'arc');
const isLine = (e) => e && (e.type === 'line' || e.type === 'centerline');

export function circleFrom3(p1, p2, p3) {
  const [ax, ay] = p1, [bx, by] = p2, [cx, cy] = p3;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

export function arcFrom3(s, e, m) {
  const circ = circleFrom3(s, e, m);
  if (!circ) return null;
  const ang = (p) => Math.atan2(p[1] - circ.c[1], p[0] - circ.c[0]);
  const as = ang(s), ae = ang(e), am = ang(m);
  const ccw = modAngle(am - as) < modAngle(ae - as);
  return { type: 'arc', c: circ.c, r: circ.r, a0: ccw ? as : ae, a1: ccw ? ae : as };
}

// Snap/handle points of an entity. `key` is the constraint point reference.
export function entityHandles(e) {
  switch (e.type) {
    case 'line':
    case 'centerline':
      return [
        { p: e.a, type: 'endpoint', handle: 'a', key: 'a' },
        { p: e.b, type: 'endpoint', handle: 'b', key: 'b' },
        { p: mid(e.a, e.b), type: 'midpoint', handle: null, key: 'mid' },
      ];
    case 'rect':
      return [
        { p: e.a, type: 'endpoint', handle: 'a', key: 'a' },
        { p: e.b, type: 'endpoint', handle: 'b', key: 'b' },
        { p: [e.a[0], e.b[1]], type: 'endpoint', handle: 'ab', key: 'ab' },
        { p: [e.b[0], e.a[1]], type: 'endpoint', handle: 'ba', key: 'ba' },
        { p: mid(e.a, e.b), type: 'center', handle: null, key: 'mid' },
      ];
    case 'circle':
      return [
        { p: e.c, type: 'center', handle: 'c', key: 'c' },
        { p: [e.c[0] + e.r, e.c[1]], type: 'quadrant', handle: 'r', key: null },
        { p: [e.c[0], e.c[1] + e.r], type: 'quadrant', handle: null, key: null },
        { p: [e.c[0] - e.r, e.c[1]], type: 'quadrant', handle: null, key: null },
        { p: [e.c[0], e.c[1] - e.r], type: 'quadrant', handle: null, key: null },
      ];
    case 'arc': {
      const [p0, p1] = arcEnds(e);
      return [
        { p: e.c, type: 'center', handle: 'c', key: 'c' },
        { p: p0, type: 'endpoint', handle: 'p0', key: 'p0' },
        { p: p1, type: 'endpoint', handle: 'p1', key: 'p1' },
      ];
    }
    case 'polygon':
      return [
        { p: e.c, type: 'center', handle: 'c', key: 'c' },
        ...polygonVertices(e).map((p, i) => ({ p, type: 'endpoint', handle: i === 0 ? 'v0' : null, key: `v${i}` })),
      ];
    default:
      return [];
  }
}

export function setHandle(e, handle, p) {
  const P = [p[0], p[1]];
  switch (e.type) {
    case 'line': case 'centerline': e[handle] = P; break;
    case 'rect':
      if (handle === 'a' || handle === 'b') e[handle] = P;
      else if (handle === 'ab') { e.a = [P[0], e.a[1]]; e.b = [e.b[0], P[1]]; }
      else if (handle === 'ba') { e.b = [P[0], e.b[1]]; e.a = [e.a[0], P[1]]; }
      break;
    case 'circle':
      if (handle === 'c') e.c = P; else e.r = Math.max(1e-3, dist(e.c, P));
      break;
    case 'arc':
      if (handle === 'c') e.c = P;
      else if (handle === 'p0') e.a0 = Math.atan2(P[1] - e.c[1], P[0] - e.c[0]);
      else if (handle === 'p1') e.a1 = Math.atan2(P[1] - e.c[1], P[0] - e.c[0]);
      break;
    case 'polygon':
      if (handle === 'c') e.c = P;
      else { e.r = Math.max(1e-3, dist(e.c, P)); e.rot = Math.atan2(P[1] - e.c[1], P[0] - e.c[0]); }
      break;
    default: break;
  }
}

function maxParamChange(a, b) {
  let m = 0;
  const walk = (x, y) => {
    if (typeof x === 'number') m = Math.max(m, Math.abs(x - y));
    else if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k], y?.[k]);
  };
  walk(a, b);
  return m;
}

function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

// Point of a constraint reference in an entity list ({ e: -1 } is the origin).
export function refPoint(entities, ref) {
  if (!ref || ref.e < 0) return [0, 0];
  const e = entities[ref.e];
  if (!e) return [0, 0];
  if (ref.p === 'mid') return e.type === 'rect' ? mid(e.a, e.b) : mid(e.a, e.b);
  const h = entityHandles(e).find((x) => x.key === ref.p);
  return h ? h.p : [0, 0];
}

// Build display objects for a list of entities (shared by the active sketcher and inactive sketches).
export function buildSketchObject(entities, mats, { styleOf = () => 'normal', points = false, pickId = null } = {}) {
  const g = new THREE.Group();
  entities.forEach((e, i) => {
    const pts = entityPoints(e);
    if (pts.length < 2) return;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p[0], p[1], 0]));
    const style = styleOf(e, i);
    const construction = e.type === 'centerline' || e.construction;
    const mat = construction && (style === 'normal' || style === 'defined') ? mats.construction : mats[style] || mats.normal;
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 12;
    if (pickId) line.userData.pickSketch = pickId;
    g.add(line);
  });
  if (points) {
    const pts = [];
    for (const e of entities) for (const h of entityHandles(e)) if (h.type === 'endpoint' || h.type === 'center') pts.push(h.p[0], h.p[1], 0);
    pts.push(0, 0, 0);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const p = new THREE.Points(pg, mats.points);
    p.renderOrder = 13;
    g.add(p);
  }
  return g;
}

export function makeSketchMaterials(vp) {
  return {
    normal: vp.makeLineMaterial({ color: 0x1f5fd1, linewidth: 2 }),
    defined: vp.makeLineMaterial({ color: 0x111418, linewidth: 2 }),
    over: vp.makeLineMaterial({ color: 0xd8392b, linewidth: 2.4 }),
    selected: vp.makeLineMaterial({ color: 0x00a6c8, linewidth: 3.2 }),
    hover: vp.makeLineMaterial({ color: 0xff8c1a, linewidth: 3.2 }),
    preview: vp.makeLineMaterial({ color: 0x1f5fd1, linewidth: 1.6, opacity: 0.8 }),
    construction: vp.makeLineMaterial({ color: 0x5b6573, linewidth: 1.4, dashed: true, dashSize: 4, gapSize: 2.5 }),
    inactive: vp.makeLineMaterial({ color: 0x3767b8, linewidth: 1.5, opacity: 0.85 }),
    inactiveSel: vp.makeLineMaterial({ color: 0x00a6c8, linewidth: 2.6 }),
    dim: vp.makeLineMaterial({ color: 0x2b3340, linewidth: 1.2 }),
    dimSel: vp.makeLineMaterial({ color: 0xff8c1a, linewidth: 1.8 }),
    dimDriven: vp.makeLineMaterial({ color: 0x8a919c, linewidth: 1.2 }),
    points: new THREE.PointsMaterial({ color: 0x0f2f6b, size: 5, sizeAttenuation: false, depthTest: false }),
    selPoints: new THREE.PointsMaterial({ color: 0x00a6c8, size: 10, sizeAttenuation: false, depthTest: false }),
  };
}

// ---------------------------------------------------------------- dimension geometry

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const addv = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s];
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const perp = (v) => [-v[1], v[0]];

// Segments (pairs of 2D points) and label anchor for drawing a dimension.
export function dimensionGraphics(c, entities, wpp) {
  const segs = [];
  const arrow = (tip, dir) => {
    const s = wpp * 9, w = wpp * 3.5;
    const d = norm(dir), n = perp(d);
    segs.push([tip, addv(addv(tip, d, -s), n, w)], [tip, addv(addv(tip, d, -s), n, -w)]);
  };
  const linear = (p, q, mode, pos) => {
    let dirv, n;
    if (mode === 'h') { dirv = [1, 0]; n = [0, 1]; }
    else if (mode === 'v') { dirv = [0, 1]; n = [1, 0]; }
    else { dirv = norm(sub(q, p)); n = perp(dirv); }
    const off = (pos[0] - p[0]) * n[0] + (pos[1] - p[1]) * n[1];
    const offQ = (pos[0] - q[0]) * n[0] + (pos[1] - q[1]) * n[1];
    const p2 = addv(p, n, off), q2 = addv(q, n, offQ);
    const gap = wpp * 3, ext = wpp * 6;
    const ext1 = Math.sign(off) || 1, ext2 = Math.sign(offQ) || 1;
    segs.push([addv(p, n, gap * ext1), addv(p2, n, ext * ext1)], [addv(q, n, gap * ext2), addv(q2, n, ext * ext2)], [p2, q2]);
    const dd = sub(q2, p2);
    if (Math.hypot(...dd) > wpp * 20) { arrow(q2, dd); arrow(p2, [-dd[0], -dd[1]]); }
    const t = (pos[0] - p2[0]) * norm(dd)[0] + (pos[1] - p2[1]) * norm(dd)[1];
    const along = Math.hypot(...dd);
    if (t < 0) segs.push([p2, addv(p2, norm(dd), t)]);
    if (t > along) segs.push([q2, addv(p2, norm(dd), t)]);
    return addv(p2, norm(dd), t);
  };
  let anchor = c.pos;
  switch (c.type) {
    case 'length': {
      const e = entities[c.e];
      anchor = linear(e.a, e.b, null, c.pos);
      break;
    }
    case 'distance':
      anchor = linear(refPoint(entities, c.p1), refPoint(entities, c.p2), c.mode, c.pos);
      break;
    case 'pointLine': {
      const e = entities[c.e];
      const p = refPoint(entities, c.p);
      const d = norm(sub(e.b, e.a));
      const t = (p[0] - e.a[0]) * d[0] + (p[1] - e.a[1]) * d[1];
      const foot = addv(e.a, d, t);
      anchor = linear(foot, p, null, c.pos);
      break;
    }
    case 'radius':
    case 'diameter': {
      const e = entities[c.e];
      const dir = norm(sub(c.pos, e.c));
      const edge = addv(e.c, dir, e.r);
      if (c.type === 'diameter') {
        const opp = addv(e.c, dir, -e.r);
        segs.push([opp, c.pos]);
        arrow(edge, dir); arrow(opp, [-dir[0], -dir[1]]);
      } else {
        segs.push([e.c, c.pos]);
        arrow(edge, dir);
      }
      break;
    }
    case 'angle': {
      const l1 = entities[c.e1], l2 = entities[c.e2];
      const d1 = sub(l1.b, l1.a), d2 = sub(l2.b, l2.a);
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      let v = l1.a;
      if (Math.abs(den) > 1e-12) {
        const t = ((l2.a[0] - l1.a[0]) * d2[1] - (l2.a[1] - l1.a[1]) * d2[0]) / den;
        v = addv(l1.a, d1, t);
      }
      const r = Math.max(dist(c.pos, v), wpp * 10);
      const a1 = Math.atan2(d1[1], d1[0]), a2 = Math.atan2(d2[1], d2[0]);
      // pick the pair of ray directions whose sector contains the label
      const pa = Math.atan2(c.pos[1] - v[1], c.pos[0] - v[0]);
      const cands = [[a1, a2], [a1 + Math.PI, a2], [a1, a2 + Math.PI], [a1 + Math.PI, a2 + Math.PI]];
      let best = cands[0];
      for (const [s, e] of cands) {
        const sweep = modAngle(e - s);
        const [lo, sw] = sweep <= Math.PI ? [s, sweep] : [e, TWO_PI - sweep];
        if (modAngle(pa - lo) <= sw) { best = [lo, lo + sw]; break; }
      }
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const t0 = best[0] + ((best[1] - best[0]) * i) / steps, t1 = best[0] + ((best[1] - best[0]) * (i + 1)) / steps;
        segs.push([addv(v, [Math.cos(t0), Math.sin(t0)], r), addv(v, [Math.cos(t1), Math.sin(t1)], r)]);
      }
      break;
    }
    default: break;
  }
  return { segs, anchor };
}

export function dimensionText(c) {
  if (c.type === 'angle') return `${Math.round(c.value * 100) / 100}°`;
  const v = units.fmt(c.value, false);
  if (c.type === 'diameter') return `Ø${v}`;
  if (c.type === 'radius') return `R${v}`;
  return `${v}`;
}

// ---------------------------------------------------------------- sketcher

export class Sketcher {
  constructor(app) {
    this.app = app;
    this.vp = app.viewport;
    this.mats = makeSketchMaterials(this.vp);
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.vp.scene.add(this.group);
    this.content = new THREE.Group();
    this.dimGroup = new THREE.Group();
    this.previewGroup = new THREE.Group();
    this.gridGroup = new THREE.Group();
    this.marker = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xff8c1a, size: 9, sizeAttenuation: false, depthTest: false }));
    this.marker.renderOrder = 15;
    this.group.add(this.gridGroup, this.content, this.dimGroup, this.previewGroup, this.marker);
    this.active = false;
    this.gridSig = '';
    this.labels = [];
    this.vp.onFrame.push(() => {
      if (!this.active) return;
      this.updateGrid();
      this.positionLabels();
    });
  }

  get entities() { return this.feature.entities; }
  get constraints() { return this.feature.constraints; }

  begin(feature, frame) {
    this.feature = feature;
    if (!Array.isArray(feature.constraints)) feature.constraints = inferCoincidences(feature.entities);
    this.frame = frame;
    this.group.matrix.copy(frameMatrix(frame));
    this.group.matrixWorldNeedsUpdate = true;
    this.group.updateMatrixWorld(true);
    this.inverse = this.group.matrixWorld.clone().invert();
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...frame.normal), new THREE.Vector3(...frame.origin));
    this.tool = 'select';
    this.pts = [];
    this.selected = new Set();
    this.selPoints = [];
    this.selConstraint = -1;
    this.dimPicks = [];
    this.hoverIdx = -1;
    this.undoStack = [];
    this.redoStack = [];
    this.active = true;
    this.group.visible = true;
    this.gridSig = '';
    this.vp.setNavigation('sketch');
    this.reanalyze();
    this.redraw();
  }

  end() {
    this.active = false;
    this.group.visible = false;
    this.pts = [];
    this.clearLabels();
    this.closeValueEditor();
    this.vp.setNavigation('model');
    this.app.cursorLabel(null);
  }

  setTool(t) {
    this.tool = t;
    this.pts = [];
    this.dimPicks = [];
    this.previewGroup.clear();
    if (t !== 'select') { this.selected.clear(); this.selPoints = []; this.selConstraint = -1; }
    this.redraw();
    this.app.onSketchToolChanged(t);
  }

  // -------------------------------------------------------- coordinates

  localPoint(clientX, clientY) {
    const ray = this.vp.ray(clientX, clientY);
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(this.plane, hit)) this.plane.projectPoint(ray.origin, hit);
    const l = hit.applyMatrix4(this.inverse);
    return [l.x, l.y];
  }

  toScreen(p) {
    const v = new THREE.Vector3(p[0], p[1], 0).applyMatrix4(this.group.matrixWorld);
    return this.vp.toScreen(v);
  }

  snap(raw, { exclude = null, from = null } = {}) {
    const tolW = this.vp.worldPerPixel() * 10;
    let best = null, bestD = tolW;
    const consider = (p, type, ref) => {
      const d = dist(p, raw);
      if (d < bestD) { bestD = d; best = { p: [p[0], p[1]], type, ref }; }
    };
    consider([0, 0], 'origin', { e: -1 });
    this.entities.forEach((e, i) => {
      if (exclude && exclude.has(i)) return;
      for (const h of entityHandles(e)) consider(h.p, h.type, h.key ? { e: i, p: h.key } : null);
    });
    for (const p of this.pts) consider(p.p || p, 'endpoint', p.ref || null);
    if (best) return best;
    let p = [raw[0], raw[1]];
    let type = null;
    const s = this.app.settings;
    if (s.snapGrid) {
      const step = s.gridStep;
      p = [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step];
      type = 'grid';
    }
    if (from) {
      const ang = Math.atan2(raw[1] - from[1], raw[0] - from[0]);
      const tol = (3 * Math.PI) / 180;
      const a = modAngle(ang);
      if (Math.min(a, Math.abs(a - Math.PI), TWO_PI - a) < tol) { p = [p[0], from[1]]; type = 'horizontal'; }
      else if (Math.abs(a - Math.PI / 2) < tol || Math.abs(a - 1.5 * Math.PI) < tol) { p = [from[0], p[1]]; type = 'vertical'; }
    }
    return { p, type, ref: null };
  }

  hitEntity(p) {
    const tolW = this.vp.worldPerPixel() * 7;
    let best = -1, bestD = tolW;
    this.entities.forEach((e, i) => {
      const d = distToPolyline(p, entityPoints(e));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  hitHandle(p, { withOrigin = false, keyed = false, skipMid = false } = {}) {
    const tolW = this.vp.worldPerPixel() * 8;
    let best = null, bestD = tolW;
    if (withOrigin && dist(p, [0, 0]) < bestD) { bestD = dist(p, [0, 0]); best = { idx: -1, handle: null, p: [0, 0], ref: { e: -1 } }; }
    this.entities.forEach((e, i) => {
      for (const h of entityHandles(e)) {
        if (keyed ? !h.key : !h.handle) continue;
        if (skipMid && h.type === 'midpoint') continue;
        const d = dist(h.p, p);
        if (d < bestD) { bestD = d; best = { idx: i, handle: h.handle, p: h.p, ref: h.key ? { e: i, p: h.key } : null }; }
      }
    });
    return best;
  }

  // -------------------------------------------------------- history & solving

  state() { return clone({ entities: this.entities, constraints: this.constraints }); }

  restore(s) {
    this.feature.entities = s.entities;
    this.feature.constraints = s.constraints;
  }

  pushUndo() {
    this.undoStack.push(this.state());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.state());
    this.restore(this.undoStack.pop());
    this.clearSelection();
    this.changed();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.state());
    this.restore(this.redoStack.pop());
    this.clearSelection();
    this.changed();
    return true;
  }

  clearSelection() {
    this.selected.clear();
    this.selPoints = [];
    this.selConstraint = -1;
  }

  activeConstraints() { return this.constraints.filter((c) => !c.driven); }

  resolve(opts) { return solve(this.entities, this.activeConstraints(), opts); }

  reanalyze() {
    this.analysis = analyze(this.entities, this.activeConstraints());
    // refresh driven (reference) dimension values
    for (const c of this.constraints) if (c.driven) c.value = Math.abs(measure(c, this.entities));
  }

  addEntity(e, relations = []) {
    this.pushUndo();
    const idx = this.entities.length;
    this.entities.push(e);
    for (const r of relations) this.constraints.push(typeof r === 'function' ? r(idx) : r);
    this.resolve();
    this.changed();
    return idx;
  }

  // A rectangle is four lines held by coincident + horizontal/vertical relations (so each side can be
  // dimensioned). A center rectangle also gets construction diagonals whose midpoint is the center.
  addRectangle(first, second, centered) {
    let p0, p2;
    if (centered) { p2 = second.p; p0 = [2 * first.p[0] - p2[0], 2 * first.p[1] - p2[1]]; }
    else { p0 = first.p; p2 = second.p; }
    const p1 = [p2[0], p0[1]], p3 = [p0[0], p2[1]];
    this.pushUndo();
    const b = this.entities.length;
    const corners = [p0, p1, p2, p3];
    for (let k = 0; k < 4; k++) this.entities.push({ type: 'line', a: [...corners[k]], b: [...corners[(k + 1) % 4]] });
    const C = this.constraints;
    for (let k = 0; k < 4; k++) C.push({ type: 'coincident', p1: { e: b + k, p: 'b' }, p2: { e: b + ((k + 1) % 4), p: 'a' } });
    C.push({ type: 'horizontal', e: b }, { type: 'horizontal', e: b + 2 }, { type: 'vertical', e: b + 1 }, { type: 'vertical', e: b + 3 });
    if (centered) {
      this.entities.push({ type: 'line', a: [...p0], b: [...p2], construction: true }, { type: 'line', a: [...p1], b: [...p3], construction: true });
      C.push({ type: 'coincident', p1: { e: b + 4, p: 'a' }, p2: { e: b, p: 'a' } }, { type: 'coincident', p1: { e: b + 4, p: 'b' }, p2: { e: b + 2, p: 'a' } },
        { type: 'coincident', p1: { e: b + 5, p: 'a' }, p2: { e: b + 1, p: 'a' } }, { type: 'coincident', p1: { e: b + 5, p: 'b' }, p2: { e: b + 3, p: 'a' } });
      if (first.ref) C.push({ type: 'coincident', p1: { e: b + 4, p: 'mid' }, p2: first.ref });
      if (second.ref) C.push({ type: 'coincident', p1: { e: b + 2, p: 'a' }, p2: second.ref });
    } else {
      if (first.ref) C.push({ type: 'coincident', p1: { e: b, p: 'a' }, p2: first.ref });
      if (second.ref) C.push({ type: 'coincident', p1: { e: b + 2, p: 'a' }, p2: second.ref });
    }
    this.resolve();
    this.changed();
  }

  /** Adds a relation; returns false (and leaves the sketch unchanged) if it conflicts. */
  addConstraint(c) {
    const before = this.state();
    this.pushUndo();
    this.constraints.push(c);
    const res = this.resolve();
    if (!res.ok) {
      this.undoStack.pop();
      this.restore(before);
      this.changed();
      return false;
    }
    this.changed();
    return true;
  }

  deleteConstraint(i) {
    this.pushUndo();
    this.constraints.splice(i, 1);
    this.selConstraint = -1;
    this.changed();
  }

  deleteSelected() {
    if (this.selConstraint >= 0) { this.deleteConstraint(this.selConstraint); return true; }
    if (!this.selected.size) return false;
    this.pushUndo();
    const del = new Set(this.selected);
    this.feature.constraints = remapAfterDelete(this.constraints, del);
    this.feature.entities = this.entities.filter((_, i) => !del.has(i));
    this.clearSelection();
    this.changed();
    return true;
  }

  setConstruction(on) {
    if (!this.selected.size) return;
    this.pushUndo();
    for (const i of this.selected) if (this.entities[i].type !== 'centerline') this.entities[i].construction = on;
    this.changed();
  }

  changed() {
    this.reanalyze();
    this.redraw();
    this.app.onSketchChanged();
  }

  // -------------------------------------------------------- events

  pointerDown(ev) {
    if (ev.button !== 0) return;
    if (this.valueEditor) this.commitValueEditor();
    const raw = this.localPoint(ev.clientX, ev.clientY);
    if (this.tool === 'dimension') { this.dimensionClick(raw); return; }
    if (this.tool === 'select') {
      const h = this.hitHandle(raw);
      if (h) {
        this.drag = { ...h, start: this.state(), moved: false, ev };
        return;
      }
      const idx = this.hitEntity(raw);
      this.selConstraint = -1;
      if (idx >= 0) {
        if (ev.shiftKey || ev.ctrlKey) { if (this.selected.has(idx)) this.selected.delete(idx); else this.selected.add(idx); }
        else { this.selected.clear(); this.selPoints = []; this.selected.add(idx); }
      } else this.clearSelection();
      this.redraw();
      this.app.onSketchChanged();
      return;
    }
    const prev = this.pts[this.pts.length - 1] || null;
    const s = this.snap(raw, { from: this.tool === 'line' || this.tool === 'centerline' ? prev?.p : null });
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.click(s);
  }

  pointerUp(ev) {
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.moved) {
        this.undoStack.push(d.start);
        this.redoStack = [];
        this.changed();
      } else {
        // a click on a point selects it (for relations)
        const ref = this.hitHandle(this.localPoint(ev.clientX, ev.clientY), { keyed: true, withOrigin: true })?.ref;
        if (ref) {
          const k = JSON.stringify(ref);
          const has = this.selPoints.findIndex((r) => JSON.stringify(r) === k);
          if (!(ev.shiftKey || ev.ctrlKey)) { this.selected.clear(); this.selPoints = has >= 0 ? [] : [ref]; }
          else if (has >= 0) this.selPoints.splice(has, 1); else this.selPoints.push(ref);
          this.selConstraint = -1;
          this.redraw();
          this.app.onSketchChanged();
        }
      }
      return;
    }
    if (this.downAt && this.pts.length === 1 && ['rect', 'crect', 'circle', 'polygon', 'centerline'].includes(this.tool)) {
      if (Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y) > 8) {
        this.click(this.snap(this.localPoint(ev.clientX, ev.clientY), { from: this.pts[0].p }));
      }
    }
    this.downAt = null;
  }

  // s = { p, type, ref } from snap()
  click(s) {
    const pts = this.pts;
    const p = s.p;
    const coincident = (ref, key) => (idx) => ({ type: 'coincident', p1: { e: idx, p: key }, p2: ref });
    switch (this.tool) {
      case 'line':
      case 'centerline': {
        if (!pts.length) { this.pts = [{ p, ref: s.ref }]; this.chainStart = { p, ref: s.ref }; break; }
        const last = pts[pts.length - 1];
        if (dist(last.p, p) < 1e-6) break;
        const rel = [];
        if (last.ref) rel.push(coincident(last.ref, 'a'));
        if (s.ref) rel.push(coincident(s.ref, 'b'));
        if (s.type === 'horizontal') rel.push((i) => ({ type: 'horizontal', e: i }));
        if (s.type === 'vertical') rel.push((i) => ({ type: 'vertical', e: i }));
        const idx = this.addEntity({ type: this.tool, a: last.p, b: p }, rel);
        if (this.tool === 'centerline' || dist(p, this.chainStart.p) < 1e-6) { this.pts = []; this.previewGroup.clear(); }
        else this.pts = [{ p, ref: { e: idx, p: 'b' } }];
        break;
      }
      case 'rect':
      case 'crect': {
        if (!pts.length) { this.pts = [{ p, ref: s.ref }]; break; }
        const a = pts[0];
        if (Math.abs(a.p[0] - p[0]) < 1e-6 || Math.abs(a.p[1] - p[1]) < 1e-6) break;
        this.addRectangle(a, { p, ref: s.ref }, this.tool === 'crect');
        this.pts = [];
        this.previewGroup.clear();
        break;
      }
      case 'circle':
      case 'polygon': {
        if (!pts.length) { this.pts = [{ p, ref: s.ref }]; break; }
        const a = pts[0];
        if (dist(a.p, p) < 1e-6) break;
        const e = this.makeEntity(this.tool, a.p, p);
        if (e) this.addEntity(e, a.ref ? [coincident(a.ref, 'c')] : []);
        this.pts = [];
        this.previewGroup.clear();
        break;
      }
      case 'arc': {
        if (pts.length < 2) { if (!pts.length || dist(pts[0].p, p) > 1e-6) this.pts = [...pts, { p, ref: s.ref }]; break; }
        const e = arcFrom3(pts[0].p, pts[1].p, p);
        if (e) {
          const [p0] = arcEnds(e);
          const startKey = dist(p0, pts[0].p) < 1e-6 ? 'p0' : 'p1';
          const endKey = startKey === 'p0' ? 'p1' : 'p0';
          const rel = [];
          if (pts[0].ref) rel.push(coincident(pts[0].ref, startKey));
          if (pts[1].ref) rel.push(coincident(pts[1].ref, endKey));
          this.addEntity(e, rel);
        }
        this.pts = [];
        this.previewGroup.clear();
        break;
      }
      default: break;
    }
    this.redraw();
  }

  makeEntity(tool, a, p) {
    switch (tool) {
      case 'centerline': return { type: 'centerline', a, b: p };
      case 'rect': return { type: 'rect', a: [Math.min(a[0], p[0]), Math.min(a[1], p[1])], b: [Math.max(a[0], p[0]), Math.max(a[1], p[1])] };
      case 'crect': {
        const dx = Math.abs(p[0] - a[0]), dy = Math.abs(p[1] - a[1]);
        if (dx < 1e-6 || dy < 1e-6) return null;
        return { type: 'rect', a: [a[0] - dx, a[1] - dy], b: [a[0] + dx, a[1] + dy] };
      }
      case 'circle': return { type: 'circle', c: a, r: dist(a, p) };
      case 'polygon': return { type: 'polygon', c: a, r: dist(a, p), n: this.app.settings.polygonSides || 6, rot: Math.atan2(p[1] - a[1], p[0] - a[0]) };
      default: return null;
    }
  }

  pointerMove(ev) {
    const raw = this.localPoint(ev.clientX, ev.clientY);
    const rect = this.vp.el.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

    if (this.drag) {
      if (!this.drag.moved && Math.hypot(ev.clientX - this.drag.ev.clientX, ev.clientY - this.drag.ev.clientY) < 3) return;
      this.dragTo(raw);
      this.app.setCoords(raw);
      return;
    }
    if (this.labelDrag) {
      const c = this.constraints[this.labelDrag.index];
      if (c) { c.pos = raw; this.redrawDimensions(); }
      return;
    }

    const prev = this.pts[this.pts.length - 1] || null;
    const s = this.tool === 'select' || this.tool === 'dimension' ? { p: raw, type: null } : this.snap(raw, { from: this.tool === 'line' || this.tool === 'centerline' ? prev?.p : null });
    const p = s.p;
    this.app.setCoords(p);

    const mg = new THREE.BufferGeometry();
    if (s.type && s.type !== 'grid' && s.type !== 'horizontal' && s.type !== 'vertical') mg.setAttribute('position', new THREE.Float32BufferAttribute([p[0], p[1], 0], 3));
    this.marker.geometry.dispose();
    this.marker.geometry = mg;

    if (this.tool === 'select' || this.tool === 'dimension') {
      const handle = this.hitHandle(raw, { keyed: this.tool === 'dimension', withOrigin: this.tool === 'dimension', skipMid: this.tool === 'dimension' });
      const idx = handle ? -1 : this.hitEntity(raw);
      if (idx !== this.hoverIdx) { this.hoverIdx = idx; this.redraw(); }
      this.vp.el.style.cursor = handle ? (this.tool === 'select' ? 'move' : 'pointer') : idx >= 0 ? 'pointer' : this.tool === 'dimension' ? 'crosshair' : 'default';
      if (this.tool === 'dimension') this.updateDimensionPreview(raw, sx, sy);
      else this.app.cursorLabel(null);
      return;
    }
    this.vp.el.style.cursor = 'crosshair';
    this.updatePreview(p, s.type, sx, sy);
  }

  // Moves a handle to `target`, keeping all relations satisfied where possible.
  dragTo(target) {
    const d = this.drag;
    const before = this.state();
    const e = this.entities[d.idx];
    setHandle(e, d.handle, target);
    if (!this.activeConstraints().length) { d.moved = true; this.redraw(); return; }
    const ref = d.ref;
    const fixedR = d.handle === 'r' ? e.r : null;
    const extra = (V) => {
      if (fixedR != null) return [V.radius(d.idx) - fixedR];
      if (!ref) return [];
      const q = V.point(ref);
      return [q[0] - target[0], q[1] - target[1]];
    };
    let res = this.resolve({ extra, maxIter: 25 });
    if (!res.ok) {
      // the drag target is not reachable: move as close as the relations allow
      this.restore(clone(before));
      setHandle(this.entities[d.idx], d.handle, target);
      res = this.resolve({ maxIter: 25 });
      // nothing could move (e.g. fully defined): keep the exact previous values, without solver round-off
      if (!res.ok || maxParamChange(before.entities, this.entities) < 1e-7) this.restore(before);
    }
    d.moved = true;
    this.redraw();
    this.app.onSketchChanged(true);
  }

  updatePreview(p, snapType, sx, sy) {
    this.previewGroup.clear();
    const pts = this.pts.map((q) => q.p);
    let label = '';
    let ents = [];
    if (pts.length) {
      const a = pts[0];
      switch (this.tool) {
        case 'line':
        case 'centerline': {
          const last = pts[pts.length - 1];
          ents = [{ type: this.tool, a: last, b: p }];
          const ang = (Math.atan2(p[1] - last[1], p[0] - last[0]) * 180) / Math.PI;
          label = `L: ${units.fmt(dist(last, p))}  A: ${Math.round((((ang % 360) + 360) % 360) * 10) / 10}°`;
          break;
        }
        case 'rect':
        case 'crect': {
          const e = this.makeEntity(this.tool, a, p);
          if (e) { ents = [e]; label = `${units.fmt(e.b[0] - e.a[0], false)} × ${units.fmt(e.b[1] - e.a[1])}`; }
          break;
        }
        case 'circle':
        case 'polygon':
          ents = [this.makeEntity(this.tool, a, p)];
          label = `R: ${units.fmt(dist(a, p))}`;
          break;
        case 'arc':
          if (pts.length === 1) { ents = [{ type: 'line', a, b: p }]; label = `L: ${units.fmt(dist(a, p))}`; }
          else {
            const e = arcFrom3(pts[0], pts[1], p);
            if (e) { ents = [e]; label = `R: ${units.fmt(e.r)}`; }
          }
          break;
        default: break;
      }
    }
    if (ents.length) this.previewGroup.add(buildSketchObject(ents, this.mats, { styleOf: () => 'preview' }));
    if (snapType === 'horizontal') label += '  ⟷ H';
    if (snapType === 'vertical') label += '  ↕ V';
    if (!label) label = `${units.fmt(p[0], false)}, ${units.fmt(p[1])}`;
    this.app.cursorLabel(label, sx, sy);
  }

  // -------------------------------------------------------- smart dimension

  dimensionCandidate(picks, cursor) {
    const E = this.entities;
    const ptOf = (pk) => (pk.kind === 'point' ? pk.ref : isRound(E[pk.i]) ? { e: pk.i, p: 'c' } : null);
    if (picks.length === 1) {
      const pk = picks[0];
      if (pk.kind !== 'entity') return null;
      const e = E[pk.i];
      if (isLine(e)) return { type: 'length', e: pk.i };
      if (e.type === 'circle') return { type: 'diameter', e: pk.i };
      if (e.type === 'arc' || e.type === 'polygon') return { type: 'radius', e: pk.i };
      return null;
    }
    if (picks.length !== 2) return null;
    const [A, B] = picks;
    const eA = A.kind === 'entity' ? E[A.i] : null, eB = B.kind === 'entity' ? E[B.i] : null;
    if (isLine(eA) && isLine(eB)) {
      const d1 = sub(eA.b, eA.a), d2 = sub(eB.b, eB.a);
      const cr = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / (Math.hypot(...d1) * Math.hypot(...d2));
      if (cr < 1e-6) return { type: 'pointLine', p: { e: B.i, p: 'a' }, e: A.i };
      return { type: 'angle', e1: A.i, e2: B.i };
    }
    if (isLine(eA) && !isLine(eB)) { const p = ptOf(B); return p ? { type: 'pointLine', p, e: A.i } : null; }
    if (isLine(eB) && !isLine(eA)) { const p = ptOf(A); return p ? { type: 'pointLine', p, e: B.i } : null; }
    const p1 = ptOf(A), p2 = ptOf(B);
    if (!p1 || !p2) return null;
    const a = refPoint(E, p1), b = refPoint(E, p2);
    // cursor between the points horizontally -> horizontal dimension, vertically -> vertical
    let mode = null;
    const inX = cursor[0] > Math.min(a[0], b[0]) && cursor[0] < Math.max(a[0], b[0]);
    const inY = cursor[1] > Math.min(a[1], b[1]) && cursor[1] < Math.max(a[1], b[1]);
    if (inX && !inY) mode = 'h';
    else if (inY && !inX) mode = 'v';
    return { type: 'distance', p1, p2, mode };
  }

  dimensionClick(raw) {
    const h = this.hitHandle(raw, { keyed: true, withOrigin: true, skipMid: true });
    const idx = h ? -1 : this.hitEntity(raw);
    const hitPick = h ? { kind: 'point', ref: h.ref } : idx >= 0 ? { kind: 'entity', i: idx } : null;
    if (hitPick) {
      if (this.dimPicks.length >= 2) this.dimPicks = [];
      this.dimPicks.push(hitPick);
      this.redraw();
      return;
    }
    const cand = this.dimensionCandidate(this.dimPicks, raw);
    if (!cand) { this.dimPicks = []; this.redraw(); return; }
    cand.pos = raw;
    cand.value = Math.abs(measure(cand, this.entities));
    this.dimPicks = [];
    this.previewGroup.clear();
    this.app.cursorLabel(null);
    // a dimension that would over-define the sketch becomes a driven (reference) dimension
    const before = analyze(this.entities, this.activeConstraints());
    const after = analyze(this.entities, [...this.activeConstraints(), cand]);
    if (after.redundant > before.redundant) {
      cand.driven = true;
      this.app.toast('That dimension would over-define the sketch — added as a driven (reference) dimension');
    }
    this.pushUndo();
    this.constraints.push(cand);
    this.changed();
    if (!cand.driven) this.editDimension(this.constraints.length - 1);
  }

  updateDimensionPreview(raw, sx, sy) {
    this.previewGroup.clear();
    const cand = this.dimensionCandidate(this.dimPicks, raw);
    if (!cand) {
      this.app.cursorLabel(this.dimPicks.length ? 'Select a second entity, or click to place' : 'Select an entity to dimension', sx, sy);
      return;
    }
    cand.pos = raw;
    cand.value = Math.abs(measure(cand, this.entities));
    this.previewGroup.add(this.dimensionObject(cand, 'dimSel'));
    this.app.cursorLabel(`${dimensionText(cand)} — click to place`, sx, sy);
  }

  dimensionObject(c, matKey) {
    const { segs } = dimensionGraphics(c, this.entities, this.vp.worldPerPixel());
    const g = new LineSegmentsGeometry();
    g.setPositions(segs.flatMap(([a, b]) => [a[0], a[1], 0, b[0], b[1], 0]));
    const obj = new LineSegments2(g, this.mats[matKey]);
    obj.renderOrder = 14;
    return obj;
  }

  // Inline "Modify" box for a dimension value.
  editDimension(index) {
    const c = this.constraints[index];
    if (!c || c.driven) return;
    this.closeValueEditor();
    const anchor = dimensionGraphics(c, this.entities, this.vp.worldPerPixel()).anchor;
    const s = this.toScreen(anchor);
    const wrap = document.createElement('div');
    wrap.className = 'dim-editor';
    const input = document.createElement('input');
    input.value = c.type === 'angle' ? Math.round(c.value * 1e4) / 1e4 : units.toDisplay(c.value);
    const ok = document.createElement('button');
    ok.textContent = '✓';
    wrap.append(input, ok);
    wrap.style.left = `${s.x}px`;
    wrap.style.top = `${s.y}px`;
    this.vp.el.append(wrap);
    this.valueEditor = { wrap, input, index };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.commitValueEditor();
      if (e.key === 'Escape') this.closeValueEditor();
    });
    ok.addEventListener('click', () => this.commitValueEditor());
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  commitValueEditor() {
    const ed = this.valueEditor;
    if (!ed) return;
    const c = this.constraints[ed.index];
    const v = this.app.evalNumber(ed.input.value);
    this.closeValueEditor();
    if (!c || Number.isNaN(v) || v <= 0) return;
    const value = c.type === 'angle' ? v : units.fromDisplay(v);
    if (Math.abs(value - c.value) < 1e-12) return;
    const before = this.state();
    this.pushUndo();
    c.value = value;
    if (!this.resolve().ok) {
      this.undoStack.pop();
      this.restore(before);
      this.app.toast('That value conflicts with other dimensions or relations', 'error');
    }
    this.changed();
  }

  closeValueEditor() {
    if (this.valueEditor) { this.valueEditor.wrap.remove(); this.valueEditor = null; }
  }

  // -------------------------------------------------------- relations (from the PropertyManager)

  applicableRelations() {
    const E = this.entities;
    const ents = [...this.selected].map((i) => ({ i, e: E[i] }));
    const pts = this.selPoints;
    const out = [];
    const L = ents.filter((x) => isLine(x.e)), R = ents.filter((x) => isRound(x.e));
    if (!pts.length) {
      if (ents.length === 1 && L.length === 1) out.push({ type: 'horizontal', e: L[0].i }, { type: 'vertical', e: L[0].i });
      if (ents.length >= 2 && L.length === ents.length) {
        const ps = L.slice(1).map((x) => ({ e1: L[0].i, e2: x.i }));
        out.push({ multi: ps.map((p) => ({ type: 'parallel', ...p })), type: 'parallel' },
          { multi: ps.map((p) => ({ type: 'perpendicular', ...p })), type: 'perpendicular' },
          { multi: ps.map((p) => ({ type: 'equal', ...p })), type: 'equal' },
          { multi: L.map((x) => ({ type: 'horizontal', e: x.i })), type: 'horizontal' },
          { multi: L.map((x) => ({ type: 'vertical', e: x.i })), type: 'vertical' });
      }
      if (ents.length >= 2 && R.length === ents.length) {
        const ps = R.slice(1).map((x) => ({ e1: R[0].i, e2: x.i }));
        out.push({ multi: ps.map((p) => ({ type: 'equal', ...p })), type: 'equal' },
          { multi: ps.map((p) => ({ type: 'concentric', ...p })), type: 'concentric' });
        if (ents.length === 2) {
          const [a, b] = R.map((x) => x.e);
          const dc = dist(a.c, b.c);
          out.push({ type: 'tangent', e1: R[0].i, e2: R[1].i, inner: Math.abs(dc - Math.abs(a.r - b.r)) < Math.abs(dc - (a.r + b.r)) });
        }
      }
      if (ents.length === 2 && L.length === 1 && R.length === 1) out.push({ type: 'tangent', e1: L[0].i, e2: R[0].i });
    }
    if (pts.length === 2 && !ents.length) {
      out.push({ type: 'coincident', p1: pts[0], p2: pts[1] }, { type: 'horizontal', p1: pts[0], p2: pts[1] }, { type: 'vertical', p1: pts[0], p2: pts[1] });
    }
    if (pts.length === 1 && ents.length === 1) {
      if (L.length) out.push({ type: 'onLine', p: pts[0], e: L[0].i }, { type: 'midpoint', p: pts[0], e: L[0].i });
      if (R.length) out.push({ type: 'onCircle', p: pts[0], e: R[0].i });
    }
    if (pts.length >= 1 && !ents.length) {
      out.push({ multi: pts.filter((r) => r.e >= 0).map((r) => ({ type: 'fix', p: r, at: refPoint(E, r) })), type: 'fix' });
    }
    if (!pts.length && ents.length >= 1) {
      const fixes = [];
      for (const { i, e } of ents) {
        for (const h of entityHandles(e)) if (h.key && h.type !== 'midpoint' && !(e.type === 'polygon' && h.key !== 'c' && h.key !== 'v0')) fixes.push({ type: 'fix', p: { e: i, p: h.key }, at: [...h.p] });
        if (e.type === 'circle') fixes.push({ type: 'radius', e: i, value: e.r, pos: [e.c[0] + e.r, e.c[1] + e.r], hidden: true });
      }
      if (ents.length !== L.length || ents.length === 1) out.push({ multi: fixes, type: 'fix' });
    }
    return out.filter((r) => !r.multi || r.multi.length);
  }

  applyRelation(rel) {
    const list = rel.multi || [rel];
    const before = this.state();
    this.pushUndo();
    for (const c of list) this.constraints.push(c);
    if (!this.resolve().ok) {
      this.undoStack.pop();
      this.restore(before);
      this.changed();
      return false;
    }
    this.changed();
    return true;
  }

  constraintsOfSelection() {
    const out = [];
    this.constraints.forEach((c, i) => {
      const ents = constraintEntities(c);
      if (ents.some((e) => this.selected.has(e)) || this.selPoints.some((r) => [c.p, c.p1, c.p2].some((q) => q && q.e === r.e && q.p === r.p))) out.push(i);
    });
    return out;
  }

  // -------------------------------------------------------- misc events

  finishChain() {
    if (this.pts.length || this.dimPicks.length) {
      this.pts = [];
      this.dimPicks = [];
      this.previewGroup.clear();
      this.app.cursorLabel(null);
      this.redraw();
      return true;
    }
    return false;
  }

  dblclick() { if (this.tool === 'line') this.finishChain(); }

  contextMenu() { return this.finishChain(); }

  keyDown(ev) {
    const k = ev.key.toLowerCase();
    if (ev.key === 'Escape') {
      if (this.valueEditor) { this.closeValueEditor(); return true; }
      if (this.finishChain()) return true;
      if (this.tool !== 'select') { this.setTool('select'); return true; }
      if (this.selected.size || this.selPoints.length || this.selConstraint >= 0) { this.clearSelection(); this.changed(); return true; }
      return false;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') return this.deleteSelected();
    if (ev.ctrlKey && k === 'z') { this.undo(); return true; }
    if (ev.ctrlKey && k === 'y') { this.redo(); return true; }
    if (!ev.ctrlKey && !ev.altKey) {
      for (const [id, t] of Object.entries(SKETCH_TOOLS)) if (t.key === k && id !== 'select') { this.setTool(id); return true; }
    }
    return false;
  }

  // -------------------------------------------------------- drawing

  styleOf(i) {
    if (this.selected.has(i)) return 'selected';
    if (i === this.hoverIdx) return 'hover';
    if (this.dimPicks.some((p) => p.kind === 'entity' && p.i === i)) return 'selected';
    if (this.analysis?.status === 'over') return 'over';
    return this.analysis?.defined.has(i) ? 'defined' : 'normal';
  }

  redraw() {
    this.content.clear();
    this.content.add(buildSketchObject(this.entities, this.mats, { points: true, styleOf: (e, i) => this.styleOf(i) }));
    const sel = [...this.selPoints, ...this.dimPicks.filter((p) => p.kind === 'point').map((p) => p.ref)].map((r) => refPoint(this.entities, r));
    const chain = this.pts.map((q) => q.p);
    for (const [list, mat] of [[chain, this.mats.points], [sel, this.mats.selPoints]]) {
      if (!list.length) continue;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((p) => [p[0], p[1], 0]), 3));
      const pp = new THREE.Points(pg, mat);
      pp.renderOrder = 14;
      this.content.add(pp);
    }
    this.redrawDimensions();
  }

  redrawDimensions() {
    this.dimGroup.clear();
    this.constraints.forEach((c, i) => {
      if (!DIMENSION_TYPES.has(c.type) || c.hidden) return;
      this.dimGroup.add(this.dimensionObject(c, i === this.selConstraint ? 'dimSel' : c.driven ? 'dimDriven' : 'dim'));
    });
    this.buildLabels();
  }

  clearLabels() {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  buildLabels() {
    this.clearLabels();
    const overlay = document.getElementById('vp-overlay');
    if (!overlay) return;
    const wpp = this.vp.worldPerPixel();
    this.constraints.forEach((c, i) => {
      if (c.hidden) return;
      const el = document.createElement('div');
      if (DIMENSION_TYPES.has(c.type)) {
        el.className = `dim-label${i === this.selConstraint ? ' sel' : ''}${c.driven ? ' driven' : ''}`;
        el.textContent = c.driven ? `(${dimensionText(c)})` : dimensionText(c);
        el.title = c.driven ? 'Driven (reference) dimension' : 'Double-click to change the value. Drag to move.';
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.selConstraint = i;
          this.selected.clear();
          this.selPoints = [];
          this.labelDrag = { index: i, start: this.state() };
          const up = () => {
            window.removeEventListener('pointerup', up);
            this.labelDrag = null;
            this.redraw();
            this.app.onSketchChanged();
          };
          window.addEventListener('pointerup', up);
          const move = (ev) => { if (!this.labelDrag) { window.removeEventListener('pointermove', move); return; } this.pointerMove(ev); };
          window.addEventListener('pointermove', move);
        });
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); this.editDimension(i); });
        this.labels.push({ el, at: () => dimensionGraphics(c, this.entities, this.vp.worldPerPixel()).anchor });
      } else {
        const glyph = RELATION_GLYPHS[c.type];
        if (!glyph || c.type === 'coincident') return;
        el.className = `rel-glyph${i === this.selConstraint ? ' sel' : ''}`;
        el.textContent = glyph;
        el.title = `${c.type} relation — click to select, Delete to remove`;
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.selConstraint = i; this.selected.clear(); this.selPoints = [];
          this.redraw();
          this.app.onSketchChanged();
        });
        const anchorOf = () => {
          const ent = this.entities[c.e ?? c.e1 ?? c.p?.e ?? c.p1?.e];
          if (!ent) return [0, 0];
          let p = ent.type === 'line' || ent.type === 'centerline' ? mid(ent.a, ent.b) : ent.c ? [ent.c[0] + ent.r * 0.7, ent.c[1] + ent.r * 0.7] : refPoint(this.entities, c.p || c.p1);
          if (c.p) p = refPoint(this.entities, c.p);
          // spread glyphs on the same entity
          const k = this.constraints.slice(0, i).filter((o) => (o.e ?? o.e1) === (c.e ?? c.e1) && !DIMENSION_TYPES.has(o.type)).length;
          return [p[0] + wpp * (10 + k * 16), p[1] + wpp * 10];
        };
        this.labels.push({ el, at: anchorOf });
      }
      overlay.append(el);
    });
    this.positionLabels();
  }

  positionLabels() {
    for (const l of this.labels) {
      const s = this.toScreen(l.at());
      l.el.style.left = `${s.x}px`;
      l.el.style.top = `${s.y}px`;
    }
  }

  updateGrid() {
    const s = this.app.settings;
    if (!s.showGrid) { this.gridGroup.clear(); this.gridSig = 'off'; return; }
    const wpp = this.vp.worldPerPixel();
    let step = s.gridStep;
    while (step / wpp < 8) step *= 5;
    while (step / wpp > 80) step /= 5;
    const t = this.vp.controls.target.clone().applyMatrix4(this.inverse);
    const half = (this.vp.el.clientWidth + this.vp.el.clientHeight) * wpp * 0.8;
    const cx = Math.round(t.x / (step * 5)) * step * 5, cy = Math.round(t.y / (step * 5)) * step * 5;
    const sig = `${step.toFixed(6)}|${cx}|${cy}|${Math.round(half / step)}`;
    if (sig === this.gridSig) return;
    this.gridSig = sig;
    this.gridGroup.clear();
    // dimension arrow sizes depend on zoom
    if (this.constraints?.some((c) => DIMENSION_TYPES.has(c.type))) this.redrawDimensions();
    const n = Math.ceil(half / step);
    const minor = [], major = [];
    for (let i = -n; i <= n; i++) {
      const x = cx + i * step, y = cy + i * step;
      const isMajor = Math.round(cx / step + i) % 5 === 0;
      const isMajorY = Math.round(cy / step + i) % 5 === 0;
      (isMajor ? major : minor).push(x, cy - n * step, 0, x, cy + n * step, 0);
      (isMajorY ? major : minor).push(cx - n * step, y, 0, cx + n * step, y, 0);
    }
    const mk = (arr, color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
      l.renderOrder = 1;
      return l;
    };
    this.gridGroup.add(mk(minor, 0x8fa3bf, 0.22), mk(major, 0x6f87aa, 0.4));
    const ax = new THREE.BufferGeometry();
    ax.setAttribute('position', new THREE.Float32BufferAttribute([-n * step + cx, 0, 0, n * step + cx, 0, 0, 0, -n * step + cy, 0, 0, n * step + cy, 0], 3));
    const axl = new THREE.LineSegments(ax, new THREE.LineBasicMaterial({ color: 0xd8392b, transparent: true, opacity: 0.35, depthTest: false }));
    axl.renderOrder = 1;
    this.gridGroup.add(axl);
  }
}
