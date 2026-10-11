// Builds the app for the single-file offline version: `npm run build:offline`.
// One bundle, the worker embedded in it, nothing from public/. scripts/inline-offline.ts then
// folds the bundle and the stylesheet into one HTML file.
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  publicDir: false,
  resolve: {
    // streaming.ts imports './workerFactory'; here that means the embedded-worker version.
    alias: [{ find: './workerFactory', replacement: fileURLToPath(new URL('./src/lib/workerFactory.inline.ts', import.meta.url)) }],
  },
  build: {
    outDir: 'dist-offline',
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
