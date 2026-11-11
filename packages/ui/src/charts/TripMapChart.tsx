import * as React from 'react';
import { createPortal } from 'react-dom';
import { Info, Loader2 } from 'lucide-react';
import type { BasemapStyleDescriptor, MapStylePreference } from '@riviamigo/types';
import { CHART_COLORS } from './ChartProvider';
import { useDocumentPalette } from '../hooks/useDocumentPalette';
import { useDocumentTheme } from '../hooks/useDocumentTheme';
import { isAbortError, reportClientError } from '../lib/clientDiagnostics';
import { useThemeRevision } from '../lib/themeRuntime';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export interface LatLng { lat: number; lng: number; }

export interface TripMapRoute {
  id: string;
  track: LatLng[];
  color?: string;
}

export type MapStyleMode = 'dark' | 'light';

/** Resolved by the application data layer before the chart is rendered. */
export interface BasemapConfig {
  enabled: boolean;
  provider_preference?: string;
  resolved_provider?: string;
  revision: string;
  styles?: BasemapStyleDescriptor[];
  attributions?: Array<{ label: string; url?: string | null }>;
  // Legacy fields are retained for consumers upgrading alongside the API.
  carto_api_key_missing?: boolean;
  light_url?: string;
  dark_url?: string;
  attribution?: string | null;
  attribution_url?: string | null;
}

export interface TripMapChartProps {
  track: LatLng[];
  routes?: TripMapRoute[];
  selectedRouteIds?: string[];
  onRouteClick?: (routeId: string) => void;
  activePoint?: LatLng | null;
  /**
   * Keeps the map centered on one marked point, such as the vehicle's current
   * location. With a focus point the map renders even when there are no
   * routes; routes, when present, still decide the initial fit.
   */
  focusPoint?: LatLng | null;
  /** Zoom used when centering on `focusPoint` without routes. */
  focusZoom?: number;
  /**
   * Custom marker content drawn at `focusPoint` instead of the default dot,
   * for example a small vehicle image. It is pinned to the map, so it stays
   * on the location while the map is panned.
   */
  focusMarker?: React.ReactNode;
  /** Clockwise degrees from north applied to `focusMarker` (a compass heading). */
  focusRotation?: number | null | undefined;
  /** Copy shown when there is neither a route nor a focus point. */
  emptyLabel?: string;
  /**
   * Collapse the basemap credits behind a small info button, for maps too
   * narrow to show the full line without covering the map.
   */
  compactAttribution?: boolean;
  startPoint?: LatLng;
  endPoint?: LatLng;
  height?: number;
  className?: string;
  mapStyle?: MapStyleMode;
  mapStylePreference?: MapStylePreference;
  /** Bearer token used only for Riviamigo's same-origin basemap proxy. */
  accessToken?: string | null;
  /** Resolved basemap policy. UI never performs API requests. */
  basemapConfig?: BasemapConfig | null | undefined;
  /** Optional connected-wrapper error copy. */
  basemapError?: string | null;
  /** Retries configuration in the connected wrapper, not in this presentation component. */
  onBasemapRetry?: () => void;
  mapLoader?: typeof loadMapLibre;
}

interface MarkerApi {
  setLngLat(lngLat: [number, number]): MarkerApi;
  setRotation(rotation: number): MarkerApi;
  addTo(map: unknown): MarkerApi;
  remove(): void;
}

type MarkerConstructor = new (options: {
  element: HTMLElement;
  anchor?: 'center';
  rotationAlignment?: 'map' | 'viewport';
  pitchAlignment?: 'map' | 'viewport';
}) => MarkerApi;

interface MapSourceApi {
  setData(data: unknown): void;
}

interface MapApi {
  remove(): void;
  on(event: string, cb: (event?: unknown) => void): void;
  on(event: string, layerId: string, cb: (event?: unknown) => void): void;
  off(event: string, cb: (event?: unknown) => void): void;
  resize(): void;
  fitBounds(bounds: [[number, number], [number, number]], options?: { padding?: number; animate?: boolean }): void;
  jumpTo?(options: { center: [number, number]; zoom?: number }): void;
  addSource(id: string, source: unknown): void;
  getSource(id: string): MapSourceApi | undefined;
  removeSource(id: string): void;
  addLayer(layer: unknown): void;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  getCanvas(): { style: CSSStyleDeclaration };
  setStyle(style: unknown): void;
  triggerRepaint?(): void;
  setPitch?(pitch: number): void;
  setBearing?(bearing: number): void;
  dragRotate?: { enable(): void; disable(): void };
}

