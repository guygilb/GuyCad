// End-to-end test of the second feature batch (sketch tools, sweep/loft/draft/hole, import,
// all export formats, drawings, exploded view, BOM):
//   npm run build && ELECTRON=1 node tests/browser-driver.mjs app tests/desktop-e2e-2.mjs <shotsDir>
export default async function (t) {
  const log = (...a) => console.log('[test]', ...a);
  const fail = (msg) => { console.log(`[FAIL] ${msg}`); process.exitCode = 1; };
  const ok = (cond, msg, extra = '') => (cond ? log(`PASS ${msg} ${extra}`) : fail(`${msg} ${extra}`));
  const idle = async (ms = 30000) => {
    const t0 = Date.now();
    await t.wait(150);
    while (Date.now() - t0 < ms) {
      if (await t.eval(`document.getElementById('sb-busy').hidden && !guycad.kernel.busy`)) return;
      await t.wait(100);
    }
    fail('timed out waiting for the kernel');
  };
  const sketchScreen = async (x, y) => t.eval(`(() => { const s = guycad.sketcher.toScreen([${x}, ${y}]); const r = guycad.viewport.el.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; })()`);
  const clickSketch = async (x, y) => { const p = await sketchScreen(x, y); await t.move(p[0], p[1]); await t.click(p[0], p[1]); };
  const errors = async () => t.eval('JSON.stringify(guycad.build.errors)');
  const vol = async () => t.eval('guycad.build.data?.mass.volume ?? 0');

  await idle();
  await t.eval('guycad.closeModals()');

  // ---------------------------------------------------------- slot sketched with the mouse, extruded
  await t.eval(`guycad.cmdNew('part')`);
  await idle();
  await t.eval(`guycad.selection = { kind: 'plane', key: 'Top' }; guycad.run('sketch')`);
  await t.wait(600);
  await t.eval(`guycad.sketcher.setTool('slot')`);
  await clickSketch(-20, 0);
  await clickSketch(20, 0);
  await clickSketch(0, 8);
  let st = await t.eval(`({ n: guycad.sketcher.entities.length, a: guycad.sketcher.analysis.status })`);
  ok(st.n === 4, 'slot tool makes 2 lines + 2 arcs', JSON.stringify(st));
  await t.shot('slot-sketch');
  await t.eval(`guycad.run('extrude')`);
  await t.wait(300);
  await t.eval(`(() => { const f = guycad.byId(guycad.pm.featureId); f.depth = 10; guycad.pmOK(); })()`);
  await idle();
  let v = await vol();
  // the width click snaps to the 5 mm grid: radius 10
  ok(Math.abs(v - (40 * 20 + Math.PI * 100) * 10) < 0.5, 'slot extrusion volume', v.toFixed(2));

  // ---------------------------------------------------------- Hole Wizard: points on the top face, counterbore
  await t.eval(`guycad.selection = null; guycad.run('hole')`);
  await t.wait(300);
  ok(await t.eval(`guycad.mode === 'pickPlane'`), 'Hole Wizard asks for a face');
  const topPt = await t.eval(`(() => { const V = guycad.viewport.camera.position.constructor; const s = guycad.viewport.toScreen(new V(-20, 10, 0)); const r = guycad.viewport.el.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; })()`);
  await t.click(topPt[0], topPt[1]);
  await t.wait(700);
  ok(await t.eval(`guycad.mode === 'sketch' && guycad.sketcher.tool === 'point'`), 'sketch on the face with the Point tool');
  // face sketch origin is the projection of the part origin: points at (-20,0) and (20,0)
  await clickSketch(-20, 0);
  await clickSketch(20, 0);
  await t.eval(`guycad.run('hole')`);
  await t.wait(400);
  ok(await t.eval(`guycad.pm?.kind === 'feature' && guycad.byId(guycad.pm.featureId).type === 'hole'`), 'Hole Wizard PropertyManager opened');
  await t.eval(`(() => { const f = guycad.byId(guycad.pm.featureId); Object.assign(f, { holeType: 'cbore', diameter: 6.6, cboreDiameter: 11, cboreDepth: 4, through: true }); guycad.pmOK(); })()`);
  await idle();
  const v2 = await vol();
  const expect = v - 2 * (Math.PI * 3.3 * 3.3 * 10 + Math.PI * (5.5 * 5.5 - 3.3 * 3.3) * 4);
  ok(Math.abs(v2 - expect) < 0.5 && (await errors()) === '{}', 'two counterbored holes', `${v2.toFixed(2)} vs ${expect.toFixed(2)}`);
  await t.eval(`guycad.setView('iso')`);
  await t.wait(500);
  await t.shot('holes');

  // ---------------------------------------------------------- sketch fillet + trim in the UI
  await t.eval(`guycad.selection = { kind: 'plane', key: 'Front' }; guycad.run('sketch')`);
  await t.wait(600);
  // frame the area we draw in (the camera is still zoomed on the small part)
  await t.eval(`(() => { const vp = guycad.viewport; vp.controls.target.set(0, 40, 0); vp.camera.position.set(0, 40, 4000); vp.camera.zoom = 1.2; vp.camera.updateProjectionMatrix(); vp.controls.update(); })()`);
  await t.wait(100);
  await t.eval(`guycad.sketcher.setTool('rect')`);
  await clickSketch(-30, 30);
  await clickSketch(30, 70);
  await t.eval(`guycad.settings.sketchFilletRadius = 8; guycad.sketcher.setTool('sfillet')`);
  await clickSketch(30, 70);
  st = await t.eval(`({ n: guycad.sketcher.entities.length, arc: guycad.sketcher.entities.find(e => e.type === 'arc')?.r })`);
  ok(st.n === 5 && Math.abs(st.arc - 8) < 1e-6, 'sketch fillet on a rectangle corner', JSON.stringify(st));
  await t.eval(`guycad.sketcher.setTool('line')`);
  await clickSketch(0, 20);
  await clickSketch(0, 80);
  await t.key('Escape', 'Escape');
  await t.eval(`guycad.sketcher.setTool('trim')`);
  await clickSketch(0, 76);
  await clickSketch(0, 24);
  st = await t.eval(`(() => { const l = guycad.sketcher.entities[guycad.sketcher.entities.length - 1]; return [l.a[1], l.b[1]]; })()`);
  ok(Math.abs(Math.min(...st) - 30) < 1e-6 && Math.abs(Math.max(...st) - 70) < 1e-6, 'trim both ends of a line back to the rectangle', JSON.stringify(st));
  await t.shot('sketch-fillet-trim');
  await t.eval(`guycad.exitSketch(false)`);
  await t.wait(300);

  // ---------------------------------------------------------- sweep, loft and draft through their PropertyManagers
  await t.eval(`(() => {
    const s = JSON.stringify(guycad.doc);
    guycad.doc.features.push(
      { id: 'pp', type: 'sketch', name: 'Path', plane: 'Front', entities: [{ type: 'line', a: [30, 10], b: [30, 40] }, { type: 'arc', c: [10, 40], r: 20, a0: 0, a1: Math.PI / 2 }], constraints: [] },
      { id: 'pr', type: 'sketch', name: 'Profile', plane: 'pl1', entities: [{ type: 'circle', c: [-30, 0], r: 3 }], constraints: [] });
    guycad.doc.features.splice(guycad.doc.features.length - 1, 0, { id: 'pl1', type: 'plane', name: 'Plane1', base: 'Top', offset: 10, flip: false });
    guycad.commit(s);
  })()`);
  await t.eval(`guycad.selection = null; guycad.run('sweep')`);
  await idle();
  st = await t.eval(`(() => { const f = guycad.byId(guycad.pm.featureId); return { profile: f.profile, path: f.path }; })()`);
  ok(st.profile === 'pr' && st.path === 'pp', 'sweep picks profile and path sketches automatically', JSON.stringify(st));
  await t.eval('guycad.pmOK()');
  await idle();
  ok((await errors()) === '{}', 'sweep built', await errors());
  await t.eval(`guycad.setView('iso')`);
  await t.wait(400);
  await t.shot('sweep');

  // ---------------------------------------------------------- exports of every format
  const sizes = await t.eval(`(async () => {
    const out = {};
    for (const f of ['step', 'brep', 'stl', 'stl-ascii', '3mf', 'obj', 'ply', 'glb', 'gltf', 'usdz']) {
      const d = await guycad.exportData(f);
      out[f] = typeof d === 'string' ? d.length : (d.byteLength ?? d.length ?? d.size);
    }
    return out; })()`);
  const allOk = Object.values(sizes).every((n) => n > 1000);
  ok(allOk, 'export STEP, BREP, STL (bin/ASCII), 3MF, OBJ, PLY, GLB, glTF, USDZ', JSON.stringify(sizes));
  const head3mf = await t.eval(`guycad.exportData('3mf').then(b => String.fromCharCode(...b.slice(0, 2)))`);
  ok(head3mf === 'PK', '3MF is a zip package');

  // ---------------------------------------------------------- import: STEP export -> new part -> features on it
  const imp = await t.eval(`(async () => {
    const step = new Uint8Array(await guycad.exportData('step'));
    const doc = guycad.importedPartDoc('roundtrip.step', 'step', step);
    await guycad.loadDoc(doc, { dirty: true });
    return { errors: JSON.stringify(guycad.build.errors), vol: guycad.build.data?.mass.volume };
  })()`);
  await idle();
  ok(imp.errors === '{}' && imp.vol > 1000, 'STEP import builds a part', JSON.stringify(imp));

  // ---------------------------------------------------------- drawing from a part
  await t.eval(`guycad.loadSample('flange')`);
  await idle();
  await t.eval(`guycad.run('makeDrawing')`);
  await idle();
  await t.wait(500);
  st = await t.eval(`({ type: guycad.doc.type, views: guycad.doc.views.length, proj: guycad.drawingProj.size, scale: guycad.doc.scale })`);
  ok(st.type === 'drawing' && st.views === 4 && st.proj === 4, 'standard 3 view drawing + isometric', JSON.stringify(st));
  // dimension: the flange diameter (a circle in the top view)
  const dimOk = await t.eval(`(() => {
    const v = guycad.doc.views.find(x => x.kind === 'top'); const pr = guycad.drawingProj.get('top');
    const c = pr.circles.sort((a, b) => b.r - a.r)[0];
    const edge = guycad.toSheet(v, [c.c[0] + c.r, c.c[1]]);
    guycad.setDrawingTool('dim'); guycad.drawingDimClick(edge);
    guycad.drawingDimClick([edge[0] + 15, edge[1] - 15]);
    const d = guycad.doc.dims[0];
    return d && d.type === 'diameter' && Math.abs(d.r * 2 - 100) < 1e-6;
  })()`);
  ok(dimOk, 'diameter dimension on a drawing view (Ø100)');
  await t.eval(`guycad.setDrawingTool(null); guycad.fitSheet()`);
  await t.wait(300);
  await t.shot('drawing-part');
  const pdf = await t.eval(`guycad.drawingExportData('pdf').then(b => ({ n: b.length, head: String.fromCharCode(...b.slice(0, 5)) }))`);
  ok(pdf.head === '%PDF-' && pdf.n > 5000, 'drawing PDF export', JSON.stringify(pdf));
  const dxf = await t.eval(`guycad.drawingExportData('dxf').then(s => ({ n: s.length, ents: (s.match(/\\nPOLYLINE\\r/g) || []).length }))`);
  ok(dxf.n > 10000 && dxf.ents > 20, 'drawing DXF export', JSON.stringify(dxf));
  const svg = await t.eval(`guycad.drawingExportData('svg').then(s => s.includes('<polyline') && s.includes('mm"'))`);
  ok(svg, 'drawing SVG export');

  // the drawing follows model changes
  await t.eval(`guycad.switchTab(guycad.tabs.findIndex(x => x.doc.name === 'Flange'))`);
  await idle();
  await t.eval(`(() => { const s = JSON.stringify(guycad.doc); guycad.byId('f1').depth = 20; guycad.commit(s); return guycad.rebuildModel(); })()`);
  await idle();
  await t.eval(`guycad.switchTab(guycad.tabs.findIndex(x => x.doc.type === 'drawing'))`);
  await idle();
  await t.wait(500);
  const h = await t.eval(`(() => { const b = guycad.drawingProj.get('front').bbox; return b[3] - b[1]; })()`);
  ok(Math.abs(h - 45) < 1e-6 || Math.abs(h - 53) < 1e-6, 'drawing updated after the part changed', h);

  // ---------------------------------------------------------- assembly: exploded view, BOM, assembly drawing
  await t.eval(`guycad.loadSample('pinnedBracket')`);
  await idle();
  const before = await t.eval(`guycad.viewport.bodies.get('c2').group.matrix.elements[13]`);
  await t.eval(`guycad.cmdExplode()`);
  await t.wait(300);
  const after = await t.eval(`guycad.viewport.bodies.get('c2').group.matrix.elements[13]`);
  ok(Math.abs(after - before) > 1, 'exploded view moves components', `${before.toFixed(1)} -> ${after.toFixed(1)}`);
  await t.eval(`guycad.viewport.zoomToFit(false)`);
  await t.wait(300);
  await t.shot('exploded');
  await t.eval('guycad.pmCancel()');
  const bom = await t.eval(`guycad.bomRowsAsm().map(r => r.name + ' x' + r.qty).join(', ')`);
  ok(bom === 'Bracket x1, Pin x2', 'bill of materials', bom);
  await t.eval(`guycad.makeDrawingFrom(guycad.tab)`);
  await idle();
  await t.wait(500);
  ok(await t.eval(`guycad.doc.bom.show && guycad.sheetSVG().includes('PART NAME')`), 'assembly drawing with BOM table');
  await t.shot('drawing-assembly');
  log('done');
}
