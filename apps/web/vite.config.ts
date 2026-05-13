/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
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
      '@riviamigo/hooks': path.resolve(__dirname, '../../packages/hooks/src/index.ts'),
      '@riviamigo/config/typescript/react.json': path.resolve(__dirname, '../../packages/config/typescript/react.json'),
    },
  },
  server: {
    host: '0.0.0.0',
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
          'router':       ['@tanstack/react-router'],
          'query':        ['@tanstack/react-query'],
        },
      },
    },
  },
});
