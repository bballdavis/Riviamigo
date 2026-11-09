import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_RELEASE_CHECK,
  LATEST_RELEASE_API_URL,
  RELEASE_CHECK_STORAGE_KEY,
  UPDATE_CHECK_INTERVALS_MS,
  fetchLatestStableRelease,
  isNewerRelease,
  isReleaseCheckDue,
  readReleaseCheckSnapshot,
  writeReleaseCheckSnapshot,
} from '../releaseCheck';

describe('GitHub release checks', () => {
  beforeEach(() => localStorage.clear());

  it('compares calendar releases and ignores the development build suffix', () => {
    expect(isNewerRelease('2026.09.4+dev', '2026.10.1')).toBe(true);
    expect(isNewerRelease('2026.09.4+dev', '2026.09.4')).toBe(false);
    expect(isNewerRelease('2026.09.4', '2026.09.3')).toBe(false);
    expect(isNewerRelease('unknown', '2026.10.1')).toBe(false);
    expect(isNewerRelease('2026.13.1', '2027.01.0')).toBe(false);
  });

  it('uses exact hourly, daily, weekly, and 30-day monthly intervals', () => {
    const now = 2_000_000;
    expect(UPDATE_CHECK_INTERVALS_MS.monthly).toBe(30 * 24 * 60 * 60 * 1000);
    expect(isReleaseCheckDue(null, 'daily', now)).toBe(true);
    expect(isReleaseCheckDue(now - UPDATE_CHECK_INTERVALS_MS.hourly, 'hourly', now)).toBe(true);
    expect(isReleaseCheckDue(now - UPDATE_CHECK_INTERVALS_MS.weekly + 1, 'weekly', now)).toBe(false);
    expect(isReleaseCheckDue(now - UPDATE_CHECK_INTERVALS_MS.monthly, 'monthly', now)).toBe(true);
  });

  it('stores only browser-local check time and result', () => {
    const result = {
      lastAttemptAt: 100,
      lastSuccessfulAt: 100,
      latestVersion: '2026.10.1',
      updateAvailable: true,
      error: null,
    };
    writeReleaseCheckSnapshot(result);
    expect(readReleaseCheckSnapshot()).toEqual(result);
    expect(Object.keys(JSON.parse(localStorage.getItem(RELEASE_CHECK_STORAGE_KEY) ?? '{}')).sort()).toEqual([
      'error', 'lastAttemptAt', 'lastSuccessfulAt', 'latestVersion', 'updateAvailable',
    ]);
    localStorage.removeItem(RELEASE_CHECK_STORAGE_KEY);
    expect(readReleaseCheckSnapshot()).toEqual(EMPTY_RELEASE_CHECK);
  });

  it('calls GitHub directly without browser credentials or a referrer', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: '2026.10.1', draft: false, prerelease: false }),
    }) as unknown as typeof fetch;

    await expect(fetchLatestStableRelease(fetcher)).resolves.toBe('2026.10.1');
    expect(fetcher).toHaveBeenCalledWith(LATEST_RELEASE_API_URL, expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    }));
  });

  it('rejects malformed responses, prereleases, and GitHub rate limiting', async () => {
    const malformed = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tag_name: 'latest', draft: false, prerelease: false }) });
    const prerelease = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tag_name: '2026.10.1', prerelease: true }) });
    const limited = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(fetchLatestStableRelease(malformed as unknown as typeof fetch)).rejects.toThrow(/invalid stable release version/i);
    await expect(fetchLatestStableRelease(prerelease as unknown as typeof fetch)).rejects.toThrow(/invalid stable release response/i);
    await expect(fetchLatestStableRelease(limited as unknown as typeof fetch)).rejects.toThrow('HTTP 403');
  });
});

describe('candidate build versions', () => {
  it('treats +dev.N as its base release', () => {
    expect(isNewerRelease('2026.10.1+dev.7', '2026.10.1')).toBe(false);
    expect(isNewerRelease('2026.10.1+dev.7', '2026.10.2')).toBe(true);
  });
});
