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

function imageSearchText(image: VehicleImage) {
  return `${image.placement} ${image.design ?? ''} ${image.url} ${JSON.stringify(image.metadata ?? {})}`.toLowerCase();
}

function findSemanticImage(
  images: VehicleImages | null | undefined,
  predicate: (image: VehicleImage, text: string) => boolean,
  design: 'light' | 'dark',
) {
  return images?.all?.find((image) => (
    predicate(image, imageSearchText(image))
    && (image.design?.toLowerCase().includes(design) || image.design == null)
  ))?.url ?? null;
}

function findChargingImage(images: VehicleImages | null | undefined, design: 'light' | 'dark') {
  return findSemanticImage(images, (image, text) => {
    const placement = normalizedPlacement(image);
    return (placement.includes('side') && placement.includes('charg'))
      || text.includes('side-charging')
      || text.includes('side_charging')
      || (placement === 'side' && (text.includes('charge port') || text.includes('port open')));
  }, design);
}

function findHealthImage(
  images: VehicleImages | null | undefined,
  kind: 'hero' | 'three-quarter' | 'plain-side' | 'tagged-fallback' | 'front',
  design: 'light' | 'dark',
) {
  return findSemanticImage(images, (image, text) => {
    const placement = normalizedPlacement(image);
    if (kind === 'hero') return text.includes('health-hero') && !text.includes('health-hero-fallback');
    if (kind === 'three-quarter') {
      return placement.includes('three-quarter')
        || text.includes('three-quarter')
        || text.includes('three_quarter')
        || text.includes('3-quarter');
    }
    if (kind === 'plain-side') return placement === 'side' && !text.includes('charg');
    if (kind === 'tagged-fallback') return text.includes('health-hero-fallback');
    return placement === 'front';
  }, design);
}

function findPlacement(images: VehicleImages | null | undefined, placements: string[], design: 'light' | 'dark') {
  for (const placement of placements) {
    const match = images?.all?.find((image) => (
      normalizedPlacement(image) === placement
      && (image.design?.toLowerCase() === design || image.design == null)
    ));
    if (match) return match.url;
  }
  return null;
}

export function resolveVehicleArtwork(
  images: VehicleImages | null | undefined,
  model: string | null | undefined,
  usage: VehicleArtworkUsage,
): ResolvedVehicleArtwork {
  const typedPair = usage === 'overview'
    ? images?.overhead
    : usage === 'vehicle-card'
      ? images?.side
      : null;
  const placements = usage === 'overview'
    ? ['overhead']
    : usage === 'charging'
      ? ['side-charging', 'charging-side']
      : usage === 'health'
        ? ['health-hero', 'three-quarter']
        : ['side'];
  const healthLight = usage === 'health'
    ? findHealthImage(images, 'hero', 'light')
      ?? findHealthImage(images, 'hero', 'dark')
      ?? findHealthImage(images, 'three-quarter', 'light')
      ?? findHealthImage(images, 'three-quarter', 'dark')
      ?? images?.side?.light
      ?? images?.side?.dark
      ?? findHealthImage(images, 'plain-side', 'light')
      ?? findHealthImage(images, 'plain-side', 'dark')
      ?? findHealthImage(images, 'tagged-fallback', 'light')
      ?? findHealthImage(images, 'tagged-fallback', 'dark')
      ?? findHealthImage(images, 'front', 'light')
      ?? findHealthImage(images, 'front', 'dark')
    : null;
  const healthDark = usage === 'health'
    ? findHealthImage(images, 'hero', 'dark')
      ?? findHealthImage(images, 'hero', 'light')
      ?? findHealthImage(images, 'three-quarter', 'dark')
      ?? findHealthImage(images, 'three-quarter', 'light')
      ?? images?.side?.dark
      ?? images?.side?.light
      ?? findHealthImage(images, 'plain-side', 'dark')
      ?? findHealthImage(images, 'plain-side', 'light')
      ?? findHealthImage(images, 'tagged-fallback', 'dark')
      ?? findHealthImage(images, 'tagged-fallback', 'light')
      ?? findHealthImage(images, 'front', 'dark')
      ?? findHealthImage(images, 'front', 'light')
    : null;
  const chargingLight = usage === 'charging' ? findChargingImage(images, 'light') ?? findChargingImage(images, 'dark') : null;
  const chargingDark = usage === 'charging' ? findChargingImage(images, 'dark') ?? findChargingImage(images, 'light') : null;
  const light = healthLight
    ?? chargingLight
    ?? typedPair?.light
    ?? typedPair?.dark
    ?? findPlacement(images, placements, 'light')
    ?? findPlacement(images, placements, 'dark');
  const dark = healthDark
    ?? chargingDark
    ?? typedPair?.dark
    ?? typedPair?.light
    ?? findPlacement(images, placements, 'dark')
    ?? light;
  return {
    light: light ?? null,
    dark: dark ?? null,
    fallback: getVehicleArtworkFallback(model, usage),
  };
}
