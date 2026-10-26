// Desktop test of sketch tools driven by the mouse:
//   npm run build && ELECTRON=1 node tests/browser-driver.mjs app tests/desktop-sketch.mjs <shotsDir>
export default async function (t) {
  const log = (...a) => console.log('[test]', ...a);
  const ok = (cond, msg, extra = '') => { if (cond) log(`PASS ${msg} ${extra}`); else { console.log(`[FAIL] ${msg} ${extra}`); process.exitCode = 1; } };
  for (let i = 0; i < 150 && !(await t.eval(`!!window.guycad && document.getElementById('sb-busy').hidden`)); i++) await t.wait(200);
  await t.eval(`guycad.closeModals(); guycad.cmdNew('part')`);
  await t.wait(800);
  await t.eval(`guycad.selection = { kind: 'plane', key: 'Front' }; guycad.run('sketch')`);
  await t.wait(700);
  await t.eval(`(() => { const vp = guycad.viewport; vp.controls.target.set(0, 0, 0); vp.camera.position.set(0, 0, 4000); vp.camera.zoom = 1.5; vp.camera.updateProjectionMatrix(); vp.controls.update(); })()`);
  await t.wait(400);
  const at = async (x, y) => t.eval(`(() => { const s = guycad.sketcher.toScreen([${x}, ${y}]); const r = guycad.viewport.el.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; })()`);
  const click = async (x, y) => { const p = await at(x, y); await t.move(p[0], p[1]); await t.click(p[0], p[1]); };
  const tool = (name) => t.eval(`guycad.sketcher.setTool('${name}')`);
  const last = () => t.eval(`JSON.stringify(guycad.sketcher.entities[guycad.sketcher.entities.length - 1])`);

  await tool('ellipse'); await click(-40, 30); await click(-25, 30);
  await click(-40, 37);
  ok(JSON.parse(await last()).type === 'ellipse', 'ellipse by mouse', await last());
  await tool('line'); await click(0, 0); await click(20, 0);
  await t.key('Escape', 'Escape');
  await tool('tarc'); await click(20, 0); await click(20, 20);
  const arc = JSON.parse(await last());
  ok(arc.type === 'arc' && Math.abs(arc.r - 10) < 1e-6, 'tangent arc off a line end', JSON.stringify(arc));
  await tool('carc'); await click(-40, -30); await click(-30, -30); await click(-40, -20);
  ok(JSON.parse(await last()).type === 'arc', 'centerpoint arc');
  await tool('rect3'); await click(30, -40); await click(50, -20); await click(40, -40);
  ok(await t.eval('guycad.sketcher.entities.length') === 8, '3-point rectangle adds 4 lines', await t.eval('guycad.sketcher.entities.length'));
  ok(await t.eval('guycad.sketcher.analysis.status') !== 'over', 'relations consistent');
  await t.shot('sketch-tools');
}
