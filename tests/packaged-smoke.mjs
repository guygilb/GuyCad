// Smoke test of a packaged build:
//   ELECTRON=1 ELECTRON_EXE=release/win-unpacked/GuyCAD.exe node tests/browser-driver.mjs app tests/packaged-smoke.mjs <shotsDir>
export default async function (t) {
  for (let i = 0; i < 150 && !(await t.eval(`!!window.guycad && document.getElementById('sb-busy').hidden`)); i++) await t.wait(200);
  await t.eval(`guycad.closeModals()`);
  for (const id of ['enclosure', 'pinnedBracket']) {
    await t.eval(`guycad.loadSample('${id}')`);
    for (let i = 0; i < 100; i++) { await t.wait(200); if (await t.eval(`document.getElementById('sb-busy').hidden && !guycad.kernel.busy`)) break; }
    const r = await t.eval(`({ bodies: guycad.viewport.bodies.size, errors: JSON.stringify(guycad.build.errors) })`);
    console.log(`[test] ${r.bodies > 0 && r.errors === '{}' ? 'PASS' : 'FAIL'} packaged ${id}: ${r.bodies} bodies, errors ${r.errors}`);
    await t.shot(`packaged-${id}`);
  }
}
