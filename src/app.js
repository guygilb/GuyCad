// GuyCAD application controller: documents, commands, UI chrome and part-modeling modes.
// Assembly-specific behaviour lives in assembly-ui.js and is mixed into App.
import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { make3MF, sketchToDXF } from './exporters.js';
import { DrawingMixin } from './drawing-ui.js';
import { Viewport, VIEWS, DISPLAY_STYLES } from './viewport.js';
import { Sketcher, SKETCH_TOOLS, buildSketchObject } from './sketcher.js';
import { STD_PLANES, frameFromNormal, frameMatrix, resolvePlane, revolveAxisOptions, extractLoops, computeFrames } from './geometry.js';
import { RELATION_LABELS, DIMENSION_TYPES } from './constraints.js';
import { KernelClient } from './kernel/client.js';
import { AssemblyMixin } from './assembly-ui.js';
import { solveMates } from './assembly.js';
import { icon } from './icons.js';
import { units, UNIT_DEFS } from './units.js';
import { MATERIALS, FINISHES, SWATCHES, SAMPLES, appearanceOf } from './library.js';
import { $, h, ico, clone, uid, val, evalNumber, native, FILE_FILTERS, download, storage } from './ui.js';

const DEG = 180 / Math.PI;
const SOLID_TYPES = new Set(['extrude', 'revolve', 'sweep', 'loft', 'hole', 'linpattern', 'cirpattern', 'mirror']);
const PICK_FEATURES = new Set(['fillet', 'chamfer', 'shell', 'draft']);
// features that need an existing body
const BODY_FEATURES = new Set(['fillet', 'chamfer', 'shell', 'draft', 'hole']);
// Hole Wizard sizes: clearance hole (normal fit) with matching counterbore / countersink, mm.
const HOLE_SIZES = [
  { label: 'Custom' },
  ...[['M2', 2.4, 4.4, 2.2, 4.4], ['M2.5', 2.9, 5.4, 2.7, 5.5], ['M3', 3.4, 6.5, 3.3, 6.3], ['M4', 4.5, 8, 4.4, 8.4], ['M5', 5.5, 10, 5.4, 10.4],
    ['M6', 6.6, 11, 6.5, 12.4], ['M8', 9, 15, 8.6, 16.4], ['M10', 11, 18, 10.8, 20.4], ['M12', 13.5, 20, 13, 24.4], ['M16', 17.5, 26, 17.5, 32.4],
    ['#4 (inch)', 3.26, 5.94, 2.84, 6.6], ['#6 (inch)', 3.86, 6.86, 3.51, 7.9], ['#8 (inch)', 4.5, 7.92, 4.17, 9.3], ['#10 (inch)', 5.11, 9.53, 4.83, 10.4],
    ['1/4" (inch)', 6.76, 11.13, 6.35, 13.2], ['5/16" (inch)', 8.33, 13.49, 7.92, 16.5], ['3/8" (inch)', 9.92, 15.88, 9.53, 19.6]]
    .map(([label, d, cb, cbd, cs]) => ({ label: `${label} clearance`, d, cb, cbd, cs })),
];
// sketch references held by each feature type
const sketchRefs = (f) => [f.sketch, f.profile, f.path, ...(f.sections || [])].filter(Boolean);

const SETTINGS_KEY = 'guycad.settings';
const AUTOSAVE_KEY = 'guycad.autosave';
const DEFAULT_SETTINGS = {
  userName: 'Guy',
  units: 'mm',
  theme: 'light',
  accent: '#e8590c',
  background: 'gradient',
  gridStep: 5,
  showGrid: true,
  snapGrid: true,
  polygonSides: 6,
  showWelcome: true,
  displayStyle: 'shadedEdges',
  showPlanes: false,
  showOrigin: true,
  showSketches: true,
  sketchFilletRadius: 3,
  offsetDistance: 2,
};

const FEATURE_META = {
  sketch: { icon: 'sketch', prefix: 'Sketch', label: 'Sketch' },
  extrude: { icon: (f) => (f.cut ? 'extrudeCut' : 'extrude'), prefix: (f) => (f.cut ? 'Cut-Extrude' : 'Boss-Extrude'), label: (f) => (f.cut ? 'Cut-Extrude' : 'Boss-Extrude') },
  revolve: { icon: (f) => (f.cut ? 'revolveCut' : 'revolve'), prefix: (f) => (f.cut ? 'Cut-Revolve' : 'Revolve'), label: (f) => (f.cut ? 'Cut-Revolve' : 'Revolve') },
  sweep: { icon: (f) => (f.cut ? 'sweepCut' : 'sweep'), prefix: (f) => (f.cut ? 'Cut-Sweep' : 'Sweep'), label: (f) => (f.cut ? 'Swept Cut' : 'Swept Boss/Base') },
  loft: { icon: (f) => (f.cut ? 'loftCut' : 'loft'), prefix: (f) => (f.cut ? 'Cut-Loft' : 'Loft'), label: (f) => (f.cut ? 'Lofted Cut' : 'Lofted Boss/Base') },
  draft: { icon: 'draft', prefix: 'Draft', label: 'Draft' },
  hole: { icon: 'hole', prefix: (f) => ({ cbore: 'CBORE Hole', csink: 'CSK Hole' }[f.holeType] || 'Hole'), label: 'Hole Wizard' },
  import: { icon: 'import', prefix: 'Imported', label: 'Imported Body' },
  fillet: { icon: 'fillet', prefix: 'Fillet', label: 'Fillet' },
  chamfer: { icon: 'chamfer', prefix: 'Chamfer', label: 'Chamfer' },
  shell: { icon: 'shell', prefix: 'Shell', label: 'Shell' },
  linpattern: { icon: 'linpattern', prefix: 'LPattern', label: 'Linear Pattern' },
  cirpattern: { icon: 'cirpattern', prefix: 'CirPattern', label: 'Circular Pattern' },
  mirror: { icon: 'mirror', prefix: 'Mirror', label: 'Mirror' },
  plane: { icon: 'plane', prefix: 'Plane', label: 'Plane' },
};
export const featIcon = (f) => val(FEATURE_META[f.type]?.icon || 'part', f);

const VIEW_ICONS = { front: 'front', back: 'front', left: 'right', right: 'right', top: 'top', bottom: 'top', iso: 'iso', trimetric: 'iso', dimetric: 'iso' };

// Index of the face/edge of serialized body data closest to a point (references are stored as points).
function nearestFace(data, p, tol = 0.05) {
  if (!data) return -1;
  const v = data.vertices, idx = data.indices;
  const tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  const P = new THREE.Vector3(...p);
  let best = -1, bestD = tol;
  for (let f = 0; f < data.faceRanges.length / 2; f++) {
    const start = data.faceRanges[f * 2], count = data.faceRanges[f * 2 + 1];
    for (let t = start; t < start + count; t += 3) {
      a.fromArray(v, idx[t] * 3); b.fromArray(v, idx[t + 1] * 3); c.fromArray(v, idx[t + 2] * 3);
      tri.set(a, b, c).closestPointToPoint(P, q);
      const d = q.distanceTo(P);
      if (d < bestD) { bestD = d; best = f; }
    }
  }
  return best;
}

