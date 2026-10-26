// Minimal headless-Edge/Chrome driver over the DevTools protocol (no dependencies).
// Usage: node tests/browser-driver.mjs <url> <script.mjs> <outDir>
// The script exports `async (t) => {}` where t = { eval, shot, wait, click, key, move }.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [url, scriptPath, outDir = 'test-shots'] = process.argv.slice(2);
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const exe = process.env.BROWSER || BROWSERS[0];
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'guycad-'));
mkdirSync(outDir, { recursive: true });

// ELECTRON=1 launches the desktop app (npx electron .) and drives its window instead of a browser.
const proc = process.env.ELECTRON
  ? spawn(process.env.ELECTRON_EXE || join('node_modules', 'electron', 'dist', 'electron.exe'), [`--remote-debugging-port=${port}`, '.'], { stdio: 'ignore', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) })
  : spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1440,860', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
  ], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) { console.error('browser did not start'); proc.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled') logs.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`[EXCEPTION] ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Runtime.enable');
await send('Page.enable');
if (!process.env.ELECTRON) await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
if (url !== 'app') await send('Page.navigate', { url });
for (let i = 0; i < 60; i++) {
  await sleep(250);
  const r = await send('Runtime.evaluate', { expression: `typeof window.guycad === 'object'`, returnByValue: true });
  if (r.result?.result?.value) break;
}
await sleep(500);

let shotN = 0;
const t = {
  wait: sleep,
  async eval(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.result?.value;
  },
  async shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, `${String(++shotN).padStart(2, '0')}-${name}.png`);
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  },
  async mouse(type, x, y, button = 'left', clickCount = 1) {
    await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mouseReleased' ? 0 : button === 'left' ? 1 : button === 'right' ? 2 : 4 });
  },
  async click(x, y, button = 'left') {
    await t.mouse('mouseMoved', x, y, 'none');
    await t.mouse('mousePressed', x, y, button);
    await t.mouse('mouseReleased', x, y, button);
    await sleep(60);
  },
  async move(x, y) { await t.mouse('mouseMoved', x, y, 'none'); await sleep(30); },
  async key(key, code = key, extra = {}) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, ...extra });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, ...extra });
    await sleep(60);
  },
};

let failed = false;
try {
  const mod = await import(pathToFileURL(resolve(scriptPath)).href);
  await mod.default(t);
} catch (e) {
  failed = true;
  logs.push(`[DRIVER ERROR] ${e.stack || e}`);
}
console.log(logs.join('\n') || '(no console output)');
ws.close();
proc.kill();
process.exit(failed ? 1 : 0);
