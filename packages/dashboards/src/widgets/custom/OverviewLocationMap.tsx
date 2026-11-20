import React, { useEffect, useMemo, useRef } from 'react';
import { Car, MapPin, MapPinOff, Zap } from 'lucide-react';
import { useAuth, useBasemapConfig, useUserPreferences, useVehicleArtwork } from '@riviamigo/hooks';
import { TripMapChart, type MapStyleMode, type TripMapFitPadding, type TripMapMarker, type TripMapRoute } from '@riviamigo/ui/charts';
import { useDocumentTheme } from '@riviamigo/ui/hooks';
import { AssistantWave, RivianMark } from '@riviamigo/ui/primitives';
import type { VehicleNavigationRoute, VehicleNavigationStop } from '@riviamigo/types';
import type { OverviewMapOptions } from './overviewMap';
import { decodeNavigationLine, splitRouteAtVehicle, type RoutePoint } from './overviewNavigation';

/** Overhead artwork already resolved for the overview frame (API light/dark, then packaged fallback). */
export interface OverviewMarkerArtwork {
  light?: string | null | undefined;
  dark?: string | null | undefined;
  fallback?: string | null | undefined;
}

/** The route line, in the drive wave's own teal. */
const ROUTE_COLOR_VAR = '--rm-drive-wave-line';
/** Closest a whole-route view zooms, so a nearly finished route still shows its surroundings. */
const ROUTE_FIT_MAX_ZOOM = 15;

/**
 * Current-location map for the Vehicle Overview. It reuses the shared trip
 * map renderer, basemap proxy, and the user's map style unless the widget
 * overrides the style or light/dark mode. The vehicle is marked with its own
 * overhead artwork, turned to its compass heading.
 *
 * While the vehicle is navigating, its planned route is drawn ahead of it
 * with a pin at each stop. The map keeps following the vehicle unless
 * `showWholeRoute` asks for the route to be framed instead.
 */
export function OverviewLocationMap({
  latitude,
  longitude,
  headingDeg,
  artwork,
  options,
  heightPx,
  onRenderFrame,
  route,
  showWholeRoute = false,
  routeFitPadding,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  headingDeg?: number | null | undefined;
  artwork?: OverviewMarkerArtwork | undefined;
  options: OverviewMapOptions;
  heightPx: number;
  /** Receives the map canvas after each frame, for overlays that blur what is beneath them. */
  onRenderFrame?: ((canvas: HTMLCanvasElement) => void) | undefined;
  /** The route the vehicle is navigating, if any. */
  route?: VehicleNavigationRoute | null | undefined;
  /** Frame the whole route instead of following the vehicle. */
  showWholeRoute?: boolean | undefined;
  /** Space the whole-route view keeps clear for overlays drawn over the map. */
  routeFitPadding?: TripMapFitPadding | undefined;
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
  const routes = useRouteLines(route ?? null, focusPoint);
  const stopMarkers = useMemo<TripMapMarker[]>(
    () => (route?.stops ?? []).map((stop, index, stops) => ({
      // Stable across reroutes, so a pin moves instead of being replaced.
      id: `navigation-stop-${index}`,
      point: { lat: stop.latitude, lng: stop.longitude },
      content: <RouteStopMarker stop={stop} destination={index === stops.length - 1} />,
    })),
    [route],
  );

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
        routes={routes}
        markers={stopMarkers}
        camera={showWholeRoute ? 'fit-routes' : 'follow-focus'}
        fitKey={route?.id}
        fitPadding={routeFitPadding}
        fitMaxZoom={ROUTE_FIT_MAX_ZOOM}
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
 * The route as map lines: the part already driven, dimmed, and the part
 * ahead. The line is decoded once per route and re-split as the vehicle
 * moves along it.
 */
function useRouteLines(route: VehicleNavigationRoute | null, vehicle: RoutePoint | null): TripMapRoute[] {
  const line = useMemo(() => (route ? decodeNavigationLine(route) : []), [route]);
  // The segment the vehicle was last on, so a route that doubles back on
  // itself is not cut at the return leg.
  const progress = useRef<{ line: RoutePoint[]; index: number }>({ line, index: 0 });
  const split = useMemo(
    () => splitRouteAtVehicle(line, vehicle, progress.current.line === line ? progress.current.index : 0),
    [line, vehicle],
  );
  // Recorded once the split is on screen, so a render React discards cannot move it.
  useEffect(() => {
    progress.current = { line, index: split.index };
  }, [line, split]);
  return useMemo<TripMapRoute[]>(() => [
    // The whole-route view frames what is left to drive, not where the vehicle has been.
    { id: 'navigation-traveled', track: split.traveled, colorVar: ROUTE_COLOR_VAR, width: 4, opacity: 0.35, fit: false },
    { id: 'navigation-ahead', track: split.ahead, colorVar: ROUTE_COLOR_VAR, width: 5, opacity: 0.95 },
  ].filter((route) => route.track.length > 1), [split]);
}

/** A halo in the surface color, so a pin reads on any basemap. */
const PIN_HALO_FILTER = 'drop-shadow(0 0 1.5px var(--rm-bg-surface)) drop-shadow(0 0 1.5px var(--rm-bg-surface))';

/**
 * A stop along the route. The destination is the Rivian mark in the drive
 * wave's gold with its name beneath; a charging stop is a bolt and any other
 * stop a pin, both in the route's teal.
 */
function RouteStopMarker({ stop, destination }: { stop: VehicleNavigationStop; destination: boolean }) {
  const label = stop.name ?? (destination ? 'Destination' : stop.kind === 'charging' ? 'Charging stop' : 'Stop');
  if (destination) {
    return (
      <span
        data-testid="overview-map-destination"
        role="img"
        aria-label={`Destination: ${label}`}
        title={label}
        className="relative flex items-center justify-center"
        style={{ color: 'var(--rm-drive-wave-crest)' }}
      >
        <span style={{ filter: PIN_HALO_FILTER }}><RivianMark className="h-6 w-6" /></span>
        {stop.name ? (
          <span className="absolute left-1/2 top-full mt-0.5 max-w-28 -translate-x-1/2 truncate rounded bg-bg-surface/85 px-1 py-px text-[10px] font-medium leading-tight text-fg">
            {stop.name}
          </span>
        ) : null}
      </span>
    );
  }
  const Icon = stop.kind === 'charging' ? Zap : MapPin;
  return (
    <span
      data-testid="overview-map-stop"
      data-stop-kind={stop.kind}
      role="img"
      aria-label={stop.kind === 'charging' ? `Charging stop: ${label}` : `Stop: ${label}`}
      title={label}
      className="flex h-5 w-5 items-center justify-center rounded-full border-2 bg-bg-surface"
      style={{ borderColor: 'var(--rm-drive-wave-line)', color: 'var(--rm-drive-wave-line)' }}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
    </span>
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
