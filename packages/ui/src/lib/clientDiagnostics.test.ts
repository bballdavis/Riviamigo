// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installGlobalClientErrorHandlers,
  reportClientError,
} from './clientDiagnostics';

afterEach(() => {
  vi.restoreAllMocks();
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
      '[Riviamigo client]',
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
      '[Riviamigo client]',
      expect.objectContaining({ event: 'browser.unhandled_rejection', area: 'browser' }),
    );
    expect(preventDefault).toHaveBeenCalled();

    cleanup();
  });
});
