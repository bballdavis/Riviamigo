import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  getAppVersion: vi.fn(),
  getUpdateCheckSettings: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({
  api: hookMocks,
  queryKeys: {
    appVersion: { current: ['app-version'] },
    updateCheck: { current: ['update-check-settings'] },
  },
}));

import { useGithubReleaseCheck } from '../useGithubReleaseCheck';
import { writeReleaseCheckSnapshot } from '../../lib/releaseCheck';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useGithubReleaseCheck', () => {
  beforeEach(() => {
    localStorage.clear();
    hookMocks.getAppVersion.mockReset().mockResolvedValue({ version: '2026.09.4+dev' });
    hookMocks.getUpdateCheckSettings.mockReset().mockResolvedValue({ enabled: false, frequency: 'daily' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not contact GitHub while checks are disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGithubReleaseCheck(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not contact GitHub again before the selected interval is due', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    hookMocks.getUpdateCheckSettings.mockResolvedValue({ enabled: true, frequency: 'daily' });
    writeReleaseCheckSnapshot({
      lastAttemptAt: Date.now() - 1000,
      lastSuccessfulAt: Date.now() - 1000,
      latestVersion: '2026.10.1',
      updateAvailable: true,
      error: null,
    });
    const { result } = renderHook(() => useGithubReleaseCheck(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    expect(result.current.updateAvailable).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the stable endpoint when due and reports the newer version', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: '2026.10.1', draft: false, prerelease: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    hookMocks.getUpdateCheckSettings.mockResolvedValue({ enabled: true, frequency: 'daily' });
    const { result } = renderHook(() => useGithubReleaseCheck(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.status.latestVersion).toBe('2026.10.1'));
    expect(result.current.updateAvailable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/bballdavis/Riviamigo/releases/latest');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('keeps the previous update result after a failed or rate-limited request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    hookMocks.getUpdateCheckSettings.mockResolvedValue({ enabled: true, frequency: 'daily' });
    writeReleaseCheckSnapshot({
      lastAttemptAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      lastSuccessfulAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      latestVersion: '2026.10.1',
      updateAvailable: true,
      error: null,
    });
    const { result } = renderHook(() => useGithubReleaseCheck(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.status.error).toContain('HTTP 403'));
    expect(result.current.updateAvailable).toBe(true);
    expect(result.current.status.updateAvailable).not.toBe(false);
  });
});
