import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import type { VehicleStatus } from '@riviamigo/types';

interface LiveStatusStore {
  status: Record<string, VehicleStatus>;
  connected: Record<string, boolean>;
  setStatus: (vehicleId: string, status: VehicleStatus) => void;
  setConnected: (vehicleId: string, connected: boolean) => void;
}

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

export function useVehicleStatus(vehicleId: string | null, accessToken: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const backoffRef = useRef(1000);
  const { setStatus, setConnected } = useLiveStatusStore();

  const connect = useCallback(() => {
    if (!vehicleId || !accessToken) return;

    const ws = new WebSocket(
      `${BASE_WS}/v1/vehicles/live?vehicle_id=${vehicleId}`,
      [`bearer.${accessToken}`]
    );
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 1000;
      setConnected(vehicleId, true);
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string) as VehicleStatus;
        setStatus(vehicleId, data);
      } catch {}
    };

    ws.onclose = () => {
      setConnected(vehicleId, false);
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
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const status = useLiveStatusStore((s) => (vehicleId ? s.status[vehicleId] : null));
  const connected = useLiveStatusStore((s) => (vehicleId ? s.connected[vehicleId] ?? false : false));

  return { status: status ?? null, connected };
}