const FALLBACK_ROUTE_COLORS = [
  CHART_COLORS.sky,
  CHART_COLORS.emerald,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.amber,
  CHART_COLORS.danger,
];
const FALLBACK_ACTIVE_POINT_COLOR = CHART_COLORS.warning;
const ACTIVE_POINT_SOURCE_ID = 'trip-active-point';
const ACTIVE_POINT_LAYER_ID = 'trip-active-point-layer';
const ROUTE_SOURCE_ID = 'trip-routes';
const ROUTE_LAYER_ID = 'trip-routes-line';
const ROUTE_HIT_LAYER_ID = 'trip-routes-hit';
const BASEMAP_PROXY_PLACEHOLDER_ORIGIN = 'https://riviamigo.invalid';
const MAP_TILES_UNAVAILABLE = 'Map tiles unavailable';
/**
 * Slow upstream tiles can legitimately take several seconds. Resource errors
 * raised while a style is still loading are only surfaced once this deadline
 * passes without MapLibre reaching `idle`.
 */
export const MAP_TILE_LOAD_TIMEOUT_MS = 20_000;
/** Avoid flashing the loading indicator for fast loads and cached style swaps. */
export const MAP_TILE_LOADING_INDICATOR_DELAY_MS = 250;
const DEFAULT_FOCUS_ZOOM = 14;

export const NEUTRAL_BASEMAP_CONFIG: BasemapConfig = {
  enabled: false,
  revision: 'neutral',
  dark_url: '',
  light_url: '',
  attribution: null,
  attribution_url: null,
};

function resolveStyleDescriptor(basemap: BasemapConfig, preference: MapStylePreference, mode: MapStyleMode) {
  const descriptors = basemap.styles ?? [];
  const follow = descriptors.find((descriptor) => descriptor.id === 'follow-theme');
  const selected = descriptors.find((descriptor) => descriptor.id === preference) ?? follow;
  if (selected) return { descriptor: selected, url: mode === 'dark' ? selected.dark_url : selected.light_url };
  return { descriptor: undefined, url: mode === 'dark' ? basemap.dark_url ?? '' : basemap.light_url ?? '' };
}

function buildMapLibreStyle(mode: MapStyleMode, basemap: BasemapConfig, preference: MapStylePreference = 'follow-theme') {
  if (!basemap.enabled) {
    return {
      version: 8 as const,
      sources: {},
      layers: [{
        id: 'neutral-background',
        type: 'background' as const,
        paint: { 'background-color': getCssColor('--rm-bg-elevated', CHART_COLORS.muted) },
      }],
    };
  }
  const { descriptor, url } = resolveStyleDescriptor(basemap, preference, mode);
  if (descriptor?.kind === 'style' && url) return url;
  return {
    version: 8 as const,
    sources: {
      'carto-base': {
        type: 'raster' as const,
        tiles: [url],
        tileSize: 256,
        attribution: basemap.attributions?.map((item) => item.label).join(' | ') ?? basemap.attribution ?? '',
      },
    },
    layers: [{ id: 'background', type: 'raster' as const, source: 'carto-base' }],
  };
}

function basemapSignature(basemap: BasemapConfig, mode: MapStyleMode, preference: MapStylePreference) {
  const resolved = resolveStyleDescriptor(basemap, preference, mode);
  return `${mode}|${preference}|${basemap.enabled}|${basemap.revision}|${resolved.url}|${resolved.descriptor?.kind ?? 'raster'}`;
}

export async function loadMapLibre() {
  const maplibregl = await import('maplibre-gl');
  maplibregl.setWorkerUrl(mapLibreWorkerUrl);
  await import('maplibre-gl/dist/maplibre-gl.css');
  return maplibregl;
}

/**
 * Lazy-loads MapLibre GL to avoid bundling it in SSR/test contexts.
 * The map renders one or more trip polylines.
 */
