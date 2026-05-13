import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '../../../../packages/hooks/src/api';
import { getWebSocketBaseUrl } from '../../../../packages/hooks/src/useVehicleStatus';

describe('network proxy URL resolution', () => {
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

  it('preserves explicit non-loopback API targets', () => {
    const baseUrl = resolveApiBaseUrl('http://192.168.1.50:3001', {
      hostname: '192.168.1.25',
      origin: 'http://192.168.1.25:5173',
    });

    expect(baseUrl).toBe('http://192.168.1.50:3001');
  });
});