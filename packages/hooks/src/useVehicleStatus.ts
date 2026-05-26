import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { VehicleStatus } from '@riviamigo/types';
import { api } from './api';

interface LiveStatusStore {
  status: Record<string, VehicleStatus>;
  connected: Record<string, boolean>;
  setStatus: (vehicleId: string, status: Partial<VehicleStatus>) => void;
  setConnected: (vehicleId: string, connected: boolean) => void;
}

type VehicleConnectionState = 'idle' | 'connecting' | 'online' | 'failed';

export const useLiveStatusStore = create<LiveStatusStore>((set) => ({
  status: {},
  connected: {},
  setStatus: (vehicleId, status) =>
    set((s) => ({
      status: {
        ...s.status,
        [vehicleId]: { ...s.status[vehicleId], ...status } as VehicleStatus,
      },
    })),
  setConnected: (vehicleId, connected) =>
    set((s) => ({ connected: { ...s.connected, [vehicleId]: connected } })),
}));

const BASE_WS = getWebSocketBaseUrl();

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 60_000;

// ---------------------------------------------------------------------------
// WS debug logger — enable in the browser console:
//   localStorage.setItem('rm-ws-debug', '1'); location.reload()
//   localStorage.removeItem('rm-ws-debug');    location.reload()
// ---------------------------------------------------------------------------

function isWsDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('rm-ws-debug') === '1';
  } catch {
    return false;
  }
}

function wsDebugLog(
  vehicleId: string,
  messageType: 'partial' | 'snapshot' | 'ignored',
  raw: unknown,
  patch: Partial<VehicleStatus> | null,
): void {
  if (!isWsDebug()) return;
  const existing = useLiveStatusStore.getState().status[vehicleId];
  const dropouts: string[] = [];
  if (patch && existing) {
    const existingFields = existing as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      const prev = existingFields[k];
      if (prev !== null && prev !== undefined && (v === null || v === undefined)) {
        dropouts.push(`${k}: ${JSON.stringify(prev)} → ${String(v)}`);
      }
    }
  }
  console.group(`[WS ${vehicleId}] ${messageType} @ ${new Date().toISOString()}`);
  console.log('raw   :', raw);
  console.log('patch :', patch);
  if (dropouts.length > 0) console.warn('would-dropout:', dropouts);
  console.groupEnd();
}

// ---------------------------------------------------------------------------
// Strips null/undefined values from a partial WS update so they don't
// overwrite previously-good sensor readings in the store. The WS server
// sends explicit nulls for fields it doesn't have in a given message;
// we treat "null in a partial update" as "not present in this message".
// Full status snapshots (vehicle_id present) are NOT filtered — nulls in a
// snapshot are intentional and mean the field is genuinely unknown.
// ---------------------------------------------------------------------------

function stripNullsFromPatch(
  raw: Partial<VehicleStatus> & { distance_to_empty_mi?: number | null },
): Partial<VehicleStatus> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== null && v !== undefined) patch[k] = v;
  }
  // range_miles alias from some server implementations
  if (patch.range_miles === undefined && raw.distance_to_empty_mi != null) {
    patch.range_miles = raw.distance_to_empty_mi;
  }
  return patch as Partial<VehicleStatus>;
}

