import { defineConfig } from 'vite';

export default defineConfig({
  base: '/gym-tracker/',
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
});