// OpenCascade (replicad) part kernel: rebuilds the feature history into an exact B-rep solid
// and serializes it into render/pick data. Runs in a Web Worker in the app and in Node for tests.
import { draw, drawCircle, Plane, getOC, measureShapeVolumeProperties, measureArea, EdgeFinder, FaceFinder } from 'replicad';
import { computeFrames, sketchRegions, frameToWorld, planeFeatureFrame, resolvePlane, STD_PLANES } from '../geometry.js';

const AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const tup = (v) => [v.x, v.y, v.z];
const REF_TOL = 0.02; // mm: how far a stored edge/face reference point may drift

// ---------------------------------------------------------------- sketch -> solid

function loopDrawing(loop) {
  if (loop.circle) return drawCircle(loop.circle.r).translate(loop.circle.c[0], loop.circle.c[1]);
  let pen = draw(loop.segs[0].a);
  for (const s of loop.segs) pen = s.kind === 'line' ? pen.lineTo(s.b) : pen.threePointsArcTo(s.b, s.m);
  return pen.close();
}

const occPlane = (frame, z = 0) => new Plane(add(frame.origin, frame.normal, z), frame.xDir, frame.normal);

// Builds one solid per region (outer minus holes) using `make(drawing) -> Shape3D`.
function regionSolids(entities, make) {
  const regions = sketchRegions(entities);
  let result = null;
  for (const r of regions) {
    let solid;
    try {
      let d = loopDrawing(r.outer);
      for (const h of r.holes) d = d.cut(loopDrawing(h));
      solid = make(d);
    } catch {
      // 2D boolean failed: fall back to 3D booleans of the individual loops
      solid = make(loopDrawing(r.outer));
      for (const h of r.holes) solid = solid.cut(make(loopDrawing(h)));
    }
    result = result ? result.fuse(solid) : solid;
  }
  return result;
}

function bodyDiagonal(body) {
  const bb = body.boundingBox;
  return { size: Math.hypot(bb.width, bb.height, bb.depth), center: bb.center };
}

// ---------------------------------------------------------------- rebuild

// Incremental cache: the state after each feature, keyed by a hash of the history up to it.
const cache = new Map();
const CACHE_MAX = 80;

