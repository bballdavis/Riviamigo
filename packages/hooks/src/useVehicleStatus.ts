import { useEffect, useRef, useCallback, useState } from 'react';
import { create } from 'zustand';
import type { VehicleStatus } from '@riviamigo/types';

interface LiveStatusStore {
  status: Record<string, VehicleStatus>;
  connected: Record<string, boolean>;
  setStatus: (vehicleId: string, status: VehicleStatus) => void;
  setConnected: (vehicleId: string, connected: boolean) => void;
}

type VehicleConnectionState = 'idle' | 'connecting' | 'online' | 'failed';

export const useLiveStatusStore = create<LiveStatusStore>((set) => ({
  status: {},
  connected: {},
  setStatus: (vehicleId, status) =>
    set((s) => ({ status: { ...s.status, [vehicleId]: status } })),
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
  const shouldReconnectRef = useRef(true);
  const { setStatus, setConnected } = useLiveStatusStore();
  const [connectionState, setConnectionState] = useState<VehicleConnectionState>('idle');

  const cleanupSocket = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimeout(reconnectRef.current);
    reconnectRef.current = undefined;
    wsRef.current?.close();
    wsRef.current = null;
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
      [`bearer.${accessToken}`]
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
        const data = JSON.parse(evt.data as string) as VehicleStatus;
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
    connect();
    return () => {
      cleanupSocket();
    };
  }, [connect, cleanupSocket]);

  const status = useLiveStatusStore((s) => (vehicleId ? s.status[vehicleId] : null));
  const connected = useLiveStatusStore((s) => (vehicleId ? s.connected[vehicleId] ?? false : false));

  return { status: status ?? null, connected, connectionState };
}
