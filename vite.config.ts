import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:4187', changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:4187', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
