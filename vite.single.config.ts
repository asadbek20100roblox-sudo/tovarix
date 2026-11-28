import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  publicDir: false,
  plugins: [viteSingleFile()],
  build: {
    target: 'chrome103',
    outDir: 'dist-single',
    emptyOutDir: true,
    rollupOptions: { input: 'TOVARIX.html' },
  },
});
