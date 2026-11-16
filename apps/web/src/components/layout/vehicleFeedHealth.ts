import type { VehicleOnlineState } from '@riviamigo/ui/primitives';

export interface FeedHealthStatus {
  auth_state?: string | null;
  auth_reason_code?: string | null;
  worker_health?: string | null;
  worker_health_msg?: string | null;
  telemetry_stale?: boolean;
  telemetry_stale_reason?: string | null;
}

const FEED_HEALTH_TOAST_COOLDOWN_MS = 15 * 60 * 1000;

export function getFeedHealthIssue(status?: FeedHealthStatus | null) {
  if (status?.auth_state === 'needs_reauth') {
    return {
      key: `needs_reauth:${status.auth_reason_code ?? 'unknown'}`,
      title: 'Rivian feed disconnected',
      message:
        status.worker_health_msg ??
        'Rivian credentials are missing or expired. Reconnect the vehicle from Settings → Vehicles.',
    };
  }
  if (
    status?.worker_health === 'error' ||
    status?.worker_health === 'stale' ||
    status?.worker_health === 'degraded'
  ) {
    return {
      key: `unhealthy:${status?.worker_health ?? 'unknown'}:${status?.telemetry_stale_reason ?? 'unknown'}`,
      title: 'Vehicle feed unhealthy',
      message:
        status?.worker_health_msg ??
        'Riviamigo is not receiving fresh vehicle telemetry. Open Health for collector details.',
    };
  }
  return null;
}

export function shouldEmitFeedHealthToast(storage: Storage, key: string, now = Date.now()) {
  const lastEmittedAt = Number(storage.getItem(key));
  if (Number.isFinite(lastEmittedAt) && now - lastEmittedAt < FEED_HEALTH_TOAST_COOLDOWN_MS) {
    return false;
  }
  storage.setItem(key, String(now));
  return true;
}

export function resolveVehicleOnlineState({
  liveVehicleId,
  vehicleSelectionReady,
  connectionState,
  connected,
  feedHealthIssue,
}: {
  liveVehicleId: string | null;
  vehicleSelectionReady: boolean;
  connectionState: string;
  connected: boolean;
  feedHealthIssue: ReturnType<typeof getFeedHealthIssue>;
}): VehicleOnlineState {
  if (!liveVehicleId) return 'offline';
  if (!vehicleSelectionReady) return 'connecting';
  // Browser-to-Riviamigo transport is the first boundary. A stale or failed
  // browser socket must not surface an old server-side feed error as if it
  // were the current connection state.
  if (!connected || connectionState === 'failed') return 'connecting';
  if (feedHealthIssue) return 'unhealthy';
  return 'online';
}
