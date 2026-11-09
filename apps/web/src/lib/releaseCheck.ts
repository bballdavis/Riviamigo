export const RELEASES_URL = 'https://github.com/bballdavis/Riviamigo/releases';
export const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/bballdavis/Riviamigo/releases/latest';
export const RELEASE_CHECK_STORAGE_KEY = 'rm-github-release-check-v1';
export const RELEASE_CHECK_STATUS_EVENT = 'rm-github-release-status-change';

export const UPDATE_CHECK_INTERVALS_MS = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export interface ReleaseCheckSnapshot {
  lastAttemptAt: number | null;
  lastSuccessfulAt: number | null;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  error: string | null;
}

export interface ReleaseCheckStatus extends ReleaseCheckSnapshot {
  checking: boolean;
}

export const EMPTY_RELEASE_CHECK: ReleaseCheckSnapshot = {
  lastAttemptAt: null,
  lastSuccessfulAt: null,
  latestVersion: null,
  updateAvailable: null,
  error: null,
};

function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d{4})\.(\d{1,2})\.(\d+)(?:\+dev(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(patch)) return null;
  if (month < 1 || month > 12 || patch < 0) return null;
  return [year, month, patch];
}

export function isNewerRelease(currentVersion: string, releaseTag: string): boolean {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(releaseTag);
  if (!current || !latest) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (latest[index]! !== current[index]!) return latest[index]! > current[index]!;
  }
  return false;
}

export function isReleaseCheckDue(
  lastAttemptAt: number | null,
  frequency: keyof typeof UPDATE_CHECK_INTERVALS_MS,
  now = Date.now(),
): boolean {
  return lastAttemptAt === null || now - lastAttemptAt >= UPDATE_CHECK_INTERVALS_MS[frequency];
}

export function readReleaseCheckSnapshot(storage?: Storage): ReleaseCheckSnapshot {
  try {
    const raw = (storage ?? window.localStorage).getItem(RELEASE_CHECK_STORAGE_KEY);
    if (!raw) return { ...EMPTY_RELEASE_CHECK };
    const value = JSON.parse(raw) as Partial<ReleaseCheckSnapshot>;
    return {
      lastAttemptAt: typeof value.lastAttemptAt === 'number' && Number.isFinite(value.lastAttemptAt)
        ? value.lastAttemptAt
        : null,
      lastSuccessfulAt: typeof value.lastSuccessfulAt === 'number' && Number.isFinite(value.lastSuccessfulAt)
        ? value.lastSuccessfulAt
        : null,
      latestVersion: typeof value.latestVersion === 'string' ? value.latestVersion : null,
      updateAvailable: typeof value.updateAvailable === 'boolean' ? value.updateAvailable : null,
      error: typeof value.error === 'string' ? value.error : null,
    };
  } catch {
    return { ...EMPTY_RELEASE_CHECK };
  }
}

export function writeReleaseCheckSnapshot(
  snapshot: ReleaseCheckSnapshot,
  storage?: Storage,
): void {
  try {
    (storage ?? window.localStorage).setItem(RELEASE_CHECK_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Retain the in-memory status update below if browser storage is unavailable.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(RELEASE_CHECK_STATUS_EVENT));
  }
}

export async function fetchLatestStableRelease(fetcher: typeof fetch = fetch): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(LATEST_RELEASE_API_URL, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const payload = await response.json() as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
    if (
      typeof payload.draft !== 'boolean' ||
      typeof payload.prerelease !== 'boolean' ||
      payload.draft ||
      payload.prerelease ||
      typeof payload.tag_name !== 'string'
    ) {
      throw new Error('GitHub returned an invalid stable release response.');
    }
    const version = payload.tag_name.trim();
    if (!parseVersion(version) || version.includes('+')) {
      throw new Error('GitHub returned an invalid stable release version.');
    }
    return version;
  } finally {
    window.clearTimeout(timeout);
  }
}
