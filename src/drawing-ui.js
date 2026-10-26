// 2D engineering drawings: sheets, projected views, dimensions, notes, title block and BOM.
// Mixed into App.prototype. Everything on a sheet is built as primitives in sheet millimetres
// (y down), which are rendered to SVG on screen and written to SVG / PDF / DXF on export.
import { $, h, clone, uid, native, download } from './ui.js';
import { units } from './units.js';
import { DXFWriter } from './exporters.js';
import { poseOf } from './assembly.js';
import { MATERIALS } from './library.js';

export const SHEETS = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
  Letter: [279.4, 215.9], Tabloid: [431.8, 279.4], 'ANSI C': [558.8, 431.8], 'ANSI D': [863.6, 558.8],
};

const VIEW_DEFS = {
  front: { label: 'Front', dir: [0, 0, 1], x: [1, 0, 0] },
  back: { label: 'Back', dir: [0, 0, -1], x: [-1, 0, 0] },
  top: { label: 'Top', dir: [0, 1, 0], x: [1, 0, 0] },
  bottom: { label: 'Bottom', dir: [0, -1, 0], x: [1, 0, 0] },
  right: { label: 'Right', dir: [1, 0, 0], x: [0, 0, -1] },
  left: { label: 'Left', dir: [-1, 0, 0], x: [0, 0, 1] },
  iso: { label: 'Isometric', dir: [1, 1, 1], x: [1, 0, -1] },
  trimetric: { label: 'Trimetric', dir: [1, 0.75, 1.6], x: [1.6, 0, -1] },
};

const STD_SCALES = [20, 10, 5, 4, 2, 1, 0.5, 0.4, 0.25, 0.2, 0.1, 0.05, 0.04, 0.02, 0.01, 0.005];
const scaleLabel = (s) => (s >= 1 ? `${Math.round(s * 100) / 100}:1` : `1:${Math.round((1 / s) * 100) / 100}`);
const MARGIN = 10;
const TB_W = 180, TB_H = 40; // title block
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const r2 = (v) => Math.round(v * 1000) / 1000;

