import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '../../../../packages/hooks/src/api';
import { getWebSocketBaseUrl } from '../../../../packages/hooks/src/useVehicleStatus';

describe('network proxy URL resolution', () => {
  it('proxies both supported versioned REST roots in local and packaged deployments', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const nginxConfig = readFileSync(resolve(process.cwd(), '../../compose/nginx/nginx.conf'), 'utf8');

    expect(viteConfig).toMatch(/['"]\/v1['"]\s*:/);
    expect(viteConfig).toMatch(/['"]\/v2['"]\s*:/);
    expect(nginxConfig).toMatch(/location\s+\^~\s+\/v1\//);
    expect(nginxConfig).toMatch(/location\s+\^~\s+\/v2\//);
  });

  it('keeps the SPA shell uncached and only caches existing Vite assets immutably', () => {
    const nginxConfig = readFileSync(resolve(process.cwd(), '../../compose/nginx/nginx.conf'), 'utf8');

    expect(nginxConfig).toMatch(
      /location\s+\^~\s+\/assets\/\s*\{[\s\S]*?try_files\s+\$uri\s+=404;[\s\S]*?expires\s+1y;[\s\S]*?add_header\s+Cache-Control\s+"public, max-age=31536000, immutable";/,
    );
    expect(nginxConfig).toMatch(
      /location\s+=\s+\/index\.html\s*\{[\s\S]*?try_files\s+\$uri\s+=404;[\s\S]*?expires\s+off;[\s\S]*?add_header\s+Cache-Control\s+"no-store, no-cache, must-revalidate";/,
    );
    expect(nginxConfig).toMatch(
      /location\s+\/\s*\{[\s\S]*?try_files\s+\$uri\s+\$uri\/\s+\/index\.html;[\s\S]*?add_header\s+Cache-Control\s+"no-store, no-cache, must-revalidate";/,
    );
    expect(nginxConfig).toMatch(
      /location\s+\^~\s+\/vehicle-images\/fallbacks\/\s*\{[\s\S]*?expires\s+1d;[\s\S]*?add_header\s+Cache-Control\s+"public, max-age=86400";/,
    );
    expect(nginxConfig).not.toMatch(/location\s+~\*\s+\\\.\(js\|css\|woff2\?/);
  });

  it('keeps REST calls same-origin for localhost browsers when VITE_API_URL targets localhost', () => {
    const baseUrl = resolveApiBaseUrl('http://localhost:3001', {
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    });

    expect(baseUrl).toBe('');
  });

  it('keeps REST calls same-origin for remote browsers when VITE_API_URL targets localhost', () => {
    const baseUrl = resolveApiBaseUrl('http://localhost:3001', {
      hostname: '192.168.1.25',
      origin: 'http://192.168.1.25:5173',
    });

    expect(baseUrl).toBe('');
  });

  it('keeps websocket calls same-origin for remote browsers when VITE_WS_URL targets localhost', () => {
    const baseUrl = getWebSocketBaseUrl('http://localhost:3001', {
      hostname: '192.168.1.25',
      origin: 'http://192.168.1.25:5173',
    });

    expect(baseUrl).toBe('ws://192.168.1.25:5173');
  });

  it('keeps websocket calls same-origin for localhost browsers when VITE_WS_URL targets localhost', () => {
    const baseUrl = getWebSocketBaseUrl('http://localhost:3001', {
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    });

    expect(baseUrl).toBe('ws://localhost:5173');
  });

  it('preserves explicit non-loopback API targets', () => {
    const baseUrl = resolveApiBaseUrl('http://192.168.1.50:3001', {
      hostname: '192.168.1.25',
      origin: 'http://192.168.1.25:5173',
    });

    expect(baseUrl).toBe('http://192.168.1.50:3001');
  });

  it('supports VITE_RIVIAMIGO_API_BASE_URL for websocket calls', () => {
    const baseUrl = getWebSocketBaseUrl('http://api.riviamigo.test', {
      hostname: 'riviamigo.test',
      origin: 'https://riviamigo.test',
    });

    expect(baseUrl).toBe('ws://api.riviamigo.test');
  });
});
