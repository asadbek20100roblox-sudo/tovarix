import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist-control', rollupOptions: { input: 'control.html' } },
});
