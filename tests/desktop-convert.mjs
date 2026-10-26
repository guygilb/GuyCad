// Convert Entities in the desktop app:
//   npm run build && ELECTRON=1 node tests/browser-driver.mjs app tests/desktop-convert.mjs <shotsDir>
export default async function (t) {
  const ok = (cond, msg, extra = '') => { console.log(`${cond ? '[test] PASS' : '[FAIL]'} ${msg} ${extra}`); if (!cond) process.exitCode = 1; };
  for (let i = 0; i < 150 && !(await t.eval(`!!window.guycad && document.getElementById('sb-busy').hidden`)); i++) await t.wait(200);
  await t.eval(`guycad.closeModals(); guycad.loadSample('flange')`);
  for (let i = 0; i < 100 && !(await t.eval(`document.getElementById('sb-busy').hidden && !!guycad.build.data`)); i++) await t.wait(200);
  await t.eval(`guycad.setView('top')`);
  await t.wait(600);
  const at = async (w) => t.eval(`(() => { const V = guycad.viewport.camera.position.constructor; const s = guycad.viewport.toScreen(new V(${w})); const r = guycad.viewport.el.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; })()`);
  // the flange's top face (y = 12), outside the boss and away from the bolt holes
  let q = await at('-30, 12, 30');
  await t.click(q[0], q[1]);
  ok(await t.eval(`guycad.selection?.kind === 'face'`), 'face selected');
  await t.eval(`guycad.run('sketch')`);
  await t.wait(700);
  await t.eval(`guycad.sketcher.setTool('convert')`);
  q = await at('-30, 12, 30');
  await t.move(q[0], q[1]);
  await t.click(q[0], q[1]);
  const ents = await t.eval(`guycad.sketcher.entities.map(e => e.type + (e.r ? ':' + Math.round(e.r * 100) / 100 : '')).sort().join(',')`);
  ok(/circle:50/.test(ents) && /circle:28/.test(ents) && (ents.match(/circle:5(,|$)/g) || []).length === 6, 'face edges converted: outer Ø100, fillet edge Ø56, 6 bolt holes', ents);
  await t.shot('converted');
}
