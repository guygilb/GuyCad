// GuyCAD desktop shell: hosts the built app in a native window with native file dialogs.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(__dirname, 'icon.png');

// The built app is served from app://guycad/ so ES-module workers and the WebAssembly kernel load
// with proper origins and MIME types (file:// does not support them reliably).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serveApp() {
  protocol.handle('app', async (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      const type = MIME[path.extname(file).toLowerCase()];
      return type ? new Response(res.body, { status: res.status, headers: { 'content-type': type } }) : res;
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow(fileToOpen) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'GuyCAD',
    icon: ICON,
    backgroundColor: '#eceef1',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(`app://guycad/index.html${fileToOpen ? `?open=${encodeURIComponent(fileToOpen)}` : ''}`);

  // The app blocks unload while there are unsaved changes; ask the user instead of silently refusing to close.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'GuyCAD',
      message: 'You have unsaved changes.',
      detail: 'Close GuyCAD and discard them?',
    });
    if (choice === 0) event.preventDefault();
  });

  // Open external links in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

const filtersFor = (filters) => (filters && filters.length ? filters : [{ name: 'All Files', extensions: ['*'] }]);

ipcMain.handle('file:save', async (event, { suggestedName, data, filePath, filters }) => {
  let target = filePath;
  if (!target) {
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: suggestedName,
      filters: filtersFor(filters),
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  await fs.writeFile(target, typeof data === 'string' ? data : Buffer.from(data));
  return { filePath: target, name: path.basename(target) };
});

ipcMain.handle('file:open', async (event, { filters, binary }) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    properties: ['openFile'],
    filters: filtersFor(filters),
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  if (binary) return { filePath, name: path.basename(filePath), bytes: new Uint8Array(await fs.readFile(filePath)) };
  return { filePath, name: path.basename(filePath), text: await fs.readFile(filePath, 'utf8') };
});

// Vector PDF of an SVG drawing sheet, rendered by an offscreen window.
ipcMain.handle('pdf:fromSVG', async (_event, { svg, widthMM, heightMM }) => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${widthMM}mm ${heightMM}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${widthMM}mm;height:${heightMM}mm}</style></head><body>${svg}</body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: widthMM / 25.4, height: heightMM / 25.4 },
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    });
    return new Uint8Array(pdf);
  } finally {
    win.destroy();
  }
});

ipcMain.handle('file:read', async (_event, filePath) => ({
  filePath, name: path.basename(filePath), text: await fs.readFile(filePath, 'utf8'),
}));

// A .gcad/.gasm file passed on the command line (e.g. "Open with GuyCAD") is opened at startup.
const isDoc = (a) => /\.(gcad|gasm)$/i.test(a);
const argFile = process.argv.slice(1).find(isDoc);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    createWindow(argv.slice(1).find(isDoc));
  });
  app.whenReady().then(() => {
    serveApp();
    Menu.setApplicationMenu(null); // GuyCAD draws its own menu bar
    createWindow(argFile);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
