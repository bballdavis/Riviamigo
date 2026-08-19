import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export interface BasemapConfigPayload {
  enabled: boolean;
  light_url: string;
  dark_url: string;
  attribution: string | null;
  attribution_url: string | null;
}

/**
 * Resolves the authenticated first-party basemap configuration for connected
 * map surfaces. Rendering packages receive only this data, never transport.
 */
export function useBasemapConfig() {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['external', 'basemap', 'config', 'v1'],
    queryFn: async (): Promise<BasemapConfigPayload> => {
      const response = await api.proxyFetch('/v1/external/basemap/config', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Basemap configuration unavailable');
      return response.json() as Promise<BasemapConfigPayload>;
    },
    enabled: authReady,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
