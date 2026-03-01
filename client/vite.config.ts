import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    sourcemap: false
  },
  server: {
    host: true,
    port: 5173
  }
});