export function useVehicleStatus(vehicleId: string | null, accessToken: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const backoffRef = useRef(1000);
  const reconnectAttemptsRef = useRef(0);
  const connectionKeyRef = useRef<string | null>(null);
  const shouldReconnectRef = useRef(true);
  const { setStatus, setConnected } = useLiveStatusStore();
  const [connectionState, setConnectionState] = useState<VehicleConnectionState>('idle');

  const cleanupSocket = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimeout(reconnectRef.current);
    reconnectRef.current = undefined;
    if (wsRef.current) {
      const ws = wsRef.current;
      // Null out handlers before close so stale async onclose events can't
      // fire after shouldReconnectRef has been reset by a subsequent connect()
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      wsRef.current = null;
      ws.close();
    }
  }, []);

  const connect = useCallback(() => {
    if (!vehicleId || !accessToken) {
      setConnectionState('idle');
      if (vehicleId) setConnected(vehicleId, false);
      return;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    clearTimeout(reconnectRef.current);
    reconnectRef.current = undefined;
    shouldReconnectRef.current = true;
    const ws = new WebSocket(
      `${BASE_WS}/v1/vehicles/live?vehicle_id=${vehicleId}`,
      ['bearer', `bearer.${accessToken}`]
    );
    wsRef.current = ws;
    setConnectionState('connecting');

    ws.onopen = () => {
      backoffRef.current = 1000;
      reconnectAttemptsRef.current = 0;
      setConnected(vehicleId, true);
      setConnectionState('online');
    };

    ws.onmessage = (evt) => {
      try {
        const message = JSON.parse(evt.data as string) as
          | VehicleStatus
          | { type?: string; ts?: string; data?: Partial<VehicleStatus> };

        if ('data' in message && message.data) {
          // Partial update from the server. Strip null/undefined values so they
          // don't overwrite previously-good sensor readings — the server sends
          // explicit nulls for fields absent in this particular message batch.
          const patch = stripNullsFromPatch(
            message.data as Partial<VehicleStatus> & { distance_to_empty_mi?: number | null },
          );
          const data: VehicleStatus = {
            vehicle_id: vehicleId,
            is_online: true,
            last_updated: message.ts ?? new Date().toISOString(),
            ...patch,
          } as VehicleStatus;
          wsDebugLog(vehicleId, 'partial', message, data);
          setStatus(vehicleId, data);
        } else if ('vehicle_id' in message) {
          // Full status snapshot — nulls here are intentional.
          wsDebugLog(vehicleId, 'snapshot', message, message as VehicleStatus);
          setStatus(vehicleId, message as VehicleStatus);
        } else {
          // Heartbeat / control frame — ignore.
          wsDebugLog(vehicleId, 'ignored', message, null);
        }
      } catch (err) {
        console.warn('[WS] message parse error', err);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnected(vehicleId, false);
      if (!shouldReconnectRef.current) {
        setConnectionState('idle');
        return;
      }

      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('failed');
        return;
      }
      setConnectionState('connecting');
      reconnectRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_RECONNECT_DELAY_MS);
        connect();
      }, backoffRef.current);
    };

    ws.onerror = () => ws.close();
  }, [vehicleId, accessToken, setStatus, setConnected]);

  useEffect(() => {
    const connectionKey = vehicleId && accessToken ? `${vehicleId}:${accessToken}` : null;
    if (connectionKeyRef.current !== connectionKey) {
      connectionKeyRef.current = connectionKey;
      reconnectAttemptsRef.current = 0;
      backoffRef.current = 1000;
    }

    connect();

    const handleWake = () => {
      if (!shouldReconnectRef.current || !vehicleId || !accessToken || wsRef.current) return;
      backoffRef.current = 1000;
      reconnectAttemptsRef.current = 0;
      connect();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleWake();
    };

    window.addEventListener('online', handleWake);
    window.addEventListener('focus', handleWake);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleWake);
      window.removeEventListener('focus', handleWake);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupSocket();
    };
  }, [vehicleId, accessToken, connect, cleanupSocket]);

  const status = useLiveStatusStore((s) => (vehicleId ? s.status[vehicleId] : null));
  const connected = useLiveStatusStore((s) => (vehicleId ? s.connected[vehicleId] ?? false : false));

  return { status: status ?? null, connected, connectionState };
}

export function useCurrentVehicleStatus(vehicleId: string | null) {
  const liveStatus = useLiveStatusStore((s) => (vehicleId ? s.status[vehicleId] : null));

  const query = useQuery({
    queryKey: ['vehicles', 'status', vehicleId],
    queryFn: () => api.vehicleStatus(vehicleId!),
    enabled: !!vehicleId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  const data = mergeVehicleStatus(query.data ?? null, liveStatus ?? null);

  return { ...query, data };
}

function mergeVehicleStatus(
  storedStatus: VehicleStatus | null,
  liveStatus: VehicleStatus | null,
): VehicleStatus | null {
  if (storedStatus && liveStatus) {
    const storedTime = statusTimestampMs(storedStatus);
    const liveTime = statusTimestampMs(liveStatus);
    const liveIsNewest = liveTime !== null && (storedTime === null || liveTime >= storedTime);
    const base = liveIsNewest ? storedStatus : liveStatus;
    const preferred = liveIsNewest ? liveStatus : storedStatus;

    return mergeDefinedStatus(base, preferred);
  }

  return liveStatus ?? storedStatus ?? null;
}

function mergeDefinedStatus(base: VehicleStatus, preferred: VehicleStatus): VehicleStatus {
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(preferred)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as unknown as VehicleStatus;
}

function statusTimestampMs(status: VehicleStatus): number | null {
  const timestamp = status.last_updated ?? status.last_event_at;
  if (!timestamp) return null;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? value : null;
}

export function getWebSocketBaseUrl(
  configuredBaseUrl = (() => {
    const env = import.meta as { env?: { VITE_WS_URL?: string; VITE_API_URL?: string; VITE_RIVIAMIGO_API_BASE_URL?: string } };
    return env.env?.VITE_WS_URL ?? env.env?.VITE_API_URL ?? env.env?.VITE_RIVIAMIGO_API_BASE_URL;
  })(),
  location: Pick<Location, 'hostname' | 'origin'> | undefined = typeof window === 'undefined' ? undefined : window.location,
) {
  if (!location) return 'ws://localhost:3001';

  if (configuredBaseUrl) {
    try {
      const url = new URL(configuredBaseUrl, location.origin);
      const isLoopbackTarget = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
      const isLoopbackViewer = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
      if (!isLoopbackTarget || isLoopbackViewer) {
        return url.toString().replace(/^http/, 'ws').replace(/\/$/, '');
      }
    } catch {
      return configuredBaseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    }
  }

  return location.origin.replace(/^http/, 'ws');
}