export const DrawingMixin = {
  initDrawing() {
    const el = h('div', { id: 'sheet-view', hidden: true }, h('div', { class: 'sheet-canvas' }));
    $('#viewport').append(el);
    this.sheetEl = el;
    this.sheetZoom = 2; // screen px per sheet mm
    this.sheetPan = { x: 40, y: 40 };
    this.drawingProj = new Map(); // view id -> projection
    this.dtool = null;
    this.bindSheetEvents();
  },

  blankDrawing(base) {
    return {
      ...base, type: 'drawing', name: this.nextDocName('Drawing'),
      sheet: { size: 'A3', orientation: 'landscape' }, scale: 1,
      title: { title: '', number: '', drawnBy: this.settings?.userName || '', date: new Date().toISOString().slice(0, 10), material: '', company: '', revision: 'A' },
      source: null, views: [], dims: [], notes: [], bom: { show: false, x: null, y: null },
    };
  },

  sheetSize(doc = this.doc) {
    const [a, b] = SHEETS[doc.sheet.size] || SHEETS.A3;
    return doc.sheet.orientation === 'portrait' ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
  },

  // ------------------------------------------------------------ commands

  addDrawingCommands(add) {
    const dwg = () => this.isDrawing;
    add('newDrawing', 'New Drawing', 'drawing', () => this.cmdNewDrawing());
    add('makeDrawing', 'Make Drawing', 'drawing', () => this.makeDrawingFrom(this.tab), { big: true, enabled: () => this.isPart || this.isAsm });
    add('drawStdViews', 'Standard 3 View', 'stdViews', () => this.cmdStandardViews(), { big: true, enabled: dwg });
    add('drawModelView', 'Model View', 'modelView', () => this.cmdModelView(), { enabled: dwg });
    add('drawDimension', 'Smart Dimension', 'dimension', () => this.setDrawingTool(this.dtool === 'dim' ? null : 'dim'), { enabled: dwg, active: () => this.dtool === 'dim' });
    add('drawNote', 'Note', 'note', () => this.setDrawingTool(this.dtool === 'note' ? null : 'note'), { enabled: dwg, active: () => this.dtool === 'note' });
    add('drawBOM', 'Bill of Materials', 'bom', () => this.toggleBOM(), { enabled: dwg, active: () => !!this.doc.bom?.show });
    add('drawUpdate', 'Update from Model', 'rebuild', () => this.updateDrawingSource(true), { enabled: () => dwg() && !!this.doc.source });
    add('drawSheet', 'Sheet Properties', 'options', () => { this.dsel = null; this.openDrawingPM(); }, { enabled: dwg });
    add('exportPDF', 'PDF (*.pdf)', 'pdf', () => this.exportDrawing('pdf'), { enabled: dwg });
    add('exportSVG', 'SVG (*.svg)', 'export', () => this.exportDrawing('svg'), { enabled: dwg });
    add('exportDXF', 'DXF (*.dxf)', 'export', () => this.exportDrawing('dxf'), { enabled: dwg });
    add('explode', 'Exploded View', 'explode', () => this.cmdExplode(), { enabled: () => this.isAsm, active: () => !!this.explodeFactor });
    add('bom', 'Bill of Materials', 'bom', () => this.showBOM(), { enabled: () => this.isAsm });
  },

  drawingCmTabs() {
    return {
      Drawing: ['drawStdViews', 'drawModelView', '|', 'drawDimension', 'drawNote', 'drawBOM', '|', 'drawUpdate', 'drawSheet', '|', 'exportPDF', 'exportSVG', 'exportDXF'],
    };
  },

  drawingInsertMenu() { return ['drawModelView', 'drawStdViews', '|', 'drawDimension', 'drawNote', 'drawBOM']; },

  setDrawingTool(t) {
    this.dtool = t;
    this.dimPicks = [];
    this.sheetEl.style.cursor = t ? 'crosshair' : '';
    this.setStatus(t === 'dim' ? 'Click two vertices in a view (or a circle), then click to place the dimension. Esc to stop.'
      : t === 'note' ? 'Click where the note should go.' : t === 'place' ? 'Click on the sheet to place the view.' : null);
    this.renderSheet();
    this.refreshChrome();
  },

  // ------------------------------------------------------------ creating drawings

  sourceFromTab(tab) {
    return { name: tab.doc.name, type: tab.doc.type, doc: clone(tab.doc), tabId: tab.id };
  },

  async makeDrawingFrom(tab) {
    if (tab.doc.type === 'part' && !this.build?.data) { this.toast('The part has no solid body yet', 'error'); return; }
    if (tab.doc.type === 'assembly' && !tab.doc.components.length) { this.toast('The assembly is empty', 'error'); return; }
    const source = this.sourceFromTab(tab);
    this.resetModes(true);
    this.saveView();
    const d = this.blankDoc('drawing');
    d.name = `${tab.doc.name} Drawing`;
    d.source = source;
    d.title.title = tab.doc.name;
    d.title.material = tab.doc.type === 'part' ? tab.doc.material : '';
    d.bom.show = tab.doc.type === 'assembly';
    this.openTab(d);
    this.selection = null;
    this.cmTab = this.defaultCmTab();
    this.buildCommandManager();
    this.refreshAll();
    await this.cmdStandardViews();
  },

  cmdNewDrawing() {
    const models = this.tabs.filter((t) => t.doc.type === 'part' || t.doc.type === 'assembly');
    if (!models.length) { this.toast('Open or create a part or assembly first'); return; }
    if (models.length === 1) { this.makeDrawingFrom(models[0]); return; }
    const list = h('div', { class: 'mat-list' });
    for (const t of models) list.append(h('div', { class: 'mat-item', onclick: () => { this.closeModals(); this.makeDrawingFrom(t); } }, h('span', { class: 'ti', html: '' }), t.doc.name, h('span', { class: 'meta' }, t.doc.type)));
    this.modal({ title: 'New Drawing — choose a model', icon: 'drawing', body: list, buttons: [{ label: 'Cancel' }] });
  },

  sourceDocs(src = this.doc.source) {
    if (!src) return [];
    if (src.type === 'assembly') {
      return src.doc.components.filter((c) => !c.suppressed && !c.hidden).map((c) => ({ doc: { features: c.part.features }, pose: poseOf(c) }));
    }
    return [{ doc: { features: src.doc.features }, limit: src.doc.rollback }];
  },

  // Re-reads the model from its open tab (drawings stay linked while the model is open).
  async updateDrawingSource(announce = false) {
    const src = this.doc.source;
    if (!src) return;
    const tab = this.tabs.find((t) => t.id === src.tabId);
    if (tab && JSON.stringify(tab.doc) !== JSON.stringify(src.doc)) {
      src.doc = clone(tab.doc);
      src.name = tab.doc.name;
      this.dirty = true;
      this.drawingProjKey = null;
    }
    await this.rebuildDrawing(true);
    if (announce) this.toast(tab ? 'Drawing updated from the model' : 'The model is not open — showing the copy stored in the drawing');
  },

  async projections(kinds) {
    const docs = this.sourceDocs();
    if (!docs.length) return new Map();
    const res = await this.kernel.call('drawing', { docs, views: kinds.map((k) => ({ id: k, ...VIEW_DEFS[k] })) });
    return new Map(res.map((r) => [r.id, r]));
  },

  async rebuildDrawing(force = false) {
    if (!this.isDrawing) return;
    this.showSheet(true);
    const doc = this.doc;
    if (doc.source && !force) {
      const tab = this.tabs.find((t) => t.id === doc.source.tabId);
      if (tab && JSON.stringify(tab.doc) !== JSON.stringify(doc.source.doc)) { await this.updateDrawingSource(); return; }
    }
    const key = JSON.stringify([doc.source?.doc, [...new Set(doc.views.map((v) => v.kind))]]);
    if (doc.source && key !== this.drawingProjKey) {
      this.setBusy(true, 'Projecting views…');
      try {
        const kinds = [...new Set(doc.views.map((v) => v.kind))];
        this.drawingProj = kinds.length ? await this.projections(kinds) : new Map();
        this.drawingProjKey = key;
      } catch (e) {
        this.toast(`Could not project views: ${e.message}`, 'error');
      }
      this.setBusy(false);
    }
    if (!this.isDrawing || this.doc !== doc) return;
    this.renderSheet();
    this.refreshTree();
    this.refreshChrome();
  },

  async cmdStandardViews() {
    if (!this.doc.source) { this.cmdNewDrawing(); return; }
    this.setBusy(true, 'Projecting views…');
    const proj = await this.projections(['front', 'top', 'right', 'iso']);
    this.setBusy(false);
    const snap = JSON.stringify(this.doc);
    const size = (k) => { const b = proj.get(k).bbox; return [b[2] - b[0], b[3] - b[1]]; };
    const [fw, fh] = size('front'), [, th] = size('top'), [rw] = size('right'), [iw, ih] = size('iso');
    const [W, H] = this.sheetSize();
    const gap = 25;
    const availW = W - 2 * MARGIN - 3 * gap, availH = H - 2 * MARGIN - TB_H - 3 * gap;
    const fit = Math.min(availW / (fw + Math.max(rw, iw)), availH / (fh + Math.max(th, ih)));
    const s = STD_SCALES.find((x) => x <= fit * 0.98) || STD_SCALES[STD_SCALES.length - 1];
    const left = MARGIN + gap, top = MARGIN + gap;
    const col1 = left + (s * fw) / 2, col2 = left + s * fw + gap + (s * Math.max(rw, iw)) / 2;
    const row1 = top + (s * Math.max(th, ih)) / 2, row2 = top + s * Math.max(th, ih) + gap + (s * fh) / 2;
    this.doc.scale = s;
    this.doc.views = [
      { id: uid('v'), kind: 'front', x: col1, y: row2, scale: null, hidden: true, label: true },
      { id: uid('v'), kind: 'top', x: col1, y: row1, scale: null, hidden: true, label: true },
      { id: uid('v'), kind: 'right', x: col2, y: row2, scale: null, hidden: true, label: true },
      { id: uid('v'), kind: 'iso', x: col2, y: row1, scale: null, hidden: false, label: true },
    ];
    this.doc.dims = [];
    this.drawingProj = proj;
    this.drawingProjKey = JSON.stringify([this.doc.source.doc, ['front', 'top', 'right', 'iso']]);
    this.commit(snap);
    this.renderSheet();
    this.refreshTree();
    this.fitSheet();
  },

  cmdModelView() {
    if (!this.doc.source) { this.cmdNewDrawing(); return; }
    const kinds = Object.keys(VIEW_DEFS);
    this.pendingViewKind = this.pendingViewKind || 'front';
    this.openPM({
      kind: 'dview', title: 'Model View', icon: 'modelView',
      render: (body) => body.append(this.pmGroup('Orientation',
        this.fieldSelect('View', kinds.map((k) => ({ value: k, label: VIEW_DEFS[k].label })), () => this.pendingViewKind, (v) => { this.pendingViewKind = v; }),
        h('div', { class: 'pm-info' }, 'Click on the sheet to place the view.'))),
      onClose: () => this.setDrawingTool(null),
    });
    this.setDrawingTool('place');
  },

  // ------------------------------------------------------------ geometry helpers

  viewScale(v) { return v.scale || this.doc.scale || 1; },

  viewProj(v) { return this.drawingProj.get(v.kind); },

  // model 2D (view coords, y up) -> sheet mm (y down)
  toSheet(v, p) {
    const pr = this.viewProj(v);
    const b = pr ? pr.bbox : [0, 0, 0, 0];
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, s = this.viewScale(v);
    return [v.x + (p[0] - cx) * s, v.y - (p[1] - cy) * s];
  },

  fromSheet(v, q) {
    const pr = this.viewProj(v);
    const b = pr ? pr.bbox : [0, 0, 0, 0];
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, s = this.viewScale(v);
    return [cx + (q[0] - v.x) / s, cy - (q[1] - v.y) / s];
  },

  viewRect(v) {
    const pr = this.viewProj(v);
    if (!pr) return [v.x - 10, v.y - 10, v.x + 10, v.y + 10];
    const b = pr.bbox, s = this.viewScale(v);
    const w = (b[2] - b[0]) * s, hh = (b[3] - b[1]) * s;
    return [v.x - w / 2, v.y - hh / 2, v.x + w / 2, v.y + hh / 2];
  },

  // ------------------------------------------------------------ primitives

  // Everything on the sheet as { k: 'line'|'poly'|'text'|'arrow', layer, ... , owner } in sheet mm.
  sheetPrimitives({ forExport = false } = {}) {
    const doc = this.doc;
    const [W, H] = this.sheetSize();
    const P = [];
    const line = (a, b, layer, owner, w = 0.35) => P.push({ k: 'line', a, b, layer, owner, w });
    const text = (x, y, str, size, layer, owner, anchor = 'start', bold = false) => P.push({ k: 'text', x, y, str: String(str ?? ''), size, layer, owner, anchor, bold });
    const rect = (x0, y0, x1, y1, layer, owner, w) => { line([x0, y0], [x1, y0], layer, owner, w); line([x1, y0], [x1, y1], layer, owner, w); line([x1, y1], [x0, y1], layer, owner, w); line([x0, y1], [x0, y0], layer, owner, w); };

    // border and title block
    rect(MARGIN, MARGIN, W - MARGIN, H - MARGIN, 'BORDER', 'sheet', 0.7);
    const tx = W - MARGIN - TB_W, ty = H - MARGIN - TB_H;
    rect(tx, ty, W - MARGIN, H - MARGIN, 'BORDER', 'title', 0.5);
    const t = doc.title || {};
    line([tx, ty + 16], [W - MARGIN, ty + 16], 'BORDER', 'title', 0.25);
    line([tx, ty + 28], [W - MARGIN, ty + 28], 'BORDER', 'title', 0.25);
    for (const x of [tx + 45, tx + 90, tx + 135]) line([x, ty + 16], [x, H - MARGIN], 'BORDER', 'title', 0.25);
    text(tx + 3, ty + 6.5, t.company || 'GuyCAD', 3, 'TEXT', 'title');
    text(tx + 3, ty + 13, t.title || doc.source?.name || doc.name, 5, 'TEXT', 'title', 'start', true);
    const cell = (x, y, label, value) => { text(x + 2, y + 3.5, label, 1.8, 'TEXT', 'title'); text(x + 2, y + 9.5, value, 3, 'TEXT', 'title'); };
    cell(tx, ty + 16, 'DRAWN BY', t.drawnBy);
    cell(tx + 45, ty + 16, 'DATE', t.date);
    cell(tx + 90, ty + 16, 'MATERIAL', t.material);
    cell(tx + 135, ty + 16, 'SCALE', scaleLabel(doc.scale || 1));
    cell(tx, ty + 28, 'DWG NO.', t.number);
    cell(tx + 45, ty + 28, 'REV', t.revision);
    cell(tx + 90, ty + 28, 'SHEET', `${doc.sheet.size} ${doc.sheet.orientation}`);
    cell(tx + 135, ty + 28, 'UNITS', units.def.label.toUpperCase());
    text(tx + TB_W - 2, ty - 2, 'THIRD ANGLE PROJECTION', 2, 'TEXT', 'title', 'end');

    // views
    for (const v of doc.views) {
      const pr = this.viewProj(v);
      if (!pr) continue;
      const map = (pl) => { const out = []; for (let i = 0; i < pl.length; i += 2) out.push(this.toSheet(v, [pl[i], pl[i + 1]])); return out; };
      for (const pl of pr.visible) P.push({ k: 'poly', pts: map(pl), layer: 'VISIBLE', owner: v.id, w: 0.35 });
      if (v.hidden) for (const pl of pr.hidden) P.push({ k: 'poly', pts: map(pl), layer: 'HIDDEN', owner: v.id, w: 0.18 });
      if (v.label) {
        const rr = this.viewRect(v);
        text(v.x, rr[3] + 7, `${VIEW_DEFS[v.kind].label.toUpperCase()}${v.scale ? `  SCALE ${scaleLabel(v.scale)}` : ''}`, 3, 'TEXT', v.id, 'middle');
      }
    }

    // dimensions
    for (const d of doc.dims) this.dimensionPrimitives(d, P);
    // notes
    for (const n of doc.notes) {
      String(n.text).split('\n').forEach((ln, i) => text(n.x, n.y + i * n.size * 1.4, ln, n.size, 'TEXT', n.id));
    }
    // bill of materials
    if (doc.bom?.show) this.bomPrimitives(P, W);
    void forExport;
    return P;
  },

  dimensionPrimitives(d, P, owner = d.id, layer = 'DIM') {
    const v = this.doc.views.find((x) => x.id === d.view);
    if (!v || !this.viewProj(v)) return;
    const arrow = (tip, dir) => {
      const l = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / l, dir[1] / l], n = [-u[1], u[0]];
      P.push({ k: 'arrow', pts: [tip, [tip[0] - u[0] * 3 + n[0] * 0.9, tip[1] - u[1] * 3 + n[1] * 0.9], [tip[0] - u[0] * 3 - n[0] * 0.9, tip[1] - u[1] * 3 - n[1] * 0.9]], layer, owner });
    };
    const ln = (a, b) => P.push({ k: 'line', a, b, layer, owner, w: 0.18 });
    const txt = (x, y, s, rot = 0) => P.push({ k: 'text', x, y, str: s, size: 3.2, layer, owner, anchor: 'middle', rot });
    if (d.type === 'diameter') {
      const c = this.toSheet(v, d.c), s = this.viewScale(v), R = d.r * s;
      const dir = [d.pos[0] - c[0], d.pos[1] - c[1]], l = Math.hypot(...dir) || 1, u = [dir[0] / l, dir[1] / l];
      const e1 = [c[0] + u[0] * R, c[1] + u[1] * R], e2 = [c[0] - u[0] * R, c[1] - u[1] * R];
      ln(e2, d.pos);
      arrow(e1, u); arrow(e2, [-u[0], -u[1]]);
      txt(d.pos[0], d.pos[1] - 1.5, `Ø${units.fmt(d.r * 2, false)}`);
      return;
    }
    const a = this.toSheet(v, d.a), b = this.toSheet(v, d.b);
    let dirv;
    if (d.mode === 'h') dirv = [1, 0];
    else if (d.mode === 'v') dirv = [0, 1];
    else { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; dirv = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
    const n = [-dirv[1], dirv[0]];
    const offA = (d.pos[0] - a[0]) * n[0] + (d.pos[1] - a[1]) * n[1];
    const offB = (d.pos[0] - b[0]) * n[0] + (d.pos[1] - b[1]) * n[1];
    const a2 = [a[0] + n[0] * offA, a[1] + n[1] * offA], b2 = [b[0] + n[0] * offB, b[1] + n[1] * offB];
    const sg = (o) => Math.sign(o) || 1;
    ln([a[0] + n[0] * 1 * sg(offA), a[1] + n[1] * 1 * sg(offA)], [a2[0] + n[0] * 2 * sg(offA), a2[1] + n[1] * 2 * sg(offA)]);
    ln([b[0] + n[0] * 1 * sg(offB), b[1] + n[1] * 1 * sg(offB)], [b2[0] + n[0] * 2 * sg(offB), b2[1] + n[1] * 2 * sg(offB)]);
    ln(a2, b2);
    arrow(b2, [b2[0] - a2[0], b2[1] - a2[1]]);
    arrow(a2, [a2[0] - b2[0], a2[1] - b2[1]]);
    const m = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
    let ang = (Math.atan2(b2[1] - a2[1], b2[0] - a2[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    const lift = 1.2;
    txt(m[0] + n[0] * -lift * (ang === 0 ? 1 : 1), m[1] - lift, units.fmt(this.dimValue(d), false), ang);
  },

  dimValue(d) {
    if (d.type === 'diameter') return d.r * 2;
    const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1];
    return d.mode === 'h' ? Math.abs(dx) : d.mode === 'v' ? Math.abs(dy) : Math.hypot(dx, dy);
  },

  bomRows() {
    const src = this.doc.source;
    if (!src) return [];
    if (src.type === 'part') return [{ item: 1, name: src.doc.name, material: src.doc.material, qty: 1 }];
    const groups = new Map();
    for (const c of src.doc.components) {
      if (c.suppressed) continue;
      const key = `${c.name}|${c.part.material}`;
      const g = groups.get(key) || { name: c.name, material: c.part.material, qty: 0 };
      g.qty++;
      groups.set(key, g);
    }
    return [...groups.values()].map((g, i) => ({ item: i + 1, ...g }));
  },

  bomPrimitives(P, W) {
    const rows = this.bomRows();
    const cols = [15, 70, 50, 15];
    const total = cols.reduce((a, b) => a + b, 0);
    const x0 = this.doc.bom.x ?? W - MARGIN - total, y0 = this.doc.bom.y ?? MARGIN;
    const rh = 7;
    const owner = 'bom';
    const head = ['ITEM NO.', 'PART NAME', 'MATERIAL', 'QTY.'];
    const all = [head, ...rows.map((r) => [r.item, r.name, r.material, r.qty])];
    all.forEach((row, ri) => {
      let x = x0;
      const y = y0 + ri * rh;
      row.forEach((cellText, ci) => {
        P.push({ k: 'text', x: x + 2, y: y + 4.8, str: String(cellText), size: ri ? 2.8 : 2.5, layer: 'BOM', owner, anchor: 'start', bold: ri === 0 });
        x += cols[ci];
      });
    });
    const yEnd = y0 + all.length * rh;
    for (let ri = 0; ri <= all.length; ri++) P.push({ k: 'line', a: [x0, y0 + ri * rh], b: [x0 + total, y0 + ri * rh], layer: 'BOM', owner, w: ri <= 1 ? 0.35 : 0.18 });
    let x = x0;
    for (let ci = 0; ci <= cols.length; ci++) { P.push({ k: 'line', a: [x, y0], b: [x, yEnd], layer: 'BOM', owner, w: 0.25 }); x += cols[ci] || 0; }
  },

  // ------------------------------------------------------------ SVG

  sheetSVG({ forExport = false } = {}) {
    const [W, H] = this.sheetSize();
    const prims = this.sheetPrimitives({ forExport });
    const style = {
      VISIBLE: 'stroke:#000', HIDDEN: 'stroke:#444;stroke-dasharray:2 1', BORDER: 'stroke:#000', DIM: 'stroke:#0b3d91', BOM: 'stroke:#000', TEXT: 'stroke:#000',
    };
    const fill = { DIM: '#0b3d91' };
    const groups = new Map();
    for (const p of prims) {
      if (!groups.has(p.owner)) groups.set(p.owner, []);
      const g = groups.get(p.owner);
      if (p.k === 'line') g.push(`<line x1="${r2(p.a[0])}" y1="${r2(p.a[1])}" x2="${r2(p.b[0])}" y2="${r2(p.b[1])}" style="${style[p.layer]};stroke-width:${p.w}"/>`);
      else if (p.k === 'poly') g.push(`<polyline points="${p.pts.map((q) => `${r2(q[0])},${r2(q[1])}`).join(' ')}" fill="none" style="${style[p.layer]};stroke-width:${p.w};stroke-linejoin:round;stroke-linecap:round"/>`);
      else if (p.k === 'arrow') g.push(`<polygon points="${p.pts.map((q) => `${r2(q[0])},${r2(q[1])}`).join(' ')}" fill="${fill[p.layer] || '#000'}"/>`);
      else if (p.k === 'text') {
        const rot = p.rot ? ` transform="rotate(${r2(-p.rot)} ${r2(p.x)} ${r2(p.y)})"` : '';
        g.push(`<text x="${r2(p.x)}" y="${r2(p.y)}" font-size="${p.size}" text-anchor="${p.anchor}" font-family="Segoe UI, Arial, sans-serif"${p.bold ? ' font-weight="700"' : ''} fill="${fill[p.layer] || '#000'}"${rot}>${esc(p.str)}</text>`);
      }
    }
    let body = '';
    for (const [owner, items] of groups) body += `<g data-owner="${esc(owner)}">${items.join('')}</g>`;
    let overlay = '';
    if (!forExport) {
      // selection outlines and drawing-tool feedback (screen only)
      const sel = this.dsel;
      if (sel?.kind === 'view') {
        const v = this.doc.views.find((x) => x.id === sel.id);
        if (v) { const rr = this.viewRect(v); overlay += `<rect x="${rr[0] - 3}" y="${rr[1] - 3}" width="${rr[2] - rr[0] + 6}" height="${rr[3] - rr[1] + 6}" fill="none" stroke="#2f7cf6" stroke-width="0.4" stroke-dasharray="2 1"/>`; }
      }
      if (this.dimPicks?.length) {
        for (const pk of this.dimPicks) {
          const v = this.doc.views.find((x) => x.id === pk.view);
          if (!v) continue;
          const q = this.toSheet(v, pk.c || pk.p);
          overlay += `<circle cx="${r2(q[0])}" cy="${r2(q[1])}" r="${pk.r ? r2(pk.r * this.viewScale(v)) : 1.2}" fill="${pk.r ? 'none' : '#ff8c1a'}" stroke="#ff8c1a" stroke-width="0.4"/>`;
        }
      }
      if (this.dimPreview) {
        const P = [];
        this.dimensionPrimitives(this.dimPreview, P, 'preview', 'DIM');
        overlay += P.map((p) => (p.k === 'line' ? `<line x1="${p.a[0]}" y1="${p.a[1]}" x2="${p.b[0]}" y2="${p.b[1]}" stroke="#ff8c1a" stroke-width="0.25"/>`
          : p.k === 'arrow' ? `<polygon points="${p.pts.map((q) => q.join(',')).join(' ')}" fill="#ff8c1a"/>`
            : p.k === 'text' ? `<text x="${p.x}" y="${p.y}" font-size="${p.size}" text-anchor="middle" fill="#ff8c1a" font-family="Segoe UI, Arial">${esc(p.str)}</text>` : '')).join('');
      }
      if (this.dsel?.kind && this.dsel.kind !== 'view') overlay += `<style>[data-owner="${esc(this.dsel.id)}"] *{stroke:#ff8c1a!important;fill-opacity:1}</style>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${body}${overlay}</svg>`;
  },

  showSheet(on) {
    this.sheetEl.hidden = !on;
    this.viewport.renderer.domElement.style.visibility = on ? 'hidden' : 'visible';
    $('#hud').hidden = on;
  },

  renderSheet() {
    if (!this.isDrawing) { this.showSheet(false); return; }
    this.showSheet(true);
    const canvas = this.sheetEl.querySelector('.sheet-canvas');
    const [W, H] = this.sheetSize();
    canvas.innerHTML = this.sheetSVG();
    if (!this.doc.source) canvas.insertAdjacentHTML('beforeend', '<div class="sheet-hint">This drawing has no model yet. Use <b>Standard 3 View</b> to choose one.</div>');
    const svg = canvas.querySelector('svg');
    svg.style.width = `${W * this.sheetZoom}px`;
    svg.style.height = `${H * this.sheetZoom}px`;
    canvas.style.transform = `translate(${this.sheetPan.x}px, ${this.sheetPan.y}px)`;
  },

  fitSheet() {
    const [W, H] = this.sheetSize();
    const r = this.sheetEl.getBoundingClientRect();
    this.sheetZoom = Math.min((r.width - 60) / W, (r.height - 60) / H);
    this.sheetPan = { x: (r.width - W * this.sheetZoom) / 2, y: (r.height - H * this.sheetZoom) / 2 };
    this.renderSheet();
  },

  sheetPoint(ev) {
    const r = this.sheetEl.getBoundingClientRect();
    return [(ev.clientX - r.left - this.sheetPan.x) / this.sheetZoom, (ev.clientY - r.top - this.sheetPan.y) / this.sheetZoom];
  },

  // ------------------------------------------------------------ interaction

  bindSheetEvents() {
    const el = this.sheetEl;
    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const k = Math.exp(-ev.deltaY * 0.0015);
      const z = Math.max(0.2, Math.min(40, this.sheetZoom * k));
      this.sheetPan.x = mx - ((mx - this.sheetPan.x) * z) / this.sheetZoom;
      this.sheetPan.y = my - ((my - this.sheetPan.y) * z) / this.sheetZoom;
      this.sheetZoom = z;
      this.renderSheet();
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (ev) => this.sheetPointerDown(ev));
    el.addEventListener('pointermove', (ev) => this.sheetPointerMove(ev));
    el.addEventListener('dblclick', (ev) => {
      const owner = ev.target.closest('[data-owner]')?.dataset.owner;
      const note = this.doc.notes?.find((n) => n.id === owner);
      if (note) this.editNote(note);
      if (owner === 'title' || owner === 'sheet') { this.dsel = null; this.openDrawingPM(); }
    });
  },

  sheetPointerDown(ev) {
    if (!this.isDrawing) return;
    const q = this.sheetPoint(ev);
    if (ev.button !== 0) { this.startSheetPan(ev); return; }
    if (this.dtool === 'place') {
      const snap = JSON.stringify(this.doc);
      const v = { id: uid('v'), kind: this.pendingViewKind || 'front', x: q[0], y: q[1], scale: null, hidden: this.pendingViewKind !== 'iso' && this.pendingViewKind !== 'trimetric', label: true };
      this.doc.views.push(v);
      this.commit(snap);
      this.dsel = { kind: 'view', id: v.id };
      if (this.pm?.kind === 'dview') this.pmOK();
      this.setDrawingTool(null);
      this.rebuildDrawing();
      return;
    }
    if (this.dtool === 'note') { this.addNoteAt(q); return; }
    if (this.dtool === 'dim') { this.drawingDimClick(q); return; }
    const owner = ev.target.closest('[data-owner]')?.dataset.owner;
    const hitView = this.doc.views.find((v) => { const rr = this.viewRect(v); return q[0] >= rr[0] - 3 && q[0] <= rr[2] + 3 && q[1] >= rr[1] - 3 && q[1] <= rr[3] + 3; });
    let target = null;
    if (owner && this.doc.dims.some((d) => d.id === owner)) target = { kind: 'dim', id: owner };
    else if (owner && this.doc.notes.some((n) => n.id === owner)) target = { kind: 'note', id: owner };
    else if (owner === 'bom') target = { kind: 'bom', id: 'bom' };
    else if (hitView) target = { kind: 'view', id: hitView.id };
    this.dsel = target;
    this.openDrawingPM();
    this.renderSheet();
    this.refreshTree();
    if (!target) { this.startSheetPan(ev); return; }
    // drag to move the selected item
    const snap = JSON.stringify(this.doc);
    const start = q;
    const obj = target.kind === 'view' ? this.doc.views.find((v) => v.id === target.id)
      : target.kind === 'note' ? this.doc.notes.find((n) => n.id === target.id)
        : target.kind === 'dim' ? this.doc.dims.find((d) => d.id === target.id) : this.doc.bom;
    const W = this.sheetSize()[0];
    if (target.kind === 'bom' && obj.x == null) { obj.x = W - MARGIN - 150; obj.y = MARGIN; }
    const base = target.kind === 'dim' ? [...obj.pos] : [obj.x, obj.y];
    let moved = false;
    const move = (e) => {
      const p = this.sheetPoint(e);
      const dx = p[0] - start[0], dy = p[1] - start[1];
      if (!moved && Math.hypot(dx, dy) * this.sheetZoom < 3) return;
      moved = true;
      if (target.kind === 'dim') obj.pos = [base[0] + dx, base[1] + dy];
      else { obj.x = base[0] + dx; obj.y = base[1] + dy; }
      this.renderSheet();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) this.commit(snap);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  },

  startSheetPan(ev) {
    const start = { x: ev.clientX, y: ev.clientY, px: this.sheetPan.x, py: this.sheetPan.y };
    const move = (e) => { this.sheetPan = { x: start.px + e.clientX - start.x, y: start.py + e.clientY - start.y }; this.renderSheet(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  },

  sheetPointerMove(ev) {
    if (this.dtool !== 'dim' || this.dimPicks?.length < 1) return;
    const q = this.sheetPoint(ev);
    this.dimPreview = this.dimFromPicks(this.dimPicks, q);
    this.renderSheet();
  },

  // Nearest projected vertex (polyline end) or circle in any view.
  drawingSnap(q) {
    const tol = 8 / this.sheetZoom;
    let best = null, bestD = tol;
    for (const v of this.doc.views) {
      const pr = this.viewProj(v);
      if (!pr) continue;
      for (const pl of pr.visible) {
        for (const i of [0, pl.length - 2]) {
          const s = this.toSheet(v, [pl[i], pl[i + 1]]);
          const d = Math.hypot(s[0] - q[0], s[1] - q[1]);
          if (d < bestD) { bestD = d; best = { view: v.id, p: [pl[i], pl[i + 1]] }; }
        }
      }
      if (!best) {
        for (const c of pr.circles) {
          const s = this.toSheet(v, c.c), R = c.r * this.viewScale(v);
          const d = Math.abs(Math.hypot(s[0] - q[0], s[1] - q[1]) - R);
          if (d < bestD) { bestD = d; best = { view: v.id, c: c.c, r: c.r }; }
        }
      }
    }
    return best;
  },

  dimFromPicks(picks, q) {
    if (picks.length === 1 && picks[0].r) return { type: 'diameter', view: picks[0].view, c: picks[0].c, r: picks[0].r, pos: q };
    if (picks.length !== 2) return null;
    const [A, B] = picks;
    const v = this.doc.views.find((x) => x.id === A.view);
    const a = this.toSheet(v, A.p), b = this.toSheet(v, B.p);
    const inX = q[0] > Math.min(a[0], b[0]) && q[0] < Math.max(a[0], b[0]);
    const inY = q[1] > Math.min(a[1], b[1]) && q[1] < Math.max(a[1], b[1]);
    const mode = inX && !inY ? 'h' : inY && !inX ? 'v' : 'a';
    return { type: 'linear', view: A.view, a: A.p, b: B.p, mode, pos: q };
  },

  drawingDimClick(q) {
    const hit = this.drawingSnap(q);
    const picks = this.dimPicks || [];
    if (hit && !(picks.length === 1 && picks[0].r) && picks.length < 2) {
      if (picks.length === 1 && picks[0].view !== hit.view) { this.toast('Pick both points in the same view'); return; }
      if (!hit.r || !picks.length) { this.dimPicks = [...picks, hit]; this.renderSheet(); return; }
    }
    const d = this.dimFromPicks(picks, q);
    if (!d) { this.dimPicks = []; this.renderSheet(); return; }
    const snap = JSON.stringify(this.doc);
    d.id = uid('d');
    this.doc.dims.push(d);
    this.commit(snap);
    this.dimPicks = [];
    this.dimPreview = null;
    this.renderSheet();
    this.refreshTree();
  },

  async addNoteAt(q) {
    const text = await this.promptBox('Note', 'Text (use \\n for a new line)', '');
    if (!text) return;
    const snap = JSON.stringify(this.doc);
    const n = { id: uid('n'), x: q[0], y: q[1], text: text.replace(/\\n/g, '\n'), size: 3.5 };
    this.doc.notes.push(n);
    this.commit(snap);
    this.setDrawingTool(null);
    this.dsel = { kind: 'note', id: n.id };
    this.renderSheet();
    this.refreshTree();
  },

  async editNote(n) {
    const text = await this.promptBox('Edit Note', 'Text (use \\n for a new line)', n.text.replace(/\n/g, '\\n'));
    if (text == null) return;
    const snap = JSON.stringify(this.doc);
    n.text = text.replace(/\\n/g, '\n');
    this.commit(snap);
    this.renderSheet();
  },

  toggleBOM() {
    const snap = JSON.stringify(this.doc);
    this.doc.bom.show = !this.doc.bom.show;
    this.commit(snap);
    this.renderSheet();
    this.refreshTree();
  },

  deleteDrawingSelection() {
    const s = this.dsel;
    if (!s) return;
    const snap = JSON.stringify(this.doc);
    if (s.kind === 'view') {
      this.doc.views = this.doc.views.filter((v) => v.id !== s.id);
      this.doc.dims = this.doc.dims.filter((d) => d.view !== s.id);
    } else if (s.kind === 'dim') this.doc.dims = this.doc.dims.filter((d) => d.id !== s.id);
    else if (s.kind === 'note') this.doc.notes = this.doc.notes.filter((n) => n.id !== s.id);
    else if (s.kind === 'bom') this.doc.bom.show = false;
    this.dsel = null;
    this.commit(snap);
    this.renderSheet();
    this.refreshTree();
  },

  // ------------------------------------------------------------ property manager & tree

  openDrawingPM() {
    const s = this.dsel;
    const doc = this.doc;
    const snapField = (fn) => (v) => { const snap = JSON.stringify(this.doc); fn(v); this.commit(snap); this.rebuildDrawing(); };
    if (s?.kind === 'view') {
      const v = doc.views.find((x) => x.id === s.id);
      if (!v) return;
      this.pm = {
        kind: 'dsel', title: `${VIEW_DEFS[v.kind].label} View`, icon: 'modelView',
        render: (body) => body.append(
          this.pmGroup('Orientation', this.fieldSelect('View', Object.entries(VIEW_DEFS).map(([k, d]) => ({ value: k, label: d.label })), () => v.kind, snapField((x) => { v.kind = x; }))),
          this.pmGroup('Scale',
            this.fieldSelect('Scale', [{ value: '', label: `Use sheet scale (${scaleLabel(doc.scale || 1)})` }, ...STD_SCALES.map((x) => ({ value: x, label: scaleLabel(x) }))], () => v.scale ?? '', snapField((x) => { v.scale = x === '' ? null : Number(x); }))),
          this.pmGroup('Display',
            this.fieldCheck('Show hidden lines', () => v.hidden, snapField((x) => { v.hidden = x; })),
            this.fieldCheck('Show view label', () => v.label, snapField((x) => { v.label = x; })),
            h('button', { class: 'pm-button danger', onclick: () => this.deleteDrawingSelection() }, 'Delete view')),
        ),
        onOK: () => {}, onCancel: () => {},
      };
    } else if (s?.kind === 'note') {
      const n = doc.notes.find((x) => x.id === s.id);
      this.pm = {
        kind: 'dsel', title: 'Note', icon: 'note',
        render: (body) => body.append(this.pmGroup('Note',
          this.fieldNumber('Text height', () => n.size, snapField((x) => { n.size = Math.max(1, x); }), { min: 1 }),
          h('button', { class: 'pm-button', onclick: () => this.editNote(n) }, 'Edit text...'),
          h('button', { class: 'pm-button danger', onclick: () => this.deleteDrawingSelection() }, 'Delete note'))),
        onOK: () => {}, onCancel: () => {},
      };
    } else if (s?.kind === 'dim') {
      const d = doc.dims.find((x) => x.id === s.id);
      this.pm = {
        kind: 'dsel', title: 'Dimension', icon: 'dimension',
        render: (body) => body.append(this.pmGroup('Dimension',
          h('div', { class: 'pm-info' }, `Value: ${d.type === 'diameter' ? 'Ø' : ''}${units.fmt(this.dimValue(d))} (measured from the model)`),
          d.type === 'linear' ? this.fieldSelect('Direction', [{ value: 'a', label: 'Aligned' }, { value: 'h', label: 'Horizontal' }, { value: 'v', label: 'Vertical' }], () => d.mode, snapField((x) => { d.mode = x; })) : null,
          h('button', { class: 'pm-button danger', onclick: () => this.deleteDrawingSelection() }, 'Delete dimension'))),
        onOK: () => {}, onCancel: () => {},
      };
    } else {
      const t = doc.title;
      const text = (label, key) => {
        const input = h('input', { type: 'text', value: t[key] || '' });
        input.addEventListener('change', () => { const snap = JSON.stringify(this.doc); t[key] = input.value; this.commit(snap); this.renderSheet(); });
        return h('div', { class: 'pm-row' }, h('label', {}, label), input);
      };
      this.pm = {
        kind: 'dsel', title: 'Sheet Properties', icon: 'drawing',
        render: (body) => body.append(
          this.pmGroup('Sheet',
            this.fieldSelect('Size', Object.keys(SHEETS).map((k) => ({ value: k, label: `${k} (${SHEETS[k][0]} × ${SHEETS[k][1]} mm)` })), () => doc.sheet.size, snapField((x) => { doc.sheet.size = x; })),
            this.fieldSelect('Orientation', [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }], () => doc.sheet.orientation, snapField((x) => { doc.sheet.orientation = x; })),
            this.fieldSelect('Sheet scale', STD_SCALES.map((x) => ({ value: x, label: scaleLabel(x) })), () => doc.scale, snapField((x) => { doc.scale = Number(x); }))),
          this.pmGroup('Title Block', text('Title', 'title'), text('Drawing no.', 'number'), text('Company', 'company'), text('Drawn by', 'drawnBy'), text('Date', 'date'), text('Material', 'material'), text('Revision', 'revision')),
          this.pmGroup('Model', h('div', { class: 'pm-info' }, doc.source ? `${doc.source.name} (${doc.source.type}). The drawing updates automatically while the model is open.` : 'No model.')),
        ),
        onOK: () => {}, onCancel: () => {},
      };
    }
    this.mode = 'model';
    this.lpTab = 'pm';
    this.refreshLeftTabs();
    this.renderPM();
    this.refreshChrome();
  },

  refreshDrawingTree() {
    const tree = $('#tree');
    tree.replaceChildren();
    const doc = this.doc;
    const node = (o) => this.treeNode(o);
    const sel = (kind, id) => () => { this.dsel = kind ? { kind, id } : null; this.openDrawingPM(); this.renderSheet(); this.refreshDrawingTree(); };
    tree.append(node({ cls: 'root', icon: 'drawing', label: doc.name, onDbl: () => this.renameDoc(), onClick: sel(null) }));
    tree.append(node({ depth: 1, icon: 'part', label: `Model: ${doc.source?.name || '(none)'}` }));
    tree.append(node({ depth: 1, icon: 'drawing', label: `Sheet1 (${doc.sheet.size}, ${scaleLabel(doc.scale || 1)})`, onClick: sel(null) }));
    for (const v of doc.views) {
      tree.append(node({ depth: 2, icon: 'modelView', label: `${VIEW_DEFS[v.kind].label} view`, selected: this.dsel?.id === v.id, onClick: sel('view', v.id) }));
    }
    if (doc.dims.length) tree.append(node({ depth: 2, icon: 'dimension', label: `Dimensions (${doc.dims.length})` }));
    for (const n of doc.notes) tree.append(node({ depth: 2, icon: 'note', label: `Note: ${n.text.split('\n')[0].slice(0, 24)}`, selected: this.dsel?.id === n.id, onClick: sel('note', n.id) }));
    if (doc.bom.show) tree.append(node({ depth: 2, icon: 'bom', label: 'Bill of Materials', selected: this.dsel?.kind === 'bom', onClick: sel('bom', 'bom') }));
  },

  // ------------------------------------------------------------ export

  async exportDrawing(fmt) {
    if (!this.isDrawing) return;
    const name = this.doc.name;
    try {
      const data = await this.drawingExportData(fmt);
      if (data == null) return;
      const saved = await download(data, `${name}.${fmt}`, fmt === 'svg' ? 'image/svg+xml' : 'application/octet-stream');
      if (saved) this.toast(`Exported ${saved}`, 'ok');
    } catch (e) {
      this.toast(`Export failed: ${e.message}`, 'error');
    }
  },

  async drawingExportData(fmt) {
    const [W, H] = this.sheetSize();
    {
      let data;
      if (fmt === 'svg') data = `<?xml version="1.0" encoding="UTF-8"?>\n${this.sheetSVG({ forExport: true })}`;
      else if (fmt === 'dxf') data = this.sheetDXF();
      else if (fmt === 'pdf') {
        const svg = this.sheetSVG({ forExport: true });
        if (native?.svgToPDF) data = await native.svgToPDF({ svg, widthMM: W, heightMM: H });
        else {
          const w = window.open('', '_blank');
          w.document.write(`<html><head><style>@page{size:${W}mm ${H}mm;margin:0}body{margin:0}</style></head><body>${svg}</body></html>`);
          w.document.close();
          w.print();
          return null;
        }
      }
      return data;
    }
  },

  sheetDXF() {
    const H = this.sheetSize()[1];
    const d = new DXFWriter();
    d.layer('BORDER', 7); d.layer('VISIBLE', 7); d.layer('HIDDEN', 8, 'DASHED'); d.layer('DIM', 5); d.layer('TEXT', 7); d.layer('BOM', 7);
    const Y = (y) => H - y;
    for (const p of this.sheetPrimitives({ forExport: true })) {
      if (p.k === 'line') d.line(p.a[0], Y(p.a[1]), p.b[0], Y(p.b[1]), p.layer);
      else if (p.k === 'poly') d.polyline(p.pts.map((q) => [q[0], Y(q[1])]), false, p.layer);
      else if (p.k === 'arrow') d.polyline(p.pts.map((q) => [q[0], Y(q[1])]), true, p.layer);
      else if (p.k === 'text') d.text(p.x, Y(p.y), p.size, p.str, p.layer, p.anchor === 'middle' ? 1 : p.anchor === 'end' ? 2 : 0, p.rot || 0);
    }
    return d.toString();
  },

  // ------------------------------------------------------------ assembly extras: explode & BOM

  cmdExplode() {
    if (this.explodeFactor && !this.pm) { this.explodeFactor = 0; this.updateAssemblyBodies(); this.refreshChrome(); return; }
    if (this.pm) this.pmCancel();
    this.explodeFactor = this.explodeFactor || 1;
    const apply = () => { this.updateAssemblyBodies(); this.refreshChrome(); };
    this.openPM({
      kind: 'explode', title: 'Exploded View', icon: 'explode',
      render: (body) => {
        const slider = h('input', { type: 'range', min: 0, max: 3, step: 0.05, value: this.explodeFactor, style: { width: '100%' } });
        slider.addEventListener('input', () => { this.explodeFactor = Number(slider.value); apply(); });
        body.append(this.pmGroup('Explode Distance', slider, h('div', { class: 'pm-info' }, 'Spreads floating components away from the assembly center. View only — positions and mates are not changed. Click Exploded View again to collapse.')));
      },
      onCancel: () => { this.explodeFactor = 0; apply(); },
    });
    apply();
  },

  // Display offset of a component in the exploded view.
  explodeOffset(c, center) {
    if (!this.explodeFactor || c.fixed) return null;
    const d = this.asmData.get(c.id)?.data;
    if (!d) return null;
    const lc = [(d.bbox.min[0] + d.bbox.max[0]) / 2, (d.bbox.min[1] + d.bbox.max[1]) / 2, (d.bbox.min[2] + d.bbox.max[2]) / 2];
    const p = [lc[0] + c.position[0] - center[0], lc[1] + c.position[1] - center[1], lc[2] + c.position[2] - center[2]];
    const len = Math.hypot(...p) || 1;
    const size = Math.hypot(d.bbox.max[0] - d.bbox.min[0], d.bbox.max[1] - d.bbox.min[1], d.bbox.max[2] - d.bbox.min[2]);
    const dist = (len + size) * this.explodeFactor;
    return p.map((v) => (v / len) * dist);
  },

  bomRowsAsm() {
    const groups = new Map();
    for (const c of this.doc.components) {
      if (c.suppressed) continue;
      const mat = MATERIALS[c.part.material] || MATERIALS['Plain Carbon Steel'];
      const vol = this.asmData.get(c.id)?.data?.mass.volume || 0;
      const key = `${c.name}|${c.part.material}`;
      const g = groups.get(key) || { name: c.name, material: c.part.material, qty: 0, mass: (vol / 1000) * mat.density };
      g.qty++;
      groups.set(key, g);
    }
    return [...groups.values()].map((g, i) => ({ item: i + 1, ...g }));
  },

  showBOM() {
    const rows = this.bomRowsAsm();
    const table = h('table', { class: 'data-table' },
      h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Part'), h('th', {}, 'Material'), h('th', {}, 'Qty'), h('th', {}, 'Mass each'), h('th', {}, 'Total')),
      ...rows.map((r) => h('tr', {}, h('td', {}, r.item), h('td', {}, r.name), h('td', {}, r.material), h('td', { class: 'num' }, r.qty), h('td', { class: 'num' }, units.fmtMass(r.mass)), h('td', { class: 'num' }, units.fmtMass(r.mass * r.qty)))));
    const csv = ['Item,Part,Material,Qty,Mass each (g),Total (g)', ...rows.map((r) => [r.item, `"${r.name}"`, `"${r.material}"`, r.qty, r.mass.toFixed(3), (r.mass * r.qty).toFixed(3)].join(','))].join('\r\n');
    this.modal({
      title: `Bill of Materials — ${this.doc.name}`, icon: 'bom', width: 640, body: table,
      buttons: [
        { label: 'Export CSV...', onClick: () => { download(csv, `${this.doc.name} BOM.csv`, 'text/csv'); return false; } },
        { label: 'Make Drawing', onClick: () => { this.makeDrawingFrom(this.tab); } },
        { label: 'Close', primary: true },
      ],
    });
  },
};
