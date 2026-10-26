// Exposes a minimal native file API to the app (no Node access in the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guycadNative', {
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  svgToPDF: (opts) => ipcRenderer.invoke('pdf:fromSVG', opts),
});
