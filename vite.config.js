import { defineConfig } from 'vite';

// Builds into dist/ with relative paths; the desktop app serves it through its own app:// protocol.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
});
