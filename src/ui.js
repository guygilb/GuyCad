// Small DOM and file helpers shared by the application modules.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export const ico = (name, cls = 'ti') => h('span', { class: cls, html: icon(name) });
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const uid = (p = 'f') => `${p}${Math.random().toString(36).slice(2, 9)}`;
export const val = (v, ...args) => (typeof v === 'function' ? v(...args) : v);

// Evaluates simple arithmetic typed into number fields, e.g. "25.4*2" or "(100-4)/3".
export function evalNumber(str) {
  const tokens = String(str).replace(/,/g, '.').match(/\d*\.?\d+(?:e[-+]?\d+)?|[-+*/()]|\S/gi) || [];
  let i = 0;
  const peek = () => tokens[i];
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = () => {
    let v = factor();
    while (peek() === '*' || peek() === '/') v = tokens[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const factor = () => {
    const t = tokens[i++];
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') { const v = expr(); return tokens[i++] === ')' ? v : NaN; }
    return t !== undefined && /^[\d.]/.test(t) ? Number(t) : NaN;
  };
  const v = tokens.length ? expr() : NaN;
  return i === tokens.length && Number.isFinite(v) ? v : NaN;
}

// Desktop build (Electron) exposes native file dialogs; the web build falls back to downloads.
export const native = window.guycadNative || null;

export const FILE_FILTERS = {
  gcad: [{ name: 'GuyCAD Part', extensions: ['gcad'] }],
  gasm: [{ name: 'GuyCAD Assembly', extensions: ['gasm'] }],
  open: [{ name: 'GuyCAD Documents', extensions: ['gcad', 'gasm'] }],
  step: [{ name: 'STEP', extensions: ['step', 'stp'] }],
  stl: [{ name: 'STL Mesh', extensions: ['stl'] }],
  obj: [{ name: 'Wavefront OBJ', extensions: ['obj'] }],
  glb: [{ name: 'glTF Binary', extensions: ['glb'] }],
  png: [{ name: 'PNG Image', extensions: ['png'] }],
};

async function toBytesOrText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

// Saves data through a native dialog (desktop) or a download (web). Returns the file name, or null if cancelled.
export async function download(data, filename, type = 'application/octet-stream') {
  if (native) {
    const ext = filename.split('.').pop().toLowerCase();
    const res = await native.saveFile({ suggestedName: filename, data: await toBytesOrText(data), filters: FILE_FILTERS[ext] });
    return res ? res.name : null;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return filename;
}

export const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
