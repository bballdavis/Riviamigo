import React, { useMemo } from 'react';
import { Car, MapPinOff } from 'lucide-react';
import { useAuth, useBasemapConfig, useUserPreferences, useVehicleArtwork } from '@riviamigo/hooks';
import { TripMapChart, type MapStyleMode } from '@riviamigo/ui/charts';
import { useDocumentTheme } from '@riviamigo/ui/hooks';
import { AssistantWave } from '@riviamigo/ui/primitives';
import type { OverviewMapOptions } from './overviewMap';

/** Overhead artwork already resolved for the overview frame (API light/dark, then packaged fallback). */
export interface OverviewMarkerArtwork {
  light?: string | null | undefined;
  dark?: string | null | undefined;
  fallback?: string | null | undefined;
}

/**
 * Current-location map for the Vehicle Overview. It reuses the shared trip
 * map renderer, basemap proxy, and the user's map style unless the widget
 * overrides the style or light/dark mode. The vehicle is marked with its own
 * overhead artwork, turned to its compass heading.
 */
export function OverviewLocationMap({
  latitude,
  longitude,
  headingDeg,
  artwork,
  options,
  heightPx,
  onRenderFrame,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  headingDeg?: number | null | undefined;
  artwork?: OverviewMarkerArtwork | undefined;
  options: OverviewMapOptions;
  heightPx: number;
  /** Receives the map canvas after each frame, for overlays that blur what is beneath them. */
  onRenderFrame?: ((canvas: HTMLCanvasElement) => void) | undefined;
}) {
  const isDark = useDocumentTheme();
  const accessToken = useAuth((state) => state.accessToken);
  const basemap = useBasemapConfig();
  const userPreferences = useUserPreferences();
  const mapStyle: MapStyleMode = options.mode === 'auto' ? (isDark ? 'dark' : 'light') : options.mode;
  const mapStylePreference = options.style === 'app'
    ? userPreferences.data?.map_style ?? 'follow-theme'
    : options.style;
  const hasLocation = isCoordinate(latitude, 90) && isCoordinate(longitude, 180);
  const focusPoint = useMemo(
    () => (hasLocation ? { lat: latitude as number, lng: longitude as number } : null),
    [hasLocation, latitude, longitude],
  );
  // Match the artwork variant to the map, not the app, so a forced dark map
  // still gets the artwork drawn for dark surfaces.
  const markerSource = mapStyle === 'dark'
    ? artwork?.dark ?? artwork?.light
    : artwork?.light ?? artwork?.dark;
  const markerArtwork = useVehicleArtwork(markerSource);
  const fallbackMarkerArtwork = useVehicleArtwork(artwork?.fallback);
  // While the real artwork loads the marker shows the loading wave, never the
  // packaged fallback art.
  const markerLoading = markerArtwork.isLoading;
  const markerSrc = markerLoading ? null : markerArtwork.src ?? fallbackMarkerArtwork.src ?? null;

  if (!focusPoint) {
    return (
      <div data-testid="overview-location-empty" className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-fg-tertiary">
        <MapPinOff className="h-6 w-6" aria-hidden="true" />
        <span>No location reported yet</span>
      </div>
    );
  }

  return (
    <div data-testid="overview-location-map" className="h-full w-full">
      <TripMapChart
        track={[]}
        focusPoint={focusPoint}
        focusMarker={<VehicleMapMarker src={markerSrc} loading={markerLoading} />}
        // The loading pill stays level; only the vehicle turns to its heading.
        focusRotation={markerLoading ? null : headingDeg}
        compactAttribution
        onRenderFrame={onRenderFrame}
        // The drive wave runs along the bottom edge, so credits go top-left.
        compactAttributionPlacement="top-left"
        height={Math.max(160, Math.round(heightPx))}
        mapStyle={mapStyle}
        mapStylePreference={mapStylePreference}
        className="h-full w-full"
        accessToken={accessToken}
        basemapConfig={basemap.data}
        basemapError={basemap.isError ? 'Map configuration unavailable' : null}
        onBasemapRetry={() => void basemap.refetch()}
      />
    </div>
  );
}

/**
 * Traces an accent outline around the artwork's own silhouette. Each
 * drop-shadow applies to the result of the previous one, so four 2px offsets
 * close into a continuous border that follows the transparent artwork.
 */
const VEHICLE_OUTLINE_FILTER = [
  'drop-shadow(2px 0 0 var(--rm-accent))',
  'drop-shadow(-2px 0 0 var(--rm-accent))',
  'drop-shadow(0 2px 0 var(--rm-accent))',
  'drop-shadow(0 -2px 0 var(--rm-accent))',
].join(' ');

/** Small overhead view of the vehicle, outlined in the accent color. The artwork's front faces up (north) before rotation. */
function VehicleMapMarker({ src, loading = false }: { src: string | null; loading?: boolean }) {
  return (
    <span data-testid="overview-map-vehicle-marker" className="flex items-center justify-center">
      {loading ? (
        <span className="flex h-9 w-16 items-center rounded-full border-2 border-accent bg-bg-surface px-2 shadow-lg animate-assistant-wave-in">
          <AssistantWave size="sm" label="Loading vehicle picture" className="h-5" />
        </span>
      ) : src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          data-testid="overview-map-vehicle-art"
          className="h-12 w-auto max-w-none select-none object-contain"
          style={{ filter: VEHICLE_OUTLINE_FILTER }}
        />
      ) : (
        <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-accent bg-bg-surface shadow-lg">
          <Car className="h-5 w-5 text-accent" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

function isCoordinate(value: number | null | undefined, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}
