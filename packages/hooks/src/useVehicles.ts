import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.listVehicles(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDefaultVehicleId(): string | null {
  const { accessToken, defaultVehicleId } = (() => {
    // Read from Zustand store without importing circular deps — read from localStorage
    try {
      const raw = localStorage.getItem('rm-auth');
      if (!raw) return { accessToken: null, defaultVehicleId: null };
      const parsed = JSON.parse(raw) as { state?: { defaultVehicleId?: string; accessToken?: string } };
      return {
        accessToken: parsed.state?.accessToken ?? null,
        defaultVehicleId: parsed.state?.defaultVehicleId ?? null,
      };
    } catch {
      return { accessToken: null, defaultVehicleId: null };
    }
  })();

  return defaultVehicleId;
}
