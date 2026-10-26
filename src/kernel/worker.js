// Web Worker hosting the OpenCascade kernel.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC, makeCompound, measureShapeVolumeProperties } from 'replicad';
import { rebuildPart, serializeShape, exportShape } from './part.js';

const ready = opencascade({ locateFile: () => wasmUrl }).then((oc) => { setOC(oc); });

// Serialized meshes of whole parts (used by assemblies), keyed by document JSON.
const partMeshes = new Map();

// { doc, limit?, pose?: { position, axis, angle(deg) } } -> solid placed in the assembly
function placedShape(d) {
  const r = rebuildPart(d.doc, d.limit ?? null);
  if (!r.shape) return null;
  let s = r.shape.clone();
  if (d.pose) {
    if (d.pose.angle) s = s.rotate(d.pose.angle, [0, 0, 0], d.pose.axis);
    s = s.translate(d.pose.position);
  }
  return s;
}

function transferables(data) {
  if (!data) return [];
  return [data.vertices, data.normals, data.indices, data.faceRanges, data.edgeLines, data.edgeRanges].map((a) => a.buffer);
}

async function handle(op, p) {
  await ready;
  switch (op) {
    case 'ping':
      return 'ok';
    case 'rebuild': {
      const r = rebuildPart(p.doc, p.limit);
      const data = r.shape ? serializeShape(r.shape) : null;
      return { result: { data, planes: r.planes, frames: r.frames, errors: r.errors, times: r.times }, transfer: transferables(data) };
    }
    case 'partMesh': {
      const key = JSON.stringify(p.doc.features);
      let entry = partMeshes.get(key);
      if (!entry) {
        const r = rebuildPart(p.doc, null);
        entry = { data: r.shape ? serializeShape(r.shape) : null, errors: r.errors };
        partMeshes.set(key, entry);
        if (partMeshes.size > 40) partMeshes.delete(partMeshes.keys().next().value);
      }
      // copies, since buffers are transferred
      const data = entry.data && Object.fromEntries(Object.entries(entry.data).map(([k, v]) => [k, ArrayBuffer.isView(v) ? v.slice() : v]));
      return { result: { data, errors: entry.errors }, transfer: transferables(data) };
    }
    case 'interference': {
      const shapes = p.docs.map((d) => placedShape(d));
      const out = [];
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          if (!shapes[i] || !shapes[j]) continue;
          const a = shapes[i].boundingBox, b = shapes[j].boundingBox;
          const [amin, amax] = a.bounds, [bmin, bmax] = b.bounds;
          if ([0, 1, 2].some((k) => amax[k] < bmin[k] || bmax[k] < amin[k])) continue;
          try {
            const common = shapes[i].intersect(shapes[j]);
            const v = Math.abs(measureShapeVolumeProperties(common).volume);
            if (v > 1e-6) out.push({ i, j, volume: v });
          } catch { /* no overlap */ }
        }
      }
      return { result: out };
    }
    case 'export': {
      // each entry: { doc, limit?, pose?: { position, axis, angle(deg) } } — poses place assembly components
      const shapes = p.docs.map((d) => placedShape(d)).filter(Boolean);
      if (!shapes.length) throw new Error('There is no solid body to export');
      const shape = shapes.length > 1 ? makeCompound(shapes) : shapes[0];
      const blob = exportShape(shape, p.format);
      const buf = await blob.arrayBuffer();
      return { result: buf, transfer: [buf] };
    }
    default:
      throw new Error(`Unknown kernel op ${op}`);
  }
}

self.onmessage = async (e) => {
  const { id, op, payload } = e.data;
  try {
    const { result, transfer = [] } = await handle(op, payload).then((r) => (r && r.result !== undefined ? r : { result: r }));
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
