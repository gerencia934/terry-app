import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// `--mode demo` empaqueta todo en un único HTML (prototipo publicable).
export default defineConfig(({ mode }) => ({
  base: './',
  resolve: { alias: { '@terraviva/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', assetsInlineLimit: mode === 'demo' ? 100_000_000 : 4096 },
}));
