import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@riviamigo/hooks';
import type { UpdateCheckFrequency } from '@riviamigo/types';
import {
  RELEASE_CHECK_STATUS_EVENT,
  UPDATE_CHECK_INTERVALS_MS,
  fetchLatestStableRelease,
  isNewerRelease,
  isReleaseCheckDue,
  readReleaseCheckSnapshot,
  writeReleaseCheckSnapshot,
  type ReleaseCheckSnapshot,
  type ReleaseCheckStatus,
} from '../lib/releaseCheck';

let releaseCheckInProgress = false;

export function readReleaseCheckStatus(): ReleaseCheckStatus {
  return { ...readReleaseCheckSnapshot(), checking: releaseCheckInProgress };
}

export function useReleaseCheckStatus(): ReleaseCheckStatus {
  const [status, setStatus] = React.useState<ReleaseCheckStatus>(readReleaseCheckStatus);
  React.useEffect(() => {
    const refresh = () => setStatus(readReleaseCheckStatus());
    window.addEventListener(RELEASE_CHECK_STATUS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    refresh();
    return () => {
      window.removeEventListener(RELEASE_CHECK_STATUS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return status;
}

function snapshotForResult(
  now: number,
  latestVersion: string,
  currentVersion: string,
): ReleaseCheckSnapshot {
  return {
    lastAttemptAt: now,
    lastSuccessfulAt: now,
    latestVersion,
    updateAvailable: isNewerRelease(currentVersion, latestVersion),
    error: null,
  };
}

function frequencyInterval(frequency: UpdateCheckFrequency) {
  return UPDATE_CHECK_INTERVALS_MS[frequency];
}

export function useGithubReleaseCheck() {
  const status = useReleaseCheckStatus();
  const checkingRef = React.useRef(false);
  const settings = useQuery({
    queryKey: queryKeys.updateCheck.current,
    queryFn: () => api.getUpdateCheckSettings(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const version = useQuery({
    queryKey: queryKeys.appVersion.current,
    queryFn: () => api.getAppVersion(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const enabled = settings.data?.enabled === true;
  const frequency = settings.data?.frequency ?? 'daily';
  const currentVersion = version.data?.version;

  React.useEffect(() => {
    if (!enabled || !currentVersion || currentVersion === 'unknown') return;
    let disposed = false;
    let timer: number | undefined;
    const interval = frequencyInterval(frequency);

    const scheduleNext = (snapshot = readReleaseCheckSnapshot()) => {
      if (disposed) return;
      const dueAt = snapshot.lastAttemptAt === null ? Date.now() : snapshot.lastAttemptAt + interval;
      timer = window.setTimeout(runIfDue, Math.max(250, dueAt - Date.now()));
    };

    const runIfDue = async () => {
      if (disposed || document.visibilityState === 'hidden') return;
      const previous = readReleaseCheckSnapshot();
      if (!isReleaseCheckDue(previous.lastAttemptAt, frequency)) {
        scheduleNext(previous);
        return;
      }
      if (checkingRef.current) return;
      checkingRef.current = true;
      releaseCheckInProgress = true;
      window.dispatchEvent(new Event(RELEASE_CHECK_STATUS_EVENT));
      const attemptedAt = Date.now();
      const attempted: ReleaseCheckSnapshot = { ...previous, lastAttemptAt: attemptedAt, error: null };
      writeReleaseCheckSnapshot(attempted);

      try {
        const latestVersion = await fetchLatestStableRelease();
        const result = snapshotForResult(attemptedAt, latestVersion, currentVersion);
        writeReleaseCheckSnapshot(result);
      } catch (error) {
        const result: ReleaseCheckSnapshot = {
          ...previous,
          lastAttemptAt: attemptedAt,
          error: error instanceof Error ? error.message : 'The GitHub release check failed.',
        };
        writeReleaseCheckSnapshot(result);
      } finally {
        checkingRef.current = false;
        releaseCheckInProgress = false;
        window.dispatchEvent(new Event(RELEASE_CHECK_STATUS_EVENT));
        if (!disposed) scheduleNext(readReleaseCheckSnapshot());
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void runIfDue();
    };
    void runIfDue();
    window.addEventListener('focus', checkWhenVisible);
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', checkWhenVisible);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, [currentVersion, enabled, frequency]);

  return {
    settings,
    version,
    status,
    updateAvailable: status.updateAvailable === true,
  };
}
