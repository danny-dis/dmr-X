import type { Config } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default {
  plugins: [react()],
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
    },
  },
} satisfies Config;
