/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        css: false,
        exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/routes/**/*.tsx', 'src/components/**/*.tsx'],
        },
    },
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@riviamigo/dashboards': path.resolve(__dirname, '../../packages/dashboards/src/index.ts'),
            '@riviamigo/config/typescript/react.json': path.resolve(__dirname, '../../packages/config/typescript/react.json'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/v1': {
                target: process.env.VITE_API_URL ?? 'http://localhost:3001',
                changeOrigin: true,
                ws: true,
            },
        },
    },
    build: {
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom'],
                    'router': ['@tanstack/react-router'],
                    'query': ['@tanstack/react-query'],
                },
            },
        },
    },
});