function hashStr(s, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function clearCache() { cache.clear(); }

export function rebuildPart(doc, limit = null) {
  const end = limit ?? doc.features.length;
  const { planes, frames } = computeFrames(doc, end);
  const errors = {}, times = {};
  const byId = Object.fromEntries(doc.features.map((f) => [f.id, f]));
  let body = null;
  let tools = {};
  let key = 'root';

  for (let i = 0; i < end; i++) {
    const f = doc.features[i];
    key = hashStr(`${key}|${JSON.stringify(f)}`);
    const hit = cache.get(key);
    if (hit) {
      body = hit.body; tools = hit.tools;
      if (hit.error) errors[f.id] = hit.error;
      times[f.id] = 0;
      cache.delete(key); cache.set(key, hit); // LRU touch
      continue;
    }
    const t0 = performance.now();
    let error = null;
    if (!f.suppressed) {
      try {
        const res = applyFeature(f, { body, tools, planes, frames, byId });
        if (res) { body = res.body; tools = { ...tools, ...(res.tools ? { [f.id]: res.tools } : {}) }; }
      } catch (e) {
        error = e?.message || String(e);
        if (/^\d+$/.test(error)) error = 'The geometry kernel could not build this feature';
        errors[f.id] = error;
      }
    }
    times[f.id] = performance.now() - t0;
    cache.set(key, { body, tools, error });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return { shape: body, planes, frames, errors, times };
}

function applyOp(body, tool, cut) {
  if (!body) {
    if (cut) throw new Error('Nothing to cut — create a boss/base first');
    return tool;
  }
  return cut ? body.cut(tool) : body.fuse(tool);
}

function applyFeature(f, ctx) {
  const { byId, frames, planes } = ctx;
  const sketchOf = () => {
    const s = byId[f.sketch];
    if (!s) throw new Error('Profile sketch is missing');
    if (s.suppressed) throw new Error('Profile sketch is suppressed');
    if (!frames[s.id]) throw new Error('Profile sketch has errors');
    return s;
  };
  const needBody = (what) => { if (!ctx.body) throw new Error(`There is no body to ${what}`); };

  switch (f.type) {
    case 'plane':
    case 'sketch':
      return null;

    case 'extrude': {
      const s = sketchOf();
      const frame = frames[s.id];
      let depth = Math.max(f.depth, 1e-3), z0;
      const through = () => {
        if (!ctx.body) return 1000;
        const { size, center } = bodyDiagonal(ctx.body);
        return size + 2 * Math.hypot(center[0] - frame.origin[0], center[1] - frame.origin[1], center[2] - frame.origin[2]) + 10;
      };
      switch (f.endCondition) {
        case 'midplane': z0 = -depth / 2; break;
        case 'throughAll': depth = through(); z0 = f.reverse ? -depth : 0; break;
        case 'throughAllBoth': depth = through(); z0 = -depth; depth *= 2; break;
        default: z0 = f.reverse ? -depth : 0;
      }
      const tool = regionSolids(s.entities, (d) => d.sketchOnPlane(occPlane(frame, z0)).extrude(depth));
      return { body: applyOp(ctx.body, tool, f.cut), tools: [{ shape: tool, cut: !!f.cut }] };
    }

    case 'revolve': {
      const s = sketchOf();
      const frame = frames[s.id];
      let p, d;
      if (f.axis === 'x') { p = [0, 0]; d = [1, 0]; }
      else if (f.axis === 'y') { p = [0, 0]; d = [0, 1]; }
      else {
        const cl = s.entities[Number(String(f.axis).split(':')[1])];
        if (!cl || cl.type !== 'centerline') throw new Error('Axis of revolution is missing');
        p = cl.a;
        d = [cl.b[0] - cl.a[0], cl.b[1] - cl.a[1]];
        if (Math.hypot(...d) < 1e-9) throw new Error('Axis of revolution has zero length');
      }
      if (f.reverse) d = [-d[0], -d[1]];
      const origin = frameToWorld(frame, p);
      const dirEnd = frameToWorld(frame, [p[0] + d[0], p[1] + d[1]]);
      const axis = [dirEnd[0] - origin[0], dirEnd[1] - origin[1], dirEnd[2] - origin[2]];
      const angle = Math.min(Math.max(f.angle, 0.1), 360);
      const tool = regionSolids(s.entities, (dr) => dr.sketchOnPlane(occPlane(frame)).revolve(axis, { origin, angle }));
      return { body: applyOp(ctx.body, tool, f.cut), tools: [{ shape: tool, cut: !!f.cut }] };
    }

    case 'fillet':
    case 'chamfer': {
      needBody(f.type);
      if (!f.edges?.length) throw new Error('Select one or more edges');
      const size = f.type === 'fillet' ? f.radius : f.distance;
      if (!(size > 0)) throw new Error('Size must be greater than zero');
      const pick = (e) => e.either(f.edges.map((p) => (q) => q.near(p, REF_TOL)));
      const found = pick(new EdgeFinder()).find(ctx.body).length;
      if (found < f.edges.length) throw new Error(`${f.edges.length - found} selected edge(s) no longer exist — edit the feature and reselect`);
      const out = f.type === 'fillet' ? ctx.body.fillet(size, pick) : ctx.body.chamfer(size, pick);
      if (!out || !out.faces?.length) throw new Error(`${f.type === 'fillet' ? 'Fillet' : 'Chamfer'} failed — try a smaller size`);
      return { body: out };
    }

    case 'shell': {
      needBody('shell');
      if (!(f.thickness > 0)) throw new Error('Thickness must be greater than zero');
      if (!f.faces?.length) throw new Error('Select the face(s) to remove');
      const pick = (ff) => ff.either(f.faces.map((p) => (q) => q.near(p, REF_TOL)));
      const found = pick(new FaceFinder()).find(ctx.body).length;
      if (found < f.faces.length) throw new Error(`${f.faces.length - found} selected face(s) no longer exist — edit the feature and reselect`);
      const out = ctx.body.shell(f.thickness, pick);
      if (!out || !out.faces?.length) throw new Error('Shell failed — try a smaller thickness');
      return { body: out };
    }

    case 'linpattern':
    case 'cirpattern':
    case 'mirror': {
      const sources = f.targets?.length
        ? f.targets.flatMap((id) => ctx.tools[id] || [])
        : f.type === 'mirror' && ctx.body ? [{ shape: ctx.body, cut: false }] : [];
      if (!sources.length) throw new Error(f.type === 'mirror' ? 'Nothing to mirror' : 'Select features to pattern');
      const transforms = [];
      if (f.type === 'linpattern') {
        const dir = AXES[f.direction] || AXES.X;
        const sgn = f.reverse ? -1 : 1;
        for (let k = 1; k < f.count; k++) transforms.push((sh) => sh.clone().translate(dir.map((c) => c * f.spacing * k * sgn)));
      } else if (f.type === 'cirpattern') {
        const axis = AXES[f.axis] || AXES.Y;
        const step = f.equal ? 360 / f.count : f.angle;
        for (let k = 1; k < f.count; k++) transforms.push((sh) => sh.clone().rotate(step * k * (f.reverse ? -1 : 1), [0, 0, 0], axis));
      } else {
        const pl = resolvePlane(f.plane, null, planes);
        transforms.push((sh) => sh.clone().mirror(pl.normal, pl.origin));
      }
      let body = ctx.body;
      const out = [];
      for (const tf of transforms) for (const src of sources) {
        const shape = tf(src.shape);
        out.push({ shape, cut: src.cut });
        body = applyOp(body, shape, src.cut);
      }
      return { body, tools: out };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------- serialization

export function serializeShape(shape, { tolerance = 0.01, angularTolerance = 0.12 } = {}) {
  const oc = getOC();
  const m = shape.mesh({ tolerance, angularTolerance });
  const faces = shape.faces;
  const faceRanges = new Int32Array(m.faceGroups.length * 2);
  const faceInfo = faces.map((face, i) => {
    const g = m.faceGroups[i];
    faceRanges[i * 2] = g.start;
    faceRanges[i * 2 + 1] = g.count;
    const info = { type: face.geomType, center: tup(face.center) };
    try { info.area = measureArea(face); } catch { info.area = 0; }
    if (info.type === 'PLANE') {
      info.normal = tup(face.normalAt(face.center));
    } else if (info.type === 'CYLINDRE') {
      const ad = new oc.BRepAdaptor_Surface(face.wrapped, false);
      const cyl = ad.Cylinder();
      const ax = cyl.Axis();
      const l = ax.Location(), d = ax.Direction();
      info.axisOrigin = [l.X(), l.Y(), l.Z()];
      info.axis = [d.X(), d.Y(), d.Z()];
      info.radius = cyl.Radius();
      ad.delete();
    }
    return info;
  });

  const em = shape.meshEdges({ tolerance, angularTolerance });
  const edges = shape.edges;
  const edgeRanges = new Int32Array(em.edgeGroups.length * 2);
  const edgeInfo = edges.map((edge, i) => {
    const g = em.edgeGroups[i];
    edgeRanges[i * 2] = g.start;
    edgeRanges[i * 2 + 1] = g.count;
    const info = { type: edge.geomType, a: tup(edge.startPoint), b: tup(edge.endPoint), mid: tup(edge.pointAt(0.5)), length: edge.length };
    if (info.type === 'CIRCLE') {
      const ad = new oc.BRepAdaptor_Curve(edge.wrapped);
      const c = ad.Circle();
      const ax = c.Axis();
      const l = c.Location(), d = ax.Direction();
      info.center = [l.X(), l.Y(), l.Z()];
      info.axis = [d.X(), d.Y(), d.Z()];
      info.radius = c.Radius();
      ad.delete();
    }
    return info;
  });

  const props = measureShapeVolumeProperties(shape);
  let area = 0;
  for (const f of faceInfo) area += f.area;
  const bb = shape.boundingBox;
  const [min, max] = bb.bounds;
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
    faceRanges,
    faces: faceInfo,
    edgeLines: new Float32Array(em.lines),
    edgeRanges,
    edges: edgeInfo,
    mass: { volume: Math.abs(props.volume), area, centroid: props.centerOfMass },
    bbox: { min: [...min], max: [...max] },
  };
}

export function exportShape(shape, format) {
  if (format === 'step') return shape.blobSTEP();
  if (format === 'stl') return shape.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 });
  throw new Error(`Unknown export format ${format}`);
}

export { STD_PLANES, planeFeatureFrame };
