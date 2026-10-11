import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev: forward API calls to the optional Hono server (npm run server).
    proxy: { '/api': 'http://localhost:8787' },
  },
});
