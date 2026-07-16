import type { VehicleImage, VehicleImages } from '@riviamigo/types';

export type VehicleArtworkUsage = 'overview' | 'charging' | 'health' | 'vehicle-card';
export type VehicleArtworkFallbackModel = 'r1s' | 'r1t' | 'r2s';

const VEHICLE_ARTWORK_FALLBACKS: Record<
  VehicleArtworkFallbackModel,
  Record<VehicleArtworkUsage, string>
> = {
  r1s: {
    overview: '/vehicle-images/fallbacks/r1s/overview.webp',
    charging: '/vehicle-images/fallbacks/r1s/charging.webp',
    health: '/vehicle-images/fallbacks/r1s/health.webp',
    'vehicle-card': '/vehicle-images/fallbacks/r1s/side.webp',
  },
  r1t: {
    overview: '/vehicle-images/fallbacks/r1t/overview.webp',
    charging: '/vehicle-images/fallbacks/r1t/charging.webp',
    health: '/vehicle-images/fallbacks/r1t/health.webp',
    'vehicle-card': '/vehicle-images/fallbacks/r1t/side.webp',
  },
  r2s: {
    overview: '/vehicle-images/fallbacks/r2s/overview.webp',
    charging: '/vehicle-images/fallbacks/r2s/charging.webp',
    health: '/vehicle-images/fallbacks/r2s/health.webp',
    'vehicle-card': '/vehicle-images/fallbacks/r2s/side.webp',
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

export interface ResolvedVehicleArtwork {
  light: string | null;
  dark: string | null;
  fallback: string | null;
}

function normalizedPlacement(image: VehicleImage) {
  return image.placement.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function findPlacement(images: VehicleImages | null | undefined, placements: string[], design: 'light' | 'dark') {
  const requested = new Set(placements);
  return images?.all?.find((image) => (
    requested.has(normalizedPlacement(image))
    && (image.design?.toLowerCase() === design || image.design == null)
  ))?.url ?? null;
}

export function resolveVehicleArtwork(
  images: VehicleImages | null | undefined,
  model: string | null | undefined,
  usage: VehicleArtworkUsage,
): ResolvedVehicleArtwork {
  const placements = usage === 'overview'
    ? ['overhead']
    : usage === 'charging'
      ? ['side-charging', 'charging-side']
      : usage === 'health'
        ? ['health-hero', 'three-quarter', 'side', 'front']
        : ['side'];
  const typedPair = usage === 'overview'
    ? images?.overhead
    : usage === 'vehicle-card' || usage === 'health'
      ? images?.side
      : null;
  const light = typedPair?.light
    ?? typedPair?.dark
    ?? findPlacement(images, placements, 'light')
    ?? findPlacement(images, placements, 'dark');
  const dark = typedPair?.dark
    ?? typedPair?.light
    ?? findPlacement(images, placements, 'dark')
    ?? light;
  return {
    light: light ?? null,
    dark: dark ?? null,
    fallback: getVehicleArtworkFallback(model, usage),
  };
}