export function TripMapChart({
  track,
  routes,
  selectedRouteIds = [],
  onRouteClick,
  activePoint,
  focusPoint = null,
  focusZoom = DEFAULT_FOCUS_ZOOM,
  focusMarker,
  focusRotation = null,
  emptyLabel = 'No route points in this period',
  compactAttribution = false,
  height = 320,
  className,
  mapStyle = 'dark',
  mapStylePreference = 'follow-theme',
  accessToken = null,
  basemapConfig,
  basemapError = null,
  onBasemapRetry,
  mapLoader = loadMapLibre,
}: TripMapChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapApi | null>(null);
  const isLoadedRef = React.useRef(false);
  const lastRouteSignatureRef = React.useRef<string>('');
  const onRouteClickRef = React.useRef(onRouteClick);
  const latestRoutesRef = React.useRef<TripMapRoute[]>([]);
  const latestSelectedRouteIdsRef = React.useRef<string[]>([]);
  const markerConstructorRef = React.useRef<MarkerConstructor | null>(null);
  const focusMarkerRef = React.useRef<MarkerApi | null>(null);
  const [focusMarkerElement] = React.useState<HTMLDivElement | null>(
    () => (typeof document === 'undefined' ? null : document.createElement('div')),
  );
  const [mapLoaded, setMapLoaded] = React.useState(false);
  const [attributionOpen, setAttributionOpen] = React.useState(false);
  const [customFocusMarkerShown, setCustomFocusMarkerShown] = React.useState(false);
  const hasFocusMarker = focusMarker !== undefined && focusMarker !== null;
  // A focus point is drawn with the same dot as a scrubbed active point unless
  // custom marker content is pinned there instead.
  const markerPoint = activePoint ?? (customFocusMarkerShown ? null : focusPoint);
  const latestActivePointRef = React.useRef<LatLng | null | undefined>(markerPoint);
  const focusPointRef = React.useRef<LatLng | null>(focusPoint);
  const focusZoomRef = React.useRef(focusZoom);
  const focusRotationRef = React.useRef(0);
  focusRotationRef.current = typeof focusRotation === 'number' && Number.isFinite(focusRotation) ? focusRotation : 0;
  const latestVisibleRouteSignatureRef = React.useRef<string>('');
  const activePointFrameRef = React.useRef<number | null>(null);
  const lastActivePointRef = React.useRef<LatLng | null>(null);
  const accessTokenRef = React.useRef<string | null>(accessToken);
  const basemap = basemapConfig ?? NEUTRAL_BASEMAP_CONFIG;
  const basemapRef = React.useRef<BasemapConfig>(basemap);
  const mapStyleRef = React.useRef<MapStyleMode>(mapStyle);
  const mapStylePreferenceRef = React.useRef<MapStylePreference>(mapStylePreference);
  const appliedBasemapSignatureRef = React.useRef('');
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [mapRetryVersion, setMapRetryVersion] = React.useState(0);
  // Tiles are "loading" from map creation (and every style swap or retry)
  // until MapLibre reports `idle`: style, sources, and visible tiles rendered.
  const tilesLoadingRef = React.useRef(true);
  const tileLoadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tilesLoading, setTilesLoading] = React.useState(true);
  const [showTilesLoading, setShowTilesLoading] = React.useState(false);
  const palette = useDocumentPalette();
  const isDark = useDocumentTheme();
  const themeRevision = useThemeRevision();

  React.useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  React.useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);

  React.useEffect(() => {
    mapStyleRef.current = mapStyle;
    mapStylePreferenceRef.current = mapStylePreference;
  }, [mapStyle, mapStylePreference]);

  const routeList = React.useMemo(
    () => (routes?.length ? routes : [{ id: 'trip', track }]).filter((route) => route.track.length > 1),
    [routes, track],
  );
  const hasMapContent = routeList.length > 0 || focusPoint !== null;
  const selectedRouteIdSet = React.useMemo(() => new Set(selectedRouteIds), [selectedRouteIds]);
  const visibleRoutes = React.useMemo(
    () => (selectedRouteIds.length > 0
      ? routeList.filter((route) => selectedRouteIdSet.has(route.id))
      : routeList),
    [routeList, selectedRouteIdSet, selectedRouteIds.length],
  );
  const visibleRouteSignature = React.useMemo(
    () => visibleRoutes.map((route) => `${route.id}:${route.track.length}:${serializePoint(route.track[0])}:${serializePoint(route.track.at(-1))}`).join('|'),
    [visibleRoutes],
  );

  React.useEffect(() => {
    onRouteClickRef.current = onRouteClick;
  }, [onRouteClick]);

  React.useEffect(() => {
    latestRoutesRef.current = visibleRoutes;
    latestSelectedRouteIdsRef.current = selectedRouteIds;
    latestActivePointRef.current = markerPoint;
    latestVisibleRouteSignatureRef.current = visibleRouteSignature;
    focusPointRef.current = focusPoint;
    focusZoomRef.current = focusZoom;
  }, [focusPoint, focusZoom, markerPoint, selectedRouteIds, visibleRouteSignature, visibleRoutes]);

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clearTileLoadTimeout = React.useCallback(() => {
    if (tileLoadTimeoutRef.current !== null) {
      clearTimeout(tileLoadTimeoutRef.current);
      tileLoadTimeoutRef.current = null;
    }
  }, []);

  const beginTileLoad = React.useCallback(() => {
    clearTileLoadTimeout();
    tilesLoadingRef.current = true;
    setTilesLoading(true);
    setMapError(null);
    tileLoadTimeoutRef.current = setTimeout(() => {
      tileLoadTimeoutRef.current = null;
      if (!tilesLoadingRef.current) return;
      tilesLoadingRef.current = false;
      setTilesLoading(false);
      setMapError(MAP_TILES_UNAVAILABLE);
    }, MAP_TILE_LOAD_TIMEOUT_MS);
  }, [clearTileLoadTimeout]);

  const finishTileLoad = React.useCallback(() => {
    if (!tilesLoadingRef.current) return;
    clearTileLoadTimeout();
    tilesLoadingRef.current = false;
    setTilesLoading(false);
    // Transient resource errors during the load were deferred; the map
    // reached a complete render, so none of them should block it now.
    setMapError(null);
  }, [clearTileLoadTimeout]);

  const failTileLoad = React.useCallback(() => {
    clearTileLoadTimeout();
    tilesLoadingRef.current = false;
    setTilesLoading(false);
    setMapError(MAP_TILES_UNAVAILABLE);
  }, [clearTileLoadTimeout]);

  React.useEffect(() => clearTileLoadTimeout, [clearTileLoadTimeout]);

  React.useEffect(() => {
    if (!tilesLoading) {
      setShowTilesLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowTilesLoading(true), MAP_TILE_LOADING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tilesLoading]);

  // ── Map creation — runs once when the first routes become available ─────────
  // The map instance is kept alive for the lifetime of the component.  Style
  // changes (dark↔light) are applied via setStyle() on the existing instance
  // rather than destroying and recreating the map, which avoids losing the
  // in-GPU tile cache and triggering a "WebGL context was lost" error.
  React.useEffect(() => {
    if (!containerRef.current || !hasMapContent || mapRef.current) return;

    let cancelled = false;
    beginTileLoad();

    (async () => {
      try {
        const maplibregl = await mapLoader();

        if (cancelled || !containerRef.current) return;
        markerConstructorRef.current = (maplibregl as { Marker?: MarkerConstructor }).Marker ?? null;

        const routeStart = routeList[0]?.track[0];
        const firstPoint = routeStart ?? focusPointRef.current;
        if (!firstPoint) return;

        const initialBasemap = basemapRef.current;
        const initialMapStyle = mapStyleRef.current;
        const initialMapStylePreference = mapStylePreferenceRef.current;
        appliedBasemapSignatureRef.current = basemapSignature(initialBasemap, initialMapStyle, initialMapStylePreference);
        const map = new maplibregl.Map({
          container: containerRef.current!,
          style: buildMapLibreStyle(initialMapStyle, initialBasemap, initialMapStylePreference),
          center: [firstPoint.lng, firstPoint.lat],
          zoom: routeStart ? 12 : focusZoomRef.current,
          attributionControl: false,
          transformRequest: (url: string) => {
            try {
              const requestUrl = new URL(url, window.location.origin);
              const placeholderProxyRequest = requestUrl.origin === BASEMAP_PROXY_PLACEHOLDER_ORIGIN
                && requestUrl.pathname.startsWith('/v1/external/basemap/');
              const sameOriginProxyRequest = requestUrl.origin === window.location.origin
                && requestUrl.pathname.startsWith('/v1/external/basemap/');
              if (placeholderProxyRequest || sameOriginProxyRequest) {
                const token = accessTokenRef.current;
                const firstPartyUrl = placeholderProxyRequest
                  ? `${window.location.origin}${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`
                  : url;
                return token ? { url: firstPartyUrl, headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin' } : { url: firstPartyUrl, credentials: 'same-origin' };
              }
            } catch {
              // MapLibre will surface malformed source URLs through its normal error event.
            }
            return { url };
          },
          // Keep more tiles in the GPU cache to survive style swaps.
          maxTileCacheSize: 512,
        }) as MapApi;

        mapRef.current = map;

        map.on('error', (event) => {
          const details = mapLibreErrorDetails(event);
          // MapLibre aborts in-flight resources during an intentional style
          // replacement. Those requests must not leave a stale failure overlay.
          if (isAbortError(details.error)) return;
          reportClientError(details.error, {
            event: 'maplibre.error',
            area: 'map',
            operation: 'map-resource-load',
            status: details.status,
            provider: basemapRef.current.resolved_provider,
            style: mapStylePreferenceRef.current,
            resourceKind: details.resourceKind,
            sourceId: details.sourceId,
            url: details.url,
            severity: 'error',
          });
          // While the style and its first tiles are still loading, a single
          // slow or failed resource is not an outage. Keep the loading state;
          // the load timeout decides if the map never becomes usable.
          if (tilesLoadingRef.current) return;
          if (basemapRef.current.enabled) setMapError(MAP_TILES_UNAVAILABLE);
        });

        map.on('idle', () => {
          finishTileLoad();
        });

        map.on('load', () => {
          if (!mapRef.current) return;

          isLoadedRef.current = true;
          setMapLoaded(true);
          lastRouteSignatureRef.current = '';
          syncRoutes(
            mapRef.current,
            latestRoutesRef.current,
            latestSelectedRouteIdsRef.current,
            onRouteClickRef,
            latestVisibleRouteSignatureRef.current,
          );
          syncActivePoint(mapRef.current, latestActivePointRef.current, lastActivePointRef);
          applyPerspective(map, basemapRef.current, mapStylePreferenceRef.current);
          // Configuration can arrive after the map is constructed but before
          // its initial style loads. Reapply it after route sync; the regular
          // style-load handler below restores the route source after the swap.
          const currentSignature = basemapSignature(
            basemapRef.current,
            mapStyleRef.current,
            mapStylePreferenceRef.current,
          );
          if (currentSignature !== appliedBasemapSignatureRef.current) {
            appliedBasemapSignatureRef.current = currentSignature;
            const restoreAfterInitialSwap = () => {
              map.off('style.load', restoreAfterInitialSwap);
              lastRouteSignatureRef.current = '';
              syncRoutes(
                map,
                latestRoutesRef.current,
                latestSelectedRouteIdsRef.current,
                onRouteClickRef,
                latestVisibleRouteSignatureRef.current,
              );
              lastActivePointRef.current = null;
              syncActivePoint(map, latestActivePointRef.current, lastActivePointRef);
              applyPerspective(map, basemapRef.current, mapStylePreferenceRef.current);
            };
            map.on('style.load', restoreAfterInitialSwap);
            beginTileLoad();
            map.setStyle(buildMapLibreStyle(
              mapStyleRef.current,
              basemapRef.current,
              mapStylePreferenceRef.current,
            ));
            map.triggerRepaint?.();
          }
          requestAnimationFrame(() => {
            mapRef.current?.resize();
          });
        });
      } catch (error) {
        if (cancelled) return;
        reportClientError(error, {
          event: 'maplibre.initialization_failed',
          area: 'map',
          operation: 'map-initialize',
          provider: basemapRef.current.resolved_provider,
          style: mapStylePreferenceRef.current,
          severity: 'error',
        });
        failTileLoad();
      }
    })();

    return () => {
      cancelled = true;
      clearTileLoadTimeout();
      isLoadedRef.current = false;
      setMapLoaded(false);
      lastRouteSignatureRef.current = '';
      focusMarkerRef.current?.remove();
      focusMarkerRef.current = null;
      setCustomFocusMarkerShown(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Only run when the first routes (or focus point) arrive — NOT on mapStyle
    // change so that toggling dark/light doesn't destroy the map instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoader, mapRetryVersion, !hasMapContent]);

  // Follow the focus point when there are no routes to frame instead.
  const focusLat = focusPoint?.lat;
  const focusLng = focusPoint?.lng;
  React.useEffect(() => {
    if (!isLoadedRef.current || !mapRef.current) return;
    if (focusLat === undefined || focusLng === undefined || routeList.length > 0) return;
    mapRef.current.jumpTo?.({ center: [focusLng, focusLat] });
  }, [focusLat, focusLng, routeList.length]);

  // Pin custom focus marker content. DOM markers live outside the map style,
  // so they survive light/dark and basemap swaps without re-adding.
  const hasFocusPoint = focusLat !== undefined && focusLng !== undefined;
  React.useEffect(() => {
    const MarkerCtor = markerConstructorRef.current;
    const map = mapRef.current;
    const point = focusPointRef.current;
    if (!mapLoaded || !map || !hasFocusMarker || !hasFocusPoint || !point || !focusMarkerElement || !MarkerCtor) return;
    const marker = new MarkerCtor({
      element: focusMarkerElement,
      anchor: 'center',
      rotationAlignment: 'map',
      pitchAlignment: 'map',
    });
    marker.setLngLat([point.lng, point.lat]);
    marker.setRotation(focusRotationRef.current);
    marker.addTo(map);
    focusMarkerRef.current = marker;
    setCustomFocusMarkerShown(true);
    return () => {
      marker.remove();
      if (focusMarkerRef.current === marker) focusMarkerRef.current = null;
      setCustomFocusMarkerShown(false);
    };
  }, [focusMarkerElement, hasFocusMarker, hasFocusPoint, mapLoaded]);

  React.useEffect(() => {
    const marker = focusMarkerRef.current;
    if (!marker || focusLat === undefined || focusLng === undefined) return;
    marker.setLngLat([focusLng, focusLat]);
    marker.setRotation(focusRotationRef.current);
  }, [customFocusMarkerShown, focusLat, focusLng, focusRotation]);

  // ── Style swap — update tiles in place without destroying the map ─────────
  // setStyle() clears all sources/layers, so we re-sync routes once the new
  // style has loaded.  We register the handler here and clean it up if the
  // effect re-fires (rapid dark/light toggle) before it fires.
  React.useEffect(() => {
    if (!isLoadedRef.current || !mapRef.current) return;

    const map = mapRef.current;

    function onStyleLoad() {
      isLoadedRef.current = true;
      lastRouteSignatureRef.current = '';
      syncRoutes(
        map,
        latestRoutesRef.current,
        latestSelectedRouteIdsRef.current,
        onRouteClickRef,
        latestVisibleRouteSignatureRef.current,
      );
      lastActivePointRef.current = null;
      syncActivePoint(map, latestActivePointRef.current, lastActivePointRef);
      applyPerspective(map, basemap, mapStylePreference);
    }

    map.on('style.load', onStyleLoad);
    appliedBasemapSignatureRef.current = basemapSignature(basemap, mapStyle, mapStylePreference);
    beginTileLoad();
    map.setStyle(buildMapLibreStyle(mapStyle, basemap, mapStylePreference));
    // An unchanged style diff may not schedule a frame; force one so `idle`
    // always follows and the loading state cannot wait for the timeout.
    map.triggerRepaint?.();

    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [basemap, beginTileLoad, mapStyle, mapStylePreference]);

  const retryMap = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      setMapError(null);
      setMapRetryVersion((version) => version + 1);
      return;
    }
    appliedBasemapSignatureRef.current = '';
    beginTileLoad();
    map.setStyle(buildMapLibreStyle(
      mapStyleRef.current,
      basemapRef.current,
      mapStylePreferenceRef.current,
    ));
    map.triggerRepaint?.();
  }, [beginTileLoad]);

  // Sync routes whenever routes or selection changes
  React.useEffect(() => {
    if (!isLoadedRef.current || !mapRef.current) return;

    const map = mapRef.current;
    if (map.getLayer('neutral-background')) {
      map.setPaintProperty('neutral-background', 'background-color', getCssColor('--rm-bg-elevated', CHART_COLORS.muted));
    }
    if (routeList.length === 0) return;
    syncRoutes(map, visibleRoutes, selectedRouteIds, onRouteClickRef, visibleRouteSignature);
  }, [palette, themeRevision, selectedRouteIds, visibleRouteSignature, visibleRoutes]);

  React.useEffect(() => {
    if (!isLoadedRef.current || !mapRef.current) return;
    if (activePointFrameRef.current !== null) {
      cancelAnimationFrame(activePointFrameRef.current);
    }

    activePointFrameRef.current = requestAnimationFrame(() => {
      activePointFrameRef.current = null;
      const map = mapRef.current;
      if (!map) return;
      syncActivePoint(map, markerPoint, lastActivePointRef);
    });

    return () => {
      if (activePointFrameRef.current !== null) {
        cancelAnimationFrame(activePointFrameRef.current);
      }
    };
  }, [markerPoint, isDark, palette, themeRevision]);

  function syncRoutes(
    map: MapApi,
    nextRoutes: TripMapRoute[],
    nextSelectedRouteIds: string[],
    routeClickRef: React.MutableRefObject<TripMapChartProps['onRouteClick']>,
    nextRouteSignature: string,
  ) {
    const routeColors = getRouteColors();
    const geojson = {
      type: 'FeatureCollection' as const,
      features: nextRoutes.map((route, index) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: route.track.map((point) => [point.lng, point.lat]),
        },
        properties: {
          id: route.id,
          color: route.color?.trim() || routeColors[index % routeColors.length],
          selected: nextSelectedRouteIds.includes(route.id),
        },
      })),
    };

    const source = map.getSource(ROUTE_SOURCE_ID);
    if (source) {
      source.setData(geojson);
    } else {
      map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: geojson });
    }

    if (!map.getLayer(ROUTE_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['boolean', ['get', 'selected'], false], 5, 3],
          'line-opacity': 0.9,
        },
      });
    }

    if (!map.getLayer(ROUTE_HIT_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_HIT_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        paint: {
          'line-color': 'transparent',
          'line-width': 18,
          'line-opacity': 0,
        },
      });

      map.on('click', ROUTE_HIT_LAYER_ID, (event) => {
        const id = (event as { features?: Array<{ properties?: { id?: unknown } }> } | undefined)
          ?.features?.[0]?.properties?.id;
        if (typeof id === 'string') routeClickRef.current?.(id);
      });
      map.on('mouseenter', ROUTE_HIT_LAYER_ID, () => {
        map.getCanvas().style.cursor = routeClickRef.current ? 'pointer' : '';
      });
      map.on('mouseleave', ROUTE_HIT_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    if (nextRoutes.length === 0) {
      lastRouteSignatureRef.current = nextRouteSignature;
      return;
    }

    const shouldRefit = lastRouteSignatureRef.current !== nextRouteSignature;
    if (shouldRefit) {
      map.fitBounds(getRouteBounds(nextRoutes), { padding: 48, animate: false });
      map.resize();
      lastRouteSignatureRef.current = nextRouteSignature;
    }

  }

  const attributionId = React.useId();
  const attributionLinks = (
    <>
      {basemap.attributions?.map((item, index) => <React.Fragment key={`${item.label}-${index}`}>{index > 0 ? ' · ' : ''}{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-fg">{item.label}</a> : item.label}</React.Fragment>)}
      {!basemap.attributions?.length && (basemap.attribution_url ? <a href={basemap.attribution_url} target="_blank" rel="noopener noreferrer" className="hover:text-fg">{basemap.attribution}</a> : basemap.attribution)}
    </>
  );

  return (
    !hasMapContent ? (
      <div
        style={{ height }}
        className={className ?? 'w-full rounded-xl border border-border bg-bg-elevated flex items-center justify-center text-sm text-fg-tertiary'}
      >
        {emptyLabel}
      </div>
    ) : (
      <div className="relative">
        {focusMarkerElement && hasFocusMarker ? createPortal(focusMarker, focusMarkerElement) : null}
        <div
          ref={containerRef}
          style={{ height }}
          className={className ?? 'w-full rounded-xl overflow-hidden'}
        />
        {basemap.enabled && ((basemap.attributions?.length ?? 0) > 0 || basemap.attribution) ? (
          compactAttribution ? (
            <div className="absolute bottom-1 right-1 flex max-w-[calc(100%-0.5rem)] items-end justify-end gap-1">
              {attributionOpen ? (
                <div id={attributionId} className="rounded bg-bg/90 px-1.5 py-0.5 text-right text-[10px] leading-snug text-fg-tertiary">
                  {attributionLinks}
                </div>
              ) : null}
              <button
                type="button"
                aria-label={attributionOpen ? 'Hide map credits' : 'Show map credits'}
                aria-expanded={attributionOpen}
                aria-controls={attributionOpen ? attributionId : undefined}
                onClick={() => setAttributionOpen((open) => !open)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg/80 text-fg-tertiary hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="absolute bottom-1 right-1 max-w-[calc(100%-0.5rem)] rounded bg-bg/80 px-1.5 py-0.5 text-right text-[10px] text-fg-tertiary">
              {attributionLinks}
            </div>
          )
        ) : null}
        {showTilesLoading && !mapError && !basemapError ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/40 p-4"
          >
            <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-secondary shadow-lg">
              <Loader2 aria-hidden="true" className="h-4 w-4 text-accent motion-safe:animate-spin" />
              <span>Loading map…</span>
            </div>
          </div>
        ) : null}
        {mapError || basemapError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/70 p-4 text-center">
            <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-secondary shadow-lg">
              <p>{basemapError ?? mapError}</p>
              {(basemapError ? onBasemapRetry : mapError ? retryMap : undefined) ? (
                <button
                  type="button"
                  onClick={() => {
                    if (basemapError) onBasemapRetry?.();
                    else retryMap();
                  }}
                  className="mt-1 font-medium text-accent hover:underline"
                >
                  Retry
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  );
}

function mapLibreErrorDetails(event: unknown): {
  error: unknown;
  status?: number | undefined;
  resourceKind?: string | undefined;
  sourceId?: string | undefined;
  url?: string | undefined;
} {
  if (!isRecord(event)) return { error: event };

  const nestedError = isRecord(event.error) ? event.error : undefined;
  const status = finiteNumber(event.status) ?? (nestedError ? finiteNumber(nestedError.status) : undefined);
  const url = firstString(event.url, nestedError?.url, event.resource, event.source);
  const sourceId = firstString(event.sourceId, nestedError?.sourceId);
  const resourceKind = firstString(event.resourceType, nestedError?.resourceType, event.type);

  return {
    error: nestedError ?? event.error ?? event,
    status,
    resourceKind,
    sourceId,
    url,
  };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function syncActivePoint(
  map: MapApi,
  point: LatLng | null | undefined,
  lastPointRef: React.MutableRefObject<LatLng | null>,
) {
  if (!point) {
    lastPointRef.current = null;
    if (map.getLayer(ACTIVE_POINT_LAYER_ID)) map.removeLayer(ACTIVE_POINT_LAYER_ID);
    if (map.getSource(ACTIVE_POINT_SOURCE_ID)) map.removeSource(ACTIVE_POINT_SOURCE_ID);
    return;
  }

  const previousPoint = lastPointRef.current;
  if (
    previousPoint
    && previousPoint.lat === point.lat
    && previousPoint.lng === point.lng
    && map.getLayer(ACTIVE_POINT_LAYER_ID)
  ) {
    map.setPaintProperty(ACTIVE_POINT_LAYER_ID, 'circle-color', getCssColor('--rm-accent', FALLBACK_ACTIVE_POINT_COLOR));
    map.setPaintProperty(ACTIVE_POINT_LAYER_ID, 'circle-stroke-color', getCssColor('--rm-bg-surface', CHART_COLORS.muted));
    return;
  }

  lastPointRef.current = point;

  const geojson = {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [point.lng, point.lat],
    },
    properties: {},
  };

  const source = map.getSource(ACTIVE_POINT_SOURCE_ID);
  if (source) {
    source.setData(geojson);
  } else {
    map.addSource(ACTIVE_POINT_SOURCE_ID, { type: 'geojson', data: geojson });
  }

  if (!map.getLayer(ACTIVE_POINT_LAYER_ID)) {
    map.addLayer({
      id: ACTIVE_POINT_LAYER_ID,
      type: 'circle',
      source: ACTIVE_POINT_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': getCssColor('--rm-accent', FALLBACK_ACTIVE_POINT_COLOR),
        'circle-stroke-width': 2,
        'circle-stroke-color': getCssColor('--rm-bg-surface', CHART_COLORS.muted),
      },
    });
  }
}

function applyPerspective(map: MapApi, basemap: BasemapConfig, preference: MapStylePreference) {
  const perspective = resolveStyleDescriptor(basemap, preference, 'light').descriptor?.perspective_3d === true;
  if (perspective) {
    map.setPitch?.(45);
    map.setBearing?.(-15);
    map.dragRotate?.enable();
  } else {
    map.setPitch?.(0);
    map.setBearing?.(0);
    map.dragRotate?.disable();
  }
}

function getRouteColors(): string[] {
  return FALLBACK_ROUTE_COLORS.map((fallbackColor, i) => getCssColor(`--rm-map-route-${i}`, fallbackColor));
}

function getCssColor(variableName: string, fallbackColor: string) {
  if (typeof document === 'undefined') return fallbackColor;

  const color = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return color || fallbackColor;
}

function getRouteBounds(routeList: TripMapRoute[]) {
  const allPoints = routeList.flatMap((route) => route.track);
  const first = allPoints[0]!;

  return allPoints.reduce(
    (bounds, point) => [[Math.min(bounds[0][0], point.lng), Math.min(bounds[0][1], point.lat)],
      [Math.max(bounds[1][0], point.lng), Math.max(bounds[1][1], point.lat)]] as [[number, number], [number, number]],
    [[first.lng, first.lat], [first.lng, first.lat]] as [[number, number], [number, number]],
  );
}

function serializePoint(point: LatLng | undefined) {
  return point ? `${point.lat.toFixed(5)},${point.lng.toFixed(5)}` : 'none';
}
