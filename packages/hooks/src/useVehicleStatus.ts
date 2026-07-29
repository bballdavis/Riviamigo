import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { VehicleStatus } from '@riviamigo/types';
import { api } from './api';
import { useAuthReady } from './useAuthState';

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

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 60_000;
const CLIENT_LIVENESS_TIMEOUT_MS = 90_000;
const CLIENT_LIVENESS_CHECK_INTERVAL_MS = 30_000;
const PROBE_RESPONSE_TIMEOUT_MS = 10_000;
const LIVE_PROBE_MESSAGE = JSON.stringify({ type: 'probe' });

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
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const livenessIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const probeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backoffRef = useRef(1000);
  const reconnectAttemptsRef = useRef(0);
  const connectionKeyRef = useRef<string | null>(null);
  const shouldReconnectRef = useRef(true);
  const socketCreatedAtRef = useRef<number | null>(null);
  const socketOpenedAtRef = useRef<number | null>(null);
  const lastMessageAtRef = useRef<number | null>(null);
  const setStatus = useLiveStatusStore((s) => s.setStatus);
  const setConnected = useLiveStatusStore((s) => s.setConnected);
  const [connectionState, setConnectionState] = useState<VehicleConnectionState>('idle');

  const clearProbeTimeout = useCallback(() => {
    clearTimeout(probeTimeoutRef.current);
    probeTimeoutRef.current = undefined;
  }, []);

  const cleanupSocket = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimeout(reconnectRef.current);
    reconnectRef.current = undefined;
    clearProbeTimeout();
    socketCreatedAtRef.current = null;
    socketOpenedAtRef.current = null;
    lastMessageAtRef.current = null;
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
  }, [clearProbeTimeout]);

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
      `${getWebSocketBaseUrl()}/v1/vehicles/live?vehicle_id=${vehicleId}`,
      ['bearer', `bearer.${accessToken}`]
    );
    wsRef.current = ws;
    socketCreatedAtRef.current = Date.now();
    socketOpenedAtRef.current = null;
    lastMessageAtRef.current = null;
    setConnectionState('connecting');

    ws.onopen = () => {
      backoffRef.current = 1000;
      reconnectAttemptsRef.current = 0;
      socketOpenedAtRef.current = Date.now();
      lastMessageAtRef.current = null;
      setConnected(vehicleId, false);
      setConnectionState('connecting');
      clearProbeTimeout();
      try {
        ws.send(LIVE_PROBE_MESSAGE);
        probeTimeoutRef.current = setTimeout(() => {
          if (wsRef.current !== ws) return;
          setConnected(vehicleId, false);
          setConnectionState('connecting');
          ws.close();
        }, PROBE_RESPONSE_TIMEOUT_MS);
      } catch {
        ws.close();
      }
    };

    ws.onmessage = (evt) => {
      lastMessageAtRef.current = Date.now();
      clearProbeTimeout();
      setConnected(vehicleId, true);
      setConnectionState('online');
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
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      clearProbeTimeout();
      socketCreatedAtRef.current = null;
      socketOpenedAtRef.current = null;
      lastMessageAtRef.current = null;
      setConnected(vehicleId, false);
      if (!shouldReconnectRef.current) {
        setConnectionState('idle');
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setConnectionState('connecting');
        return;
      }

      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        // Signal persistent failure so the UI can show a warning, but keep
        // retrying at the max-backoff interval rather than giving up forever.
        // The user should not have to reload the page to recover from a flaky
        // network; the hook will silently recover once the server is reachable.
        setConnectionState('failed');
      } else {
        setConnectionState('connecting');
      }
      reconnectRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_RECONNECT_DELAY_MS);
        connect();
      }, backoffRef.current);
    };

    ws.onerror = () => ws.close();
  }, [
    accessToken,
    clearProbeTimeout,
    setConnected,
    setStatus,
    vehicleId,
  ]);

  const forceReconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    clearProbeTimeout();
    const ws = wsRef.current;
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      wsRef.current = null;
      connect();
      return;
    }
    if (ws.readyState === WebSocket.CLOSING) return;
    if (vehicleId) setConnected(vehicleId, false);
    setConnectionState('connecting');
    ws.close();
  }, [clearProbeTimeout, connect, setConnected, vehicleId]);

  const sendProbe = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;

    clearProbeTimeout();
    try {
      ws.send(LIVE_PROBE_MESSAGE);
      probeTimeoutRef.current = setTimeout(() => {
        if (wsRef.current !== ws) return;
        if (vehicleId) setConnected(vehicleId, false);
        setConnectionState('connecting');
        ws.close();
      }, PROBE_RESPONSE_TIMEOUT_MS);
      return true;
    } catch {
      forceReconnect();
      return false;
    }
  }, [clearProbeTimeout, forceReconnect, setConnected, vehicleId]);

  useEffect(() => {
    const connectionKey = vehicleId && accessToken ? `${vehicleId}:${accessToken}` : null;
    if (connectionKeyRef.current !== connectionKey) {
      connectionKeyRef.current = connectionKey;
      reconnectAttemptsRef.current = 0;
      backoffRef.current = 1000;
    }

    connect();

    const handleWake = () => {
      if (
        !shouldReconnectRef.current ||
        !vehicleId ||
        !accessToken ||
        (typeof navigator !== 'undefined' && navigator.onLine === false)
      ) return;

      backoffRef.current = 1000;
      reconnectAttemptsRef.current = 0;
      const ws = wsRef.current;
      if (!ws) {
        connect();
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        const lastMessageAt = lastMessageAtRef.current;
        if (
          lastMessageAt === null ||
          Date.now() - lastMessageAt >= CLIENT_LIVENESS_TIMEOUT_MS
        ) {
          forceReconnect();
          return;
        }
        sendProbe();
        return;
      }

      if (
        ws.readyState === WebSocket.CONNECTING &&
        socketCreatedAtRef.current !== null &&
        Date.now() - socketCreatedAtRef.current >= PROBE_RESPONSE_TIMEOUT_MS
      ) {
        forceReconnect();
      }
    };

    const handleOffline = () => {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = undefined;
      if (vehicleId) setConnected(vehicleId, false);
      setConnectionState('connecting');
      const ws = wsRef.current;
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleWake();
    };

    const checkLiveness = () => {
      if (document.visibilityState !== 'visible') return;
      const ws = wsRef.current;
      if (!ws) {
        if (!reconnectRef.current) connect();
        return;
      }

      const referenceTime = lastMessageAtRef.current ?? socketOpenedAtRef.current;
      if (referenceTime !== null && Date.now() - referenceTime >= CLIENT_LIVENESS_TIMEOUT_MS) {
        forceReconnect();
      }
    };

    window.addEventListener('online', handleWake);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleWake);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    livenessIntervalRef.current = setInterval(checkLiveness, CLIENT_LIVENESS_CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleWake);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleWake);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(livenessIntervalRef.current);
      livenessIntervalRef.current = undefined;
      cleanupSocket();
    };
  }, [
    accessToken,
    cleanupSocket,
    connect,
    forceReconnect,
    sendProbe,
    setConnected,
    vehicleId,
  ]);

  const status = useLiveStatusStore((s) => (vehicleId ? s.status[vehicleId] : null));
  const connected = useLiveStatusStore((s) => (vehicleId ? s.connected[vehicleId] ?? false : false));

  return { status: status ?? null, connected, connectionState };
}

export function useCurrentVehicleStatus(vehicleId: string | null) {
  const liveStatus = useLiveStatusStore((s) => (vehicleId ? s.status[vehicleId] : null));
  const authReady = useAuthReady();

  const query = useQuery({
    queryKey: ['vehicles', 'status', vehicleId],
    queryFn: () => api.vehicleStatus(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: 'always',
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
      if (!isLoopbackTarget) {
        return url.toString().replace(/^https?/, (m) => m === 'https' ? 'wss' : 'ws').replace(/\/$/, '');
      }
    } catch {
      return configuredBaseUrl.replace(/^https?/, (m) => m === 'https' ? 'wss' : 'ws').replace(/\/$/, '');
    }
  }

  return location.origin.replace(/^https?/, (m) => m === 'https' ? 'wss' : 'ws');
}
