// Bundles the command-line tool (bin/pretendata.ts) into one Node script: `npm run build:cli`.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: { ssr: 'bin/pretendata.ts', outDir: 'dist-cli' },
});
