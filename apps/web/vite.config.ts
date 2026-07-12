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
      thresholds: {
        // Keep the gate just below the current route/component aggregate. The
        // suite intentionally includes browser-only route shells and settings
        // branches that are covered by E2E rather than jsdom unit tests.
        statements: 69,
        branches: 55,
        functions: 50,
        lines: 69,
      },
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
        target: process.env.VITE_API_URL ?? process.env.VITE_RIVIAMIGO_API_BASE_URL ?? 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (error) => {
            const code = (error as NodeJS.ErrnoException).code;
            // During refresh/reconnect churn, backend-closed sockets can
            // produce noisy ECONNRESET events that are expected in dev.
            if (code === 'ECONNRESET') return;
            console.error('[vite] ws proxy error:', error);
          });
        },
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
