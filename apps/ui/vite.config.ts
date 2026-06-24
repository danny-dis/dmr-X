import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    loader: 'tsx',
    include: /.*\.tsx?$/,
    target: 'es2022',
  },
  build: {
    target: 'es2022',
    outDir: '../gateway/public',
    emptyOutDir: true,
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4200,
    host: true,
    proxy: {
      '/v1': {
        target: process.env.VITE_GATEWAY_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_GATEWAY_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/healthz': {
        target: process.env.VITE_GATEWAY_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ready': {
        target: process.env.VITE_GATEWAY_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/livez': {
        target: process.env.VITE_GATEWAY_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
