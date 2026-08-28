import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export interface BasemapConfigPayload {
  enabled: boolean;
  /** Remote CARTO remains usable without a key, but its tiles will be watermarked. */
  carto_api_key_missing: boolean;
  /** Non-secret setting revision used to give map tiles a fresh cache identity. */
  revision: string;
  light_url: string;
  dark_url: string;
  attribution: string | null;
  attribution_url: string | null;
}

export const BASEMAP_CONFIG_QUERY_KEY = ['external', 'basemap', 'config', 'v1'] as const;

/**
 * Resolves the authenticated first-party basemap configuration for connected
 * map surfaces. Rendering packages receive only this data, never transport.
 */
export function useBasemapConfig() {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: BASEMAP_CONFIG_QUERY_KEY,
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
