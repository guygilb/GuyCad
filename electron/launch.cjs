// Starts the desktop app. Clears ELECTRON_RUN_AS_NODE, which VS Code sets in its terminals
// and which would make Electron behave like plain Node instead of opening a window.
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
