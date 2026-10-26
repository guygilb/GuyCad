// 3D viewport: camera, navigation, B-rep body display, reference geometry, triad, picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { frameMatrix, STD_PLANES } from './geometry.js';

const DIST = 4000;
const FRUSTUM = 120; // half-height in world units at zoom 1

export const VIEWS = {
  front: { label: 'Front', dir: [0, 0, 1], key: '1' },
  back: { label: 'Back', dir: [0, 0, -1], key: '2' },
  left: { label: 'Left', dir: [-1, 0, 0], key: '3' },
  right: { label: 'Right', dir: [1, 0, 0], key: '4' },
  top: { label: 'Top', dir: [0, 1, 0], key: '5' },
  bottom: { label: 'Bottom', dir: [0, -1, 0], key: '6' },
  iso: { label: 'Isometric', dir: [1, 1, 1], key: '7' },
  trimetric: { label: 'Trimetric', dir: [1, 0.75, 1.6] },
  dimetric: { label: 'Dimetric', dir: [1, 0.6, 1] },
};

export const DISPLAY_STYLES = {
  shadedEdges: 'Shaded With Edges',
  shaded: 'Shaded',
  hiddenRemoved: 'Hidden Lines Removed',
  hiddenVisible: 'Hidden Lines Visible',
  wireframe: 'Wireframe',
};

