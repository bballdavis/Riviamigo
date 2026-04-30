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

const BASE_WS =
  typeof window !== 'undefined'
    ? window.location.origin.replace(/^http/, 'ws')
    : 'ws://localhost:3001';

const MAX_RECONNECT_ATTEMPTS = 5;

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
      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('failed');
        return;
      }

      setConnectionState('connecting');
      reconnectRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 60_000);
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
    return () => {
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
    enabled: !!vehicleId && !liveStatus,
    staleTime: 30 * 1000,
    refetchInterval: liveStatus ? false : 60 * 1000,
    initialData: liveStatus ?? undefined,
  });

  return liveStatus ? { ...query, data: liveStatus } : query;
}
