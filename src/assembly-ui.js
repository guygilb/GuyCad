// Assembly mode for App: components, mates, move/rotate, interference. Mixed into App.prototype.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { MATE_TYPES, componentMatrix, refFromPick, mateTypesFor, solveMates, poseOf } from './assembly.js';
import { STD_PLANES } from './geometry.js';
import { MATERIALS, SAMPLES, appearanceOf } from './library.js';
import { units } from './units.js';
import { $, h, ico, clone, uid, native, FILE_FILTERS } from './ui.js';

export const AssemblyMixin = {
  initAssembly() {
    const vp = this.viewport;
    this.gizmo = new TransformControls(vp.camera, vp.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmoProxy = new THREE.Object3D();
    vp.scene.add(this.gizmoProxy);
    vp.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      vp.controls.enabled = !e.value;
      this.gizmoDragging = e.value;
      if (e.value) this.gizmoSnap = JSON.stringify(this.doc);
      else this.finishGizmoDrag();
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.asmData = new Map();
  },

  addAssemblyCommands(add) {
    const asm = () => this.isAsm;
    add('insertComponent', 'Insert Components', 'insertComponent', () => this.cmdInsertComponent(), { big: true, enabled: asm });
    add('mate', 'Mate', 'mate', () => this.cmdMate(), { big: true, enabled: () => asm() && this.doc.components.length > 1 });
    add('moveComponent', 'Move Component', 'moveComponent', () => this.toggleMove('translate'), { enabled: asm, active: () => !!this.gizmo?.object && this.gizmo.mode === 'translate' });
    add('rotateComponent', 'Rotate Component', 'rotateComponent', () => this.toggleMove('rotate'), { enabled: asm, active: () => !!this.gizmo?.object && this.gizmo.mode === 'rotate' });
    add('editPart', 'Edit Part', 'editPart', () => { const c = this.selectedComponent(); if (c) this.editComponentPart(c.id); else this.toast('Select a component first'); }, { enabled: asm });
    add('fixComponent', () => (this.selectedComponent()?.fixed ? 'Float' : 'Fix'), 'fix', () => this.toggleFixed(), { enabled: () => asm() && !!this.selectedComponent() });
    add('interference', 'Interference Detection', 'interference', () => this.cmdInterference(), { enabled: () => asm() && this.doc.components.length > 1 });
  },

  selectedComponent() {
    if (!this.isAsm || this.selection?.kind !== 'component') return null;
    return this.doc.components.find((c) => c.id === this.selection.id) || null;
  },

  poseOf(c) { return poseOf(c); },

  // ------------------------------------------------------------ build & display

  async partData(part) {
    const key = JSON.stringify(part.features);
    if (this.partCache.has(key)) return this.partCache.get(key);
    const res = await this.kernel.partMesh(part);
    const entry = { data: res.data, errors: res.errors || {} };
    this.partCache.set(key, entry);
    if (this.partCache.size > 60) this.partCache.delete(this.partCache.keys().next().value);
    return entry;
  },

  async rebuildAssembly() {
    const seq = ++this.buildSeq;
    this.setBusy(true, 'Loading components…');
    const comps = this.doc.components.filter((c) => !c.suppressed);
    const results = await Promise.all(comps.map((c) => this.partData(c.part).catch((e) => ({ data: null, errors: { kernel: e.message } }))));
    if (seq !== this.buildSeq || !this.isAsm) return;
    this.setBusy(false);
    this.tab.stale = false;
    this.asmData = new Map(comps.map((c, i) => [c.id, results[i]]));
    this.build = { data: null, planes: {}, frames: {}, errors: {}, times: {} };
    this.updateAssemblyBodies();
    this.refreshAssemblyScene();
    this.refreshTree();
    this.refreshHighlights();
    this.refreshChrome();
  },

  updateAssemblyBodies() {
    const bodies = [];
    // exploded view: offsets from the center of all components (display only)
    let center = null;
    if (this.explodeFactor) {
      const pts = this.doc.components.filter((c) => !c.suppressed && this.asmData.get(c.id)?.data).map((c) => {
        const b = this.asmData.get(c.id).data.bbox;
        return [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2 + c.position[k]);
      });
      center = pts.length ? [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length) : [0, 0, 0];
    }
    for (const c of this.doc.components) {
      if (c.suppressed) continue;
      const d = this.asmData.get(c.id)?.data;
      if (!d) continue;
      const matrix = componentMatrix(c);
      const off = center ? this.explodeOffset(c, center) : null;
      if (off) matrix.premultiply(new THREE.Matrix4().makeTranslation(...off));
      bodies.push({ id: c.id, data: d, matrix, appearance: appearanceOf(c.part), hidden: c.hidden });
    }
    this.viewport.setBodies(bodies);
    this.refreshAssemblyHighlights();
    if (this.gizmo?.object && this.gizmoComp) {
      const c = this.doc.components.find((x) => x.id === this.gizmoComp);
      if (c && !this.gizmoDragging) { this.gizmoProxy.position.fromArray(c.position); this.gizmoProxy.quaternion.fromArray(c.quaternion); }
    }
  },

  refreshAssemblyScene() {
    const box = this.viewport.bodyBox();
    let size = 100;
    if (box) { const s = box.getSize(new THREE.Vector3()); size = Math.max(60, Math.max(s.x, s.y, s.z) * 1.2); }
    const sel = this.selection;
    const list = ['Front', 'Top', 'Right'].map((n) => {
      const selected = sel?.kind === 'plane' && sel.key === n;
      const hover = (this.hover?.kind === 'plane' && this.hover.key === n) || this.treeHover === n;
      return { key: n, name: `${n} Plane`, frame: STD_PLANES[n], state: selected ? 'selected' : hover ? 'hover' : 'normal', visible: this.settings.showPlanes || selected || hover };
    });
    this.viewport.setPlanes(list, size);
    this.viewport.origin.visible = this.settings.showOrigin;
    this.sketchObjects.clear();
  },

  // Selected / hovered components are tinted instead of face-highlighted.
  refreshAssemblyHighlights() {
    const selId = this.selection?.kind === 'component' ? this.selection.id : null;
    const hoverId = this.treeHover && this.doc.components?.some((c) => c.id === this.treeHover) ? this.treeHover : null;
    for (const b of this.viewport.bodies.values()) {
      if (!b.material) continue;
      const on = b.id === selId ? [0x1d4ed8, 0.35] : b.id === hoverId ? [0xff8c1a, 0.25] : [0x000000, 0];
      b.material.emissive.setHex(on[0]);
      b.material.emissiveIntensity = on[1];
    }
  },

  // ------------------------------------------------------------ selection & menus

  assemblyClick(hit) {
    if (hit?.bodyId) {
      if (this.gizmo.object && this.gizmoComp !== hit.bodyId) {
        const c = this.doc.components.find((x) => x.id === hit.bodyId);
        this.selection = { kind: 'component', id: hit.bodyId };
        if (c && !c.fixed) this.attachGizmo(c, this.gizmo.mode);
        this.afterSelect();
        return;
      }
      this.selection = { kind: 'component', id: hit.bodyId };
      this.afterSelect();
      const c = this.doc.components.find((x) => x.id === hit.bodyId);
      this.setStatus(`${c?.name}${c?.fixed ? ' (fixed)' : ''} — ${this.describePick(hit)}`);
      return;
    }
    if (hit?.kind === 'plane') this.selection = { kind: 'plane', key: hit.key };
    else this.selection = null;
    this.afterSelect();
  },

  componentMenuItems(c) {
    return [
      { label: 'Edit Part', icon: 'editPart', run: () => this.editComponentPart(c.id) },
      { label: 'Move', icon: 'moveComponent', run: () => { this.selection = { kind: 'component', id: c.id }; this.toggleMove('translate'); } },
      { label: 'Rotate', icon: 'rotateComponent', run: () => { this.selection = { kind: 'component', id: c.id }; this.toggleMove('rotate'); } },
      { label: c.fixed ? 'Float' : 'Fix', icon: 'fix', run: () => { this.selection = { kind: 'component', id: c.id }; this.toggleFixed(); } },
      '|',
      { label: c.hidden ? 'Show' : 'Hide', icon: 'hideShow', run: () => this.setComponentFlag(c.id, 'hidden', !c.hidden) },
      { label: c.suppressed ? 'Unsuppress' : 'Suppress', run: () => this.setComponentFlag(c.id, 'suppressed', !c.suppressed) },
      { label: 'Appearance...', icon: 'appearance', run: () => { this.selection = { kind: 'component', id: c.id }; this.openTaskPane('appearance'); } },
      { label: 'Material...', icon: 'material', run: () => { this.selection = { kind: 'component', id: c.id }; this.openTaskPane('material'); } },
      '|',
      { label: 'Rename...', run: () => this.renameAsmItem({ kind: 'component', id: c.id }) },
      { label: 'Delete...', icon: 'trash', run: () => { this.selection = { kind: 'component', id: c.id }; this.deleteAsmSelection(); } },
    ];
  },

  assemblyContextMenu(hit, ev) {
    if (hit?.bodyId) { this.selection = { kind: 'component', id: hit.bodyId }; this.afterSelect(); }
    const c = this.selectedComponent();
    const items = [];
    if (c) items.push(...this.componentMenuItems(c), '|');
    items.push({ label: 'Insert Components...', icon: 'insertComponent', run: () => this.cmdInsertComponent() });
    items.push({ label: 'Mate...', icon: 'mate', run: () => this.cmdMate() });
    items.push('|', { label: 'Zoom to Fit', icon: 'zoomFit', short: 'F', run: () => this.viewport.zoomToFit() });
    this.openMenu(items, ev.clientX, ev.clientY);
  },

  instanceLabel(c) {
    const same = this.doc.components.filter((x) => x.name === c.name);
    return `${c.fixed ? '(f) ' : '(-) '}${c.name}<${same.indexOf(c) + 1}>`;
  },

  compName(id) {
    const c = this.doc.components.find((x) => x.id === id);
    return c ? `${c.name}<${this.doc.components.filter((x) => x.name === c.name).indexOf(c) + 1}>` : '?';
  },

  refreshAssemblyTree() {
    const tree = $('#tree');
    tree.replaceChildren();
    const sel = this.selection;
    const node = (o) => this.treeNode(o);
    tree.append(node({
      cls: 'root', icon: 'assembly', label: `${this.doc.name}  (Default)`, onDbl: () => this.renameDoc(),
      menu: () => [{ label: 'Rename Assembly...', run: () => this.renameDoc() }, { label: 'Insert Components...', icon: 'insertComponent', run: () => this.cmdInsertComponent() }, { label: 'Mass Properties', icon: 'mass', run: () => this.showMassProps() }],
    }));
    for (const n of ['Front', 'Top', 'Right']) {
      tree.append(node({
        depth: 1, icon: 'plane', label: `${n} Plane`, selected: sel?.kind === 'plane' && sel.key === n, hoverKey: n,
        onClick: () => { this.selection = { kind: 'plane', key: n }; this.afterSelect(); },
      }));
    }
    tree.append(node({ depth: 1, icon: 'origin', label: 'Origin', onClick: () => this.toggleSetting('showOrigin') }));
    for (const c of this.doc.components) {
      const errs = this.asmData.get(c.id)?.errors || {};
      const err = Object.values(errs)[0];
      tree.append(node({
        depth: 1, icon: 'part', label: this.instanceLabel(c), selected: sel?.kind === 'component' && sel.id === c.id,
        suppressed: c.suppressed, rolled: c.hidden, error: err ? `Part has errors: ${err}` : null, hoverKey: c.id,
        title: c.fixed ? 'Fixed in place' : 'Floating — positioned by mates or by moving it',
        onClick: () => { this.selection = { kind: 'component', id: c.id }; this.afterSelect(); },
        onDbl: () => this.editComponentPart(c.id),
        menu: () => this.componentMenuItems(c),
      }));
    }
    tree.append(node({ depth: 1, icon: 'mate', label: `Mates (${this.doc.mates.length})`, twisty: this.doc.mates.length ? '▾' : '' }));
    for (const m of this.doc.mates) {
      tree.append(node({
        depth: 2, icon: MATE_TYPES[m.type]?.icon || 'mate', label: `${m.name} (${this.compName(m.a.comp)}, ${this.compName(m.b.comp)})`,
        selected: sel?.kind === 'mate' && sel.id === m.id, suppressed: m.suppressed, error: this.mateFailures?.has(m.id) ? 'This mate cannot be satisfied with the others' : null,
        onClick: () => { this.selection = { kind: 'mate', id: m.id }; this.afterSelect(); },
        onDbl: () => this.editMate(m.id),
        menu: () => [
          { label: 'Edit Mate', icon: 'mate', run: () => this.editMate(m.id) },
          { label: m.suppressed ? 'Unsuppress' : 'Suppress', run: () => { this.selection = { kind: 'mate', id: m.id }; this.suppressAsmItem(!m.suppressed); } },
          { label: 'Rename...', run: () => this.renameAsmItem({ kind: 'mate', id: m.id }) },
          { label: 'Delete', icon: 'trash', run: () => { this.selection = { kind: 'mate', id: m.id }; this.deleteAsmSelection(); } },
        ],
      }));
    }
    if (!this.doc.components.length) {
      tree.append(h('div', { class: 'tree-empty-hint', html: 'This assembly is empty.<br>Click <b>Insert Components</b> to add parts. The first part is fixed at the origin; position the others with <b>Mate</b> or <b>Move Component</b>.' }));
    }
  },

  // ------------------------------------------------------------ editing components & mates

  setComponentFlag(id, key, value) {
    const c = this.doc.components.find((x) => x.id === id);
    if (!c) return;
    const snap = JSON.stringify(this.doc);
    c[key] = value;
    this.commit(snap);
    if (key === 'suppressed') this.rebuildModel(); else this.updateAssemblyBodies();
    this.refreshTree();
  },

  toggleFixed() {
    const c = this.selectedComponent();
    if (!c) return;
    const snap = JSON.stringify(this.doc);
    c.fixed = !c.fixed;
    if (c.fixed && this.gizmoComp === c.id) this.stopMoveComponent();
    this.commit(snap);
    this.refreshTree();
    this.refreshChrome();
  },

  async renameAsmItem(s) {
    const item = s.kind === 'component' ? this.doc.components.find((c) => c.id === s.id) : this.doc.mates.find((m) => m.id === s.id);
    if (!item) return;
    const name = await this.promptBox('Rename', 'Name', item.name);
    if (!name) return;
    const snap = JSON.stringify(this.doc);
    item.name = name;
    if (s.kind === 'component') item.part.name = name;
    this.commit(snap);
    this.refreshTree();
  },

  suppressAsmItem(on) {
    const s = this.selection;
    if (s?.kind === 'mate') {
      const m = this.doc.mates.find((x) => x.id === s.id);
      if (!m) return;
      const snap = JSON.stringify(this.doc);
      m.suppressed = on;
      this.solveAssembly();
      this.commit(snap);
      this.updateAssemblyBodies();
      this.refreshTree();
    } else if (s?.kind === 'component') this.setComponentFlag(s.id, 'suppressed', on);
  },

  async deleteAsmSelection() {
    const s = this.selection;
    if (s?.kind === 'mate') {
      const snap = JSON.stringify(this.doc);
      this.doc.mates = this.doc.mates.filter((m) => m.id !== s.id);
      this.selection = null;
      this.commit(snap);
      this.refreshTree();
      return;
    }
    const c = this.selectedComponent();
    if (!c) return;
    const mates = this.doc.mates.filter((m) => m.a.comp === c.id || m.b.comp === c.id);
    if (!(await this.confirmBox(`Delete ${this.compName(c.id)}${mates.length ? ` and its ${mates.length} mate${mates.length === 1 ? '' : 's'}` : ''}?`, { okLabel: 'Delete' }))) return;
    const snap = JSON.stringify(this.doc);
    this.doc.components = this.doc.components.filter((x) => x.id !== c.id);
    this.doc.mates = this.doc.mates.filter((m) => !mates.includes(m));
    if (this.gizmoComp === c.id) this.stopMoveComponent();
    for (const t of [...this.tabs]) if (t.link?.compId === c.id) t.link = null;
    this.selection = null;
    this.commit(snap);
    this.rebuildModel();
  },

  // Solves all mates; records failing mates for the tree.
  solveAssembly() {
    const res = solveMates(this.doc.components, this.doc.mates);
    this.mateFailures = new Set();
    if (!res.ok) {
      // find which mates are in conflict by removing them one at a time
      for (const m of this.doc.mates) {
        if (m.suppressed) continue;
        const trial = clone(this.doc.components);
        if (solveMates(trial, this.doc.mates.filter((x) => x !== m)).ok) this.mateFailures.add(m.id);
      }
    }
    return res;
  },

  // ------------------------------------------------------------ insert components

  cmdInsertComponent() {
    if (!this.isAsm) return;
    if (this.pm) this.pmCancel();
    this.openPM({
      kind: 'insert', title: 'Insert Component', icon: 'insertComponent',
      status: () => 'Choose a part to insert. Click OK when you are done.',
      render: (body) => {
        body.append(this.pmGroup('Part to Insert',
          h('button', { class: 'pm-button', onclick: () => this.browsePartFile() }, ico('open'), ' Browse for a part file (.gcad)...'),
          h('div', { class: 'pm-info' }, 'The first component is fixed at the origin. Later ones are placed beside the others — use Mate to position them.')));
        const open = this.tabs.filter((t) => t !== this.tab && t.doc.type === 'part' && t.doc.features.length);
        if (open.length) {
          body.append(this.pmGroup('Open Documents', ...open.map((t) => h('div', { class: 'sample-card', onclick: () => this.insertPart(t.doc) }, ico('part'), h('div', {}, h('b', {}, t.doc.name), h('span', {}, `${t.doc.features.length} features`))))));
        }
        const parts = Object.entries(SAMPLES).filter(([, s]) => s.doc.type !== 'assembly');
        body.append(this.pmGroup('Design Library', ...parts.map(([, s]) => h('div', { class: 'sample-card', onclick: () => this.insertPart(s.doc) }, ico(s.icon || 'extrude'), h('div', {}, h('b', {}, s.title), h('span', {}, s.description))))));
      },
    });
  },

  async browsePartFile() {
    const take = (text) => {
      try {
        const d = JSON.parse(text);
        if (d.type === 'assembly') { this.toast('Sub-assemblies are not supported yet — insert parts', 'error'); return; }
        if (!Array.isArray(d.features)) throw new Error('bad');
        this.insertPart(d);
      } catch { this.toast('That file is not a GuyCAD part', 'error'); }
    };
    if (native) {
      const res = await native.openFile({ filters: [...FILE_FILTERS.gcad, { name: 'All Files', extensions: ['*'] }] });
      if (res) take(res.text);
      return;
    }
    const input = h('input', { type: 'file', accept: '.gcad,.json' });
    input.addEventListener('change', async () => { const f = input.files[0]; if (f) take(await f.text()); });
    input.click();
  },

  async insertPart(partDoc) {
    const part = this.normalizeDoc(clone(partDoc));
    const entry = await this.partData(part);
    if (!entry.data) { this.toast(`${part.name} has no solid body`, 'error'); return; }
    const snap = JSON.stringify(this.doc);
    const first = this.doc.components.length === 0;
    let position = [0, 0, 0];
    if (!first) {
      const box = this.viewport.bodyBox();
      const { min } = entry.data.bbox;
      if (box) position = [box.max.x + 20 - min[0], 0, 0];
    }
    const c = { id: uid('c'), name: part.name, part, position, quaternion: [0, 0, 0, 1], fixed: first };
    this.doc.components.push(c);
    this.commit(snap);
    this.selection = { kind: 'component', id: c.id };
    await this.rebuildAssembly();
    this.viewport.zoomToFit();
    this.toast(`Inserted ${this.compName(c.id)}${first ? ' (fixed at origin)' : ''}`, 'ok');
  },

  makeAssemblyFromPart() {
    if (this.isAsm) return;
    if (!this.build?.data) { this.toast('The part has no solid body yet', 'error'); return; }
    const part = clone(this.doc);
    this.cmdNew('assembly').then(() => {
      if (this.pm) this.pmCancel();
      this.insertPart(part);
    });
  },

  editComponentPart(compId) {
    const c = this.doc.components.find((x) => x.id === compId);
    if (!c) return;
    const existing = this.tabs.findIndex((t) => t.link?.compId === compId && t.link.asmTabId === this.tab.id);
    if (existing >= 0) { this.switchTab(existing); return; }
    const asmTabId = this.tab.id;
    this.resetModes(true);
    this.saveView();
    this.openTab(c.part, { link: { asmTabId, compId } });
    this.selection = null;
    this.cmTab = 'Features';
    this.buildCommandManager();
    this.refreshAll();
    this.rebuildModel().then(() => this.viewport.setView([1, 0.75, 1.6], { fit: true, animate: false }));
    this.toast(`Editing ${c.name}. Changes update the assembly — switch back with the tab bar.`);
  },

  // ------------------------------------------------------------ move / rotate

  toggleMove(mode) {
    if (this.gizmo.object && this.gizmo.mode === mode) { this.stopMoveComponent(); return; }
    const c = this.selectedComponent();
    if (!c) { this.toast('Select a component to move'); return; }
    if (c.fixed) { this.toast(`${c.name} is fixed. Right-click it and choose Float to move it.`); return; }
    this.attachGizmo(c, mode);
  },

  attachGizmo(c, mode) {
    this.gizmoComp = c.id;
    this.gizmoProxy.position.fromArray(c.position);
    this.gizmoProxy.quaternion.fromArray(c.quaternion);
    this.gizmo.attach(this.gizmoProxy);
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(mode === 'rotate' ? 'local' : 'world');
    this.setStatus(`${mode === 'rotate' ? 'Rotate' : 'Move'} ${c.name}: drag the gizmo. Mates are re-solved when you release. Press Esc when done.`);
    this.refreshChrome();
  },

  stopMoveComponent() {
    this.gizmo.detach();
    this.gizmoComp = null;
    this.setStatus(null);
    this.refreshChrome();
  },

  onGizmoChange() {
    const c = this.doc.components.find((x) => x.id === this.gizmoComp);
    if (!c) return;
    c.position = this.gizmoProxy.position.toArray();
    c.quaternion = this.gizmoProxy.quaternion.toArray();
    this.updateAssemblyBodies();
  },

  finishGizmoDrag() {
    const res = this.solveAssembly();
    if (!res.ok && this.doc.mates.length) this.toast('Some mates could not be satisfied', 'error');
    this.commit(this.gizmoSnap);
    this.updateAssemblyBodies();
    this.refreshTree();
  },

  // ------------------------------------------------------------ mates

  pickToMateRef(hit) {
    const c = this.doc.components.find((x) => x.id === hit.bodyId);
    if (!c) return null;
    const inv = componentMatrix(c).invert();
    const localPoint = hit.point.clone().applyMatrix4(inv).toArray();
    return refFromPick({ ...hit, localPoint });
  },

  worldDir(compId, ref) {
    const c = this.doc.components.find((x) => x.id === compId);
    return new THREE.Vector3(...(ref.normal || ref.dir)).applyQuaternion(new THREE.Quaternion(...c.quaternion));
  },

  cmdMate() {
    if (!this.isAsm) return;
    if (this.pm) this.pmCancel();
    if (this.gizmo.object) this.stopMoveComponent();
    const st = { picks: [], type: null, flip: false, value: 10, error: null };
    this.openMatePM(st, null);
  },

  editMate(id) {
    const m = this.doc.mates.find((x) => x.id === id);
    if (!m) return;
    if (this.pm) this.pmCancel();
    const st = {
      picks: [{ comp: m.a.comp, ref: m.a.ref, desc: refDesc(m.a.ref) }, { comp: m.b.comp, ref: m.b.ref, desc: refDesc(m.b.ref) }],
      type: m.type, flip: !!m.flip, value: m.value ?? 10, error: null,
    };
    this.openMatePM(st, m);
  },

  openMatePM(st, existing) {
    const snapshot = JSON.stringify(this.doc);
    const preview = () => {
      const saved = JSON.parse(snapshot);
      // restore poses, then solve with the candidate mate
      for (const c of this.doc.components) {
        const s = saved.components.find((x) => x.id === c.id);
        if (s) { c.position = s.position; c.quaternion = s.quaternion; }
      }
      st.error = null;
      if (st.picks.length === 2 && st.type) {
        const others = this.doc.mates.filter((m) => m !== existing && (!existing || m.id !== existing.id));
        const res = solveMates(this.doc.components, [...others, this.mateFromState(st)]);
        if (!res.ok) st.error = 'This mate conflicts with existing mates or fixed components.';
      }
      this.updateAssemblyBodies();
      this.updatePMError();
    };
    const spec = {
      kind: 'mate', title: existing ? existing.name : 'Mate', icon: 'mate', wants: ['face', 'edge'],
      status: () => 'Select two faces on different components: planar faces, cylindrical faces or circular edges.',
      error: () => st.error,
      highlights: () => st.picks.filter((p) => p.face != null || p.edge != null).map((p) => (p.face != null ? { bodyId: p.comp, face: p.face } : { bodyId: p.comp, edge: p.edge })),
      render: (body) => this.renderMatePM(body, st, preview),
      onPick: (hit) => {
        if (hit.kind !== 'face' && hit.kind !== 'edge') return false;
        const ref = this.pickToMateRef(hit);
        if (!ref) { this.toast('Select a planar face, a cylindrical face or a circular edge'); return true; }
        if (st.picks.length >= 2) st.picks = [];
        if (st.picks.length === 1 && st.picks[0].comp === hit.bodyId) { this.toast('Select a face on a different component'); return true; }
        st.picks.push({ comp: hit.bodyId, ref, face: hit.kind === 'face' ? hit.face : null, edge: hit.kind === 'edge' ? hit.edge : null, desc: `${this.compName(hit.bodyId)} · ${refDesc(ref)}` });
        if (st.picks.length === 2) {
          const types = mateTypesFor(st.picks[0].ref, st.picks[1].ref);
          if (!types.includes(st.type)) st.type = types[0] || null;
          if (st.picks[0].ref.kind === 'plane' && st.picks[1].ref.kind === 'plane') {
            // keep the faces' current relationship: facing each other unless they already point the same way
            st.flip = this.worldDir(st.picks[0].comp, st.picks[0].ref).dot(this.worldDir(st.picks[1].comp, st.picks[1].ref)) > 0;
          }
        }
        preview();
        this.renderPM();
        return true;
      },
      onOK: () => {
        if (st.picks.length !== 2 || !st.type) { this.toast('Select two references and a mate type'); return false; }
        if (st.error) { this.toast(st.error, 'error'); return false; }
        const m = this.mateFromState(st);
        if (existing) {
          const i = this.doc.mates.findIndex((x) => x.id === existing.id);
          this.doc.mates[i] = { ...this.doc.mates[i], ...m, id: existing.id, name: existing.name };
        } else {
          m.id = uid('m');
          m.name = this.nextName(MATE_TYPES[m.type].label, this.doc.mates);
          this.doc.mates.push(m);
        }
        this.solveAssembly();
        this.commit(snapshot);
        this.updateAssemblyBodies();
        this.refreshTree();
        return undefined;
      },
      onCancel: () => { this.doc = JSON.parse(snapshot); this.updateAssemblyBodies(); },
    };
    this.openPM(spec);
    if (st.picks.length === 2) preview();
  },

  mateFromState(st) {
    const m = { type: st.type, a: { comp: st.picks[0].comp, ref: st.picks[0].ref }, b: { comp: st.picks[1].comp, ref: st.picks[1].ref }, flip: st.flip };
    if (MATE_TYPES[st.type]?.value) m.value = st.value;
    return m;
  },

  renderMatePM(body, st, preview) {
    const picks = h('div', { class: 'pm-list pick-list' });
    if (!st.picks.length) picks.append(h('div', { class: 'empty' }, 'Click two faces in the graphics area.'));
    st.picks.forEach((p, i) => picks.append(h('label', {}, h('span', { style: { flex: 1 } }, `${i + 1}. ${p.desc}`))));
    body.append(this.pmGroup('Mate Selections', picks,
      st.picks.length ? h('button', { class: 'pm-button', style: { marginTop: '6px' }, onclick: () => { st.picks = []; st.type = null; preview(); this.renderPM(); } }, 'Clear selections') : null));
    const types = st.picks.length === 2 ? mateTypesFor(st.picks[0].ref, st.picks[1].ref) : Object.keys(MATE_TYPES);
    const grid = h('div', { class: 'tool-grid' });
    for (const t of Object.keys(MATE_TYPES)) {
      const ok = types.includes(t) && st.picks.length === 2;
      grid.append(h('button', { class: st.type === t ? 'active' : '', disabled: !ok, title: MATE_TYPES[t].label, onclick: () => { st.type = t; preview(); this.renderPM(); } }, ico(MATE_TYPES[t].icon), MATE_TYPES[t].label));
    }
    body.append(this.pmGroup('Standard Mates', grid));
    if (st.type && st.type !== 'concentric' && st.type !== 'parallel' && st.type !== 'perpendicular') {
      body.append(this.pmGroup('Options',
        this.fieldCheck('Flip alignment (faces point the same way)', () => st.flip, (v) => { st.flip = v; preview(); }),
        MATE_TYPES[st.type].value ? this.fieldNumber(st.type === 'angle' ? 'Angle' : 'Distance', () => st.value, (v) => { st.value = v; preview(); }, { unit: MATE_TYPES[st.type].unit || 'len' }) : null));
    }
  },

  // ------------------------------------------------------------ evaluate

  assemblyMass() {
    let grams = 0, volume = 0, area = 0, count = 0;
    const com = new THREE.Vector3();
    for (const c of this.doc.components) {
      if (c.suppressed) continue;
      const d = this.asmData.get(c.id)?.data;
      if (!d) continue;
      const dens = (MATERIALS[c.part.material] || MATERIALS['Plain Carbon Steel']).density;
      const g = (d.mass.volume / 1000) * dens;
      grams += g; volume += d.mass.volume; area += d.mass.area; count++;
      com.addScaledVector(new THREE.Vector3(...d.mass.centroid).applyMatrix4(componentMatrix(c)), g);
    }
    if (!count) return null;
    com.divideScalar(grams || 1);
    const box = this.viewport.bodyBox();
    const size = box ? box.getSize(new THREE.Vector3()).toArray() : [0, 0, 0];
    return { count, grams, volume, area, centroid: com.toArray(), size };
  },

  async cmdInterference() {
    const comps = this.doc.components.filter((c) => !c.suppressed && !c.hidden);
    if (comps.length < 2) { this.toast('Add at least two components'); return; }
    this.setBusy(true, 'Checking interference…');
    let res;
    try {
      res = await this.kernel.call('interference', { docs: comps.map((c) => ({ doc: { features: c.part.features }, pose: poseOf(c) })) });
    } catch (e) {
      this.setBusy(false);
      this.toast(`Interference check failed: ${e.message}`, 'error');
      return;
    }
    this.setBusy(false);
    const rows = res.map((r) => h('tr', {}, h('td', {}, this.compName(comps[r.i].id)), h('td', {}, this.compName(comps[r.j].id)), h('td', { class: 'num' }, units.fmtVolume(r.volume))));
    this.modal({
      title: 'Interference Detection', icon: 'interference', width: 560,
      body: res.length
        ? h('div', {}, h('p', { style: { marginTop: 0 } }, `${res.length} interference${res.length === 1 ? '' : 's'} found:`),
          h('table', { class: 'data-table' }, h('tr', {}, h('th', {}, 'Component'), h('th', {}, 'Component'), h('th', {}, 'Overlap volume')), ...rows))
        : h('p', { style: { margin: 0 } }, `No interferences between the ${comps.length} components.`),
      buttons: [{ label: 'Close', primary: true }],
    });
  },
};

function refDesc(ref) {
  if (ref.kind === 'plane') return 'Planar face';
  return ref.radius ? `Axis (Ø${units.fmt(ref.radius * 2, false)})` : 'Axis';
}