function nearestEdge(data, p, tol = 0.05) {
  if (!data) return -1;
  const L = data.edgeLines;
  const P = new THREE.Vector3(...p);
  const seg = new THREE.Line3(), q = new THREE.Vector3();
  let best = -1, bestD = tol;
  for (let e = 0; e < data.edgeRanges.length / 2; e++) {
    const start = data.edgeRanges[e * 2], count = data.edgeRanges[e * 2 + 1];
    for (let s = start; s < start + count; s += 2) {
      seg.start.fromArray(L, s * 3); seg.end.fromArray(L, (s + 1) * 3);
      seg.closestPointToPoint(P, true, q);
      const d = q.distanceTo(P);
      if (d < bestD) { bestD = d; best = e; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ app

export class App {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...(storage.get(SETTINGS_KEY) || {}) };
    units.set(this.settings.units);
    this.applyTheme();
    this.kernel = new KernelClient();
    this.tabs = [];
    this.tabIndex = 0;
    this.openTab(this.blankDoc());
    this.mode = 'model'; // model | pm | sketch | pickPlane
    this.selection = null;
    this.hover = null;
    this.treeHover = null;
    this.pm = null;
    this.cmTab = 'Features';
    this.lpTab = 'tree';
    this.section = null;
    this.measure = null;
    this.tpTab = null;
    this.tpPinned = false;
    this.build = { data: null, planes: {}, frames: {}, errors: {}, times: {} };
    this.buildSeq = 0;
    this.partCache = new Map();

    this.viewport = new Viewport($('#viewport'));
    this.viewport.setDisplayStyle(this.settings.displayStyle);
    this.sketcher = new Sketcher(this);
    this.sketchObjects = new THREE.Group();
    this.viewport.sketchGroup.add(this.sketchObjects);
    this.measureGroup = new THREE.Group();
    this.viewport.overlay.add(this.measureGroup);
    $('#viewport').append(h('div', { class: 'vp-watermark' }, 'GuyCAD'));
    this.initAssembly();
    this.initDrawing();

    this.buildCommands();
    this.buildMenubar();
    this.buildQuickAccess();
    this.buildCommandManager();
    this.buildLeftPanel();
    this.buildHud();
    this.buildTaskPane();
    this.buildStatusBar();
    this.bindViewport();
    this.bindKeys();
    this.bindSplitter();

    $('#file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) this.loadDocText(await file.text(), { name: file.name });
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.tabs.some((t) => t.dirty && !t.link)) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.menu, .menu-btn, .view-flyout, .hud-btn, .doc-tab-add')) this.closeMenus();
      if (this.tpTab && !this.tpPinned && !e.target.closest('#taskpane, .modal')) this.openTaskPane(null);
    });

    this.kernel.ready.then(() => this.setBusy(false)).catch((e) => this.toast(`Geometry kernel failed to start: ${e.message}`, 'error'));
    this.setBusy(true, 'Starting geometry kernel…');
    this.rebuildModel();
    this.refreshAll();
    this.viewport.setView(VIEWS.trimetric.dir, { fit: true, animate: false });
    const openArg = new URLSearchParams(location.search).get('open');
    if (native && openArg) {
      native.readFile(openArg).then((res) => this.loadDocText(res.text, { filePath: res.filePath, name: res.name }))
        .catch(() => this.toast(`Could not open ${openArg}`, 'error'));
    } else if (this.settings.showWelcome) this.showWelcome();
  }

  evalNumber(s) { return evalNumber(s); }

  blankDoc(type = 'part') {
    const base = { version: 2, author: this.settings?.userName || '', created: new Date().toISOString() };
    if (type === 'assembly') return { ...base, type: 'assembly', name: this.nextDocName('Assembly'), components: [], mates: [] };
    if (type === 'drawing') return this.blankDrawing(base);
    return { ...base, type: 'part', name: this.nextDocName('Part'), material: 'Plain Carbon Steel', appearance: null, features: [], rollback: null };
  }

  nextDocName(prefix) {
    let i = 1;
    while ((this.tabs || []).some((t) => t.doc.name === `${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }

  // ================================================================ documents & tabs

  get tab() { return this.tabs[this.tabIndex]; }
  get doc() { return this.tab.doc; }
  set doc(v) {
    this.tab.doc = v;
    if (this.tab.link) this.writeLinkedPart(this.tab);
  }
  get undoStack() { return this.tab.undoStack; }
  set undoStack(v) { this.tab.undoStack = v; }
  get redoStack() { return this.tab.redoStack; }
  set redoStack(v) { this.tab.redoStack = v; }
  get dirty() { return this.tab.dirty; }
  set dirty(v) {
    this.tab.dirty = v;
    if (v && this.tab.link) this.writeLinkedPart(this.tab);
  }
  get isAsm() { return this.doc.type === 'assembly'; }
  get isDrawing() { return this.doc.type === 'drawing'; }
  get isPart() { return !this.isAsm && !this.isDrawing; }

  openTab(doc, extra = {}) {
    const tab = { id: uid('t'), doc, undoStack: [], redoStack: [], dirty: false, fileHandle: null, filePath: null, link: null, view: null, ...extra };
    this.tabs.push(tab);
    this.tabIndex = this.tabs.length - 1;
    return tab;
  }

  writeLinkedPart(tab) {
    const asm = this.tabs.find((t) => t.id === tab.link.asmTabId);
    const comp = asm?.doc.components?.find((c) => c.id === tab.link.compId);
    if (!comp) return;
    comp.part = tab.doc;
    comp.name = tab.doc.name;
    asm.dirty = true;
    asm.stale = true;
  }

  saveView() {
    const vp = this.viewport;
    if (!vp || !this.tab) return;
    this.tab.view = { pos: vp.camera.position.toArray(), target: vp.controls.target.toArray(), zoom: vp.camera.zoom };
  }

  restoreView(fit) {
    const v = this.tab.view;
    const vp = this.viewport;
    if (!v) { vp.setView(VIEWS.trimetric.dir, { fit, animate: false }); return; }
    vp.camera.position.fromArray(v.pos);
    vp.controls.target.fromArray(v.target);
    vp.camera.zoom = v.zoom;
    vp.camera.updateProjectionMatrix();
    vp.controls.update();
  }

  async switchTab(i) {
    if (i === this.tabIndex || !this.tabs[i]) return;
    this.resetModes(true);
    this.saveView();
    this.tabIndex = i;
    const t = this.tab;
    if (t.link) {
      const asm = this.tabs.find((x) => x.id === t.link.asmTabId);
      const comp = asm?.doc.components.find((c) => c.id === t.link.compId);
      if (comp && comp.part !== t.doc) t.doc = comp.part;
      if (!comp) t.link = null;
    }
    this.selection = null;
    this.cmTab = this.defaultCmTab();
    this.buildCommandManager();
    this.restoreView(true);
    this.refreshAll();
    await this.rebuildModel();
    if (!t.view) this.viewport.zoomToFit(false);
  }

  async closeTab(i) {
    const t = this.tabs[i];
    if (!t) return;
    if (t.dirty && !t.link && !(await this.confirmBox(`Close ${t.doc.name} without saving?`, { okLabel: 'Close' }))) return;
    if (i === this.tabIndex) this.resetModes(true);
    // closing an assembly also closes the parts opened from it
    const closing = new Set([t.id, ...this.tabs.filter((x) => x.link?.asmTabId === t.id).map((x) => x.id)]);
    const activeId = this.tab.id;
    this.tabs = this.tabs.filter((x) => !closing.has(x.id));
    if (!this.tabs.length) this.openTab(this.blankDoc());
    const keep = this.tabs.findIndex((x) => x.id === activeId);
    this.tabIndex = keep >= 0 ? keep : Math.min(i, this.tabs.length - 1);
    this.selection = null;
    this.cmTab = this.defaultCmTab();
    this.buildCommandManager();
    this.restoreView(true);
    this.refreshAll();
    await this.rebuildModel();
  }

  renderTabs() {
    const bar = $('#doc-tabs');
    bar.replaceChildren();
    this.tabs.forEach((t, i) => {
      const el = h('div', { class: `doc-tab${i === this.tabIndex ? ' active' : ''}`, title: t.filePath || t.doc.name, onclick: () => this.switchTab(i) },
        ico({ assembly: 'assembly', drawing: 'drawing' }[t.doc.type] || 'part'),
        h('span', { class: 'dt-name' }, `${t.doc.name}${t.dirty && !t.link ? ' *' : ''}`),
        t.link ? h('span', { class: 'dt-link' }, `in ${this.tabs.find((x) => x.id === t.link.asmTabId)?.doc.name || 'assembly'}`) : null,
        h('button', { class: 'dt-close', title: 'Close', onclick: (e) => { e.stopPropagation(); this.closeTab(i); } }, '×'));
      bar.append(el);
    });
    bar.append(h('button', {
      class: 'doc-tab-add', title: 'New document', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.openMenu([{ label: 'New Part', icon: 'new', run: () => this.cmdNew('part') }, { label: 'New Assembly', icon: 'assembly', run: () => this.cmdNew('assembly') }], r.left, r.bottom);
      },
    }, '+'));
  }

  // ================================================================ commands

  buildCommands() {
    const C = {};
    const add = (id, label, iconName, run, extra = {}) => { C[id] = { id, label, icon: iconName, run, ...extra }; };
    const inSketch = () => this.mode === 'sketch';
    const part = () => this.isPart;
    add('new', 'New Part', 'new', () => this.cmdNew('part'), { tip: 'Create a new part' });
    add('newAssembly', 'New Assembly', 'assembly', () => this.cmdNew('assembly'));
    add('open', 'Open...', 'open', () => this.cmdOpen(), { short: 'Ctrl+O' });
    add('save', 'Save', 'save', () => this.cmdSave(false), { short: 'Ctrl+S' });
    add('saveAs', 'Save As...', 'save', () => this.cmdSave(true), { short: 'Ctrl+Shift+S' });
    add('closeDoc', 'Close Document', 'cancel', () => this.closeTab(this.tabIndex), { short: 'Ctrl+W' });
    add('exportSTEP', 'STEP (*.step)', 'export', () => this.exportModel('step'));
    add('exportSTL', 'STL (*.stl)', 'export', () => this.exportModel('stl'));
    add('exportOBJ', 'OBJ (*.obj)', 'export', () => this.exportModel('obj'));
    add('exportGLB', 'glTF Binary (*.glb)', 'export', () => this.exportModel('glb'));
    add('screenshot', 'Save Screenshot', 'camera', () => this.screenshot());
    add('makeAssembly', 'Make Assembly from Part', 'assembly', () => this.makeAssemblyFromPart(), { enabled: part });
    add('undo', 'Undo', 'undo', () => this.undo(), { short: 'Ctrl+Z', enabled: () => (inSketch() ? this.sketcher.undoStack.length > 0 : !this.pm && this.undoStack.length > 0) });
    add('redo', 'Redo', 'redo', () => this.redo(), { short: 'Ctrl+Y', enabled: () => (inSketch() ? this.sketcher.redoStack.length > 0 : !this.pm && this.redoStack.length > 0) });
    add('rebuild', 'Rebuild', 'rebuild', async () => { this.partCache.clear(); await this.rebuildModel(); this.toast('Model rebuilt', 'ok'); }, { short: 'Ctrl+B' });
    add('delete', 'Delete', 'trash', () => this.deleteSelection(), { short: 'Del', enabled: () => this.mode === 'model' && ['feature', 'component', 'mate'].includes(this.selection?.kind) });
    add('options', 'Options...', 'options', () => this.showOptions());
    add('shortcuts', 'Keyboard Shortcuts', 'help', () => this.showShortcuts());
    add('about', 'About GuyCAD', 'help', () => this.showAbout());
    add('welcome', 'Welcome Screen', 'new', () => this.showWelcome());
    add('sketch', () => (inSketch() ? 'Exit Sketch' : 'Sketch'), () => (inSketch() ? 'exitSketch' : 'sketch'),
      () => (inSketch() ? this.exitSketch(true) : this.cmdSketch()), { big: true, active: () => this.mode === 'pickPlane', enabled: part });
    for (const [id, t] of Object.entries(SKETCH_TOOLS)) {
      add(`tool:${id}`, t.label, t.icon, () => this.sketchTool(id), {
        active: () => inSketch() && this.sketcher.tool === id,
        short: t.key && t.key.length === 1 ? t.key.toUpperCase() : undefined,
        enabled: part,
      });
    }
    add('addRelation', 'Add Relation', 'relation', () => { this.lpTab = 'pm'; this.refreshLeftTabs(); this.toast('Select entities or points; available relations appear in the PropertyManager'); }, { enabled: inSketch });
    add('construction', 'Construction Geometry', 'construction', () => {
      const on = ![...this.sketcher.selected].every((i) => this.sketcher.entities[i]?.construction);
      this.sketcher.setConstruction(on);
    }, { enabled: () => inSketch() && this.sketcher.selected.size > 0 });
    add('sketchDelete', 'Delete Entities', 'trash', () => this.sketcher.deleteSelected(), { enabled: () => inSketch() && (this.sketcher.selected.size > 0 || this.sketcher.selConstraint >= 0) });
    add('toggleGrid', 'Show Grid', 'grid', () => this.toggleSetting('showGrid'), { active: () => this.settings.showGrid });
    add('toggleSnap', 'Snap to Grid', 'grid', () => this.toggleSetting('snapGrid'), { active: () => this.settings.snapGrid });
    add('extrude', 'Extruded Boss/Base', 'extrude', () => this.cmdFeature('extrude', false), { big: true, enabled: part });
    add('revolve', 'Revolved Boss/Base', 'revolve', () => this.cmdFeature('revolve', false), { big: true, enabled: part });
    add('extrudeCut', 'Extruded Cut', 'extrudeCut', () => this.cmdFeature('extrude', true), { enabled: part });
    add('revolveCut', 'Revolved Cut', 'revolveCut', () => this.cmdFeature('revolve', true), { enabled: part });
    add('fillet', 'Fillet', 'fillet', () => this.cmdFeature('fillet'), { enabled: part });
    add('chamfer', 'Chamfer', 'chamfer', () => this.cmdFeature('chamfer'), { enabled: part });
    add('shell', 'Shell', 'shell', () => this.cmdFeature('shell'), { enabled: part });
    add('linpattern', 'Linear Pattern', 'linpattern', () => this.cmdFeature('linpattern'), { enabled: part });
    add('cirpattern', 'Circular Pattern', 'cirpattern', () => this.cmdFeature('cirpattern'), { enabled: part });
    add('mirror', 'Mirror', 'mirror', () => this.cmdFeature('mirror'), { enabled: part });
    add('plane', 'Plane', 'plane', () => this.cmdFeature('plane'), { enabled: part });
    add('sweep', 'Swept Boss/Base', 'sweep', () => this.cmdFeature('sweep', false), { enabled: part });
    add('sweepCut', 'Swept Cut', 'sweepCut', () => this.cmdFeature('sweep', true), { enabled: part });
    add('loft', 'Lofted Boss/Base', 'loft', () => this.cmdFeature('loft', false), { enabled: part });
    add('loftCut', 'Lofted Cut', 'loftCut', () => this.cmdFeature('loft', true), { enabled: part });
    add('draft', 'Draft', 'draft', () => this.cmdFeature('draft'), { enabled: part });
    add('hole', 'Hole Wizard', 'hole', () => this.cmdFeature('hole'), { enabled: part });
    add('offsetEntities', 'Offset Entities', 'offsetEntities', () => this.sketcher.offsetSelected(this.settings.offsetDistance, false), { enabled: () => inSketch() && this.sketcher.selected.size > 0 });
    add('mirrorEntities', 'Mirror Entities', 'mirrorEntities', () => this.sketcher.mirrorSelected(), { enabled: () => inSketch() && this.sketcher.selected.size > 0 });
    add('importModel', 'Import (STEP, STL, BREP)...', 'import', () => this.cmdImport());
    add('exportBREP', 'BREP (*.brep) — OpenCascade', 'export', () => this.exportModel('brep'));
    add('export3MF', '3MF (*.3mf) — 3D printing', 'export', () => this.exportModel('3mf'));
    add('exportSTLascii', 'STL ASCII (*.stl)', 'export', () => this.exportModel('stl-ascii'));
    add('exportPLY', 'PLY (*.ply)', 'export', () => this.exportModel('ply'));
    add('exportGLTF', 'glTF (*.gltf)', 'export', () => this.exportModel('gltf'));
    add('exportUSDZ', 'USDZ (*.usdz) — AR', 'export', () => this.exportModel('usdz'));
    add('exportSketchDXF', 'Selected Sketch as DXF...', 'export', () => this.exportSketchDXF(), { enabled: () => this.isPart && (this.mode === 'sketch' || this.byId(this.selection?.id)?.type === 'sketch') });
    add('measure', 'Measure', 'measure', () => this.cmdMeasure(), { active: () => !!this.measure });
    add('massProps', 'Mass Properties', 'mass', () => this.showMassProps());
    add('section', 'Section View', 'section', () => this.cmdSection(), { active: () => !!this.section });
    add('stats', 'Feature Statistics', 'stats', () => this.showStats(), { enabled: part });
    for (const [id, v] of Object.entries(VIEWS)) add(`view:${id}`, v.label, VIEW_ICONS[id], () => this.setView(id), { short: v.key });
    add('normalTo', 'Normal To', 'normalTo', () => this.normalTo(), { short: '8' });
    add('zoomFit', 'Zoom to Fit', 'zoomFit', () => (this.isDrawing ? this.fitSheet() : this.viewport.zoomToFit()), { short: 'F' });
    for (const [id, label] of Object.entries(DISPLAY_STYLES)) {
      add(`style:${id}`, label, 'displayStyle', () => this.setDisplayStyle(id), { active: () => this.viewport.displayStyle === id });
    }
    add('togglePlanes', 'Planes', 'plane', () => this.toggleSetting('showPlanes'), { active: () => this.settings.showPlanes });
    add('toggleOrigin', 'Origin', 'origin', () => this.toggleSetting('showOrigin'), { active: () => this.settings.showOrigin });
    add('toggleSketches', 'Sketches', 'sketch', () => this.toggleSetting('showSketches'), { active: () => this.settings.showSketches });
    add('appearance', 'Edit Appearance', 'appearance', () => this.openTaskPane('appearance'));
    add('material', 'Edit Material', 'material', () => this.openTaskPane('material'), { enabled: part });
    this.addAssemblyCommands(add);
    this.addDrawingCommands(add);
    this.commands = C;
  }

  run(id, ev) {
    const c = this.commands[id];
    if (!c || (c.enabled && !c.enabled())) return;
    this.closeMenus();
    c.run(ev);
    this.refreshChrome();
  }

  toggleSetting(key) {
    this.settings[key] = !this.settings[key];
    this.saveSettings();
    if (key === 'showGrid') this.sketcher.gridSig = '';
    this.refreshScene();
    if (this.pm?.kind === 'sketch') this.renderPM();
  }

  saveSettings() { storage.set(SETTINGS_KEY, this.settings); }

  // ================================================================ chrome: menus

  menuItems(list) {
    return list.map((it) => {
      if (it === '|') return '|';
      if (typeof it === 'string') {
        const c = this.commands[it];
        return {
          label: val(c.label), icon: val(c.icon), short: c.short, run: (ev) => this.run(it, ev),
          disabled: c.enabled ? !c.enabled() : false, checked: c.active ? c.active() : false,
        };
      }
      if (it.items) return { ...it, items: () => this.menuItems(val(it.items)) };
      return it;
    });
  }

  buildMenubar() {
    const tools = Object.keys(SKETCH_TOOLS).filter((t) => t !== 'select').map((t) => `tool:${t}`);
    this.menus = {
      File: () => ['new', 'newAssembly', 'newDrawing', 'open', '|', 'save', 'saveAs', 'closeDoc', '|', 'importModel',
        this.isDrawing
          ? { label: 'Export', icon: 'export', items: ['exportPDF', 'exportSVG', 'exportDXF'] }
          : { label: 'Export', icon: 'export', items: [{ head: 'Exact solids (CAD)' }, 'exportSTEP', 'exportBREP', { head: 'Meshes (3D printing, rendering)' }, 'exportSTL', 'exportSTLascii', 'export3MF', 'exportOBJ', 'exportPLY', 'exportGLB', 'exportGLTF', 'exportUSDZ', { head: '2D' }, 'exportSketchDXF'] },
        'screenshot', '|', 'makeAssembly', 'makeDrawing', '|', 'welcome'],
      Edit: ['undo', 'redo', '|', 'delete', 'rebuild', '|',
        { label: 'Suppress', run: () => this.suppressSelected(true), disabled: () => this.selection?.kind !== 'feature' && this.selection?.kind !== 'mate' },
        { label: 'Unsuppress', run: () => this.suppressSelected(false), disabled: () => this.selection?.kind !== 'feature' && this.selection?.kind !== 'mate' },
        { label: 'Rename...', run: () => this.renameSelection(), disabled: () => !['feature', 'component', 'mate'].includes(this.selection?.kind) }],
      View: [{ head: 'Orientation' }, ...Object.keys(VIEWS).map((v) => `view:${v}`), 'normalTo', 'zoomFit', '|', { head: 'Display Style' },
        ...Object.keys(DISPLAY_STYLES).map((s) => `style:${s}`), '|', { head: 'Show' }, 'togglePlanes', 'toggleOrigin', 'toggleSketches'],
      Insert: () => (this.isDrawing ? this.drawingInsertMenu() : this.isAsm
        ? ['insertComponent', 'mate', '|', 'moveComponent', 'rotateComponent', '|', 'explode']
        : [
          { label: 'Boss/Base', icon: 'extrude', items: ['extrude', 'revolve', 'sweep', 'loft'] },
          { label: 'Cut', icon: 'extrudeCut', items: ['extrudeCut', 'revolveCut', 'sweepCut', 'loftCut'] },
          { label: 'Features', icon: 'fillet', items: ['hole', 'fillet', 'chamfer', 'shell', 'draft'] },
          { label: 'Pattern/Mirror', icon: 'linpattern', items: ['linpattern', 'cirpattern', 'mirror'] },
          { label: 'Reference Geometry', icon: 'plane', items: ['plane'] }, '|', 'sketch']),
      Tools: [{ label: 'Sketch Entities', icon: 'line', items: tools }, { label: 'Sketch Tools', icon: 'trim', items: ['tool:sfillet', 'tool:trim', 'offsetEntities', 'mirrorEntities'] }, 'addRelation', 'construction', '|', 'measure', 'massProps', 'section', 'interference', 'bom', 'stats', '|', 'appearance', 'material', '|', 'options'],
      Help: ['shortcuts', 'welcome', '|', 'about'],
    };
    const bar = $('#menubar');
    for (const name of Object.keys(this.menus)) {
      const btn = h('button', { class: 'menu-btn' }, name);
      const open = () => {
        this.closeMenus();
        btn.classList.add('open');
        const r = btn.getBoundingClientRect();
        this.openMenu(this.menuItems(val(this.menus[name])).map((it) => (it.disabled && typeof it.disabled === 'function' ? { ...it, disabled: it.disabled() } : it)), r.left, r.bottom);
      };
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (btn.classList.contains('open')) this.closeMenus(); else open(); });
      btn.addEventListener('pointerenter', () => { if ($('.menu-btn.open') && !btn.classList.contains('open')) open(); });
      bar.append(btn);
    }
    $('.brand-logo').innerHTML = icon('logo');
    this.renderUserBadge();
  }

  renderUserBadge() {
    const initials = (this.settings.userName || 'G').trim().slice(0, 1).toUpperCase();
    $('#user-badge').replaceChildren(h('span', { class: 'avatar' }, initials), h('span', {}, this.settings.userName || ''));
  }

  openMenu(items, x, y, level = 0) {
    const layer = $('#menus-layer');
    [...layer.querySelectorAll('.menu')].filter((m) => Number(m.dataset.level) >= level).forEach((m) => m.remove());
    const menu = h('div', { class: 'menu', 'data-level': level });
    for (const it of items) {
      if (it === '|') { menu.append(h('div', { class: 'menu-sep' })); continue; }
      if (it.head) { menu.append(h('div', { class: 'menu-head' }, it.head)); continue; }
      const disabled = val(it.disabled);
      const row = h('div', { class: `menu-item${disabled ? ' disabled' : ''}${it.items ? ' has-sub' : ''}${val(it.checked) ? ' checked' : ''}` },
        h('span', { class: 'mi-icon', html: val(it.checked) ? '' : it.icon ? icon(it.icon) : '' }),
        h('span', { class: 'mi-label' }, it.label),
        it.short ? h('span', { class: 'mi-short' }, it.short) : null);
      if (it.items) {
        row.addEventListener('pointerenter', () => {
          const r = row.getBoundingClientRect();
          this.openMenu(val(it.items), r.right - 2, r.top - 4, level + 1);
        });
      } else {
        row.addEventListener('pointerenter', () => [...layer.querySelectorAll('.menu')].filter((m) => Number(m.dataset.level) > level).forEach((m) => m.remove()));
        row.addEventListener('click', (ev) => { if (disabled) return; this.closeMenus(); it.run?.(ev); this.refreshChrome(); });
      }
      menu.append(row);
    }
    layer.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
    return menu;
  }

  closeMenus() {
    const layer = $('#menus-layer');
    const had = layer.children.length > 0;
    layer.replaceChildren();
    document.querySelectorAll('.menu-btn.open').forEach((b) => b.classList.remove('open'));
    return had;
  }

  // ================================================================ chrome: toolbars

  buildQuickAccess() {
    const qa = $('#quickaccess');
    this.qaButtons = {};
    for (const id of ['new', 'open', 'save', '|', 'undo', 'redo', '|', 'rebuild', 'options']) {
      if (id === '|') { qa.append(h('span', { class: 'cm-sep' })); continue; }
      const c = this.commands[id];
      const b = h('button', { class: 'qa-btn', title: `${val(c.label)}${c.short ? ` (${c.short})` : ''}`, html: icon(val(c.icon)), onclick: () => this.run(id) });
      this.qaButtons[id] = b;
      qa.append(b);
    }
  }

  defaultCmTab() {
    return { assembly: 'Assembly', drawing: 'Drawing' }[this.doc.type] || 'Features';
  }

  buildCommandManager() {
    const viewTab = ['view:front', 'view:top', 'view:right', 'view:iso', 'normalTo', 'zoomFit', '|', 'style:shadedEdges', 'style:shaded', 'style:hiddenRemoved', 'style:hiddenVisible', 'style:wireframe', '|', 'screenshot'];
    if (this.isDrawing) this.cmTabs = this.drawingCmTabs();
    else if (this.isAsm) {
      this.cmTabs = {
        Assembly: ['insertComponent', 'mate', '|', 'moveComponent', 'rotateComponent', '|', 'editPart', 'fixComponent', '|', 'explode', 'bom', '|', 'makeDrawing'],
        Evaluate: ['measure', 'massProps', 'section', 'interference', 'bom'],
        View: viewTab,
      };
    } else {
      this.cmTabs = {
        Features: ['extrude', 'revolve', 'sweep', 'loft', '|', 'extrudeCut', 'revolveCut', 'sweepCut', 'loftCut', '|', 'hole', 'fillet', 'chamfer', 'shell', 'draft', '|', 'linpattern', 'cirpattern', 'mirror', '|', 'plane', '|', 'sketch', 'makeDrawing'],
        Sketch: ['sketch', '|', 'tool:select', 'tool:dimension', '|', 'tool:line', 'tool:centerline', 'tool:rect', 'tool:crect', 'tool:slot', 'tool:circle', 'tool:arc', 'tool:polygon', 'tool:spline', 'tool:point', '|', 'tool:sfillet', 'tool:trim', 'offsetEntities', 'mirrorEntities', '|', 'addRelation', 'construction', 'sketchDelete', '|', 'toggleGrid', 'toggleSnap'],
        Evaluate: ['measure', 'massProps', 'section', 'stats'],
        View: viewTab,
      };
    }
    if (!this.cmTabs[this.cmTab]) this.cmTab = Object.keys(this.cmTabs)[0];
    const tabs = $('#cm-tabs');
    tabs.replaceChildren();
    for (const name of Object.keys(this.cmTabs)) {
      tabs.append(h('button', { class: `cm-tab${name === this.cmTab ? ' active' : ''}`, onclick: () => { this.cmTab = name; this.buildCommandManager(); } }, name));
    }
    const wrap = $('#cm-buttons');
    wrap.replaceChildren();
    this.cmButtons = {};
    for (const id of this.cmTabs[this.cmTab]) {
      if (id === '|') { wrap.append(h('span', { class: 'cm-sep' })); continue; }
      const c = this.commands[id];
      const b = h('button', { class: `cm-btn${c.big ? ' big' : ''}`, onclick: (ev) => this.run(id, ev) },
        h('span', { class: 'cm-icon' }), h('span', { class: 'cm-label' }));
      this.cmButtons[id] = b;
      wrap.append(b);
    }
    this.refreshChrome();
  }

  buildLeftPanel() {
    const tabs = $('#lp-tabs');
    for (const [id, ic, title] of [['tree', 'tree', 'FeatureManager Design Tree'], ['pm', 'pm', 'PropertyManager']]) {
      tabs.append(h('button', { class: 'lp-tab', 'data-tab': id, title, html: icon(ic), onclick: () => { this.lpTab = id; this.refreshLeftTabs(); } }));
    }
    this.refreshLeftTabs();
  }

  refreshLeftTabs() {
    document.querySelectorAll('.lp-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.lpTab));
    $('#tree').classList.toggle('active', this.lpTab === 'tree');
    $('#pm').classList.toggle('active', this.lpTab === 'pm');
  }

  buildHud() {
    const hud = $('#hud');
    const btn = (title, ic, onclick, extra = '') => h('button', { class: `hud-btn ${extra}`, title, html: icon(ic), onclick });
    this.hudSection = btn('Section View', 'section', () => this.run('section'));
    hud.append(
      btn('Zoom to Fit (F)', 'zoomFit', () => this.viewport.zoomToFit()),
      btn('Normal To (8)', 'normalTo', () => this.normalTo()),
      h('span', { class: 'hud-sep' }),
      this.hudSection,
      btn('View Orientation (Space)', 'viewOrient', (e) => this.showViewFlyout(e.currentTarget), 'dd'),
      btn('Display Style', 'displayStyle', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.closeMenus();
        this.openMenu(this.menuItems(Object.keys(DISPLAY_STYLES).map((s) => `style:${s}`)), r.left, r.bottom + 4);
      }, 'dd'),
      btn('Hide/Show Items', 'hideShow', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.closeMenus();
        this.openMenu(this.menuItems(['togglePlanes', 'toggleOrigin', 'toggleSketches']), r.left, r.bottom + 4);
      }, 'dd'),
      h('span', { class: 'hud-sep' }),
      btn('Edit Appearance', 'appearance', () => this.openTaskPane('appearance')),
      btn('Save Screenshot', 'camera', () => this.screenshot()),
    );
  }

  showViewFlyout(anchor) {
    this.closeMenus();
    const fly = h('div', { class: 'view-flyout' });
    for (const v of ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'trimetric']) {
      fly.append(h('button', { onclick: () => { this.closeMenus(); this.setView(v); } }, ico(VIEW_ICONS[v]), VIEWS[v].label));
    }
    fly.append(h('button', { onclick: () => { this.closeMenus(); this.normalTo(); } }, ico('normalTo'), 'Normal To'));
    fly.append(h('button', { onclick: () => { this.closeMenus(); this.viewport.zoomToFit(); } }, ico('zoomFit'), 'Zoom to Fit'));
    $('#menus-layer').append(fly);
    const fr = fly.getBoundingClientRect();
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      fly.style.left = `${Math.min(r.left, window.innerWidth - fr.width - 4)}px`;
      fly.style.top = `${r.bottom + 4}px`;
    } else {
      const vr = this.viewport.el.getBoundingClientRect();
      fly.style.left = `${vr.left + vr.width / 2 - fr.width / 2}px`;
      fly.style.top = `${vr.top + vr.height / 2 - fr.height / 2}px`;
    }
  }

  buildStatusBar() {
    $('#sb-units').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.closeMenus();
      const menu = this.openMenu(Object.entries(UNIT_DEFS).map(([id, d]) => ({
        label: `${d.system} (${d.label}, ${d.mass.label}, s)`, checked: units.id === id, run: () => this.setUnits(id),
      })), r.left, r.top);
      menu.style.top = `${r.top - menu.offsetHeight - 2}px`;
    });
  }

  setBusy(on, text = 'Rebuilding…') {
    const el = $('#sb-busy');
    el.hidden = !on;
    el.textContent = text;
  }

  setUnits(id) {
    this.settings.units = id;
    units.set(id);
    this.saveSettings();
    this.refreshAll();
    this.toast(`Units set to ${UNIT_DEFS[id].system}`);
  }

  bindSplitter() {
    const sp = $('#splitter');
    sp.addEventListener('pointerdown', (e) => {
      sp.setPointerCapture(e.pointerId);
      const move = (ev) => $('#workspace').style.setProperty('--lp-width', `${Math.max(190, Math.min(520, ev.clientX))}px`);
      const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });
  }

  refreshChrome() {
    if (!this.commands) return;
    for (const [id, b] of Object.entries(this.qaButtons || {})) {
      const c = this.commands[id];
      b.disabled = c.enabled ? !c.enabled() : false;
    }
    for (const [id, b] of Object.entries(this.cmButtons || {})) {
      const c = this.commands[id];
      b.querySelector('.cm-icon').innerHTML = icon(val(c.icon));
      b.querySelector('.cm-label').textContent = val(c.label);
      b.title = `${val(c.label)}${c.short ? ` (${c.short})` : ''}`;
      b.disabled = c.enabled ? !c.enabled() : false;
      b.classList.toggle('active', c.active ? !!c.active() : false);
    }
    this.hudSection?.classList.toggle('active', !!this.section);
    const sketchName = this.mode === 'sketch' ? this.sketcher.feature?.name : null;
    $('#doc-title').replaceChildren(h('b', {}, this.doc.name), `${this.dirty ? ' *' : ''}  —  ${{ assembly: 'Assembly', drawing: 'Drawing' }[this.doc.type] || 'Part'}`, sketchName ? `  —  ${sketchName}` : '');
    document.title = `${this.doc.name}${this.dirty ? ' *' : ''} — GuyCAD`;
    let editing = `Editing ${this.doc.name}`;
    if (this.mode === 'sketch') {
      const a = this.sketcher.analysis;
      const st = !a ? '' : a.status === 'over' ? 'Over Defined' : a.status === 'full' ? 'Fully Defined' : `Under Defined (${a.dof} DOF)`;
      editing = `${st}   |   Editing ${sketchName}`;
    }
    $('#sb-editing').textContent = editing;
    $('#sb-units').textContent = `${units.def.system} ▴`;
    const cc = $('#confirm-corner');
    const showCC = !!this.pm && this.pm.kind !== 'measure';
    cc.hidden = !showCC;
    if (showCC) {
      const sketchMode = this.mode === 'sketch';
      cc.replaceChildren(
        h('button', { title: sketchMode ? 'Exit Sketch' : 'OK', html: icon(sketchMode ? 'exitSketch' : 'check'), onclick: () => this.pmOK() }),
        h('button', { title: sketchMode ? 'Discard changes and exit sketch' : 'Cancel', html: icon('cancel'), onclick: () => this.pmCancel() }),
      );
    }
    if (!this.statusOverride) $('#sb-message').textContent = this.defaultStatus();
    this.renderTabs();
  }

  defaultStatus() {
    if (this.mode === 'pickPlane') return 'Select a plane or a planar face to sketch on.';
    if (this.mode === 'sketch') return SKETCH_TOOLS[this.sketcher.tool]?.hint || 'Select a sketch tool, or select entities and points to add relations.';
    if (this.measure) return 'Click faces, edges or points to measure. Vertices snap automatically.';
    if (this.pm?.status) return val(this.pm.status);
    if (this.pm) return 'Set the parameters in the PropertyManager, then click OK.';
    if (this.isDrawing) return this.doc.source ? 'Drag views to arrange them. Double-click the title block to edit it. Wheel zooms, right-drag pans.' : 'Click Standard 3 View to choose the model for this drawing.';
    if (this.isAsm) {
      const n = this.doc.components.length;
      return n ? `${this.doc.name}: ${n} component${n === 1 ? '' : 's'}, ${this.doc.mates.length} mate${this.doc.mates.length === 1 ? '' : 's'}.` : 'Click Insert Components to add parts to the assembly.';
    }
    const n = this.doc.features.length;
    return n ? `${this.doc.name}: ${n} feature${n === 1 ? '' : 's'}. Left-drag rotates, right-drag pans, wheel zooms.` : 'Start by clicking Sketch, or Extruded Boss/Base, and choose a plane.';
  }

  setStatus(msg) {
    this.statusOverride = !!msg;
    $('#sb-message').textContent = msg || this.defaultStatus();
  }

  setCoords(p) {
    if (!p) { $('#sb-coords').textContent = ''; return; }
    $('#sb-coords').textContent = p.length === 2
      ? `x ${units.fmt(p[0], false)}   y ${units.fmt(p[1])}`
      : `x ${units.fmt(p[0], false)}  y ${units.fmt(p[1], false)}  z ${units.fmt(p[2])}`;
  }

  cursorLabel(text, x, y) {
    const el = $('#cursor-label');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.style.left = `${x + 18}px`;
    el.style.top = `${y + 18}px`;
  }

  showBanner(text, onCancel) {
    const b = $('#banner');
    b.hidden = false;
    b.replaceChildren(ico('plane'), h('span', {}, text), h('button', { onclick: onCancel }, 'Cancel'));
    b.querySelector('.ti').style.cssText = 'width:18px;height:18px';
  }

  hideBanner() { $('#banner').hidden = true; }

  // ================================================================ task pane

  buildTaskPane() {
    const strip = $('#tp-strip');
    for (const [id, ic, title] of [['appearance', 'appearance', 'Appearances'], ['material', 'material', 'Materials'], ['library', 'library', 'Design Library (Samples)']]) {
      strip.append(h('button', { class: 'tp-btn', 'data-tab': id, title, html: icon(ic), onclick: () => this.openTaskPane(this.tpTab === id ? null : id) }));
    }
  }

  openTaskPane(tab) {
    this.tpTab = tab;
    document.querySelectorAll('.tp-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tp-flyout').hidden = !tab;
    if (tab) this.renderTaskPane();
  }

  // The part whose appearance/material the task pane edits (the selected component in an assembly).
  appearanceTarget() {
    if (!this.isAsm) return { doc: this.doc, label: this.doc.name };
    const comp = this.selectedComponent();
    return comp ? { doc: comp.part, label: comp.name, comp } : null;
  }

  renderTaskPane() {
    const fly = $('#tp-flyout');
    if (!this.tpTab) return;
    const titles = { appearance: 'Appearances', material: 'Materials', library: 'Design Library' };
    const body = h('div', { class: 'tp-body' });
    fly.replaceChildren(
      h('div', { class: 'tp-head' }, titles[this.tpTab], h('span', { class: 'sp' }),
        h('button', { class: this.tpPinned ? 'on' : '', title: 'Keep visible', html: icon('pin'), onclick: () => { this.tpPinned = !this.tpPinned; this.renderTaskPane(); } }),
        h('button', { title: 'Close', html: icon('cancel'), onclick: () => this.openTaskPane(null) })),
      body,
    );
    if (this.tpTab === 'library') {
      for (const [id, s] of Object.entries(SAMPLES)) {
        body.append(h('div', { class: 'sample-card', onclick: () => this.loadSample(id) },
          ico(s.icon || 'extrude'), h('div', {}, h('b', {}, s.title), h('span', {}, s.description))));
      }
      return;
    }
    const target = this.appearanceTarget();
    if (!target) {
      body.append(h('div', { class: 'pm-info' }, 'Select a component in the assembly to change its appearance or material.'));
      return;
    }
    if (this.isAsm) body.append(h('div', { class: 'pm-info' }, `Editing component: ${target.label}`));
    if (this.tpTab === 'appearance') {
      const cur = appearanceOf(target.doc);
      const sw = h('div', { class: 'swatches' });
      for (const c of SWATCHES) {
        sw.append(h('div', { class: `swatch${cur.color.toLowerCase() === c ? ' on' : ''}`, title: c, style: { background: c }, onclick: () => this.setAppearance({ color: c }) }));
      }
      const picker = h('input', { type: 'color', value: cur.color, style: { width: '100%', height: '30px' } });
      picker.addEventListener('change', () => this.setAppearance({ color: picker.value }));
      const finish = h('select', { style: { width: '100%', padding: '4px' } }, ...Object.keys(FINISHES).map((f) => h('option', { value: f, selected: (target.doc.appearance?.finish || 'Material default') === f }, f)));
      finish.addEventListener('change', () => this.setAppearance({ finish: finish.value }));
      body.append(
        h('div', { class: 'tp-section' }, h('h4', {}, 'Color'), sw),
        h('div', { class: 'tp-section' }, h('h4', {}, 'Custom color'), picker),
        h('div', { class: 'tp-section' }, h('h4', {}, 'Finish'), finish),
        h('div', { class: 'tp-section' }, h('button', { class: 'pm-button', onclick: () => this.setAppearance(null) }, 'Reset to material appearance')),
      );
    } else {
      const list = h('div', { class: 'mat-list' });
      for (const [name, m] of Object.entries(MATERIALS)) {
        list.append(h('div', { class: `mat-item${target.doc.material === name ? ' on' : ''}`, onclick: () => this.setMaterial(name) },
          h('span', { class: 'ball', style: { background: m.color } }), name, h('span', { class: 'meta' }, `${m.density} g/cm³`)));
      }
      body.append(h('div', { class: 'tp-section' }, h('h4', {}, `Current: ${target.doc.material}`), list));
    }
  }

  applyAppearance() {
    if (this.isAsm) { this.updateAssemblyBodies(); return; }
    this.viewport.setMaterialAppearance(appearanceOf(this.doc));
  }

  setAppearance(patch) {
    const target = this.appearanceTarget();
    if (!target) return;
    const snap = JSON.stringify(this.doc);
    target.doc.appearance = patch === null ? null : { ...(target.doc.appearance || {}), ...patch };
    this.commit(snap);
    this.applyAppearance();
    this.renderTaskPane();
  }

  setMaterial(name) {
    const target = this.appearanceTarget();
    if (!target) return;
    const snap = JSON.stringify(this.doc);
    target.doc.material = name;
    this.commit(snap);
    this.applyAppearance();
    this.renderTaskPane();
    this.refreshTree();
    this.toast(`Material: ${name}`);
  }

  // ================================================================ document lifecycle

  commit(snapshot) {
    if (snapshot === JSON.stringify(this.doc)) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.autosave();
    this.refreshChrome();
  }

  autosave() {
    const root = this.tab.link ? this.tabs.find((t) => t.id === this.tab.link.asmTabId)?.doc : this.doc;
    storage.set(AUTOSAVE_KEY, { time: Date.now(), doc: root || this.doc });
  }

  undo() {
    if (this.mode === 'sketch') { this.sketcher.undo(); return; }
    if (this.pm || !this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.undoStack.pop());
    this.afterHistory();
  }

  redo() {
    if (this.mode === 'sketch') { this.sketcher.redo(); return; }
    if (this.pm || !this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.redoStack.pop());
    this.afterHistory();
  }

  afterHistory() {
    this.selection = null;
    this.dirty = true;
    this.autosave();
    this.rebuildModel();
    this.refreshAll();
  }

  resetModes(silent = false) {
    if (this.mode === 'sketch') this.exitSketch(!silent ? false : true, { silent: true });
    if (this.mode === 'pickPlane') this.cancelPickPlane();
    if (this.pm) this.pmCancel();
    if (this.section) { this.section = null; this.viewport.setSection(null); }
    this.pendingFeature = null;
    this.dtool = null;
    this.dsel = null;
    this.dimPreview = null;
    if (this.explodeFactor) { this.explodeFactor = 0; }
  }

  async cmdNew(type = 'part') {
    this.resetModes(true);
    this.saveView();
    this.openTab(this.blankDoc(type));
    this.selection = null;
    this.cmTab = type === 'assembly' ? 'Assembly' : 'Features';
    this.buildCommandManager();
    this.refreshAll();
    await this.rebuildModel();
    this.viewport.setView(VIEWS.trimetric.dir, { fit: true });
    if (type === 'assembly') this.run('insertComponent');
  }

  normalizeDoc(d) {
    if (d.type === 'drawing') {
      const base = this.blankDrawing({ version: 2, author: this.settings.userName, created: new Date().toISOString() });
      return { ...base, ...d, title: { ...base.title, ...(d.title || {}) }, bom: { ...base.bom, ...(d.bom || {}) }, views: d.views || [], dims: d.dims || [], notes: d.notes || [] };
    }
    if (d.type === 'assembly') {
      return {
        ...this.blankDoc('assembly'), ...d,
        components: (d.components || []).map((c) => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], ...c, id: c.id || uid('c'), part: this.normalizeDoc(c.part || {}) })),
        mates: (d.mates || []).map((m) => ({ ...m, id: m.id || uid('m') })),
      };
    }
    return {
      ...this.blankDoc('part'), ...d, type: 'part',
      features: (d.features || []).map((f) => ({ ...f, id: f.id || uid() })),
    };
  }

  // Opens a document in a new tab (or replaces an untouched empty tab).
  async loadDoc(d, { dirty = false, filePath = null } = {}) {
    this.resetModes(true);
    this.saveView();
    const doc = this.normalizeDoc(d);
    if (doc.type === 'assembly') solveMates(doc.components, doc.mates);
    const t = this.tab;
    const reuse = !t.dirty && !t.link && !t.filePath && t.doc.type === 'part' && !t.doc.features.length;
    if (reuse) { t.doc = doc; t.undoStack = []; t.redoStack = []; t.view = null; } else this.openTab(doc);
    this.tab.dirty = dirty;
    this.tab.filePath = filePath;
    this.selection = null;
    this.cmTab = this.defaultCmTab();
    this.buildCommandManager();
    this.refreshAll();
    await this.rebuildModel();
    this.viewport.setView(VIEWS.trimetric.dir, { fit: true });
    this.autosave();
  }

  loadDocText(text, { filePath = null, name = '' } = {}) {
    try {
      const d = JSON.parse(text);
      const ok = d && (Array.isArray(d.features) || (d.type === 'assembly' && Array.isArray(d.components)) || d.type === 'drawing');
      if (!ok) throw new Error('bad');
      const existing = filePath && this.tabs.findIndex((t) => t.filePath === filePath);
      if (existing >= 0 && existing !== false) { this.switchTab(existing); return; }
      this.loadDoc(d, { filePath });
      this.toast(`Opened ${d.name || name || 'document'}`, 'ok');
    } catch {
      this.toast('That file is not a valid GuyCAD document (.gcad / .gasm)', 'error');
    }
  }

  async loadSample(id) {
    this.closeModals();
    const s = SAMPLES[id];
    await this.loadDoc(clone(s.doc));
    this.doc.author = this.settings.userName;
    if (!this.tpPinned) this.openTaskPane(null);
    this.toast(`Opened sample: ${s.title}`, 'ok');
  }

  async cmdOpen() {
    if (native) {
      const res = await native.openFile({ filters: [...FILE_FILTERS.open, { name: 'All Files', extensions: ['*'] }] });
      if (res) this.loadDocText(res.text, { filePath: res.filePath, name: res.name });
      return;
    }
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'GuyCAD Documents', accept: { 'application/json': ['.gcad', '.gasm', '.json'] } }] });
        const file = await handle.getFile();
        this.loadDocText(await file.text(), { name: file.name });
        this.tab.fileHandle = handle;
      } catch (e) {
        if (e.name !== 'AbortError') $('#file-input').click();
      }
      return;
    }
    $('#file-input').click();
  }

  async cmdSave(as) {
    if (this.mode === 'sketch') this.exitSketch(true);
    if (this.tab.link) {
      // parts edited inside an assembly are saved with the assembly
      const i = this.tabs.findIndex((t) => t.id === this.tab.link.asmTabId);
      if (i >= 0) { await this.switchTab(i); return this.cmdSave(as); }
    }
    const ext = this.isDrawing ? 'gdrw' : this.isAsm ? 'gasm' : 'gcad';
    const text = JSON.stringify({ ...this.doc, author: this.doc.author || this.settings.userName, savedAt: new Date().toISOString(), app: 'GuyCAD 2.0' }, null, 1);
    const name = `${this.doc.name}.${ext}`;
    if (native) {
      const res = await native.saveFile({ suggestedName: name, data: text, filePath: as ? null : this.tab.filePath, filters: FILE_FILTERS[ext] });
      if (!res) return;
      this.tab.filePath = res.filePath;
    } else if (window.showSaveFilePicker) {
      try {
        if (!this.tab.fileHandle || as) {
          this.tab.fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: this.isAsm ? 'GuyCAD Assembly' : 'GuyCAD Part', accept: { 'application/json': [`.${ext}`] } }] });
        }
        const w = await this.tab.fileHandle.createWritable();
        await w.write(text);
        await w.close();
      } catch (e) {
        if (e.name === 'AbortError') return;
        await download(text, name, 'application/json');
      }
    } else {
      await download(text, name, 'application/json');
    }
    this.dirty = false;
    for (const t of this.tabs) if (t.link?.asmTabId === this.tab.id) t.dirty = false;
    this.refreshChrome();
    this.toast(`Saved ${name}`, 'ok');
  }

  exportDocs() {
    if (this.isAsm) {
      return this.doc.components.filter((c) => !c.suppressed && !c.hidden).map((c) => ({ doc: { features: c.part.features }, pose: this.poseOf(c) }));
    }
    return [{ doc: { features: this.doc.features }, limit: this.doc.rollback }];
  }

  // Exact formats come from the kernel; mesh formats from the displayed (finely tessellated) bodies.
  async exportModel(fmt) {
    if (this.isDrawing) { this.exportDrawing(fmt); return; }
    const hasBody = this.isAsm ? this.viewport.bodies.size > 0 : !!this.build?.data;
    if (!hasBody) { this.toast('There is no solid body to export yet', 'error'); return; }
    const ext = { 'stl-ascii': 'stl' }[fmt] || fmt;
    try {
      const data = await this.exportData(fmt);
      const saved = await download(data, `${this.doc.name}.${ext}`);
      if (saved) this.toast(`Exported ${saved}`, 'ok');
    } catch (err) {
      this.setBusy(false);
      this.toast(`Export failed: ${err.message}`, 'error');
    }
  }

  // The bytes/text of an export, without saving it.
  async exportData(fmt) {
    {
      let data;
      if (fmt === 'step' || fmt === 'stl' || fmt === 'brep') {
        this.setBusy(true, `Exporting ${fmt.toUpperCase()}…`);
        data = await this.kernel.export(this.exportDocs(), fmt);
        this.setBusy(false);
      } else {
        const bodies = [...this.viewport.bodies.values()].filter((b) => !b.hidden);
        const nameOf = (b) => (this.isAsm ? this.compName(b.id) : this.doc.name);
        if (fmt === '3mf') {
          data = make3MF(bodies.map((b) => ({
            name: nameOf(b), vertices: b.data.vertices, indices: b.data.indices,
            matrix: b.group.matrix.elements, color: `#${(b.material || this.viewport.bodyMat).color.getHexString()}`,
          })), { title: this.doc.name });
        } else {
          const group = new THREE.Group();
          for (const b of bodies) {
            const src = b.material || this.viewport.bodyMat;
            const mat = new THREE.MeshStandardMaterial({ color: src.color, metalness: src.metalness, roughness: src.roughness });
            const m = new THREE.Mesh(b.mesh.geometry, mat);
            m.applyMatrix4(b.group.matrix);
            m.name = nameOf(b);
            group.add(m);
          }
          group.updateMatrixWorld(true);
          if (fmt === 'obj') data = new OBJExporter().parse(group);
          else if (fmt === 'stl-ascii') data = new STLExporter().parse(group, { binary: false });
          else if (fmt === 'ply') data = await new Promise((res) => new PLYExporter().parse(group, res, { binary: true }));
          else if (fmt === 'gltf') data = JSON.stringify(await new GLTFExporter().parseAsync(group, { binary: false }));
          else if (fmt === 'usdz') {
            // USDZ (Apple AR) uses metres and Y-up: scale mm -> m
            const scene = new THREE.Scene();
            group.scale.setScalar(0.001);
            scene.add(group);
            data = await new USDZExporter().parseAsync(scene);
          } else data = await new GLTFExporter().parseAsync(group, { binary: true });
        }
      }
      return data;
    }
  }

  async exportSketchDXF() {
    const f = this.mode === 'sketch' ? this.sketcher.feature : this.byId(this.selection?.id);
    if (!f || f.type !== 'sketch') { this.toast('Select a sketch first'); return; }
    const saved = await download(sketchToDXF(f.entities), `${this.doc.name}-${f.name}.dxf`, 'application/dxf');
    if (saved) this.toast(`Exported ${saved}`, 'ok');
  }

  // Imports STEP / STL / BREP as a new part whose first feature is the imported body.
  async cmdImport() {
    let file;
    if (native) {
      const res = await native.openFile({ filters: [{ name: '3D models', extensions: ['step', 'stp', 'stl', 'brep', 'brp'] }], binary: true });
      if (!res) return;
      file = { name: res.name, bytes: res.bytes };
    } else {
      file = await new Promise((resolve) => {
        const input = h('input', { type: 'file', accept: '.step,.stp,.stl,.brep,.brp' });
        input.addEventListener('change', async () => {
          const f = input.files[0];
          resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
        });
        input.click();
      });
      if (!file) return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    const format = ext === 'stl' ? 'stl' : ext === 'brep' || ext === 'brp' ? 'brep' : 'step';
    const part = this.importedPartDoc(file.name, format, file.bytes);
    if (this.isAsm) { await this.insertPart(part); return; }
    await this.loadDoc(part, { dirty: true });
    const err = Object.values(this.build.errors)[0];
    this.toast(err ? `Import failed: ${err}` : `Imported ${file.name}`, err ? 'error' : 'ok');
  }

  importedPartDoc(fileName, format, bytes) {
    let data;
    if (format === 'brep') data = new TextDecoder().decode(bytes);
    else {
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      data = btoa(bin);
    }
    const name = fileName.replace(/\.[^.]+$/, '');
    return {
      ...this.blankDoc('part'), name,
      features: [{ id: uid(), type: 'import', name: `${name} (${format.toUpperCase()})`, format, data }],
    };
  }

  async screenshot() {
    const blob = await (await fetch(this.viewport.snapshot())).blob();
    const saved = await download(blob, `${this.doc.name}.png`, 'image/png');
    if (saved) this.toast(`Screenshot saved: ${saved}`, 'ok');
  }

  // ================================================================ model build & scene

  activeLimit() {
    if (this.mode === 'sketch') return this.doc.features.indexOf(this.sketcher.feature);
    if (this.pm?.displayLimit != null) return val(this.pm.displayLimit);
    return this.doc.rollback ?? this.doc.features.length;
  }

  insertIndex() { return this.doc.rollback ?? this.doc.features.length; }

  async rebuildModel() {
    this.showSheet(this.isDrawing);
    if (this.isAsm) return this.rebuildAssembly();
    if (this.isDrawing) return this.rebuildDrawing();
    const seq = ++this.buildSeq;
    const limit = this.activeLimit();
    const lim = limit < 0 ? null : limit;
    const frames = computeFrames(this.doc, lim);
    this.build = { ...this.build, planes: frames.planes, frames: frames.frames };
    this.refreshScene();
    this.setBusy(true);
    let res;
    try {
      res = await this.kernel.rebuild(this.doc, lim);
    } catch (e) {
      res = { data: null, errors: { kernel: e.message }, times: {} };
      this.toast(`Rebuild failed: ${e.message}`, 'error');
    }
    if (seq !== this.buildSeq || this.isAsm) return;
    this.setBusy(false);
    this.build = { data: res.data, planes: frames.planes, frames: frames.frames, errors: { ...frames.errors, ...res.errors }, times: res.times || {} };
    this.viewport.setBodies(res.data ? [{ id: 'part', data: res.data }] : []);
    this.applyAppearance();
    if (this.selection?.kind === 'face' || this.selection?.kind === 'edge') this.selection = null;
    this.refreshHighlights();
    this.refreshScene();
    this.refreshTree();
    this.updatePMError();
    if (this.pm?.validate) this.pm.validate();
  }

  isConsumed(sketchId) {
    return this.doc.features.some((f) => f.type !== 'sketch' && sketchRefs(f).includes(sketchId));
  }

  byId(id) { return this.doc.features?.find((f) => f.id === id); }

  refreshScene() {
    if (this.isAsm) { this.refreshAssemblyScene(); return; }
    if (this.isDrawing) return;
    const box = this.viewport.bodyBox();
    let size = 100;
    if (box && !box.isEmpty()) {
      const s = box.getSize(new THREE.Vector3());
      size = Math.max(60, Math.max(s.x, s.y, s.z) * 1.2);
    }
    const sel = this.selection;
    const isSel = (k) => (sel?.kind === 'plane' && sel.key === k) || (sel?.kind === 'feature' && sel.id === k) || (this.pm?.highlightPlane && this.pm.highlightPlane() === k);
    const isHover = (k) => (this.hover?.kind === 'plane' && this.hover.key === k) || this.treeHover === k;
    const state = (k) => (isSel(k) ? 'selected' : isHover(k) ? 'hover' : 'normal');
    const sketching = this.mode === 'sketch';
    const list = ['Front', 'Top', 'Right'].map((n) => ({
      key: n, name: `${n} Plane`, frame: STD_PLANES[n], state: state(n),
      visible: !sketching && (this.settings.showPlanes || this.mode === 'pickPlane' || isSel(n) || isHover(n)),
    }));
    const limit = this.activeLimit();
    this.doc.features.forEach((f, i) => {
      if (f.type !== 'plane' || !this.build.planes[f.id]) return;
      list.push({ key: f.id, name: f.name, frame: this.build.planes[f.id], state: state(f.id), visible: i < limit && !sketching && (!f.hidden || isSel(f.id) || this.mode === 'pickPlane') });
    });
    this.viewport.setPlanes(list, size);
    this.viewport.origin.visible = this.settings.showOrigin || sketching;

    this.sketchObjects.clear();
    this.doc.features.forEach((f, i) => {
      if (f.type !== 'sketch' || f.suppressed || i >= limit || (sketching && f === this.sketcher.feature)) return;
      const frame = this.build.frames[f.id];
      if (!frame) return;
      const consumer = sel?.kind === 'feature' ? this.byId(sel.id) : null;
      const selected = sel?.kind === 'feature' && (sel.id === f.id || consumer?.sketch === f.id);
      const hovered = (this.hover?.kind === 'sketch' && this.hover.id === f.id) || this.treeHover === f.id;
      const visible = selected || hovered || (!this.isConsumed(f.id) && this.settings.showSketches && !f.hidden);
      if (!visible) return;
      const obj = buildSketchObject(f.entities, this.sketcher.mats, {
        styleOf: () => (selected ? 'inactiveSel' : hovered ? 'hover' : 'inactive'),
        pickId: sketching ? null : f.id,
      });
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(frameMatrix(frame));
      this.sketchObjects.add(obj);
    });
  }

  // Face/edge highlights: current selection plus whatever the active command has picked.
  refreshHighlights() {
    const sel = [];
    const s = this.selection;
    if (s?.kind === 'face') sel.push({ bodyId: s.bodyId, face: s.face });
    if (s?.kind === 'edge') sel.push({ bodyId: s.bodyId, edge: s.edge });
    if (this.pm?.highlights) sel.push(...this.pm.highlights());
    this.viewport.setHighlight('sel', sel);
    this.viewport.setHighlight('alt', this.pm?.altHighlights ? this.pm.altHighlights() : []);
    if (this.isAsm) this.refreshAssemblyHighlights();
  }

  setDisplayStyle(id) {
    this.viewport.setDisplayStyle(id);
    this.settings.displayStyle = id;
    this.saveSettings();
  }

  setView(id) {
    this.viewport.setView(VIEWS[id].dir, { fit: id === 'iso' || id === 'trimetric' || id === 'dimetric' });
  }

  normalTo() {
    let n = null;
    const sel = this.selection;
    if (this.mode === 'sketch') n = this.sketcher.frame.normal;
    else if (sel?.kind === 'face' && sel.normal) n = sel.normal;
    else if (sel?.kind === 'plane') n = STD_PLANES[sel.key]?.normal;
    else if (sel?.kind === 'feature') {
      const f = this.byId(sel.id);
      const sid = f?.type === 'sketch' || f?.type === 'plane' ? f.id : f?.sketch;
      n = this.build.frames[sid]?.normal;
    }
    if (!n) { this.toast('Select a plane, planar face or sketch first'); return; }
    this.viewport.setView(n);
  }

  // ================================================================ viewport interaction

  bindViewport() {
    const el = this.viewport.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (ev) => {
      down = { x: ev.clientX, y: ev.clientY, button: ev.button };
      el.focus();
      if (this.mode === 'sketch') this.sketcher.pointerDown(ev);
    });
    el.addEventListener('pointermove', (ev) => {
      if (this.mode === 'sketch') { this.sketcher.pointerMove(ev); return; }
      if (ev.buttons) return;
      this.queueHover(ev);
    });
    el.addEventListener('pointerup', (ev) => {
      const moved = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4;
      if (this.mode === 'sketch') {
        this.sketcher.pointerUp(ev);
        if (ev.button === 2 && !moved && !this.sketcher.contextMenu()) this.sketchContextMenu(ev);
      } else if (down && !moved && !this.gizmoDragging) {
        if (ev.button === 0) this.viewportClick(ev);
        else if (ev.button === 2) this.viewportContextMenu(ev);
      }
      down = null;
      this.refreshChrome();
    });
    el.addEventListener('dblclick', (ev) => {
      if (this.mode === 'sketch') { this.sketcher.dblclick(ev); return; }
      const hit = this.viewport.pick(ev.clientX, ev.clientY, { body: !!this.isAsm, planes: false });
      if (hit?.kind === 'sketch' && this.mode === 'model') this.editSketch(hit.id);
      else if (this.isAsm && hit?.bodyId && this.mode === 'model') this.editComponentPart(hit.bodyId);
    });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    el.addEventListener('pointerleave', () => {
      this.cursorLabel(null);
      this.setCoords(null);
      if (this.hover) { this.hover = null; this.viewport.setHighlight('hover', []); this.refreshScene(); }
    });
    el.tabIndex = 0;
    this.viewport.onFrame.push(() => this.positionMeasureTag());
  }

  queueHover(ev) {
    this.hoverEv = ev;
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => { this.hoverRaf = null; this.doHover(this.hoverEv); });
  }

  hoverKey(hit) {
    if (!hit) return '';
    if (hit.kind === 'face') return `face:${hit.bodyId}:${hit.face}`;
    if (hit.kind === 'edge') return `edge:${hit.bodyId}:${hit.edge}`;
    if (hit.kind === 'plane') return `plane:${hit.key}`;
    return `sketch:${hit.id}`;
  }

  pickOptions() {
    const wants = this.pm?.wants;
    return {
      sketches: this.mode !== 'pickPlane' && !this.measure && !this.isAsm,
      edges: !wants || wants.includes('edge'),
    };
  }

  doHover(ev) {
    const hit = this.viewport.pick(ev.clientX, ev.clientY, this.pickOptions());
    const prev = this.hoverKey(this.hover);
    this.hover = hit;
    this.setCoords(hit?.point ? hit.point.toArray() : null);
    if (this.hoverKey(hit) !== prev) {
      const items = [];
      if (hit?.kind === 'face') items.push({ bodyId: hit.bodyId, face: hit.face });
      if (hit?.kind === 'edge') items.push({ bodyId: hit.bodyId, edge: hit.edge });
      this.viewport.setHighlight('hover', items);
      this.refreshScene();
    }
    this.viewport.el.style.cursor = hit ? 'pointer' : 'default';
  }

  planeTargetFromHit(hit) {
    if (!hit) return null;
    if (hit.kind === 'plane') return { plane: hit.key };
    if (hit.kind === 'face') {
      const frame = this.faceFrame(hit);
      return frame ? { plane: 'face', frame } : null;
    }
    return null;
  }

  // Sketch frame on a planar face, with its origin at the projection of the part origin.
  faceFrame(hit) {
    if (hit.info?.type !== 'PLANE') return null;
    const n = hit.normal.clone().normalize();
    const o = n.clone().multiplyScalar(n.dot(hit.point));
    return frameFromNormal(n.toArray(), o.toArray());
  }

  viewportClick(ev) {
    const hit = this.viewport.pick(ev.clientX, ev.clientY, this.pickOptions());
    if (this.mode === 'pickPlane') {
      const target = this.planeTargetFromHit(hit);
      if (target) this.startSketch(target);
      else this.toast('Click a plane or a flat face of the model');
      return;
    }
    if (this.measure) { this.measureClick(hit, ev); return; }
    if (this.pm?.onPick && hit && this.pm.onPick(hit, ev)) { this.refreshHighlights(); return; }
    if (this.isAsm) { this.assemblyClick(hit, ev); return; }
    this.selectFromHit(hit);
  }

  selectFromHit(hit) {
    if (!hit) this.selection = null;
    else if (hit.kind === 'face') this.selection = { kind: 'face', bodyId: hit.bodyId, face: hit.face, info: hit.info, normal: hit.normal.toArray(), point: hit.point.toArray(), frame: this.faceFrame(hit) };
    else if (hit.kind === 'edge') this.selection = { kind: 'edge', bodyId: hit.bodyId, edge: hit.edge, info: hit.info };
    else if (hit.kind === 'plane') this.selection = STD_PLANES[hit.key] ? { kind: 'plane', key: hit.key } : { kind: 'feature', id: hit.key };
    else this.selection = { kind: 'feature', id: hit.id };
    this.afterSelect();
  }

  describePick(s) {
    if (s.kind === 'face') {
      const i = s.info || {};
      const kind = { PLANE: 'Planar face', CYLINDRE: 'Cylindrical face', CONE: 'Conical face', SPHERE: 'Spherical face', TORUS: 'Toroidal face' }[i.type] || 'Face';
      return `${kind} — area ${units.fmtArea(i.area || 0)}${i.radius ? `, radius ${units.fmt(i.radius)}` : ''}`;
    }
    if (s.kind === 'edge') {
      const i = s.info || {};
      return `${i.type === 'CIRCLE' ? 'Circular edge' : i.type === 'LINE' ? 'Straight edge' : 'Edge'} — length ${units.fmt(i.length || 0)}${i.radius ? `, radius ${units.fmt(i.radius)}` : ''}`;
    }
    return '';
  }

  afterSelect() {
    const s = this.selection;
    if (s?.kind === 'face' || s?.kind === 'edge') {
      this.setStatus(`${this.describePick(s)}.${s.kind === 'face' && s.frame && !this.isAsm ? ' Click Sketch to sketch on it.' : ''}`);
    } else this.setStatus(null);
    this.refreshHighlights();
    this.refreshScene();
    this.refreshTree();
    this.refreshChrome();
    if (this.tpTab && this.isAsm) this.renderTaskPane();
  }

  viewportContextMenu(ev) {
    const hit = this.viewport.pick(ev.clientX, ev.clientY, this.pickOptions());
    if (this.mode === 'pickPlane' || this.pm) return;
    if (this.isAsm) { this.assemblyContextMenu(hit, ev); return; }
    if (hit) this.selectFromHit(hit);
    const items = [];
    const sel = this.selection;
    if ((sel?.kind === 'face' && sel.frame) || sel?.kind === 'plane' || (sel?.kind === 'feature' && this.byId(sel.id)?.type === 'plane')) {
      items.push({ label: sel.kind === 'face' ? 'Sketch on Face' : 'Sketch', icon: 'sketch', run: () => this.cmdSketch() });
      items.push({ label: 'Normal To', icon: 'normalTo', run: () => this.normalTo() });
      items.push({ label: 'Offset Plane...', icon: 'plane', run: () => this.cmdFeature('plane') });
      items.push('|');
    }
    if (sel?.kind === 'edge') items.push({ label: 'Fillet', icon: 'fillet', run: () => this.cmdFeature('fillet') }, { label: 'Chamfer', icon: 'chamfer', run: () => this.cmdFeature('chamfer') }, '|');
    if (sel?.kind === 'face') items.push({ label: 'Shell (remove this face)', icon: 'shell', run: () => this.cmdFeature('shell') }, '|');
    if (sel?.kind === 'feature') items.push(...this.featureMenuItems(this.byId(sel.id)), '|');
    items.push({ label: 'Zoom to Fit', icon: 'zoomFit', short: 'F', run: () => this.viewport.zoomToFit() });
    items.push({ label: 'View Orientation', icon: 'viewOrient', items: () => this.menuItems([...Object.keys(VIEWS).map((v) => `view:${v}`), 'normalTo']) });
    items.push({ label: 'Display Style', icon: 'displayStyle', items: () => this.menuItems(Object.keys(DISPLAY_STYLES).map((s) => `style:${s}`)) });
    items.push('|', { label: 'Appearance...', icon: 'appearance', run: () => this.openTaskPane('appearance') });
    this.openMenu(items, ev.clientX, ev.clientY);
  }

  sketchContextMenu(ev) {
    const items = [
      ...Object.keys(SKETCH_TOOLS).map((t) => `tool:${t}`), '|', 'construction', 'sketchDelete', '|',
      { label: 'Exit Sketch', icon: 'exitSketch', run: () => this.exitSketch(true) },
      { label: 'Discard Sketch Changes', icon: 'cancel', run: () => this.exitSketch(false) },
    ];
    this.openMenu(this.menuItems(items), ev.clientX, ev.clientY);
  }

  // ================================================================ feature tree

  treeNode(o) {
    const el = h('div', {
      class: ['tnode', o.cls, o.selected ? 'selected' : '', o.rolled ? 'rolled' : '', o.error ? 'error' : '', o.suppressed ? 'suppressed' : '', o.editing ? 'editing' : ''].filter(Boolean).join(' '),
      style: { paddingLeft: `${6 + (o.depth || 0) * 16}px` },
      title: o.error || o.title || '',
    }, h('span', { class: 'tw' }, o.twisty || ''), ico(o.icon), h('span', { class: 'tl' }, o.label),
    o.error ? h('span', { class: 'tx', html: icon('error') }) : null);
    if (o.onClick) el.addEventListener('click', o.onClick);
    if (o.onDbl) el.addEventListener('dblclick', o.onDbl);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (o.onClick) o.onClick(); if (o.menu) this.openMenu(val(o.menu), e.clientX, e.clientY); });
    if (o.hoverKey) {
      el.addEventListener('mouseenter', () => { this.treeHover = o.hoverKey; this.refreshScene(); if (this.isAsm) this.refreshAssemblyHighlights(); });
      el.addEventListener('mouseleave', () => { this.treeHover = null; this.refreshScene(); if (this.isAsm) this.refreshAssemblyHighlights(); });
    }
    if (o.index != null) el.dataset.index = o.index;
    return el;
  }

  refreshTree() {
    if (this.isAsm) { this.refreshAssemblyTree(); return; }
    if (this.isDrawing) { this.refreshDrawingTree(); return; }
    const tree = $('#tree');
    tree.replaceChildren();
    const sel = this.selection;
    const limit = this.mode === 'sketch' ? this.doc.features.length : this.activeLimit();
    const errs = this.build?.errors || {};
    const node = (o) => this.treeNode(o);
    const selectKey = (kind, key) => () => {
      if (this.mode === 'pickPlane' && kind === 'plane') { this.startSketch({ plane: key }); return; }
      if (this.mode === 'pickPlane' && kind === 'feature' && this.byId(key)?.type === 'plane') { this.startSketch({ plane: key }); return; }
      if (this.pm?.onPick && kind !== 'face' && this.pm.onPick({ kind: 'plane', key, fromTree: true })) return;
      this.selection = kind === 'plane' ? { kind, key } : { kind, id: key };
      this.afterSelect();
    };

    tree.append(node({
      cls: 'root', icon: 'part', label: `${this.doc.name}  (Default)`,
      menu: () => [
        { label: 'Rename Part...', run: () => this.renameDoc() },
        { label: 'Edit Material', icon: 'material', run: () => this.openTaskPane('material') },
        { label: 'Appearance', icon: 'appearance', run: () => this.openTaskPane('appearance') },
        { label: 'Mass Properties', icon: 'mass', run: () => this.showMassProps() },
        { label: 'Make Assembly from Part', icon: 'assembly', run: () => this.makeAssemblyFromPart() },
      ],
      onDbl: () => this.renameDoc(),
    }));
    tree.append(node({ depth: 1, icon: 'material', label: `Material <${this.doc.material}>`, onClick: () => this.openTaskPane('material') }));
    for (const n of ['Front', 'Top', 'Right']) {
      tree.append(node({
        depth: 1, icon: 'plane', label: `${n} Plane`, selected: sel?.kind === 'plane' && sel.key === n, hoverKey: n,
        onClick: selectKey('plane', n),
        menu: () => [
          { label: 'Sketch', icon: 'sketch', run: () => this.startSketch({ plane: n }) },
          { label: 'Normal To', icon: 'normalTo', run: () => this.viewport.setView(STD_PLANES[n].normal) },
          { label: 'Offset Plane...', icon: 'plane', run: () => this.cmdFeature('plane') },
          { label: this.settings.showPlanes ? 'Hide Planes' : 'Show Planes', icon: 'hideShow', run: () => this.toggleSetting('showPlanes') },
        ],
      }));
    }
    tree.append(node({ depth: 1, icon: 'origin', label: 'Origin', onClick: () => this.toggleSetting('showOrigin'), title: 'Click to show/hide the origin' }));

    const consumerOf = {};
    this.doc.features.forEach((f) => { if ((f.type === 'extrude' || f.type === 'revolve') && consumerOf[f.sketch] == null) consumerOf[f.sketch] = f.id; });
    const indexOf = Object.fromEntries(this.doc.features.map((f, i) => [f.id, i]));
    let barPlaced = false;
    const bar = () => {
      const b = h('div', { class: 'rollback-bar', title: 'Rollback bar — drag to roll the model back. Double-click to roll to end.' });
      b.addEventListener('pointerdown', (e) => this.dragRollback(e, b));
      b.addEventListener('dblclick', () => this.setRollback(null));
      return b;
    };
    this.doc.features.forEach((f, i) => {
      const consumer = f.type === 'sketch' ? consumerOf[f.id] : null;
      if (consumer && indexOf[consumer] > i) return;
      if (!barPlaced && i >= limit && this.mode !== 'sketch') { tree.append(bar()); barPlaced = true; }
      const rolled = this.mode !== 'sketch' && i >= limit;
      const mk = (ff, idx, depth, twisty) => node({
        depth, icon: featIcon(ff), label: ff.name, index: idx, twisty,
        selected: sel?.kind === 'feature' && sel.id === ff.id, rolled, suppressed: ff.suppressed, error: errs[ff.id],
        editing: (this.mode === 'sketch' && this.sketcher.feature === ff) || (this.pm?.featureId === ff.id),
        hoverKey: ff.id, onClick: selectKey('feature', ff.id), onDbl: () => this.editFeatureById(ff.id), menu: () => this.featureMenuItems(ff),
      });
      const childSketch = (f.type === 'extrude' || f.type === 'revolve') ? this.byId(f.sketch) : null;
      const showChild = childSketch && consumerOf[childSketch.id] === f.id && indexOf[childSketch.id] < i;
      tree.append(mk(f, i, 1, showChild ? '▾' : ''));
      if (showChild) tree.append(mk(childSketch, indexOf[childSketch.id], 2, ''));
    });
    if (!barPlaced && this.mode !== 'sketch') tree.append(bar());
    if (!this.doc.features.length) {
      tree.append(h('div', { class: 'tree-empty-hint', html: 'Your part is empty.<br>Select <b>Front</b>, <b>Top</b> or <b>Right Plane</b> and click <b>Sketch</b> — or open a sample from the <b>Design Library</b> on the right.' }));
    }
  }

  dragRollback(e, barEl) {
    e.preventDefault();
    barEl.classList.add('dragging');
    let target = null;
    const tree = $('#tree');
    const marker = h('div', { class: 'tree-drop' });
    const move = (ev) => {
      const nodes = [...tree.querySelectorAll('.tnode[data-index]')].filter((n) => !n.style.paddingLeft.startsWith('38'));
      target = this.doc.features.length;
      let before = null;
      for (const n of nodes) {
        const r = n.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { target = Number(n.dataset.index); before = n; break; }
      }
      marker.remove();
      if (before) tree.insertBefore(marker, before); else tree.append(marker);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      marker.remove();
      barEl.classList.remove('dragging');
      if (target != null) this.setRollback(target >= this.doc.features.length ? null : target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  setRollback(index) {
    if (this.mode !== 'model') return;
    this.doc.rollback = index == null ? null : Math.max(0, Math.min(index, this.doc.features.length));
    this.dirty = true;
    this.rebuildModel();
    this.refreshChrome();
  }

  featureMenuItems(f) {
    if (!f) return [];
    const idx = this.doc.features.indexOf(f);
    const items = [];
    if (f.type === 'sketch') items.push({ label: 'Edit Sketch', icon: 'sketch', run: () => this.editSketch(f.id) });
    else items.push({ label: 'Edit Feature', icon: featIcon(f), run: () => this.editFeatureById(f.id) });
    if (f.sketch) items.push({ label: 'Edit Sketch', icon: 'sketch', run: () => this.editSketch(f.sketch) });
    if (f.type === 'sketch' || f.type === 'plane') {
      items.push({ label: 'Normal To', icon: 'normalTo', run: () => { this.selection = { kind: 'feature', id: f.id }; this.normalTo(); } });
      items.push({ label: f.hidden ? 'Show' : 'Hide', icon: 'hideShow', run: () => { f.hidden = !f.hidden; this.dirty = true; this.refreshScene(); } });
    }
    if (f.type === 'plane') items.push({ label: 'Sketch on Plane', icon: 'sketch', run: () => this.startSketch({ plane: f.id }) });
    items.push('|',
      { label: f.suppressed ? 'Unsuppress' : 'Suppress', run: () => { this.selection = { kind: 'feature', id: f.id }; this.suppressSelected(!f.suppressed); } },
      { label: 'Rename...', run: () => this.renameFeature(f.id) },
      { label: 'Delete...', icon: 'trash', run: () => this.deleteFeature(f.id) },
      '|',
      { label: 'Roll Back to Here', icon: 'rollback', run: () => this.setRollback(idx) },
      { label: 'Roll to End', run: () => this.setRollback(null), disabled: this.doc.rollback == null });
    return items;
  }

  async renameDoc() {
    const name = await this.promptBox(`Rename ${{ assembly: 'Assembly', drawing: 'Drawing' }[this.doc.type] || 'Part'}`, 'Name', this.doc.name);
    if (!name) return;
    const snap = JSON.stringify(this.doc);
    this.doc.name = name.replace(/[\\/:*?"<>|]/g, '_');
    this.commit(snap);
    if (this.tab.link) this.writeLinkedPart(this.tab);
    this.refreshAll();
  }

  renameSelection() {
    const s = this.selection;
    if (s?.kind === 'feature') this.renameFeature(s.id);
    else if (s?.kind === 'component' || s?.kind === 'mate') this.renameAsmItem(s);
  }

  async renameFeature(id) {
    const f = this.byId(id);
    if (!f) return;
    const name = await this.promptBox(`Rename ${f.name}`, 'Name', f.name);
    if (!name || name === f.name) return;
    const snap = JSON.stringify(this.doc);
    f.name = name;
    this.commit(snap);
    this.refreshTree();
  }

  suppressSelected(on) {
    if (this.isAsm) { this.suppressAsmItem(on); return; }
    if (this.selection?.kind !== 'feature') return;
    const f = this.byId(this.selection.id);
    if (!f) return;
    const snap = JSON.stringify(this.doc);
    f.suppressed = on;
    this.commit(snap);
    this.rebuildModel();
  }

  dependents(id) {
    const out = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of this.doc.features) {
        if (out.has(f.id)) continue;
        const refs = [...sketchRefs(f), f.plane, f.base, f.neutral].filter(Boolean);
        const patternOrphan = (f.type === 'linpattern' || f.type === 'cirpattern') && f.targets.length && f.targets.every((t) => out.has(t));
        if (refs.some((r) => out.has(r)) || patternOrphan) { out.add(f.id); changed = true; }
      }
    }
    out.delete(id);
    return out;
  }

  deleteSelection() {
    if (this.isDrawing) { this.deleteDrawingSelection(); return; }
    if (this.isAsm) { this.deleteAsmSelection(); return; }
    if (this.selection?.kind === 'feature') this.deleteFeature(this.selection.id);
  }

  async deleteFeature(id) {
    const f = this.byId(id);
    if (!f) return;
    const remove = new Set([id, ...this.dependents(id)]);
    for (const sid of sketchRefs(f)) {
      if (this.doc.features.filter((x) => x.type !== 'sketch' && sketchRefs(x).includes(sid)).length === 1) {
        remove.add(sid);
        for (const d of this.dependents(sid)) remove.add(d);
      }
    }
    const names = this.doc.features.filter((x) => remove.has(x.id)).map((x) => x.name);
    const msg = names.length > 1 ? `Delete ${f.name} and its dependent items?\n\n• ${names.join('\n• ')}` : `Delete ${f.name}?`;
    if (!(await this.confirmBox(msg, { okLabel: 'Delete' }))) return;
    const snap = JSON.stringify(this.doc);
    if (this.doc.rollback != null) this.doc.rollback -= this.doc.features.slice(0, this.doc.rollback).filter((x) => remove.has(x.id)).length;
    this.doc.features = this.doc.features.filter((x) => !remove.has(x.id));
    for (const x of this.doc.features) if (Array.isArray(x.targets)) x.targets = x.targets.filter((t) => !remove.has(t));
    if (this.doc.rollback != null && this.doc.rollback >= this.doc.features.length) this.doc.rollback = null;
    this.selection = null;
    this.commit(snap);
    this.rebuildModel();
    this.refreshChrome();
  }

  nextName(prefix, list = this.doc.features) {
    let i = 1;
    while (list.some((f) => f.name === `${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }

  planeLabel(ref) {
    if (STD_PLANES[ref]) return `${ref} Plane`;
    if (ref === 'face') return 'Face';
    return this.byId(ref)?.name || 'missing plane';
  }

  // ================================================================ sketch mode

  cmdSketch() {
    if (this.isAsm) return;
    if (this.mode === 'sketch') { this.exitSketch(true); return; }
    if (this.measure) this.closeMeasure();
    if (this.pm) this.pmCancel();
    const sel = this.selection;
    let target = null;
    if (sel?.kind === 'plane') target = { plane: sel.key };
    else if (sel?.kind === 'face' && sel.frame) target = { plane: 'face', frame: sel.frame };
    else if (sel?.kind === 'feature' && this.byId(sel.id)?.type === 'plane') target = { plane: sel.id };
    if (target) { this.startSketch(target); return; }
    this.mode = 'pickPlane';
    this.showBanner('Select a plane or a planar face to sketch on', () => this.cancelPickPlane());
    this.refreshScene();
    this.refreshChrome();
  }

  cancelPickPlane() {
    this.mode = 'model';
    this.pendingFeature = null;
    this.hideBanner();
    this.refreshScene();
    this.refreshChrome();
  }

  startSketch(target) {
    if (this.mode === 'sketch') this.exitSketch(true);
    if (this.pm) this.pmCancel();
    this.hideBanner();
    this.mode = 'model';
    const snapshot = JSON.stringify(this.doc);
    const f = { id: uid(), type: 'sketch', name: this.nextName('Sketch'), plane: target.plane, entities: [], constraints: [] };
    if (target.frame) f.frame = target.frame;
    const idx = this.insertIndex();
    this.doc.features.splice(idx, 0, f);
    if (this.doc.rollback != null) this.doc.rollback++;
    this.enterSketch(f, snapshot, true);
  }

  editSketch(id) {
    const f = this.byId(id);
    if (!f || f.type !== 'sketch') return;
    if (this.mode === 'sketch') this.exitSketch(true);
    if (this.pm) this.pmCancel();
    this.enterSketch(f, JSON.stringify(this.doc), false);
  }

  enterSketch(f, snapshot, isNew) {
    let frame;
    try {
      const pre = computeFrames(this.doc, this.doc.features.indexOf(f));
      frame = resolvePlane(f.plane, f.frame, pre.planes);
    } catch (e) {
      this.doc = JSON.parse(snapshot);
      this.toast(`Cannot edit sketch: ${e.message}`, 'error');
      return;
    }
    this.selection = null;
    this.sketchState = { snapshot, isNew };
    this.mode = 'sketch';
    this.sketcher.begin(f, frame);
    this.rebuildModel();
    this.viewport.setView(frame.normal);
    this.cmTab = 'Sketch';
    this.buildCommandManager();
    this.pm = {
      kind: 'sketch', title: f.name, icon: 'sketch',
      onOK: () => this.exitSketch(true), onCancel: () => this.exitSketch(false),
      render: (body) => this.renderSketchPM(body),
    };
    this.lpTab = 'pm';
    this.refreshLeftTabs();
    this.renderPM();
    this.refreshChrome();
    if (isNew && this.pendingFeature?.type === 'hole') this.sketcher.setTool('point');
    if (isNew && this.pendingFeature) this.setStatus(`Sketch the profile for the ${this.pendingFeature.cut ? 'cut' : 'feature'}, then click Exit Sketch.`);
  }

  exitSketch(accept, { silent = false } = {}) {
    if (this.mode !== 'sketch') return;
    const st = this.sketchState;
    const f = this.sketcher.feature;
    this.sketcher.end();
    this.mode = 'model';
    this.pm = null;
    this.sketchState = null;
    let kept = false;
    if (!accept) {
      this.doc = JSON.parse(st.snapshot);
    } else if (st.isNew && !f.entities.length) {
      this.doc = JSON.parse(st.snapshot);
      if (!silent) this.toast('Empty sketch discarded');
    } else {
      this.commit(st.snapshot);
      this.selection = { kind: 'feature', id: f.id };
      kept = true;
    }
    this.cmTab = 'Features';
    this.buildCommandManager();
    this.lpTab = 'tree';
    this.refreshLeftTabs();
    this.setStatus(null);
    this.rebuildModel();
    this.refreshAll();
    const pending = this.pendingFeature;
    this.pendingFeature = null;
    if (kept && pending) {
      this.viewport.setView(VIEWS.trimetric.dir, { fit: true });
      this.newFeature(pending.type, pending.cut, f.id);
    }
  }

  sketchTool(id) {
    if (this.mode !== 'sketch') {
      this.toast('Start or edit a sketch first');
      this.cmdSketch();
      return;
    }
    this.sketcher.setTool(id);
  }

  onSketchToolChanged() {
    this.setStatus(null);
    if (this.pm?.kind === 'sketch') this.renderPM();
    this.refreshChrome();
  }

  onSketchChanged(dragging = false) {
    if (this.pm?.kind === 'sketch' && !$('#pm').contains(document.activeElement)) this.renderPM();
    if (!dragging) this.refreshChrome();
  }

  renderSketchPM(body) {
    const sk = this.sketcher;
    const f = sk.feature;
    const a = sk.analysis;
    const status = !a ? '' : a.status === 'over' ? 'Over Defined — remove a relation or dimension' : a.status === 'full' ? 'Fully Defined' : `Under Defined — ${a.dof} degree${a.dof === 1 ? '' : 's'} of freedom`;
    body.append(h('div', { class: `pm-msg${a?.status === 'over' ? ' error' : a?.status === 'full' ? ' ok' : ''}` },
      h('b', {}, status), h('br'), `Sketching on ${this.planeLabel(f.plane)}. `, SKETCH_TOOLS[sk.tool]?.hint || 'Pick a tool, or select entities and points to add relations.'));
    const grid = h('div', { class: 'tool-grid' });
    for (const [id, t] of Object.entries(SKETCH_TOOLS)) {
      grid.append(h('button', { class: sk.tool === id ? 'active' : '', title: `${t.label}${t.key && t.key.length === 1 ? ` (${t.key.toUpperCase()})` : ''}`, onclick: () => this.sketchTool(id) },
        ico(t.icon), t.label.replace('Corner ', '').replace('Center ', 'Ctr ').replace('3 Point ', '').replace('Smart ', '').replace('Straight ', '').replace('Sketch ', '')));
    }
    body.append(this.pmGroup('Sketch Tools', grid));

    // relations for the current selection
    const rels = sk.applicableRelations();
    const nSel = sk.selected.size + sk.selPoints.length;
    if (nSel) {
      const btns = h('div', { class: 'rel-buttons' });
      for (const r of rels) {
        btns.append(h('button', { class: 'pm-button', onclick: () => { if (!sk.applyRelation(r)) this.toast('That relation conflicts with existing relations or dimensions', 'error'); } }, RELATION_LABELS[r.type] || r.type));
      }
      body.append(this.pmGroup('Add Relations',
        h('div', { class: 'pm-info' }, `${sk.selected.size} entit${sk.selected.size === 1 ? 'y' : 'ies'}, ${sk.selPoints.length} point${sk.selPoints.length === 1 ? '' : 's'} selected (Shift+click to add).`),
        rels.length ? btns : h('div', { class: 'pm-info' }, 'No relations apply to this selection.')));
    }
    const listIdx = nSel ? sk.constraintsOfSelection() : sk.constraints.map((_, i) => i);
    const list = h('div', { class: 'pm-list rel-list' });
    for (const i of listIdx) {
      const c = sk.constraints[i];
      if (c.hidden) continue;
      const label = DIMENSION_TYPES.has(c.type) ? `${RELATION_LABELS[c.type]} ${c.type === 'angle' ? `${(Math.round(c.value * 100) / 100)}°` : units.fmt(c.value)}${c.driven ? ' (driven)' : ''}` : RELATION_LABELS[c.type];
      list.append(h('label', { class: i === sk.selConstraint ? 'on' : '', onclick: () => { sk.selConstraint = i; sk.redraw(); this.renderPM(); } },
        ico(DIMENSION_TYPES.has(c.type) ? 'dimension' : 'relation'), h('span', { style: { flex: 1 } }, label),
        h('button', { class: 'x-btn', title: 'Delete', onclick: (e) => { e.stopPropagation(); sk.deleteConstraint(i); } }, '×')));
    }
    if (!list.children.length) list.append(h('div', { class: 'empty' }, 'No relations or dimensions yet.'));
    body.append(this.pmGroup(nSel ? 'Existing Relations (selection)' : `Relations & Dimensions (${list.children.length})`, list));

    if (sk.selected.size) {
      const ents = [...sk.selected].map((i) => sk.entities[i]);
      body.append(this.pmGroup('Options',
        this.fieldCheck('For construction', () => ents.every((e) => e.construction || e.type === 'centerline'), (v) => sk.setConstruction(v))));
    }
    if (sk.selected.size === 1 && !sk.selPoints.length) {
      const idx = [...sk.selected][0];
      body.append(this.pmGroup('Parameters', ...this.entityFields(sk.entities[idx], idx)));
    } else if (sk.selected.size > 1) {
      body.append(h('div', { style: { margin: '8px' } }, h('button', { class: 'pm-button danger', onclick: () => sk.deleteSelected() }, `Delete ${sk.selected.size} entities`)));
    }

    const { loops, open } = extractLoops(sk.entities);
    const n = sk.entities.length;
    body.append(this.pmGroup('Profile Status', h('div', { class: 'pm-info' },
      `${n} entit${n === 1 ? 'y' : 'ies'} • ${loops.length} closed contour${loops.length === 1 ? '' : 's'}`,
      open.length ? h('div', { style: { color: 'var(--danger)' } }, `${open.length} open contour${open.length === 1 ? '' : 's'} — connect endpoints to use as a profile.`) : null)));

    if (sk.tool === 'sfillet') {
      body.append(this.pmGroup('Sketch Fillet',
        this.fieldNumber('Radius', () => this.settings.sketchFilletRadius, (v) => { this.settings.sketchFilletRadius = Math.max(0.001, v); this.saveSettings(); }, { min: 0.001 })));
    }
    if (sk.selected.size) {
      body.append(this.pmGroup('Modify Entities',
        this.fieldNumber('Offset distance', () => this.settings.offsetDistance, (v) => { this.settings.offsetDistance = Math.max(0.001, v); this.saveSettings(); }, { min: 0.001 }),
        h('div', { class: 'rel-buttons' },
          h('button', { class: 'pm-button', onclick: () => sk.offsetSelected(this.settings.offsetDistance, false) }, 'Offset'),
          h('button', { class: 'pm-button', onclick: () => sk.offsetSelected(this.settings.offsetDistance, true) }, 'Offset (other side)'),
          h('button', { class: 'pm-button', onclick: () => sk.mirrorSelected() }, 'Mirror about centerline'))));
    }
    body.append(this.pmGroup('Grid & Snap',
      this.fieldCheck('Show grid', () => this.settings.showGrid, (v) => { this.settings.showGrid = v; this.sketcher.gridSig = ''; this.saveSettings(); this.refreshChrome(); }),
      this.fieldCheck('Snap to grid', () => this.settings.snapGrid, (v) => { this.settings.snapGrid = v; this.saveSettings(); this.refreshChrome(); }),
      this.fieldNumber('Grid spacing', () => this.settings.gridStep, (v) => { this.settings.gridStep = Math.max(0.01, v); this.sketcher.gridSig = ''; this.saveSettings(); }, { unit: 'len', min: 0.01 }),
      this.fieldNumber('Polygon sides', () => this.settings.polygonSides, (v) => { this.settings.polygonSides = Math.max(3, Math.min(64, Math.round(v))); this.saveSettings(); }, { unit: 'int', min: 3 }),
    ));
  }

  entityFields(e, idx) {
    const sk = this.sketcher;
    let lastPush = 0;
    const touch = () => {
      if (Date.now() - lastPush > 1200) sk.pushUndo();
      lastPush = Date.now();
    };
    const upd = (fn) => (v) => { touch(); fn(v); sk.resolve(); sk.redraw(); };
    const num = (label, get, set, unit = 'len', min) => this.fieldNumber(label, get, upd(set), { unit, min, live: false, onCommit: () => { sk.changed(); this.renderPM(); } });
    const title = { line: 'Line', centerline: 'Centerline', rect: 'Rectangle', circle: 'Circle', arc: 'Arc', polygon: 'Polygon' }[e.type];
    const rows = [h('div', { class: 'pm-info' }, `${title} (entity ${idx + 1}). Tip: use Smart Dimension to keep values when the sketch changes.`)];
    switch (e.type) {
      case 'line':
      case 'centerline': {
        const len = () => Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
        const ang = () => Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]);
        rows.push(
          num('Start X', () => e.a[0], (v) => { e.a[0] = v; }), num('Start Y', () => e.a[1], (v) => { e.a[1] = v; }),
          num('End X', () => e.b[0], (v) => { e.b[0] = v; }), num('End Y', () => e.b[1], (v) => { e.b[1] = v; }),
          num('Length', len, (v) => { const a = ang(); e.b = [e.a[0] + v * Math.cos(a), e.a[1] + v * Math.sin(a)]; }, 'len', 0.001),
          num('Angle', () => ang() * DEG, (v) => { const l = len(); e.b = [e.a[0] + l * Math.cos(v / DEG), e.a[1] + l * Math.sin(v / DEG)]; }, 'deg'),
        );
        break;
      }
      case 'rect':
        rows.push(
          num('Corner X', () => e.a[0], (v) => { const w = e.b[0] - e.a[0]; e.a[0] = v; e.b[0] = v + w; }),
          num('Corner Y', () => e.a[1], (v) => { const hh = e.b[1] - e.a[1]; e.a[1] = v; e.b[1] = v + hh; }),
          num('Width', () => e.b[0] - e.a[0], (v) => { e.b[0] = e.a[0] + v; }, 'len', 0.001),
          num('Height', () => e.b[1] - e.a[1], (v) => { e.b[1] = e.a[1] + v; }, 'len', 0.001),
        );
        break;
      case 'circle':
        rows.push(
          num('Center X', () => e.c[0], (v) => { e.c[0] = v; }), num('Center Y', () => e.c[1], (v) => { e.c[1] = v; }),
          num('Radius', () => e.r, (v) => { e.r = Math.max(0.001, v); }, 'len', 0.001),
          num('Diameter', () => e.r * 2, (v) => { e.r = Math.max(0.001, v / 2); }, 'len', 0.001),
        );
        break;
      case 'arc':
        rows.push(
          num('Center X', () => e.c[0], (v) => { e.c[0] = v; }), num('Center Y', () => e.c[1], (v) => { e.c[1] = v; }),
          num('Radius', () => e.r, (v) => { e.r = Math.max(0.001, v); }, 'len', 0.001),
          num('Start angle', () => e.a0 * DEG, (v) => { e.a0 = v / DEG; }, 'deg'),
          num('End angle', () => e.a1 * DEG, (v) => { e.a1 = v / DEG; }, 'deg'),
        );
        break;
      case 'polygon':
        rows.push(
          num('Center X', () => e.c[0], (v) => { e.c[0] = v; }), num('Center Y', () => e.c[1], (v) => { e.c[1] = v; }),
          num('Radius', () => e.r, (v) => { e.r = Math.max(0.001, v); }, 'len', 0.001),
          num('Sides', () => e.n, (v) => { e.n = Math.max(3, Math.min(64, Math.round(v))); }, 'int', 3),
          num('Rotation', () => e.rot * DEG, (v) => { e.rot = v / DEG; }, 'deg'),
        );
        break;
      default: break;
    }
    rows.push(h('button', { class: 'pm-button danger', onclick: () => sk.deleteSelected() }, 'Delete entity'));
    return rows;
  }

  // ================================================================ property manager

  renderPM() {
    const pmEl = $('#pm');
    pmEl.replaceChildren();
    const spec = this.pm;
    if (!spec) {
      pmEl.append(h('div', { class: 'pm-empty', html: 'No command is active.<br>Choose a command from the CommandManager, or double-click an item in the tree to edit it.' }));
      return;
    }
    const actions = h('div', { class: 'pm-actions' },
      h('button', { class: 'pm-action', title: spec.kind === 'sketch' ? 'Exit Sketch (Enter)' : 'OK (Enter)', html: icon('check'), onclick: () => this.pmOK() }),
      spec.kind === 'measure' ? null : h('button', { class: 'pm-action', title: 'Cancel (Esc)', html: icon('cancel'), onclick: () => this.pmCancel() }));
    pmEl.append(h('div', { class: 'pm-head' }, h('span', { class: 'pm-icon', html: icon(val(spec.icon)) }), h('span', { class: 'pm-title' }, val(spec.title))), actions);
    pmEl.append(h('div', { id: 'pm-error' }));
    const body = h('div', {});
    spec.render(body);
    pmEl.append(body);
    this.updatePMError();
  }

  updatePMError() {
    const el = $('#pm-error');
    if (!el) return;
    const msg = this.pm?.error?.();
    el.replaceChildren(msg ? h('div', { class: 'pm-msg error' }, msg) : '');
  }

  openPM(spec) {
    this.pm = spec;
    this.mode = 'pm';
    this.lpTab = 'pm';
    this.refreshLeftTabs();
    this.renderPM();
    this.refreshChrome();
  }

  pmOK() {
    const spec = this.pm;
    if (!spec) return;
    if (spec.kind === 'sketch') { this.exitSketch(true); return; }
    if (spec.onOK && spec.onOK() === false) return;
    this.closePM(spec);
  }

  pmCancel() {
    const spec = this.pm;
    if (!spec) return;
    if (spec.kind === 'sketch') { this.exitSketch(false); return; }
    spec.onCancel?.();
    this.closePM(spec);
  }

  closePM(spec) {
    spec.onClose?.();
    this.pm = null;
    this.mode = 'model';
    this.lpTab = 'tree';
    this.refreshLeftTabs();
    this.setStatus(null);
    this.rebuildModel();
    this.renderPM();
    this.refreshHighlights();
    this.refreshChrome();
  }

  pmGroup(title, ...rows) {
    const g = h('div', { class: 'pm-group' },
      h('div', { class: 'pm-group-head', onclick: () => g.classList.toggle('collapsed') }, title),
      h('div', { class: 'pm-group-body' }, ...rows));
    return g;
  }

  fieldNumber(label, get, set, { unit = 'len', min = null, live = true, onCommit = null } = {}) {
    const toDisp = (v) => (unit === 'len' ? units.toDisplay(v) : unit === 'int' ? Math.round(v) : Math.round(v * 1e4) / 1e4);
    const fromDisp = (v) => (unit === 'len' ? units.fromDisplay(v) : v);
    const input = h('input', { type: 'text', inputmode: 'decimal', value: toDisp(get()), spellcheck: 'false' });
    const apply = () => {
      let v = evalNumber(input.value);
      if (Number.isNaN(v)) return false;
      v = fromDisp(v);
      if (min != null && v < min) v = min;
      set(v);
      return true;
    };
    input.addEventListener('input', () => { if (live) apply(); });
    input.addEventListener('change', () => {
      if (!live) apply();
      input.value = toDisp(get());
      onCommit?.();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.dispatchEvent(new Event('change')); input.select(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = unit === 'int' ? 1 : unit === 'deg' ? 5 : (units.id === 'mm' ? 1 : 0.1);
        const cur = evalNumber(input.value);
        input.value = toDisp(fromDisp((Number.isNaN(cur) ? 0 : cur) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)));
        apply();
        input.value = toDisp(get());
        if (!live) onCommit?.();
      }
    });
    input.addEventListener('focus', () => input.select());
    const unitLabel = unit === 'len' ? units.def.label : unit === 'deg' ? '°' : '';
    return h('div', { class: 'pm-row' }, h('label', {}, label), h('div', { class: 'num-wrap' }, input, h('span', { class: 'unit' }, unitLabel)));
  }

  fieldSelect(label, options, get, set) {
    const sel = h('select', {}, ...options.map((o) => h('option', { value: o.value, selected: String(get()) === String(o.value) }, o.label)));
    sel.addEventListener('change', () => set(sel.value));
    return h('div', { class: 'pm-row' }, h('label', {}, label), sel);
  }

  fieldCheck(label, get, set) {
    const cb = h('input', { type: 'checkbox', checked: !!get() });
    cb.addEventListener('change', () => set(cb.checked));
    return h('div', { class: 'pm-row check' }, h('label', {}, cb, label));
  }

  fieldChecklist(options, get, set) {
    const list = h('div', { class: 'pm-list' });
    if (!options.length) list.append(h('div', { class: 'empty' }, 'No eligible features.'));
    for (const o of options) {
      const cb = h('input', { type: 'checkbox', checked: get().includes(o.value) });
      cb.addEventListener('change', () => {
        const cur = new Set(get());
        if (cb.checked) cur.add(o.value); else cur.delete(o.value);
        set(options.map((x) => x.value).filter((v) => cur.has(v)));
      });
      list.append(h('label', {}, cb, ico(o.icon), o.label));
    }
    return list;
  }

  // List box of picked references (edges / faces) with remove buttons.
  fieldPickList(items, describe, onRemove, onClear, emptyText) {
    const list = h('div', { class: 'pm-list pick-list' });
    if (!items.length) list.append(h('div', { class: 'empty' }, emptyText));
    items.forEach((it, i) => {
      list.append(h('label', {}, h('span', { style: { flex: 1 } }, describe(it, i)),
        h('button', { class: 'x-btn', title: 'Remove', onclick: () => onRemove(i) }, '×')));
    });
    return h('div', {}, list, items.length ? h('button', { class: 'pm-button', style: { marginTop: '6px' }, onclick: onClear }, 'Clear selections') : null);
  }

  // ================================================================ features

  cmdFeature(type, cut = false) {
    if (!this.isPart) return;
    if (this.measure) this.closeMeasure();
    if (this.mode === 'pickPlane') this.cancelPickPlane();
    if (this.mode === 'sketch') {
      const sk = this.sketcher.feature;
      this.exitSketch(true);
      if (['extrude', 'revolve', 'hole'].includes(type) && this.byId(sk.id)) { this.newFeature(type, cut, sk.id); return; }
    }
    const preSel = this.selection;
    if (this.pm) this.pmCancel();
    this.selection = preSel;
    if (type === 'extrude' || type === 'revolve') {
      const sk = this.pickProfileSketch();
      if (!sk) {
        if (cut && !this.build.data) { this.toast('Create a boss/base feature before cutting', 'error'); return; }
        this.pendingFeature = { type, cut };
        this.cmdSketch();
        if (this.mode === 'pickPlane') this.showBanner(`Select a plane or planar face to sketch the ${cut ? 'cut' : 'feature'} profile`, () => this.cancelPickPlane());
        return;
      }
      this.newFeature(type, cut, sk.id);
      return;
    }
    if (BODY_FEATURES.has(type) && !this.build.data) { this.toast('Create a solid body first', 'error'); return; }
    if (type === 'hole' && !this.pickHoleSketch()) {
      // no position sketch yet: sketch points on a face first, then come back to the Hole Wizard
      this.pendingFeature = { type: 'hole' };
      this.cmdSketch();
      if (this.mode === 'pickPlane') this.showBanner('Select the face to drill, then place points for the hole centers', () => this.cancelPickPlane());
      if (this.mode === 'sketch') this.sketcher.setTool('point');
      return;
    }
    this.newFeature(type);
  }

  pickProfileSketch() {
    const sel = this.selection;
    if (sel?.kind === 'feature') {
      const f = this.byId(sel.id);
      if (f?.type === 'sketch') return f;
    }
    const limit = this.insertIndex();
    for (let i = limit - 1; i >= 0; i--) {
      const f = this.doc.features[i];
      if (f.type === 'sketch' && !f.suppressed && !this.isConsumed(f.id) && f.entities.length) return f;
    }
    return null;
  }

  solidOptions(before) {
    const idx = this.doc.features.indexOf(before);
    return this.doc.features.slice(0, idx < 0 ? undefined : idx)
      .filter((f) => SOLID_TYPES.has(f.type) && !f.suppressed)
      .map((f) => ({ value: f.id, label: f.name, icon: featIcon(f) }));
  }

  planeOptions(before) {
    const idx = this.doc.features.indexOf(before);
    const opts = ['Front', 'Top', 'Right'].map((n) => ({ value: n, label: `${n} Plane` }));
    this.doc.features.slice(0, idx < 0 ? undefined : idx).forEach((f) => { if (f.type === 'plane' && !f.suppressed) opts.push({ value: f.id, label: f.name }); });
    return opts;
  }

  newFeature(type, cut = false, sketchId = null) {
    const f = { id: uid(), type, name: '' };
    const sel = this.selection;
    const selFeature = sel?.kind === 'feature' ? this.byId(sel.id) : null;
    const solidSel = selFeature && SOLID_TYPES.has(selFeature.type) ? [selFeature.id] : null;
    const lastSolid = () => {
      for (let i = this.insertIndex() - 1; i >= 0; i--) if (SOLID_TYPES.has(this.doc.features[i].type) && !this.doc.features[i].suppressed) return [this.doc.features[i].id];
      return [];
    };
    const selPlane = sel?.kind === 'plane' ? sel.key : selFeature?.type === 'plane' ? selFeature.id : null;
    switch (type) {
      case 'extrude': {
        const sk = this.byId(sketchId);
        Object.assign(f, { sketch: sketchId, endCondition: 'blind', depth: 10, reverse: cut && sk?.plane === 'face', cut });
        break;
      }
      case 'revolve': {
        const sk = this.byId(sketchId);
        Object.assign(f, { sketch: sketchId, axis: revolveAxisOptions(sk.entities)[0].value, angle: 360, reverse: false, cut });
        break;
      }
      case 'sweep': {
        const [profile, path] = this.pickSweepSketches();
        Object.assign(f, { profile, path, cut, frenet: false });
        break;
      }
      case 'loft': Object.assign(f, { sections: this.unusedSketches().slice(-2).map((x) => x.id), ruled: false, cut }); break;
      case 'draft': Object.assign(f, { angle: 3, faces: sel?.kind === 'face' ? [this.facePoint(sel)] : [], neutral: 'Top', reverse: false }); break;
      case 'hole': Object.assign(f, { sketch: sketchId || this.pickHoleSketch()?.id, holeType: 'simple', diameter: 6, depth: 10, through: false, cboreDiameter: 11, cboreDepth: 6, csinkDiameter: 12, csinkAngle: 90, reverse: false }); break;
      case 'fillet': Object.assign(f, { radius: 2, edges: sel?.kind === 'edge' ? [sel.info.mid] : [], all: false }); break;
      case 'chamfer': Object.assign(f, { distance: 1, edges: sel?.kind === 'edge' ? [sel.info.mid] : [], all: false }); break;
      case 'shell': Object.assign(f, { thickness: 2, faces: sel?.kind === 'face' ? [this.facePoint(sel)] : [] }); break;
      case 'linpattern': Object.assign(f, { targets: solidSel || lastSolid(), direction: 'X', reverse: false, spacing: 20, count: 3 }); break;
      case 'cirpattern': Object.assign(f, { targets: solidSel || lastSolid(), axis: 'Y', count: 4, angle: 90, equal: true, reverse: false }); break;
      case 'mirror': Object.assign(f, { targets: solidSel || [], plane: selPlane || 'Right' }); break;
      case 'plane':
        if (sel?.kind === 'face' && sel.frame) Object.assign(f, { base: 'face', baseFrame: sel.frame, offset: 10, flip: false });
        else Object.assign(f, { base: selPlane || 'Top', offset: 20, flip: false });
        break;
      default: return;
    }
    f.name = this.nextName(val(FEATURE_META[type].prefix, f));
    this.editFeature(f, true);
  }

  unusedSketches() {
    return this.doc.features.slice(0, this.insertIndex()).filter((f) => f.type === 'sketch' && !f.suppressed && !this.isConsumed(f.id) && f.entities.length);
  }

  // Sweep: the path is the newest sketch with an open chain, the profile the newest closed one.
  pickSweepSketches() {
    const list = this.unusedSketches().reverse();
    const isOpen = (f) => { const r = extractLoops(f.entities); return !r.loops.length && r.open.length > 0; };
    const path = list.find(isOpen);
    const profile = list.find((f) => f !== path && extractLoops(f.entities).loops.length);
    return [profile?.id || null, path?.id || null];
  }

  pickHoleSketch() {
    const sel = this.selection?.kind === 'feature' ? this.byId(this.selection.id) : null;
    const hasPts = (f) => f?.type === 'sketch' && f.entities.some((e) => e.type === 'point');
    if (hasPts(sel)) return sel;
    return this.unusedSketches().reverse().find(hasPts) || null;
  }

  // A point on a selected face (stored as the face reference).
  facePoint(sel) {
    if (sel.point) return sel.point;
    return sel.info?.center || [0, 0, 0];
  }

  editFeatureById(id) {
    const f = this.byId(id);
    if (!f) return;
    if (f.type === 'sketch') { this.editSketch(id); return; }
    if (this.mode === 'sketch') this.exitSketch(true);
    if (this.pm) this.pmCancel();
    this.editFeature(f, false);
  }

  editFeature(f, isNew) {
    const snapshot = JSON.stringify(this.doc);
    if (isNew) {
      this.doc.features.splice(this.insertIndex(), 0, f);
      if (this.doc.rollback != null) this.doc.rollback++;
    }
    const preview = () => { clearTimeout(this.previewTimer); this.previewTimer = setTimeout(() => this.rebuildModel(), 60); };
    const rerender = () => { preview(); this.renderPM(); this.refreshHighlights(); };
    this.selection = null;
    const picking = PICK_FEATURES.has(f.type);
    const spec = {
      kind: 'feature', featureId: f.id, title: () => f.name, icon: () => featIcon(f),
      error: () => spec.validationError || this.build?.errors[f.id],
      render: (body) => this.renderFeatureFields(f, body, preview, rerender),
      onOK: () => {
        clearTimeout(this.previewTimer);
        this.commit(snapshot);
        this.selection = { kind: 'feature', id: f.id };
        this.checkFeatureAfterOK(f);
      },
      onCancel: () => { clearTimeout(this.previewTimer); this.doc = JSON.parse(snapshot); },
      onPick: (hit) => this.featurePick(f, hit, rerender),
      highlightPlane: () => (f.type === 'mirror' ? f.plane : f.type === 'plane' && f.base !== 'face' ? f.base : null),
    };
    if (picking) {
      // show the body before this feature so edges/faces can be picked, and validate the result separately
      spec.displayLimit = () => this.doc.features.indexOf(f);
      const facePick = f.type === 'shell' || f.type === 'draft';
      spec.wants = facePick ? ['face'] : ['edge'];
      spec.status = () => ({
        shell: 'Click the faces to remove (open). Then set the wall thickness.',
        draft: 'Click the faces to taper. Pick the neutral plane in the PropertyManager or click a plane.',
      }[f.type] || 'Click the edges to round or bevel. Click again to deselect.');
      spec.highlights = () => this.featureRefHighlights(f);
      spec.validate = () => {
        clearTimeout(this.validateTimer);
        this.validateTimer = setTimeout(async () => {
          const idx = this.doc.features.indexOf(f);
          if (idx < 0) return;
          try {
            const r = await this.kernel.rebuild(this.doc, idx + 1);
            spec.validationError = r.errors[f.id] || null;
            spec.preview = r.data;
          } catch (e) { spec.validationError = e.message; }
          if (this.pm === spec) { this.updatePMError(); this.renderPreviewInfo(spec); }
        }, 120);
      };
    }
    this.openPM(spec);
    this.rebuildModel();
  }

  checkFeatureAfterOK(f) {
    setTimeout(() => {
      if (this.build?.errors[f.id]) this.toast(`${f.name}: ${this.build.errors[f.id]}`, 'error');
    }, 400);
  }

  renderPreviewInfo(spec) {
    const el = document.getElementById('pm-preview-info');
    if (!el) return;
    el.textContent = spec.preview && !spec.validationError ? `Result volume: ${units.fmtVolume(spec.preview.mass.volume)}` : '';
  }

  featureRefHighlights(f) {
    const data = this.build?.data;
    if (!data) return [];
    const out = [];
    for (const p of f.edges || []) { const e = nearestEdge(data, p); if (e >= 0) out.push({ bodyId: 'part', edge: e }); }
    for (const p of f.faces || []) { const fc = nearestFace(data, p); if (fc >= 0) out.push({ bodyId: 'part', face: fc }); }
    return out;
  }

  featurePick(f, hit, rerender) {
    const planeKey = hit.kind === 'plane' ? hit.key : null;
    if (f.type === 'mirror' && planeKey) { f.plane = planeKey; rerender(); return true; }
    if (f.type === 'plane') {
      if (planeKey && planeKey !== f.id) { f.base = planeKey; delete f.baseFrame; rerender(); return true; }
      if (hit.kind === 'face') {
        const frame = this.faceFrame(hit);
        if (!frame) { this.toast('Select a planar face'); return true; }
        f.base = 'face'; f.baseFrame = frame; rerender(); return true;
      }
    }
    if ((f.type === 'fillet' || f.type === 'chamfer') && hit.kind === 'edge') {
      const data = this.build.data;
      const existing = f.edges.findIndex((p) => nearestEdge(data, p) === hit.edge);
      if (existing >= 0) f.edges.splice(existing, 1); else f.edges.push(hit.info.mid);
      f.all = false;
      rerender();
      return true;
    }
    if (f.type === 'draft' && hit.kind === 'plane') { f.neutral = hit.key; delete f.neutralFrame; rerender(); return true; }
    if ((f.type === 'shell' || f.type === 'draft') && hit.kind === 'face') {
      const data = this.build.data;
      const existing = f.faces.findIndex((p) => nearestFace(data, p) === hit.face);
      if (existing >= 0) f.faces.splice(existing, 1); else f.faces.push(hit.point.toArray());
      rerender();
      return true;
    }
    if ((f.type === 'linpattern' || f.type === 'cirpattern' || f.type === 'mirror') && hit.kind === 'sketch') return true;
    return false;
  }

  renderFeatureFields(f, body, preview, rerender) {
    const set = (k, after = preview) => (v) => { f[k] = v; after(); };
    const sketches = this.doc.features.slice(0, this.doc.features.indexOf(f)).filter((x) => x.type === 'sketch')
      .map((x) => ({ value: x.id, label: `${x.name}${this.isConsumed(x.id) && x.id !== f.sketch ? ' (used)' : ''}` }));
    const describeEdge = (p) => {
      const e = nearestEdge(this.build.data, p);
      const info = this.build.data?.edges[e];
      return info ? `${info.type === 'CIRCLE' ? 'Circular edge' : info.type === 'LINE' ? 'Edge' : 'Curved edge'} · ${units.fmt(info.length)}` : 'Edge (missing)';
    };
    const describeFace = (p) => {
      const fc = nearestFace(this.build.data, p);
      const info = this.build.data?.faces[fc];
      return info ? `${{ PLANE: 'Planar face', CYLINDRE: 'Cylindrical face' }[info.type] || 'Face'} · ${units.fmtArea(info.area)}` : 'Face (missing)';
    };
    switch (f.type) {
      case 'extrude': {
        const through = f.endCondition === 'throughAll' || f.endCondition === 'throughAllBoth';
        body.append(
          this.pmGroup('From', this.fieldSelect('Sketch', sketches, () => f.sketch, set('sketch', rerender)),
            h('div', { class: 'pm-info' }, `Sketch plane: ${this.planeLabel(this.byId(f.sketch)?.plane)}`)),
          this.pmGroup('Direction 1',
            this.fieldSelect('End condition', [
              { value: 'blind', label: 'Blind' }, { value: 'midplane', label: 'Mid Plane' },
              { value: 'throughAll', label: 'Through All' }, { value: 'throughAllBoth', label: 'Through All - Both' },
            ], () => f.endCondition, set('endCondition', rerender)),
            f.endCondition === 'throughAllBoth' || f.endCondition === 'midplane' ? null : this.fieldCheck('Reverse direction', () => f.reverse, set('reverse')),
            through ? null : this.fieldNumber('Depth', () => f.depth, set('depth'), { min: 0.001 }),
          ),
          h('div', { class: 'pm-info', style: { margin: '0 10px' } }, f.cut ? 'Removes material from the body where the profile is extruded.' : 'Adds material by extruding the closed profile(s) of the sketch.'),
        );
        break;
      }
      case 'revolve': {
        const sk = this.byId(f.sketch);
        body.append(
          this.pmGroup('Profile', this.fieldSelect('Sketch', sketches, () => f.sketch, (v) => {
            f.sketch = v;
            f.axis = revolveAxisOptions(this.byId(v)?.entities || [])[0].value;
            rerender();
          })),
          this.pmGroup('Axis of Revolution', this.fieldSelect('Axis', revolveAxisOptions(sk?.entities || []), () => f.axis, set('axis')),
            h('div', { class: 'pm-info' }, 'Tip: draw a Centerline in the sketch to use it as the axis.')),
          this.pmGroup('Direction 1',
            this.fieldNumber('Angle', () => f.angle, (v) => { f.angle = Math.min(360, v); preview(); }, { unit: 'deg', min: 0.1 }),
            this.fieldCheck('Reverse direction', () => f.reverse, set('reverse'))),
        );
        break;
      }
      case 'fillet':
      case 'chamfer': {
        const isF = f.type === 'fillet';
        body.append(
          this.pmGroup(isF ? 'Fillet Parameters' : 'Chamfer Parameters',
            isF ? this.fieldNumber('Radius', () => f.radius, set('radius'), { min: 0.001 })
              : this.fieldNumber('Distance', () => f.distance, set('distance'), { min: 0.001 })),
          this.pmGroup(isF ? 'Items to Fillet' : 'Items to Chamfer',
            this.fieldCheck('All edges of the body', () => f.all, set('all', rerender)),
            f.all ? h('div', { class: 'pm-info' }, 'Every edge of the body will be processed.')
              : this.fieldPickList(f.edges, describeEdge, (i) => { f.edges.splice(i, 1); rerender(); }, () => { f.edges = []; rerender(); }, 'Click edges in the graphics area.')),
          h('div', { id: 'pm-preview-info', class: 'pm-info', style: { margin: '0 10px' } }),
        );
        break;
      }
      case 'sweep': {
        const opts = [{ value: '', label: '— select —' }, ...sketches];
        body.append(
          this.pmGroup('Profile and Path',
            this.fieldSelect('Profile', opts, () => f.profile || '', (v) => { f.profile = v || null; rerender(); }),
            this.fieldSelect('Path', opts, () => f.path || '', (v) => { f.path = v || null; rerender(); }),
            h('div', { class: 'pm-info' }, 'Profile: a closed sketch at the start of the path, on a plane across it. Path: a sketch with an open chain of lines, arcs or splines.')),
          this.pmGroup('Options', this.fieldCheck('Keep profile orientation along the path (Frenet)', () => f.frenet, set('frenet'))),
        );
        break;
      }
      case 'loft': {
        const all = this.doc.features.slice(0, this.doc.features.indexOf(f)).filter((x) => x.type === 'sketch');
        const list = h('div', { class: 'pm-list pick-list' });
        f.sections.forEach((id, i) => {
          const sk = this.byId(id);
          list.append(h('label', {}, h('span', { style: { flex: 1 } }, `${i + 1}. ${sk?.name || 'missing'}`),
            h('button', { class: 'x-btn', title: 'Move up', onclick: () => { if (i) { [f.sections[i - 1], f.sections[i]] = [f.sections[i], f.sections[i - 1]]; rerender(); } } }, '↑'),
            h('button', { class: 'x-btn', title: 'Remove', onclick: () => { f.sections.splice(i, 1); rerender(); } }, '×')));
        });
        if (!f.sections.length) list.append(h('div', { class: 'empty' }, 'Add two or more profile sketches.'));
        const choices = all.filter((x) => !f.sections.includes(x.id)).map((x) => ({ value: x.id, label: x.name }));
        body.append(
          this.pmGroup('Profiles (in order)', list,
            this.fieldSelect('Add profile', [{ value: '', label: '— choose a sketch —' }, ...choices], () => '', (v) => { if (v) { f.sections.push(v); rerender(); } }),
            h('div', { class: 'pm-info' }, 'Each profile is one closed shape on its own plane (use reference planes to space them).')),
          this.pmGroup('Options', this.fieldCheck('Ruled (straight sides between profiles)', () => f.ruled, set('ruled'))),
        );
        break;
      }
      case 'draft':
        body.append(
          this.pmGroup('Draft Angle', this.fieldNumber('Angle', () => f.angle, set('angle'), { unit: 'deg' }), this.fieldCheck('Reverse direction', () => f.reverse, set('reverse'))),
          this.pmGroup('Neutral Plane', this.fieldSelect('Plane', this.planeOptions(f), () => f.neutral, set('neutral', rerender)),
            h('div', { class: 'pm-info' }, 'Faces pivot about where they cross this plane.')),
          this.pmGroup('Faces to Draft', this.fieldPickList(f.faces, describeFace, (i) => { f.faces.splice(i, 1); rerender(); }, () => { f.faces = []; rerender(); }, 'Click the faces to taper.')),
          h('div', { id: 'pm-preview-info', class: 'pm-info', style: { margin: '0 10px' } }),
        );
        break;
      case 'hole': {
        const ptsSk = this.doc.features.slice(0, this.doc.features.indexOf(f)).filter((x) => x.type === 'sketch' && x.entities.some((e) => e.type === 'point' || e.type === 'circle'));
        const n = this.byId(f.sketch)?.entities.filter((e) => e.type === 'point' || e.type === 'circle').length || 0;
        const size = HOLE_SIZES.find((x) => x.d && Math.abs(x.d - f.diameter) < 1e-9)?.label || 'Custom';
        body.append(
          this.pmGroup('Hole Type',
            this.fieldSelect('Type', [{ value: 'simple', label: 'Simple hole' }, { value: 'cbore', label: 'Counterbore' }, { value: 'csink', label: 'Countersink' }], () => f.holeType, set('holeType', rerender)),
            this.fieldSelect('Standard size', HOLE_SIZES.map((x) => ({ value: x.label, label: x.label })), () => size, (v) => {
              const z = HOLE_SIZES.find((x) => x.label === v);
              if (z?.d) Object.assign(f, { diameter: z.d, cboreDiameter: z.cb, cboreDepth: z.cbd, csinkDiameter: z.cs });
              rerender();
            }),
            this.fieldNumber('Diameter', () => f.diameter, set('diameter'), { min: 0.01 })),
          this.pmGroup('End Condition',
            this.fieldCheck('Through all', () => f.through, set('through', rerender)),
            f.through ? null : this.fieldNumber('Depth', () => f.depth, set('depth'), { min: 0.01 }),
            this.fieldCheck('Reverse direction', () => f.reverse, set('reverse'))),
          f.holeType === 'cbore' ? this.pmGroup('Counterbore', this.fieldNumber('Diameter', () => f.cboreDiameter, set('cboreDiameter'), { min: 0.01 }), this.fieldNumber('Depth', () => f.cboreDepth, set('cboreDepth'), { min: 0.01 })) : null,
          f.holeType === 'csink' ? this.pmGroup('Countersink', this.fieldNumber('Diameter', () => f.csinkDiameter, set('csinkDiameter'), { min: 0.01 }), this.fieldNumber('Angle', () => f.csinkAngle, set('csinkAngle'), { unit: 'deg', min: 1 })) : null,
          this.pmGroup('Positions',
            this.fieldSelect('Sketch', [{ value: '', label: '— select —' }, ...ptsSk.map((x) => ({ value: x.id, label: x.name }))], () => f.sketch || '', (v) => { f.sketch = v || null; rerender(); }),
            h('div', { class: 'pm-info' }, `${n} hole position${n === 1 ? '' : 's'} (sketch points and circle centers).`)),
        );
        break;
      }
      case 'import':
        body.append(this.pmGroup('Imported Body', h('div', { class: 'pm-info' }, `Format: ${f.format.toUpperCase()} · ${Math.round(f.data.length / 1024)} KB stored in this part. Add features on top of it like any other body.`)));
        break;
      case 'shell':
        body.append(
          this.pmGroup('Parameters', this.fieldNumber('Thickness', () => f.thickness, set('thickness'), { min: 0.001 })),
          this.pmGroup('Faces to Remove',
            this.fieldPickList(f.faces, describeFace, (i) => { f.faces.splice(i, 1); rerender(); }, () => { f.faces = []; rerender(); }, 'Click the face(s) to open up.')),
          h('div', { class: 'pm-info', style: { margin: '0 10px' } }, 'The walls are offset inward by the thickness.'),
          h('div', { id: 'pm-preview-info', class: 'pm-info', style: { margin: '0 10px' } }),
        );
        break;
      case 'linpattern':
        body.append(
          this.pmGroup('Direction 1',
            this.fieldSelect('Direction', [{ value: 'X', label: 'X axis' }, { value: 'Y', label: 'Y axis' }, { value: 'Z', label: 'Z axis' }], () => f.direction, set('direction')),
            this.fieldCheck('Reverse direction', () => f.reverse, set('reverse')),
            this.fieldNumber('Spacing', () => f.spacing, set('spacing')),
            this.fieldNumber('Instances', () => f.count, (v) => { f.count = Math.max(2, Math.min(200, Math.round(v))); preview(); }, { unit: 'int', min: 2 })),
          this.pmGroup('Features to Pattern', this.fieldChecklist(this.solidOptions(f), () => f.targets, set('targets'))),
        );
        break;
      case 'cirpattern':
        body.append(
          this.pmGroup('Parameters',
            this.fieldSelect('Axis', [{ value: 'X', label: 'X axis' }, { value: 'Y', label: 'Y axis' }, { value: 'Z', label: 'Z axis' }], () => f.axis, set('axis')),
            this.fieldCheck('Equal spacing (360°)', () => f.equal, set('equal', rerender)),
            f.equal ? null : this.fieldNumber('Angle between', () => f.angle, set('angle'), { unit: 'deg' }),
            this.fieldNumber('Instances', () => f.count, (v) => { f.count = Math.max(2, Math.min(200, Math.round(v))); preview(); }, { unit: 'int', min: 2 }),
            this.fieldCheck('Reverse direction', () => f.reverse, set('reverse'))),
          this.pmGroup('Features to Pattern', this.fieldChecklist(this.solidOptions(f), () => f.targets, set('targets'))),
        );
        break;
      case 'mirror':
        body.append(
          this.pmGroup('Mirror Face/Plane', this.fieldSelect('Plane', this.planeOptions(f), () => f.plane, set('plane', rerender)),
            h('div', { class: 'pm-info' }, 'You can also click a plane in the graphics area or the tree.')),
          this.pmGroup('Features to Mirror', this.fieldChecklist(this.solidOptions(f), () => f.targets, set('targets')),
            h('div', { class: 'pm-info' }, 'Leave empty to mirror the entire body.')),
        );
        break;
      case 'plane': {
        const opts = this.planeOptions(f);
        if (f.base === 'face') opts.push({ value: 'face', label: 'Selected face' });
        body.append(
          this.pmGroup('First Reference',
            this.fieldSelect('Reference', opts, () => f.base, (v) => { f.base = v; if (v !== 'face') delete f.baseFrame; rerender(); }),
            h('div', { class: 'pm-info' }, 'Click a plane or a flat face in the graphics area to use it as the reference.')),
          this.pmGroup('Offset',
            this.fieldNumber('Distance', () => f.offset, set('offset')),
            this.fieldCheck('Flip offset', () => f.flip, set('flip'))),
        );
        break;
      }
      default: break;
    }
  }

  // ================================================================ evaluate

  cmdMeasure() {
    if (this.measure) { this.pmOK(); return; }
    if (this.mode === 'sketch') this.exitSketch(true);
    if (this.mode === 'pickPlane') this.cancelPickPlane();
    if (this.pm) this.pmCancel();
    if (!this.viewport.bodies.size) { this.toast('Nothing to measure yet'); return; }
    this.measure = { points: [], last: null };
    this.tag = h('div', { class: 'measure-tag' });
    this.tag.hidden = true;
    $('#vp-overlay').append(this.tag);
    this.openPM({
      kind: 'measure', title: 'Measure', icon: 'measure',
      render: (body) => this.renderMeasurePM(body),
      highlights: () => (this.measure?.last ? [this.measure.last] : []),
      onClose: () => {
        this.measure = null;
        this.measureGroup.clear();
        this.tag?.remove();
        this.tag = null;
      },
    });
  }

  closeMeasure() { if (this.measure) this.pmOK(); }

  measureClick(hit, ev) {
    if (!hit || (hit.kind !== 'face' && hit.kind !== 'edge')) { this.toast('Click on the model'); return; }
    const snap = this.viewport.snapPoint(hit, ev.clientX, ev.clientY);
    const v = snap ? snap.point : hit.point.clone();
    const m = this.measure;
    if (m.points.length >= 2) m.points = [];
    m.points.push(v);
    m.last = hit.kind === 'face' ? { bodyId: hit.bodyId, face: hit.face } : { bodyId: hit.bodyId, edge: hit.edge };
    m.desc = this.describePick(hit);
    m.snap = snap?.type || null;
    this.measureGroup.clear();
    const pts = new THREE.Points(new THREE.BufferGeometry().setFromPoints(m.points), new THREE.PointsMaterial({ color: 0xd8392b, size: 9, sizeAttenuation: false, depthTest: false }));
    pts.renderOrder = 30;
    this.measureGroup.add(pts);
    if (m.points.length === 2) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(m.points), new THREE.LineBasicMaterial({ color: 0xe8590c, depthTest: false }));
      line.renderOrder = 30;
      this.measureGroup.add(line);
    }
    this.refreshHighlights();
    this.renderPM();
  }

  positionMeasureTag() {
    if (!this.tag || !this.measure) return;
    const m = this.measure;
    if (m.points.length !== 2) { this.tag.hidden = true; return; }
    const mid = m.points[0].clone().add(m.points[1]).multiplyScalar(0.5);
    const s = this.viewport.toScreen(mid);
    this.tag.hidden = false;
    this.tag.textContent = units.fmt(m.points[0].distanceTo(m.points[1]));
    this.tag.style.left = `${s.x}px`;
    this.tag.style.top = `${s.y}px`;
  }

  renderMeasurePM(body) {
    const m = this.measure;
    body.append(h('div', { class: 'pm-msg' }, 'Click faces, edges or vertices. Two clicks measure the distance between points; vertices and circle centers snap.'));
    if (m.desc) body.append(this.pmGroup('Last Selection', h('div', { class: 'pm-info' }, m.desc, m.snap ? ` (snapped to ${m.snap})` : '')));
    const kv = h('dl', { class: 'pm-kv' });
    const row = (k, v) => kv.append(h('dt', {}, k), h('dd', {}, v));
    m.points.forEach((p, i) => row(`Point ${i + 1}`, `${units.fmt(p.x, false)}, ${units.fmt(p.y, false)}, ${units.fmt(p.z)}`));
    if (m.points.length === 2) {
      const [a, b] = m.points;
      row('Distance', units.fmt(a.distanceTo(b)));
      row('dX', units.fmt(Math.abs(b.x - a.x)));
      row('dY', units.fmt(Math.abs(b.y - a.y)));
      row('dZ', units.fmt(Math.abs(b.z - a.z)));
    }
    body.append(this.pmGroup('Results', m.points.length ? kv : h('div', { class: 'pm-info' }, 'No points picked yet.')));
    body.append(h('div', { style: { margin: '8px' } }, h('button', { class: 'pm-button', onclick: () => { m.points = []; m.last = null; m.desc = null; this.measureGroup.clear(); this.refreshHighlights(); this.renderPM(); } }, 'Clear')));
  }

  showMassProps() {
    const mp = this.isAsm ? this.assemblyMass() : this.partMass();
    if (!mp) { this.toast('There is no solid body yet', 'error'); return; }
    const c = mp.centroid;
    const rows = [
      ...(mp.material ? [['Material', mp.material], ['Density', `${mp.density} g/cm³`]] : [['Components', `${mp.count}`]]),
      ['Mass', units.fmtMass(mp.grams)],
      ['Volume', units.fmtVolume(mp.volume)],
      ['Surface area', units.fmtArea(mp.area)],
      ['Center of mass', `X ${units.fmt(c[0], false)}   Y ${units.fmt(c[1], false)}   Z ${units.fmt(c[2])}`],
      ['Bounding box', `${units.fmt(mp.size[0], false)} × ${units.fmt(mp.size[1], false)} × ${units.fmt(mp.size[2])}`],
    ];
    const table = h('table', { class: 'data-table' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))));
    this.modal({
      title: `Mass Properties of ${this.doc.name}`, icon: 'mass',
      body: h('div', {}, table, h('p', { class: 'pm-info', style: { marginBottom: 0 } }, 'Computed exactly from the B-rep solid by the OpenCascade kernel.')),
      buttons: [
        { label: 'Copy', onClick: () => { navigator.clipboard?.writeText(rows.map((r) => r.join('\t')).join('\n')); this.toast('Copied to clipboard'); return false; } },
        ...(this.isAsm ? [] : [{ label: 'Change Material...', onClick: () => { this.openTaskPane('material'); } }]),
        { label: 'Close', primary: true },
      ],
    });
  }

  partMass() {
    const d = this.build?.data;
    if (!d) return null;
    const mat = MATERIALS[this.doc.material] || MATERIALS['Plain Carbon Steel'];
    const { min, max } = d.bbox;
    return {
      material: this.doc.material, density: mat.density, grams: (d.mass.volume / 1000) * mat.density,
      volume: d.mass.volume, area: d.mass.area, centroid: d.mass.centroid, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    };
  }

  cmdSection() {
    if (this.section && !this.pm) {
      this.section = null;
      this.viewport.setSection(null);
      this.refreshChrome();
      return;
    }
    if (this.mode === 'sketch') this.exitSketch(true);
    if (this.mode === 'pickPlane') this.cancelPickPlane();
    if (this.pm) this.pmCancel();
    const prev = this.section;
    const mid = this.viewport.bodyBox()?.getCenter(new THREE.Vector3()).z ?? 0;
    const s = prev ? { ...prev } : { plane: 'Front', offset: Math.round(mid * 100) / 100, flip: false };
    this.selection = null;
    this.setStatus(null);
    const planes = this.isAsm ? {} : this.build.planes;
    const apply = () => {
      try {
        const base = resolvePlane(s.plane, null, planes);
        const n = new THREE.Vector3(...base.normal);
        const o = new THREE.Vector3(...base.origin).addScaledVector(n, s.offset);
        if (s.flip) n.negate();
        this.section = s;
        this.viewport.setSection({ origin: o.toArray(), normal: n.toArray() });
      } catch { /* plane missing */ }
      this.refreshChrome();
    };
    apply();
    const box = this.viewport.bodyBox();
    this.openPM({
      kind: 'section', title: 'Section View', icon: 'section',
      render: (body) => {
        const opts = this.isAsm ? ['Front', 'Top', 'Right'].map((n) => ({ value: n, label: `${n} Plane` })) : this.planeOptions(null);
        let slider;
        body.append(
          this.pmGroup('Section 1',
            this.fieldSelect('Section plane', opts, () => s.plane, (v) => { s.plane = v; apply(); }),
            this.fieldNumber('Offset', () => s.offset, (v) => { s.offset = v; apply(); if (slider) slider.value = v; }),
            this.fieldCheck('Flip side to view', () => s.flip, (v) => { s.flip = v; apply(); })),
        );
        const r = box ? box.getSize(new THREE.Vector3()).length() / 2 + 5 : 100;
        slider = h('input', { type: 'range', min: -r, max: r, step: 0.1, value: s.offset, style: { width: '100%' } });
        slider.addEventListener('input', () => {
          s.offset = Number(slider.value);
          apply();
          const inp = body.querySelectorAll('.pm-row input')[0];
          if (inp) inp.value = units.toDisplay(s.offset);
        });
        body.querySelector('.pm-group-body').append(slider);
        body.append(h('div', { class: 'pm-info', style: { margin: '0 10px' } }, 'OK keeps the section active. Click the Section View button again to turn it off.'));
      },
      onCancel: () => {
        this.section = prev;
        if (!prev) this.viewport.setSection(null);
      },
    });
  }

  showStats() {
    const times = this.build?.times || {};
    const rows = this.doc.features.map((f) => h('tr', {},
      h('td', {}, ico(featIcon(f)), ''), h('td', {}, f.name), h('td', {}, FEATURE_META[f.type] ? val(FEATURE_META[f.type].label, f) : f.type),
      h('td', { class: 'num' }, f.suppressed ? 'suppressed' : times[f.id] != null ? `${times[f.id].toFixed(1)} ms` : '—'),
      h('td', { style: { color: 'var(--danger)' } }, this.build.errors[f.id] || '')));
    rows.forEach((r) => { const i = r.querySelector('.ti'); if (i) i.style.cssText = 'width:16px;height:16px;display:inline-block'; });
    const total = Object.values(times).reduce((a, b) => a + b, 0);
    const body = h('div', {},
      h('p', { style: { margin: '0 0 10px' } }, `Last rebuild: ${total.toFixed(1)} ms • ${this.doc.features.length} features (0 ms = reused from cache)`),
      h('table', { class: 'data-table' }, h('tr', {}, h('th', {}, ''), h('th', {}, 'Feature'), h('th', {}, 'Type'), h('th', {}, 'Time'), h('th', {}, 'Status')), ...rows));
    this.modal({ title: 'Feature Statistics', icon: 'stats', body, buttons: [{ label: 'Close', primary: true }], width: 620 });
  }

  // ================================================================ dialogs

  modal({ title, icon: ic, body, buttons = [{ label: 'OK', primary: true }], cls = '', width = null, onClose = null }) {
    const back = h('div', { class: 'modal-backdrop' });
    const box = h('div', { class: `modal ${cls}` });
    if (width) box.style.width = `min(${width}px, calc(100vw - 32px))`;
    const close = () => { back.remove(); onClose?.(); };
    box.append(h('div', { class: 'modal-head' }, ic ? h('span', { class: 'mh-icon', html: icon(ic) }) : null, title, h('span', { class: 'sp' }), h('button', { class: 'x', onclick: close }, '×')));
    box.append(h('div', { class: 'modal-body' }, body));
    if (buttons.length) {
      box.append(h('div', { class: 'modal-foot' }, ...buttons.map((b) => h('button', {
        class: `btn${b.primary ? ' primary' : ''}`,
        onclick: () => { if (b.onClick && b.onClick() === false) return; close(); },
      }, b.label))));
    }
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    back.close = close;
    $('#modal-layer').append(back);
    box.querySelector('input, select, .btn.primary')?.focus();
    return { el: box, close };
  }

  closeModals() { [...$('#modal-layer').children].forEach((m) => m.close?.()); }

  confirmBox(message, { okLabel = 'OK' } = {}) {
    return new Promise((resolve) => {
      let result = false;
      this.modal({
        title: 'GuyCAD', icon: 'warn', body: h('div', { style: { whiteSpace: 'pre-wrap' } }, message),
        buttons: [{ label: 'Cancel' }, { label: okLabel, primary: true, onClick: () => { result = true; } }],
        onClose: () => resolve(result),
      });
    });
  }

  promptBox(title, label, value) {
    return new Promise((resolve) => {
      let result = null;
      const input = h('input', { type: 'text', value, style: { width: '100%', padding: '5px 8px' } });
      const m = this.modal({
        title, body: h('div', {}, h('div', { style: { marginBottom: '6px', color: 'var(--text-dim)' } }, label), input),
        buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { result = input.value.trim(); } }],
        onClose: () => resolve(result),
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = input.value.trim(); m.close(); } });
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  toast(msg, kind = '') {
    const t = h('div', { class: `toast ${kind}` }, msg);
    $('#toast-layer').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 4200 : 2600);
  }

  showWelcome() {
    const auto = storage.get(AUTOSAVE_KEY);
    const canResume = auto?.doc && ((auto.doc.features?.length || 0) > 0 || (auto.doc.components?.length || 0) > 0);
    const showCb = h('input', { type: 'checkbox', checked: this.settings.showWelcome });
    showCb.addEventListener('change', () => { this.settings.showWelcome = showCb.checked; this.saveSettings(); });
    const samples = h('div', { class: 'welcome-samples' });
    for (const [id, s] of Object.entries(SAMPLES)) {
      samples.append(h('div', { class: 'sample-card', onclick: () => this.loadSample(id) },
        ico(s.icon || 'extrude'), h('div', {}, h('b', {}, s.title), h('span', {}, s.description))));
    }
    const action = (ic, label, fn, disabled = false) => h('button', { onclick: fn, disabled }, ico(ic), label);
    const name = this.settings.userName ? `, ${this.settings.userName}` : '';
    const body = h('div', { style: { display: 'contents' } },
      h('div', { class: 'welcome-side' },
        h('span', { class: 'wl-logo', html: icon('logo') }),
        h('h2', { html: 'Guy<b>CAD</b>' }),
        h('p', {}, `Welcome back${name}.`),
        h('p', {}, 'Sketch with dimensions and relations, build exact solids with extrudes, revolves, fillets, chamfers and shells, then mate parts together in assemblies.'),
        h('p', { style: { marginTop: 'auto', fontSize: '11px', opacity: '.75' } }, 'Powered by the OpenCascade geometry kernel. Your work is auto-saved on this computer.')),
      h('div', { class: 'welcome-main' },
        h('h4', {}, 'Start'),
        h('div', { class: 'welcome-actions' },
          action('new', 'New Part', () => { this.closeModals(); this.cmdNew('part'); }),
          action('assembly', 'New Assembly', () => { this.closeModals(); this.cmdNew('assembly'); }),
          action('open', 'Open...', () => { this.closeModals(); this.cmdOpen(); }),
          action('undo', canResume ? `Resume “${auto.doc.name}”` : 'Nothing to resume', () => { this.closeModals(); this.loadDoc(auto.doc, { dirty: true }); }, !canResume)),
        h('h4', {}, 'Samples'),
        samples,
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', color: 'var(--text-dim)' } }, showCb, 'Show this screen at startup')),
    );
    this.modal({ title: 'Welcome to GuyCAD', icon: 'logo', body, buttons: [], cls: 'welcome' });
  }

  showOptions() {
    const s = { ...this.settings };
    const inp = (key, type = 'text', extra = {}) => {
      const el = h('input', { type, value: s[key], ...extra });
      el.addEventListener('input', () => { s[key] = type === 'number' ? Number(el.value) : el.value; });
      return el;
    };
    const sel = (key, opts) => {
      const el = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)));
      el.addEventListener('change', () => { s[key] = el.value; });
      return el;
    };
    const chk = (key) => {
      const el = h('input', { type: 'checkbox', checked: s[key] });
      el.addEventListener('change', () => { s[key] = el.checked; });
      return el;
    };
    const gridInput = h('input', { type: 'number', step: 'any', min: '0.001', value: units.toDisplay(s.gridStep) });
    const form = h('div', { class: 'form-grid' },
      h('div', { class: 'form-section' }, 'Personal'),
      h('label', {}, 'Your name'), inp('userName'),
      h('div', { class: 'form-section' }, 'Look & feel'),
      h('label', {}, 'Theme'), sel('theme', [['light', 'Light'], ['dark', 'Dark']]),
      h('label', {}, 'Accent color'), inp('accent', 'color'),
      h('label', {}, 'Viewport background'), sel('background', [['gradient', 'Gradient (default)'], ['white', 'Plain white'], ['studio', 'Dark studio'], ['blueprint', 'Blueprint']]),
      h('label', {}, 'Default display style'), sel('displayStyle', Object.entries(DISPLAY_STYLES)),
      h('div', { class: 'form-section' }, 'Document'),
      h('label', {}, 'Units'), sel('units', Object.entries(UNIT_DEFS).map(([id, d]) => [id, `${d.system} (${d.label})`])),
      h('label', {}, `Sketch grid spacing (${units.def.label})`), gridInput,
      h('label', {}, 'Snap to grid'), chk('snapGrid'),
      h('label', {}, 'Default polygon sides'), inp('polygonSides', 'number', { min: 3, max: 64 }),
      h('label', {}, 'Show welcome screen'), chk('showWelcome'),
    );
    this.modal({
      title: 'System Options', icon: 'options', body: form, width: 560,
      buttons: [
        { label: 'Reset to defaults', onClick: () => { this.settings = { ...DEFAULT_SETTINGS }; this.afterSettings(); } },
        { label: 'Cancel' },
        {
          label: 'OK', primary: true, onClick: () => {
            const g = Number(gridInput.value);
            if (g > 0) s.gridStep = units.fromDisplay(g);
            s.polygonSides = Math.max(3, Math.min(64, Math.round(s.polygonSides) || 6));
            this.settings = s;
            this.afterSettings();
          },
        },
      ],
    });
  }

  afterSettings() {
    this.saveSettings();
    units.set(this.settings.units);
    this.applyTheme();
    this.viewport.setDisplayStyle(this.settings.displayStyle);
    this.sketcher.gridSig = '';
    this.renderUserBadge();
    this.refreshAll();
  }

  applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = this.settings.theme;
    if (this.settings.background === 'gradient') delete root.dataset.bg; else root.dataset.bg = this.settings.background;
    root.style.setProperty('--accent', this.settings.accent);
  }

  showShortcuts() {
    const rows = [
      ['Mouse', 'Left-drag: rotate • Right-drag: pan • Wheel: zoom at cursor • Click: select face/edge'],
      ['Sketch mouse', 'Left-click: draw • Middle-drag: rotate • Right-drag: pan • Right-click: end chain'],
      ['Ctrl+S / Ctrl+Shift+S', 'Save / Save As'], ['Ctrl+O', 'Open'], ['Ctrl+W', 'Close document'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+B', 'Rebuild'],
      ['1 – 7', 'Front, Back, Left, Right, Top, Bottom, Isometric'], ['8', 'Normal To'], ['F', 'Zoom to Fit'], ['Space', 'View orientation'],
      ['D', 'Smart Dimension (in a sketch)'],
      ['L / R / C / A / P', 'Line, Rectangle, Circle, Arc, Polygon (in a sketch)'],
      ['Shift+click', 'Add to selection (entities, points, edges)'],
      ['Enter', 'OK / Exit sketch'], ['Esc', 'Cancel / end chain / deselect'], ['Delete', 'Delete selection'],
      ['Number fields', 'Accept math like 25.4*2 or 100/3. Arrow keys step, Shift for ×10.'],
    ];
    const body = h('table', { class: 'data-table' }, ...rows.map(([k, v]) => h('tr', {}, h('th', { style: { whiteSpace: 'nowrap' } }, ...k.split(' / ').flatMap((x, i) => (i ? [' / ', h('kbd', {}, x)] : [h('kbd', {}, x)]))), h('td', {}, v))));
    this.modal({ title: 'Keyboard & Mouse', icon: 'help', body, buttons: [{ label: 'Close', primary: true }], width: 640 });
  }

  showAbout() {
    this.modal({
      title: 'About GuyCAD', icon: 'logo',
      body: h('div', {},
        h('p', { style: { marginTop: 0 }, html: '<b>GuyCAD 2.0</b> — a parametric, feature-based 3D CAD modeler for the desktop.' }),
        h('p', {}, `Customized for ${this.settings.userName || 'you'}. Geometry by OpenCascade (via replicad), graphics by three.js.`),
        h('p', { style: { color: 'var(--text-dim)' } }, 'Parts: constrained sketches with smart dimensions and relations; extrude/revolve bosses and cuts; fillets, chamfers, shells; patterns and mirror; reference planes; rollback and suppress. Assemblies: components with coincident, parallel, perpendicular, distance and concentric mates; interference detection. Exports: STEP, STL, OBJ, GLB.')),
      buttons: [{ label: 'Close', primary: true }],
    });
  }

  // ================================================================ keyboard

  bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if ($('#modal-layer').children.length) {
        if (ev.key === 'Escape') $('#modal-layer').lastElementChild?.close?.();
        return;
      }
      const inField = ev.target.closest?.('input, select, textarea');
      if (ev.key === 'Escape' && this.closeMenus()) return;
      if (inField) {
        if (ev.key === 'Escape') ev.target.blur();
        return;
      }
      const k = ev.key.toLowerCase();
      if (this.mode === 'sketch' && this.sketcher.keyDown(ev)) { ev.preventDefault(); this.refreshChrome(); return; }
      if (ev.ctrlKey || ev.metaKey) {
        const map = { s: () => this.cmdSave(ev.shiftKey), o: () => this.cmdOpen(), z: () => this.run('undo'), y: () => this.run('redo'), b: () => this.run('rebuild'), w: () => this.closeTab(this.tabIndex) };
        if (map[k]) { ev.preventDefault(); map[k](); }
        return;
      }
      if (ev.altKey) return;
      if (ev.key === 'Escape') {
        if (this.isDrawing && (this.dtool || this.dsel)) { this.dimPreview = null; this.dsel = null; this.setDrawingTool(null); }
        else if (this.gizmo?.object) this.stopMoveComponent();
        else if (this.mode === 'pickPlane') this.cancelPickPlane();
        else if (this.pm && this.mode !== 'sketch') this.pmCancel();
        else if (this.selection) { this.selection = null; this.afterSelect(); }
        return;
      }
      if (ev.key === 'Enter') { if (this.pm) { ev.preventDefault(); this.pmOK(); } return; }
      if (ev.key === 'Delete') { if (this.mode === 'model') this.deleteSelection(); return; }
      if (k === 'f') { this.run('zoomFit'); return; }
      if (this.isDrawing) return;
      if (k === ' ') { ev.preventDefault(); this.showViewFlyout(null); return; }
      if (k === '8') { this.normalTo(); return; }
      for (const [id, v] of Object.entries(VIEWS)) if (v.key === k) { this.setView(id); return; }
    });
  }

  // ================================================================ refresh

  refreshAll() {
    this.refreshTree();
    this.refreshScene();
    this.renderPM();
    this.renderTaskPane();
    this.refreshChrome();
  }
}

Object.assign(App.prototype, AssemblyMixin, DrawingMixin);
