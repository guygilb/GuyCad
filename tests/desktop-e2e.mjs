// End-to-end test of the desktop app:
//   npm run build && ELECTRON=1 node tests/browser-driver.mjs app tests/desktop-e2e.mjs <shotsDir>
export default async function (t) {
  const log = (...a) => console.log('[test]', ...a);
  const fail = (msg) => { console.log(`[FAIL] ${msg}`); process.exitCode = 1; };
  const ok = (cond, msg, extra = '') => (cond ? log(`PASS ${msg} ${extra}`) : fail(`${msg} ${extra}`));
  const idle = async (ms = 20000) => {
    const t0 = Date.now();
    await t.wait(150);
    while (Date.now() - t0 < ms) {
      if (await t.eval(`document.getElementById('sb-busy').hidden && !guycad.kernel.busy`)) return;
      await t.wait(100);
    }
    fail('timed out waiting for the kernel');
  };
  // screen position (client coords) of a world point
  const screenOf = async (expr) => t.eval(`(() => {
    const p = ${expr}; const v = new (guycad.viewport.camera.position.constructor)(p[0], p[1], p[2]);
    const s = guycad.viewport.toScreen(v); const r = guycad.viewport.el.getBoundingClientRect();
    return [r.left + s.x, r.top + s.y]; })()`);
  const sketchScreen = async (x, y) => t.eval(`(() => { const s = guycad.sketcher.toScreen([${x}, ${y}]); const r = guycad.viewport.el.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; })()`);

  await idle(30000);
  log('kernel ready');
  await t.eval(`guycad.closeModals()`);

  // ---------------------------------------------------------- samples
  for (const id of ['flange', 'bracket', 'vase', 'plate', 'enclosure']) {
    await t.eval(`guycad.loadSample('${id}')`);
    await idle();
    const r = await t.eval(`({ errors: guycad.build.errors, faces: guycad.build.data?.faces.length, vol: guycad.build.data?.mass.volume })`);
    ok(!Object.keys(r.errors).length && r.faces > 0, `sample ${id}`, `${r.faces} faces, volume ${r.vol?.toFixed(0)}`);
    await t.shot(`sample-${id}`);
  }
  log('tabs open:', await t.eval('guycad.tabs.length'));

  // ---------------------------------------------------------- part workflow
  await t.eval(`guycad.cmdNew('part')`);
  await idle();
  const front = await t.eval(`(() => { const n = [...document.querySelectorAll('#tree .tnode')].find(n => n.textContent.includes('Front Plane')); const r = n.getBoundingClientRect(); return [r.left + 50, r.top + 10]; })()`);
  await t.click(front[0], front[1]);
  await t.eval(`guycad.run('sketch')`);
  await t.wait(700);
  ok(await t.eval(`guycad.mode === 'sketch'`), 'sketch started on Front Plane');
  // rectangle from the origin (snaps) to (50, 30)
  await t.key('r', 'KeyR');
  let p = await sketchScreen(0, 0);
  await t.click(p[0], p[1]);
  p = await sketchScreen(50, 30);
  await t.move(p[0], p[1]);
  await t.click(p[0], p[1]);
  let st = await t.eval(`({ n: guycad.sketcher.entities.length, c: guycad.sketcher.constraints.length, a: guycad.sketcher.analysis.status, dof: guycad.sketcher.analysis.dof })`);
  ok(st.n === 4 && st.c >= 9, 'rectangle = 4 lines with relations', JSON.stringify(st));
  await t.shot('sketch-rectangle');

  // Smart Dimension: bottom line -> 60
  await t.key('d', 'KeyD');
  const bottomMid = await t.eval(`(() => { const e = guycad.sketcher.entities[0]; return [(e.a[0]+e.b[0])/2, (e.a[1]+e.b[1])/2]; })()`);
  p = await sketchScreen(bottomMid[0], bottomMid[1]);
  await t.click(p[0], p[1]);
  p = await sketchScreen(bottomMid[0], bottomMid[1] - 12);
  await t.move(p[0], p[1]);
  await t.click(p[0], p[1]);
  await t.wait(200);
  ok(await t.eval(`!!document.querySelector('.dim-editor input')`), 'dimension value editor opened');
  await t.eval(`(() => { const i = document.querySelector('.dim-editor input'); i.value = '60'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await t.wait(200);
  const len0 = await t.eval(`(() => { const e = guycad.sketcher.entities[0]; return Math.hypot(e.b[0]-e.a[0], e.b[1]-e.a[1]); })()`);
  ok(Math.abs(len0 - 60) < 1e-6, 'driving dimension resizes the line', len0.toFixed(6));
  // dimension the right side to 25*2 (math in the field)
  const rightMid = await t.eval(`(() => { const e = guycad.sketcher.entities[1]; return [(e.a[0]+e.b[0])/2, (e.a[1]+e.b[1])/2]; })()`);
  p = await sketchScreen(rightMid[0], rightMid[1]);
  await t.click(p[0], p[1]);
  p = await sketchScreen(rightMid[0] + 12, rightMid[1]);
  await t.click(p[0], p[1]);
  await t.wait(200);
  await t.eval(`(() => { const i = document.querySelector('.dim-editor input'); i.value = '25*2'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await t.wait(200);
  st = await t.eval(`({ a: guycad.sketcher.analysis.status, dof: guycad.sketcher.analysis.dof, h: Math.abs(guycad.sketcher.entities[1].b[1] - guycad.sketcher.entities[1].a[1]) })`);
  ok(Math.abs(st.h - 50) < 1e-6 && st.a === 'full', 'second dimension; corner snapped to origin => Fully Defined', JSON.stringify(st));
  ok((await t.eval(`document.getElementById('sb-editing').textContent`)).includes('Fully Defined'), 'status bar shows Fully Defined');
  await t.shot('sketch-dimensioned');
  // drag test: a fully-defined sketch must not move
  await t.key('Escape', 'Escape');
  const before = await t.eval(`JSON.stringify(guycad.sketcher.entities)`);
  p = await sketchScreen(60, 50);
  await t.mouse('mouseMoved', p[0], p[1], 'none');
  await t.mouse('mousePressed', p[0], p[1]);
  const p2 = await sketchScreen(80, 70);
  await t.mouse('mouseMoved', p2[0], p2[1], 'left');
  await t.mouse('mouseReleased', p2[0], p2[1]);
  ok((await t.eval(`JSON.stringify(guycad.sketcher.entities)`)) === before, 'fully defined geometry does not move when dragged');

  // Extruded Boss/Base while sketching exits the sketch and opens the extrude PropertyManager
  await t.eval(`guycad.run('extrude')`);
  await t.wait(400);
  ok(await t.eval(`guycad.pm?.kind === 'feature' && guycad.byId(guycad.pm.featureId).type === 'extrude'`), 'extrude opened from the active sketch');
  await t.eval(`guycad.pmOK()`);
  await idle();
  let vol = await t.eval(`guycad.build.data?.mass.volume`);
  ok(Math.abs(vol - 60 * 50 * 10) < 1e-3, 'extrude volume exact', vol);

  // fillet: click a vertical edge in the viewport
  await t.eval(`guycad.setView('iso')`);
  await t.wait(700);
  await t.eval(`guycad.run('fillet')`);
  await idle();
  const edgePt = await t.eval(`(() => { const d = guycad.build.data; const e = d.edges.find(e => e.type === 'LINE' && Math.abs(e.a[0]-60)<1e-6 && Math.abs(e.a[1]-50)<1e-6 && Math.abs(e.b[0]-60)<1e-6); return e.mid; })()`);
  p = await screenOf(JSON.stringify(edgePt));
  await t.move(p[0], p[1]);
  await t.click(p[0], p[1]);
  await t.wait(200);
  ok(await t.eval(`guycad.byId(guycad.pm.featureId).edges.length === 1`), 'edge picked in viewport for fillet');
  await t.eval(`(() => { const i = document.querySelector('#pm .pm-row input'); i.value = '5'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()`);
  await t.wait(600);
  await t.shot('fillet-pm');
  await t.eval(`guycad.pmOK()`);
  await idle();
  vol = await t.eval(`guycad.build.data?.mass.volume`);
  ok(Math.abs(vol - (30000 - (25 - Math.PI * 25 / 4) * 10)) < 1e-2, 'fillet volume exact', vol?.toFixed(4));

  // shell: click the front face (z = 10)
  await t.eval(`guycad.run('shell')`);
  await idle();
  p = await screenOf('[20, 20, 10]');
  await t.click(p[0], p[1]);
  await t.wait(200);
  ok(await t.eval(`guycad.byId(guycad.pm.featureId).faces.length === 1`), 'face picked for shell');
  await t.eval(`guycad.pmOK()`);
  await idle();
  const errs = await t.eval(`JSON.stringify(guycad.build.errors)`);
  ok(errs === '{}', 'shell built', errs);
  await t.shot('part-shelled');

  // STEP export through the kernel
  const stepLen = await t.eval(`guycad.kernel.export(guycad.exportDocs(), 'step').then(b => b.byteLength)`);
  ok(stepLen > 5000, 'STEP export', `${stepLen} bytes`);
  const mass = await t.eval(`(() => { guycad.showMassProps(); const txt = document.querySelector('.modal .data-table').innerText; guycad.closeModals(); return txt.replace(/\\n/g, ' | '); })()`);
  log('mass properties:', mass);

  // ---------------------------------------------------------- assembly sample
  await t.eval(`guycad.loadSample('pinnedBracket')`);
  await idle();
  const pins = await t.eval(`guycad.doc.components.filter(c => c.name === 'Pin').map(c => c.position.map(v => Math.round(v * 1e6) / 1e6))`);
  ok(JSON.stringify(pins) === JSON.stringify([[55, -20, -12], [55, -20, 12]]), 'mates seat both pins in their holes', JSON.stringify(pins));
  ok(await t.eval(`guycad.viewport.bodies.size === 3`), 'three components displayed');
  await t.eval(`guycad.viewport.setView([1, 0.6, 1.4], { fit: true, animate: false })`);
  await t.wait(300);
  await t.shot('assembly-sample');
  await t.eval(`guycad.cmdInterference()`);
  await idle();
  await t.wait(300);
  const interf = await t.eval(`document.querySelector('.modal-body')?.innerText`);
  ok(/No interferences/.test(interf || ''), 'interference detection: clearance fits', interf);
  await t.eval(`guycad.closeModals()`);

  // mate from scratch with viewport picks: float a pin, move it away, then re-mate via the Mate PM
  await t.eval(`(() => { const d = guycad.doc; d.mates = d.mates.filter(m => m.b.comp !== 'c3'); const c = d.components.find(c => c.id === 'c3'); c.position = [130, 40, 40]; guycad.updateAssemblyBodies(); guycad.refreshTree(); })()`);
  await t.eval(`guycad.viewport.zoomToFit(false)`);
  await t.wait(300);
  await t.eval(`guycad.cmdMate()`);
  // a point on a surface of a body (centroid of a triangle of the given face), in world coords
  const facePoint = (comp, pred) => `(() => {
    const b = guycad.viewport.bodies.get('${comp}'); const d = b.data; const f = d.faces.findIndex(${pred});
    const s = d.faceRanges[f * 2]; const i = d.indices; const v = d.vertices; const P = [0, 0, 0];
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) P[a] += v[i[s + k] * 3 + a] / 3;
    const w = new (guycad.viewport.camera.position.constructor)(...P).applyMatrix4(b.group.matrixWorld); return w.toArray(); })()`;
  const clickWorld = async (expr) => { const sp = await screenOf(expr); await t.move(sp[0], sp[1]); await t.click(sp[0], sp[1]); await t.wait(150); };
  await t.eval(`guycad.viewport.setView([1, 0.9, 1.2], { fit: true, animate: false })`);
  await t.wait(200);
  // click a point of the pin's cylindrical face that is actually visible from the camera
  const pinPt = await t.eval(`(() => {
    const b = guycad.viewport.bodies.get('c3'); const d = b.data; const f = d.faces.findIndex(f => f.type === 'CYLINDRE' && Math.abs(f.radius - 4.8) < 1e-6);
    const V = guycad.viewport.camera.position.constructor; const rr = guycad.viewport.el.getBoundingClientRect();
    const s = d.faceRanges[f * 2], n = d.faceRanges[f * 2 + 1];
    for (let t = s; t < s + n; t += 3) {
      const P = new V(); for (let k = 0; k < 3; k++) P.add(new V().fromArray(d.vertices, d.indices[t + k] * 3).divideScalar(3));
      P.applyMatrix4(b.group.matrixWorld);
      const sc = guycad.viewport.toScreen(P); const x = rr.left + sc.x, y = rr.top + sc.y;
      const hit = guycad.viewport.pick(x, y, guycad.pickOptions());
      if (hit && hit.kind === 'face' && hit.bodyId === 'c3' && hit.face === f) return [x, y];
    }
    return null; })()`);
  ok(!!pinPt, 'found a visible point on the pin cylinder');
  await t.move(pinPt[0], pinPt[1]);
  await t.click(pinPt[0], pinPt[1]);
  await t.wait(150);
  // the hole's inner wall is mostly hidden from this view: pick its top rim (a circular edge) instead
  await clickWorld('[55, 10, 17]');
  let mt = await t.eval(`({ n: document.querySelectorAll('#pm .pick-list label').length, type: [...document.querySelectorAll('#pm .tool-grid button.active')].map(b => b.textContent).join() })`);
  ok(mt.n === 2 && mt.type === 'Concentric', 'two cylinders picked -> Concentric suggested', JSON.stringify(mt));
  await t.shot('mate-pm');
  await t.eval(`guycad.pmOK()`);
  await t.wait(200);
  const c3 = await t.eval(`guycad.doc.components.find(c => c.id === 'c3').position.map(v => Math.round(v * 1e4) / 1e4)`);
  ok(Math.abs(c3[0] - 55) < 1e-3 && Math.abs(c3[2] - 12) < 1e-3, 'concentric mate placed the pin on the hole axis', JSON.stringify(c3));

  // edit a component part in a linked tab and see the assembly update
  await t.eval(`guycad.editComponentPart('c2')`);
  await idle();
  ok(await t.eval(`!!guycad.tab.link && guycad.doc.name === 'Pin'`), 'Edit Part opened a linked tab');
  await t.eval(`(() => { const s = JSON.stringify(guycad.doc); guycad.doc.features[1].angle = 270; guycad.commit(s); return guycad.rebuildModel(); })()`);
  await idle();
  await t.eval(`guycad.switchTab(guycad.tabs.findIndex(t => t.id === guycad.tab.link.asmTabId))`);
  await idle();
  const pinVol = await t.eval(`guycad.asmData.get('c2').data.mass.volume`);
  ok(pinVol < 2966 * 0.8, 'assembly shows the edited part', pinVol.toFixed(1));
  await t.shot('assembly-after-edit');

  // dark theme screenshot for the record
  await t.eval(`guycad.settings.theme = 'dark'; guycad.afterSettings()`);
  await t.wait(300);
  await t.shot('dark-assembly');
  await t.eval(`guycad.settings.theme = 'light'; guycad.afterSettings()`);
  log('done');
}
