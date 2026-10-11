// Bundles the command-line tool (bin/pretendata.ts) into one Node script: `npm run build:cli`.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  // Everything is bundled in, Faker included. The same seed must give the same bytes wherever the
  // command is installed, and a dependency range would let an installer pick a newer Faker with
  // different names and different output. The published package therefore has no dependencies.
  ssr: { noExternal: true },
  build: { ssr: 'bin/pretendata.ts', outDir: 'dist-cli' },
});
