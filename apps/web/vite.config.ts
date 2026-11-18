import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode demo` empaqueta todo en un único HTML (prototipo publicable).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', assetsInlineLimit: mode === 'demo' ? 100_000_000 : 4096 },
}));
