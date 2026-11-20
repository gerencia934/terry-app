import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pantallas del portal Terry-App. El servidor (/api/v1) son funciones de Cloudflare Pages (functions/ y servidor/).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: { port: 5175 },
});
