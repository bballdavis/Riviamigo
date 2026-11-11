import React, { useMemo } from 'react';
import { MapPinOff } from 'lucide-react';
import { useAuth, useBasemapConfig, useUserPreferences } from '@riviamigo/hooks';
import { TripMapChart, type MapStyleMode } from '@riviamigo/ui/charts';
import { useDocumentTheme } from '@riviamigo/ui/hooks';
import type { OverviewMapOptions } from './overviewMap';

/**
 * Current-location map for the Vehicle Overview center stage. It reuses the
 * shared trip map renderer, basemap proxy, and the user's map style unless the
 * widget overrides the style or light/dark mode.
 */
export function OverviewLocationMap({
  latitude,
  longitude,
  options,
  heightPx,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  options: OverviewMapOptions;
  heightPx: number;
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

  if (!focusPoint) {
    return (
      <div data-testid="overview-location-empty" className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-fg-tertiary">
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

function isCoordinate(value: number | null | undefined, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}
