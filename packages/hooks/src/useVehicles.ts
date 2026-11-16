import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';
import { queryKeys } from './queryKeys';
import { collectProtectedArtworkUrls, pruneVehicleArtworkCache } from './vehicleArtworkCache';

export function useVehicles() {
  const accessToken = useAuth((state) => state.accessToken);
  const isAuthenticated = useAuth((state) => state.isAuthenticated);
  const isBootstrapping = useAuth((state) => state.isBootstrapping);
  const authReady = !isBootstrapping && isAuthenticated && !!accessToken;
  return useQuery({
    queryKey: queryKeys.vehicles.all,
    queryFn: async () => {
      const vehicles = await api.listVehicles();
      // Artwork URLs change whenever the images do (and on reconnect), so the
      // fresh list says which cached pictures are still in use.
      void pruneVehicleArtworkCache(collectProtectedArtworkUrls(vehicles));
      return vehicles;
    },
    enabled: authReady,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useDefaultVehicleId(): string | null {
  const { defaultVehicleId } = (() => {
    // Read from Zustand store without importing circular deps — read from localStorage
    try {
      const raw = localStorage.getItem('rm-auth');
      if (!raw) return { defaultVehicleId: null };
      const parsed = JSON.parse(raw) as { state?: { defaultVehicleId?: string; accessToken?: string } };
      return {
        defaultVehicleId: parsed.state?.defaultVehicleId ?? null,
      };
    } catch {
      return { defaultVehicleId: null };
    }
  })();

  return defaultVehicleId;
}
