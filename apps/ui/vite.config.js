import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
    plugins: [react()],
    esbuild: {
        loader: 'tsx',
        include: /.*\.tsx?$/,
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
        },
    },
});
//# sourceMappingURL=vite.config.js.map