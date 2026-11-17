// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clientLog,
  installGlobalClientErrorHandlers,
  reportClientError,
  setClientLogLevel,
} from './clientDiagnostics';

afterEach(() => {
  vi.restoreAllMocks();
  setClientLogLevel(undefined);
});

describe('client diagnostics', () => {
  it('redacts sensitive URL details and deduplicates the same error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('request failed: Bearer secret-token https://tiles.example.test/planet?token=secret');

    reportClientError(error, {
      event: 'test.map_error',
      area: 'map',
      operation: 'tile-load',
      url: '/v1/external/basemap/openfreemap/planet/1/2/3.pbf?token=secret',
      severity: 'error',
    });
    reportClientError(error, {
      event: 'test.map_error_duplicate',
      area: 'map',
      operation: 'tile-load',
      severity: 'error',
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const record = consoleError.mock.calls[0]?.[1] as {
      url?: string;
      error?: { message?: string };
    };
    expect(record.url).toBe('/v1/external/basemap/openfreemap/planet/<tile>.pbf');
    expect(record.error?.message).not.toContain('secret-token');
    expect(record.error?.message).not.toContain('token=secret');
  });

  it('captures uncaught browser errors and supports cleanup', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cleanup = installGlobalClientErrorHandlers();

    const errorEvent = new ErrorEvent('error', {
      error: new Error('uncaught browser failure'),
      filename: 'https://app.example.test/app.js?token=secret',
    });
    const preventDefault = vi.spyOn(errorEvent, 'preventDefault');
    window.dispatchEvent(errorEvent);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[riviamigo][ERROR] browser: browser.error error="Error: uncaught browser failure"'),
      expect.objectContaining({ event: 'browser.error', area: 'browser' }),
    );
    expect(preventDefault).toHaveBeenCalled();

    cleanup();
  });

  it('suppresses raw unhandled rejection output after reporting it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cleanup = installGlobalClientErrorHandlers();
    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'reason', { value: new Error('uncaught rejection') });
    const preventDefault = vi.spyOn(rejectionEvent, 'preventDefault');

    window.dispatchEvent(rejectionEvent);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[riviamigo][ERROR] browser: browser.unhandled_rejection error="Error: uncaught rejection"'),
      expect.objectContaining({ event: 'browser.unhandled_rejection', area: 'browser' }),
    );
    expect(preventDefault).toHaveBeenCalled();

    cleanup();
  });

  describe('leveled logging', () => {
    it('hides debug and trace at the default level and shows them when raised', () => {
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

      clientLog.info('auth', 'signed in');
      clientLog.debug('auth', 'session checked');
      clientLog.trace('live', 'frame received');
      expect(info).toHaveBeenCalledWith('[riviamigo][INFO] auth: signed in');
      expect(debug).not.toHaveBeenCalled();

      setClientLogLevel('trace');
      clientLog.debug('auth', 'session checked');
      clientLog.trace('live', 'frame received');
      expect(debug).toHaveBeenCalledTimes(2);
    });

    it('filters warnings out when the level is error', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setClientLogLevel('error');
      clientLog.warn('api', 'slow response');
      clientLog.error('api', 'request failed');
      expect(warn).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('drops sensitive fields, shortens ids, and keeps the request id whole', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const id = '123e4567-e89b-12d3-a456-426614174000';
      clientLog.info('api', 'request completed', {
        status: 200,
        vehicle_id: id,
        request_id: id,
        email: 'a@example.test',
        token: 'abc',
        reason: 'not modified',
        missing: undefined,
      });
      expect(info).toHaveBeenCalledWith(
        `[riviamigo][INFO] api: request completed status=200 vehicle_id=123e4567… request_id=${id} reason="not modified"`,
      );
    });
  });
});
