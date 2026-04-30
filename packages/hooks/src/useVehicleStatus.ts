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
        const message = JSON.parse(evt.data as string) as VehicleStatus | { type?: string; ts?: string; data?: Partial<VehicleStatus> };
        const data = 'data' in message && message.data
          ? {
              vehicle_id: vehicleId,
              is_online: true,
              last_updated: message.ts ?? new Date().toISOString(),
              ...message.data,
              range_miles: message.data.range_miles ?? (message.data as { distance_to_empty_mi?: number | null }).distance_to_empty_mi,
            } as VehicleStatus
          : message as VehicleStatus;
        setStatus(vehicleId, data);
      } catch {}
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnected(vehicleId, false);
      if (!shouldReconnectRef.current) {
        setConnectionState('idle');
        return;
      }

      reconnectAttemptsRef.current += 1;
      setConnectionState(reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS ? 'failed' : 'connecting');
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
  const setStatus = useLiveStatusStore((s) => s.setStatus);

  const query = useQuery({
    queryKey: ['vehicles', 'status', vehicleId],
    queryFn: () => api.vehicleStatus(vehicleId!),
    enabled: !!vehicleId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    initialData: liveStatus ?? undefined,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (vehicleId && query.data) {
      setStatus(vehicleId, query.data);
    }
  }, [vehicleId, query.data, setStatus]);

  return { ...query, data: liveStatus ?? query.data ?? null };
}

function getWebSocketBaseUrl() {
  if (typeof window === 'undefined') return 'ws://localhost:3001';

  const env = import.meta as { env?: { VITE_WS_URL?: string; VITE_API_URL?: string } };
  const configured = env.env?.VITE_WS_URL ?? env.env?.VITE_API_URL;
  if (configured) return configured.replace(/^http/, 'ws').replace(/\/$/, '');

  return window.location.origin.replace(/^http/, 'ws');
}