function textSprite(text, color = '#1f2937', size = 64) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${size}px Segoe UI, Arial`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w; c.height = size + 16;
  ctx.font = `600 ${size}px Segoe UI, Arial`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.userData.aspect = c.width / c.height;
  sp.renderOrder = 20;
  return sp;
}

export class Viewport {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, DIST * 4);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 0.9));
    const head = new THREE.DirectionalLight(0xffffff, 1.6);
    head.position.set(0.4, 0.6, 1);
    head.target.position.set(0, 0, -1);
    this.camera.add(head, head.target);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.minZoom = 0.002;
    this.controls.maxZoom = 400;
    this.controls.zoomSpeed = 1.4;
    this.controls.rotateSpeed = 0.9;
    this.setNavigation('model');

    this.lineMaterials = new Set();
    this.clipPlanes = [];

    this.bodyGroup = new THREE.Group();
    this.refGroup = new THREE.Group();
    this.sketchGroup = new THREE.Group();
    this.overlay = new THREE.Group();
    this.scene.add(this.bodyGroup, this.refGroup, this.sketchGroup, this.overlay);

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xb9c2cc, metalness: 0.5, roughness: 0.38, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, envMapIntensity: 0.9,
    });
    this.hlrMat = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x15181c });
    this.hiddenEdgeMat = new THREE.LineDashedMaterial({ color: 0x8a9099, dashSize: 2, gapSize: 1.5, depthFunc: THREE.GreaterDepth, transparent: true, opacity: 0.8 });
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x15181c, depthTest: false });
    this.faceHL = {
      hover: new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.42, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }),
      sel: new THREE.MeshBasicMaterial({ color: 0x2f7cf6, transparent: true, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }),
      alt: new THREE.MeshBasicMaterial({ color: 0xd946ef, transparent: true, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }),
    };
    this.edgeHL = {
      hover: this.makeLineMaterial({ color: 0xff8c1a, linewidth: 3.5, depthTest: true }),
      sel: this.makeLineMaterial({ color: 0x2f7cf6, linewidth: 3.5, depthTest: true }),
      alt: this.makeLineMaterial({ color: 0xd946ef, linewidth: 3.5, depthTest: true }),
    };
    this.displayStyle = 'shadedEdges';

    this.bodies = new Map(); // id -> { group, mesh, edges, hidden, data, triFace, segEdge, material }
    this.highlights = { hover: [], sel: [], alt: [] };
    this.planeVisuals = new Map();
    this.origin = this.makeOrigin();
    this.refGroup.add(this.origin);

    this.buildTriad();
    this.raycaster = new THREE.Raycaster();

    this.camera.position.set(1, 1, 1).normalize().multiplyScalar(DIST);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(el);
    this.onFrame = [];
    const loop = () => {
      requestAnimationFrame(loop);
      for (const fn of this.onFrame) fn();
      this.render();
    };
    loop();
  }

  // ------------------------------------------------------------ setup helpers

  setNavigation(mode) {
    const M = THREE.MOUSE;
    this.controls.mouseButtons = mode === 'sketch'
      ? { LEFT: null, MIDDLE: M.ROTATE, RIGHT: M.PAN }
      : { LEFT: M.ROTATE, MIDDLE: M.ROTATE, RIGHT: M.PAN };
  }

  registerLineMaterial(m) {
    this.lineMaterials.add(m);
    m.resolution.set(this.el.clientWidth, this.el.clientHeight);
    return m;
  }

  makeLineMaterial(opts) {
    return this.registerLineMaterial(new LineMaterial({ linewidth: 2, worldUnits: false, depthTest: false, transparent: true, ...opts }));
  }

  makeOrigin() {
    const g = new THREE.Group();
    const L = 12;
    const mk = (dir, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...dir).multiplyScalar(L)]);
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
      l.renderOrder = 6;
      return l;
    };
    g.add(mk([1, 0, 0], 0xd8392b), mk([0, 1, 0], 0x2e9e4f), mk([0, 0, 1], 0x2d6fd8));
    const dot = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0xd8392b, size: 7, sizeAttenuation: false, depthTest: false }));
    dot.renderOrder = 6;
    g.add(dot);
    g.userData.baseLen = L;
    return g;
  }

  buildTriad() {
    this.triadScene = new THREE.Scene();
    this.triadCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
    const add = (dir, color, label) => {
      const a = new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(), 1.05, color, 0.32, 0.18);
      this.triadScene.add(a);
      const s = textSprite(label, `#${new THREE.Color(color).getHexString()}`, 56);
      s.position.set(...dir).multiplyScalar(1.38);
      s.scale.set(0.42 * s.userData.aspect, 0.42, 1);
      this.triadScene.add(s);
    };
    add([1, 0, 0], 0xd8392b, 'X');
    add([0, 1, 0], 0x2e9e4f, 'Y');
    add([0, 0, 1], 0x2d6fd8, 'Z');
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const aspect = w / h;
    this.camera.left = -FRUSTUM * aspect; this.camera.right = FRUSTUM * aspect;
    this.camera.top = FRUSTUM; this.camera.bottom = -FRUSTUM;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }

  render() {
    const r = this.renderer;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const s = (this.worldPerPixel() * 40) / this.origin.userData.baseLen;
    this.origin.scale.setScalar(s);
    for (const pv of this.planeVisuals.values()) if (pv.label) {
      const ls = this.worldPerPixel() * 13;
      pv.label.scale.set(ls * pv.label.userData.aspect, ls, 1);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);
    const size = 110;
    r.clearDepth();
    r.setScissorTest(true);
    r.setScissor(4, 4, size, size);
    r.setViewport(4, 4, size, size);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.triadCam.position.copy(dir.multiplyScalar(8));
    this.triadCam.quaternion.copy(this.camera.quaternion);
    r.render(this.triadScene, this.triadCam);
    r.setScissorTest(false);
  }

  worldPerPixel() {
    return (this.camera.top - this.camera.bottom) / this.camera.zoom / (this.el.clientHeight || 1);
  }

  // ------------------------------------------------------------ bodies

  /**
   * bodies: [{ id, data (kernel serialization), matrix?: Matrix4, appearance?: {color, metalness, roughness}, hidden? }]
   */
  setBodies(list) {
    const keep = new Set(list.map((b) => b.id));
    for (const [id, b] of this.bodies) if (!keep.has(id)) this.disposeBody(id, b);
    for (const spec of list) {
      let b = this.bodies.get(spec.id);
      if (!b || b.data !== spec.data) {
        if (b) this.disposeBody(spec.id, b);
        b = spec.data ? this.makeBody(spec) : null;
        if (!b) continue;
        this.bodies.set(spec.id, b);
        this.bodyGroup.add(b.group);
      }
      b.group.matrix.copy(spec.matrix || new THREE.Matrix4());
      b.group.matrixWorldNeedsUpdate = true;
      b.hidden = !!spec.hidden;
      b.group.visible = !b.hidden;
      if (spec.appearance) {
        if (!b.material) b.material = this.bodyMat.clone();
        b.material.color.set(spec.appearance.color);
        b.material.metalness = spec.appearance.metalness;
        b.material.roughness = spec.appearance.roughness;
        b.material.transparent = !!spec.appearance.opacity && spec.appearance.opacity < 1;
        b.material.opacity = spec.appearance.opacity ?? 1;
        b.material.clippingPlanes = this.clipPlanes;
      }
    }
    this.applyDisplayStyle();
    this.refreshHighlights();
  }

  disposeBody(id, b) {
    this.bodyGroup.remove(b.group);
    b.mesh.geometry.dispose();
    b.edges.geometry.dispose();
    this.bodies.delete(id);
  }

  makeBody(spec) {
    const d = spec.data;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.vertices, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const triFace = new Int32Array(d.indices.length / 3).fill(-1);
    for (let f = 0; f < d.faceRanges.length / 2; f++) {
      const start = d.faceRanges[f * 2] / 3, count = d.faceRanges[f * 2 + 1] / 3;
      for (let t = 0; t < count; t++) triFace[start + t] = f;
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(d.edgeLines, 3));
    const segEdge = new Int32Array(d.edgeLines.length / 6).fill(-1);
    for (let e = 0; e < d.edgeRanges.length / 2; e++) {
      const start = d.edgeRanges[e * 2] / 2, count = d.edgeRanges[e * 2 + 1] / 2;
      for (let s = 0; s < count; s++) segEdge[start + s] = e;
    }
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    const mesh = new THREE.Mesh(geo, this.bodyMat);
    mesh.userData = { kind: 'body', bodyId: spec.id };
    const edges = new THREE.LineSegments(eg, this.edgeMat);
    edges.userData = { kind: 'edges', bodyId: spec.id };
    const hidden = new THREE.LineSegments(eg, this.hiddenEdgeMat);
    hidden.computeLineDistances();
    group.add(mesh, edges, hidden);
    return { id: spec.id, group, mesh, edges, hiddenEdges: hidden, data: d, triFace, segEdge, material: null };
  }

  body(id) { return this.bodies.get(id); }

  setMaterialAppearance({ color, metalness, roughness }) {
    this.bodyMat.color.set(color);
    this.bodyMat.metalness = metalness;
    this.bodyMat.roughness = roughness;
  }

  setDisplayStyle(style) {
    this.displayStyle = style;
    this.applyDisplayStyle();
  }

  applyDisplayStyle() {
    const s = this.displayStyle;
    for (const b of this.bodies.values()) {
      b.mesh.visible = s !== 'wireframe';
      b.mesh.material = s === 'hiddenRemoved' || s === 'hiddenVisible' ? this.hlrMat : b.material || this.bodyMat;
      b.edges.visible = s !== 'shaded';
      b.edges.material = s === 'wireframe' ? this.wireMat : this.edgeMat;
      b.hiddenEdges.visible = s === 'hiddenVisible';
    }
  }

  setSection(frame) {
    this.clipPlanes.length = 0;
    if (frame) {
      const n = new THREE.Vector3(...frame.normal);
      this.clipPlanes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(n.negate(), new THREE.Vector3(...frame.origin)));
    }
    const mats = [this.bodyMat, this.hlrMat, this.edgeMat, this.hiddenEdgeMat, this.wireMat, ...Object.values(this.faceHL), ...Object.values(this.edgeHL)];
    for (const b of this.bodies.values()) if (b.material) mats.push(b.material);
    for (const m of mats) { m.clippingPlanes = this.clipPlanes; m.needsUpdate = true; }
  }

  bodyBox() {
    const box = new THREE.Box3();
    for (const b of this.bodies.values()) {
      if (b.hidden) continue;
      b.group.updateMatrixWorld(true);
      box.union(b.mesh.geometry.boundingBox.clone().applyMatrix4(b.group.matrixWorld));
    }
    return box.isEmpty() ? null : box;
  }

  // ------------------------------------------------------------ highlights

  // items: [{ bodyId, face } | { bodyId, edge }]
  setHighlight(which, items) {
    this.highlights[which] = items || [];
    this.refreshHighlights();
  }

  refreshHighlights() {
    for (const b of this.bodies.values()) {
      for (const o of b.group.children.filter((c) => c.userData.highlight)) { b.group.remove(o); o.geometry.dispose(); }
    }
    for (const which of ['sel', 'alt', 'hover']) {
      for (const it of this.highlights[which]) {
        const b = this.bodies.get(it.bodyId);
        if (!b) continue;
        let obj = null;
        if (it.face != null && it.face < b.data.faceRanges.length / 2) {
          const start = b.data.faceRanges[it.face * 2], count = b.data.faceRanges[it.face * 2 + 1];
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', b.mesh.geometry.attributes.position);
          g.setIndex(new THREE.BufferAttribute(b.data.indices.slice(start, start + count), 1));
          obj = new THREE.Mesh(g, this.faceHL[which]);
          obj.renderOrder = 5;
        } else if (it.edge != null && it.edge < b.data.edgeRanges.length / 2) {
          const start = b.data.edgeRanges[it.edge * 2], count = b.data.edgeRanges[it.edge * 2 + 1];
          const g = new LineSegmentsGeometry();
          g.setPositions(Array.from(b.data.edgeLines.slice(start * 3, (start + count) * 3)));
          obj = new LineSegments2(g, this.edgeHL[which]);
          obj.renderOrder = 7;
        }
        if (obj) { obj.userData.highlight = true; b.group.add(obj); }
      }
    }
  }

  // ------------------------------------------------------------ reference planes

  setPlanes(list, sizeHint) {
    const keep = new Set(list.map((p) => p.key));
    for (const [k, pv] of this.planeVisuals) if (!keep.has(k)) { this.refGroup.remove(pv.group); this.planeVisuals.delete(k); }
    for (const p of list) {
      let pv = this.planeVisuals.get(p.key);
      const sig = JSON.stringify([p.frame, sizeHint, p.name]);
      if (!pv || pv.sig !== sig) {
        if (pv) this.refGroup.remove(pv.group);
        pv = this.makePlaneVisual(p, sizeHint);
        pv.sig = sig;
        this.planeVisuals.set(p.key, pv);
        this.refGroup.add(pv.group);
      }
      pv.group.visible = p.visible;
      const colors = { normal: [0x6c9bd8, 0.08, 0x3b6db3], hover: [0xff8c1a, 0.18, 0xe06d00], selected: [0x2f7cf6, 0.22, 0x1d5fd0] };
      const [fc, op, lc] = colors[p.state] || colors.normal;
      pv.mesh.material.color.setHex(fc); pv.mesh.material.opacity = op;
      pv.outline.material.color.setHex(lc);
    }
  }

  makePlaneVisual(p, size) {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.matrix.copy(frameMatrix(p.frame));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.userData = { kind: 'plane', key: p.key };
    mesh.renderOrder = 2;
    const h = size / 2;
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, -h, 0), new THREE.Vector3(h, h, 0), new THREE.Vector3(-h, h, 0),
    ]), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
    const label = textSprite(p.name, '#1f3f73', 48);
    label.center.set(0, 0);
    label.position.set(-h, h, 0);
    group.add(mesh, outline, label);
    group.updateMatrixWorld(true);
    return { group, mesh, outline, label };
  }

  // ------------------------------------------------------------ camera

  setView(dirArr, { fit = false, animate = true } = {}) {
    let to = new THREE.Vector3(...dirArr).normalize();
    if (Math.abs(to.y) > 0.9999) to = new THREE.Vector3(0, Math.sign(to.y), 1e-4).normalize();
    const target = this.controls.target.clone();
    let endTarget = target, endZoom = this.camera.zoom;
    if (fit) {
      const f = this.fitParams();
      endTarget = f.center; endZoom = f.zoom;
    }
    const from = this.camera.position.clone().sub(target).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    const startZoom = this.camera.zoom;
    const dur = animate ? 380 : 0;
    const t0 = performance.now();
    const step = () => {
      const t = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const qq = new THREE.Quaternion().slerp(q, e);
      const dir = from.clone().applyQuaternion(qq);
      const tg = target.clone().lerp(endTarget, e);
      this.controls.target.copy(tg);
      this.camera.position.copy(tg).addScaledVector(dir, DIST);
      this.camera.zoom = startZoom + (endZoom - startZoom) * e;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(tg);
      this.controls.update();
      if (t < 1) this.onFrame.push(stepOnce);
    };
    const stepOnce = () => { this.onFrame = this.onFrame.filter((f) => f !== stepOnce); step(); };
    step();
  }

  fitParams(box = null) {
    let b = box || this.bodyBox();
    if (!b || b.isEmpty()) b = new THREE.Box3(new THREE.Vector3(-60, -60, -60), new THREE.Vector3(60, 60, 60));
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    const aspect = this.el.clientWidth / (this.el.clientHeight || 1);
    const r = Math.max(sphere.radius, 1);
    return { center: sphere.center, zoom: (FRUSTUM * Math.min(1, aspect)) / (r * 1.25) };
  }

  zoomToFit(animate = true) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.setView(dir.toArray(), { fit: true, animate });
  }

  viewDir() {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }

  // ------------------------------------------------------------ picking

  ndc(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  ray(clientX, clientY) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return this.raycaster.ray;
  }

  /**
   * Returns the nearest pick: { kind: 'face'|'edge', bodyId, face|edge, point (world), normal (world) }
   * or { kind: 'plane', key } or { kind: 'sketch', id }.
   */
  pick(clientX, clientY, { body = true, planes = true, sketches = true, edges = true, bodies = null } = {}) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const wpp = this.worldPerPixel();
    this.raycaster.params.Line.threshold = wpp * 5;
    const meshes = [], edgeObjs = [];
    if (body) {
      for (const b of this.bodies.values()) {
        if (b.hidden || (bodies && !bodies.includes(b.id))) continue;
        if (b.mesh.visible) meshes.push(b.mesh);
        if (edges && b.edges.visible) edgeObjs.push(b.edges);
      }
    }
    const others = [];
    if (planes) for (const pv of this.planeVisuals.values()) if (pv.group.visible) others.push(pv.mesh);
    if (sketches) this.sketchGroup.traverse((o) => { if (o.userData.pickSketch) others.push(o); });
    const clipOk = (p) => !this.clipPlanes.length || this.clipPlanes[0].distanceToPoint(p) >= 0;
    const faceHits = this.raycaster.intersectObjects(meshes, false).filter((h) => clipOk(h.point));
    const edgeHits = this.raycaster.intersectObjects(edgeObjs, false).filter((h) => clipOk(h.point));
    const otherHits = this.raycaster.intersectObjects(others, false);

    const sk = otherHits.find((h) => h.object.userData.pickSketch);
    if (sk) return { kind: 'sketch', id: sk.object.userData.pickSketch, point: sk.point };

    const faceHit = faceHits[0];
    const faceDist = faceHit ? faceHit.distance : Infinity;
    // edges win when they are not hidden behind the face under the cursor
    const tol = wpp * 3;
    const edgeHit = edgeHits.find((h) => h.distance <= faceDist + tol);
    if (edgeHit) {
      const b = this.bodies.get(edgeHit.object.userData.bodyId);
      const seg = Math.floor(edgeHit.index / 2);
      const edge = b.segEdge[seg];
      if (edge >= 0) return { kind: 'edge', bodyId: b.id, edge, point: edgeHit.point.clone(), info: b.data.edges[edge] };
    }
    const planeHit = otherHits.find((h) => h.object.userData.kind === 'plane');
    if (faceHit && (!planeHit || faceHit.distance <= planeHit.distance)) {
      const b = this.bodies.get(faceHit.object.userData.bodyId);
      const face = b.triFace[faceHit.faceIndex];
      const info = b.data.faces[face];
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(b.group.matrixWorld);
      const normal = info?.normal
        ? new THREE.Vector3(...info.normal).applyMatrix3(normalMatrix).normalize()
        : faceHit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      return { kind: 'face', bodyId: b.id, face, point: faceHit.point.clone(), normal, info };
    }
    if (planeHit) return { kind: 'plane', key: planeHit.object.userData.key, point: planeHit.point };
    return null;
  }

  // Snap a face/edge pick to a nearby B-rep vertex (edge endpoint) or circle center.
  snapPoint(hit, clientX, clientY, px = 12) {
    if (!hit || (hit.kind !== 'face' && hit.kind !== 'edge')) return null;
    const b = this.bodies.get(hit.bodyId);
    const r = this.renderer.domElement.getBoundingClientRect();
    let best = null, bestD = px;
    const consider = (p, type) => {
      const v = new THREE.Vector3(...p).applyMatrix4(b.group.matrixWorld);
      const s = v.clone().project(this.camera);
      const d = Math.hypot(((s.x + 1) / 2) * r.width + r.left - clientX, ((1 - s.y) / 2) * r.height + r.top - clientY);
      if (d < bestD) { bestD = d; best = { point: v, type }; }
    };
    for (const e of b.data.edges) {
      consider(e.a, 'vertex');
      consider(e.b, 'vertex');
      if (e.center) consider(e.center, 'center');
    }
    return best;
  }

  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.el.clientWidth, y: ((1 - p.y) / 2) * this.el.clientHeight };
  }

  snapshot() {
    this.render();
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    const cs = getComputedStyle(this.el);
    g.addColorStop(0, cs.getPropertyValue('--vp-top').trim() || '#dfe7f1');
    g.addColorStop(1, cs.getPropertyValue('--vp-bottom').trim() || '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
    return c.toDataURL('image/png');
  }
}

export { STD_PLANES };
