// File writers that are not provided by three.js or the kernel: ZIP (store), 3MF and DXF.
import { entityPoints, polygonVertices } from './geometry.js';

// ---------------------------------------------------------------- ZIP (no compression)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------- 3MF

/**
 * meshes: [{ name, vertices: Float32Array (xyz), indices: Uint32Array, matrix?: number[16] (column-major), color: '#rrggbb' }]
 * Returns the bytes of a .3mf package (millimetres).
 */
export function make3MF(meshes, { title = 'GuyCAD model' } = {}) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const f = (v) => (Math.round(v * 1e5) / 1e5).toString();
  let objects = '', build = '';
  const mats = meshes.map((m) => `<base name="${esc(m.name)}" displaycolor="${(m.color || '#b0b8c4').toUpperCase()}FF"/>`).join('');
  meshes.forEach((m, k) => {
    const id = k + 2;
    // merge coincident vertices so the mesh is watertight for slicers
    const map = new Map(), verts = [], remap = new Int32Array(m.vertices.length / 3);
    for (let i = 0; i < m.vertices.length / 3; i++) {
      const key = `${f(m.vertices[i * 3])},${f(m.vertices[i * 3 + 1])},${f(m.vertices[i * 3 + 2])}`;
      let j = map.get(key);
      if (j === undefined) { j = verts.length / 3; map.set(key, j); verts.push(m.vertices[i * 3], m.vertices[i * 3 + 1], m.vertices[i * 3 + 2]); }
      remap[i] = j;
    }
    let vx = '', tr = '';
    for (let i = 0; i < verts.length; i += 3) vx += `<vertex x="${f(verts[i])}" y="${f(verts[i + 1])}" z="${f(verts[i + 2])}"/>`;
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = remap[m.indices[i]], b = remap[m.indices[i + 1]], c = remap[m.indices[i + 2]];
      if (a !== b && b !== c && a !== c) tr += `<triangle v1="${a}" v2="${b}" v3="${c}"/>`;
    }
    objects += `<object id="${id}" type="model" name="${esc(m.name)}" pid="1" pindex="${k}"><mesh><vertices>${vx}</vertices><triangles>${tr}</triangles></mesh></object>`;
    const M = m.matrix;
    const transform = M ? ` transform="${[M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10], M[12], M[13], M[14]].map(f).join(' ')}"` : '';
    build += `<item objectid="${id}"${transform}/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata><metadata name="Application">GuyCAD</metadata>
<resources><basematerials id="1">${mats}</basematerials>${objects}</resources><build>${build}</build></model>`;
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model },
  ]);
}

// ---------------------------------------------------------------- DXF (R12 ASCII)

export class DXFWriter {
  constructor() {
    this.layers = new Map([['0', { color: 7, ltype: 'CONTINUOUS' }]]);
    this.ents = [];
  }

  layer(name, color = 7, ltype = 'CONTINUOUS') {
    if (!this.layers.has(name)) this.layers.set(name, { color, ltype });
    return name;
  }

  push(...pairs) { this.ents.push(pairs); }

  line(x1, y1, x2, y2, layer = '0') { this.push(0, 'LINE', 8, layer, 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0); }

  circle(cx, cy, r, layer = '0') { this.push(0, 'CIRCLE', 8, layer, 10, cx, 20, cy, 30, 0, 40, r); }

  // angles in degrees, counter-clockwise from start to end
  arc(cx, cy, r, a0, a1, layer = '0') { this.push(0, 'ARC', 8, layer, 10, cx, 20, cy, 30, 0, 40, r, 50, a0, 51, a1); }

  point(x, y, layer = '0') { this.push(0, 'POINT', 8, layer, 10, x, 20, y, 30, 0); }

  polyline(pts, closed = false, layer = '0') {
    if (pts.length < 2) return;
    const head = [0, 'POLYLINE', 8, layer, 66, 1, 10, 0, 20, 0, 30, 0, 70, closed ? 1 : 0];
    const verts = pts.flatMap(([x, y]) => [0, 'VERTEX', 8, layer, 10, x, 20, y, 30, 0]);
    this.ents.push([...head, ...verts, 0, 'SEQEND', 8, layer]);
  }

  // align: 0 left, 1 center, 2 right
  text(x, y, height, str, layer = '0', align = 0, rotation = 0) {
    const pairs = [0, 'TEXT', 8, layer, 10, x, 20, y, 30, 0, 40, height, 1, String(str).replace(/\n/g, ' ')];
    if (rotation) pairs.push(50, rotation);
    if (align) pairs.push(72, align, 11, x, 21, y, 31, 0);
    this.push(...pairs);
  }

  toString() {
    const out = [];
    const w = (...pairs) => { for (let i = 0; i < pairs.length; i += 2) out.push(String(pairs[i]), typeof pairs[i + 1] === 'number' ? fmtNum(pairs[i + 1]) : String(pairs[i + 1])); };
    w(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC');
    w(0, 'SECTION', 2, 'TABLES');
    w(0, 'TABLE', 2, 'LTYPE', 70, 2);
    w(0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0);
    w(0, 'LTYPE', 2, 'DASHED', 70, 0, 3, '__ __ __', 72, 65, 73, 2, 40, 4.5, 49, 3, 49, -1.5);
    w(0, 'ENDTAB');
    w(0, 'TABLE', 2, 'LAYER', 70, this.layers.size);
    for (const [name, l] of this.layers) w(0, 'LAYER', 2, name, 70, 0, 62, l.color, 6, l.ltype);
    w(0, 'ENDTAB', 0, 'ENDSEC');
    w(0, 'SECTION', 2, 'ENTITIES');
    for (const e of this.ents) w(...e);
    w(0, 'ENDSEC', 0, 'EOF');
    return `${out.join('\r\n')}\r\n`;
  }
}

const fmtNum = (v) => (Number.isInteger(v) ? String(v) : (Math.round(v * 1e6) / 1e6).toString());

// A sketch as DXF in sketch coordinates (mm). Construction geometry goes on its own layer.
export function sketchToDXF(entities) {
  const d = new DXFWriter();
  d.layer('PROFILE', 7);
  d.layer('CONSTRUCTION', 8, 'DASHED');
  const deg = (a) => (a * 180) / Math.PI;
  for (const e of entities) {
    const L = e.construction || e.type === 'centerline' ? 'CONSTRUCTION' : 'PROFILE';
    switch (e.type) {
      case 'line': case 'centerline': d.line(e.a[0], e.a[1], e.b[0], e.b[1], L); break;
      case 'circle': d.circle(e.c[0], e.c[1], e.r, L); break;
      case 'arc': d.arc(e.c[0], e.c[1], e.r, deg(e.a0), deg(e.a1), L); break;
      case 'point': d.point(e.p[0], e.p[1], L); break;
      case 'rect': d.polyline(entityPoints(e).slice(0, 4), true, L); break;
      case 'polygon': d.polyline(polygonVertices(e), true, L); break;
      case 'spline': d.polyline(entityPoints(e), false, L); break;
      default: break;
    }
  }
  return d.toString();
}
