export type VehicleArtworkUsage = 'overview' | 'charging' | 'health';
export type VehicleArtworkFallbackModel = 'r1s' | 'r1t' | 'r2s';

const VEHICLE_ARTWORK_FALLBACKS: Record<
  VehicleArtworkFallbackModel,
  Record<VehicleArtworkUsage, string>
> = {
  r1s: {
    overview: '/vehicle-images/fallbacks/r1s/overview.webp',
    charging: '/vehicle-images/fallbacks/r1s/charging.webp',
    health: '/vehicle-images/fallbacks/r1s/health.webp',
  },
  r1t: {
    overview: '/vehicle-images/fallbacks/r1t/overview.webp',
    charging: '/vehicle-images/fallbacks/r1t/charging.webp',
    health: '/vehicle-images/fallbacks/r1t/health.webp',
  },
  r2s: {
    overview: '/vehicle-images/fallbacks/r2s/overview.webp',
    charging: '/vehicle-images/fallbacks/r2s/charging.webp',
    health: '/vehicle-images/fallbacks/r2s/health.webp',
  },
};

export function normalizeVehicleArtworkModel(
  model: string | null | undefined,
): VehicleArtworkFallbackModel | null {
  const normalized = (model ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('r1t')) return 'r1t';
  if (normalized.includes('r1s')) return 'r1s';
  if (normalized.includes('r2s')) return 'r2s';
  return null;
}

export function getVehicleArtworkFallback(
  model: string | null | undefined,
  usage: VehicleArtworkUsage,
): string | null {
  const normalizedModel = normalizeVehicleArtworkModel(model);
  return normalizedModel ? VEHICLE_ARTWORK_FALLBACKS[normalizedModel][usage] : null;
}
