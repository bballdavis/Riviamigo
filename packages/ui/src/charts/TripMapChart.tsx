import * as React from 'react';
import { CHART_COLORS } from './ChartProvider';

export interface LatLng { lat: number; lng: number; }

export interface TripMapRoute {
  id: string;
  track: LatLng[];
  color?: string;
}

export type MapStyleMode = 'dark' | 'light';

interface BasemapConfig {
  enabled: boolean;
  light_url: string;
  dark_url: string;
  attribution: string | null;
  attribution_url: string | null;
}

export interface TripMapChartProps {
  track: LatLng[];
  routes?: TripMapRoute[];
  selectedRouteIds?: string[];
  onRouteClick?: (routeId: string) => void;
  activePoint?: LatLng | null;
  startPoint?: LatLng;
  endPoint?: LatLng;
  height?: number;
  className?: string;
  mapStyle?: MapStyleMode;
  /** Bearer token used only for Riviamigo's same-origin basemap proxy. */
  accessToken?: string | null;
  mapLoader?: typeof loadMapLibre;
}

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
  addSource(id: string, source: unknown): void;
  getSource(id: string): MapSourceApi | undefined;
  removeSource(id: string): void;
  addLayer(layer: unknown): void;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  getCanvas(): { style: CSSStyleDeclaration };
  setStyle(style: unknown): void;
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

const NEUTRAL_BASEMAP: BasemapConfig = {
  enabled: false,
  dark_url: '',
  light_url: '',
  attribution: null,
  attribution_url: null,
};

function buildMapLibreStyle(mode: MapStyleMode, basemap: BasemapConfig) {
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
  return {
    version: 8 as const,
    sources: {
      'carto-base': {
        type: 'raster' as const,
        tiles: [mode === 'dark' ? basemap.dark_url : basemap.light_url],
        tileSize: 256,
        attribution: basemap.attribution ?? '',
      },
    },
    layers: [{ id: 'background', type: 'raster' as const, source: 'carto-base' }],
  };
}

function basemapSignature(basemap: BasemapConfig, mode: MapStyleMode) {
  return `${mode}|${basemap.enabled}|${basemap.light_url}|${basemap.dark_url}`;
}

export async function loadMapLibre() {
  const maplibregl = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');
  return maplibregl.default;
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
  height = 320,
  className,
  mapStyle = 'dark',
  accessToken = null,
  mapLoader = loadMapLibre,
}: TripMapChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapApi | null>(null);
  const isLoadedRef = React.useRef(false);
  const lastRouteSignatureRef = React.useRef<string>('');
  const onRouteClickRef = React.useRef(onRouteClick);
  const latestRoutesRef = React.useRef<TripMapRoute[]>([]);
  const latestSelectedRouteIdsRef = React.useRef<string[]>([]);
  const latestActivePointRef = React.useRef<LatLng | null | undefined>(activePoint);
  const latestVisibleRouteSignatureRef = React.useRef<string>('');
  const activePointFrameRef = React.useRef<number | null>(null);
  const lastActivePointRef = React.useRef<LatLng | null>(null);
  const accessTokenRef = React.useRef<string | null>(accessToken);
  const basemapRef = React.useRef<BasemapConfig>(NEUTRAL_BASEMAP);
  const appliedBasemapSignatureRef = React.useRef('');
  const [basemap, setBasemap] = React.useState<BasemapConfig>(NEUTRAL_BASEMAP);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [configRetry, setConfigRetry] = React.useState(0);

  React.useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  React.useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);

  React.useEffect(() => {
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    const requestInit: RequestInit = accessToken
      ? { credentials: 'same-origin', headers: { Authorization: `Bearer ${accessToken}` } }
      : { credentials: 'same-origin' };
    setMapError(null);
    fetch('/v1/external/basemap/config', requestInit)
      .then((response) => response.ok
        ? response.json() as Promise<BasemapConfig>
        : Promise.reject(new Error('Basemap configuration unavailable')))
      .then((config) => { if (!cancelled) setBasemap(config); })
      .catch(() => {
        if (!cancelled) {
          setBasemap(NEUTRAL_BASEMAP);
          setMapError('Map tiles unavailable');
        }
      });
    return () => { cancelled = true; };
  }, [accessToken, configRetry]);

  const routeList = React.useMemo(
    () => (routes?.length ? routes : [{ id: 'trip', track }]).filter((route) => route.track.length > 1),
    [routes, track],
  );
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
    latestActivePointRef.current = activePoint;
    latestVisibleRouteSignatureRef.current = visibleRouteSignature;
  }, [activePoint, selectedRouteIds, visibleRouteSignature, visibleRoutes]);

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ── Map creation — runs once when the first routes become available ─────────
  // The map instance is kept alive for the lifetime of the component.  Style
  // changes (dark↔light) are applied via setStyle() on the existing instance
  // rather than destroying and recreating the map, which avoids losing the
  // in-GPU tile cache and triggering a "WebGL context was lost" error.
  React.useEffect(() => {
    if (!containerRef.current || routeList.length === 0 || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const maplibregl = await mapLoader();

      if (cancelled || !containerRef.current) return;

      const firstPoint = routeList[0]?.track[0];
      if (!firstPoint) return;

      const initialBasemap = basemapRef.current;
      appliedBasemapSignatureRef.current = basemapSignature(initialBasemap, mapStyle);
      const map = new maplibregl.Map({
        container: containerRef.current!,
        style: buildMapLibreStyle(mapStyle, initialBasemap),
        center: [firstPoint.lng, firstPoint.lat],
        zoom: 12,
        attributionControl: false,
        transformRequest: (url: string) => {
          try {
            const requestUrl = new URL(url, window.location.origin);
            if (requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith('/v1/external/basemap/')) {
              const token = accessTokenRef.current;
              return token ? { url, headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin' } : { url, credentials: 'same-origin' };
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

      map.on('error', () => {
        if (basemapRef.current.enabled) setMapError('Map tiles unavailable');
      });

      map.on('load', () => {
        if (!mapRef.current) return;

        isLoadedRef.current = true;
        lastRouteSignatureRef.current = '';
        syncRoutes(
          mapRef.current,
          latestRoutesRef.current,
          latestSelectedRouteIdsRef.current,
          onRouteClickRef,
          latestVisibleRouteSignatureRef.current,
        );
        syncActivePoint(mapRef.current, latestActivePointRef.current, lastActivePointRef);
        // Configuration can arrive after the map is constructed but before
        // its initial style loads. Reapply it after route sync; the regular
        // style-load handler below restores the route source after the swap.
        const currentSignature = basemapSignature(basemapRef.current, mapStyle);
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
            syncActivePoint(map, latestActivePointRef.current, lastActivePointRef);
          };
          map.on('style.load', restoreAfterInitialSwap);
          map.setStyle(buildMapLibreStyle(mapStyle, basemapRef.current));
        }
        requestAnimationFrame(() => {
          mapRef.current?.resize();
        });
      });
    })();

    return () => {
      cancelled = true;
      isLoadedRef.current = false;
      lastRouteSignatureRef.current = '';
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Only run when the first routes arrive — NOT on mapStyle change so that
    // toggling dark/light doesn't destroy the map instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoader, routeList.length === 0]);

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
      syncActivePoint(map, latestActivePointRef.current, lastActivePointRef);
    }

    map.on('style.load', onStyleLoad);
    appliedBasemapSignatureRef.current = basemapSignature(basemap, mapStyle);
    map.setStyle(buildMapLibreStyle(mapStyle, basemap));

    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [basemap, mapStyle]);

  // Sync routes whenever routes or selection changes
  React.useEffect(() => {
    if (!isLoadedRef.current || !mapRef.current || routeList.length === 0) return;

    syncRoutes(mapRef.current, visibleRoutes, selectedRouteIds, onRouteClickRef, visibleRouteSignature);
  }, [selectedRouteIds, visibleRouteSignature, visibleRoutes]);

  React.useEffect(() => {
    if (!isLoadedRef.current || !mapRef.current) return;
    if (activePointFrameRef.current !== null) {
      cancelAnimationFrame(activePointFrameRef.current);
    }

    activePointFrameRef.current = requestAnimationFrame(() => {
      activePointFrameRef.current = null;
      const map = mapRef.current;
      if (!map) return;
      syncActivePoint(map, activePoint, lastActivePointRef);
    });

    return () => {
      if (activePointFrameRef.current !== null) {
        cancelAnimationFrame(activePointFrameRef.current);
      }
    };
  }, [activePoint]);

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
          color: route.color?.trim() || routeColors[stableColorIndex(route.id, index) % routeColors.length],
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

  return (
    routeList.length === 0 ? (
      <div
        style={{ height }}
        className={className ?? 'w-full rounded-xl border border-border bg-bg-elevated flex items-center justify-center text-sm text-fg-tertiary'}
      >
        No route points in this period
      </div>
    ) : (
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className={className ?? 'w-full rounded-xl overflow-hidden'}
        />
        {basemap.enabled && basemap.attribution ? (
          basemap.attribution_url ? (
            <a href={basemap.attribution_url} target="_blank" rel="noopener noreferrer" className="absolute bottom-1 right-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-tertiary hover:text-fg">
              {basemap.attribution}
            </a>
          ) : (
            <span className="absolute bottom-1 right-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-tertiary">{basemap.attribution}</span>
          )
        ) : null}
        {mapError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/70 p-4 text-center">
            <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-secondary shadow-lg">
              <p>{mapError}</p>
              <button type="button" onClick={() => setConfigRetry((value) => value + 1)} className="mt-1 font-medium text-accent hover:underline">Retry</button>
            </div>
          </div>
        ) : null}
      </div>
    )
  );
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
  ) {
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
        'circle-stroke-color': getCssColor('--rm-bg', CHART_COLORS.muted),
      },
    });
  }
}

function getRouteColors(): string[] {
  return FALLBACK_ROUTE_COLORS.map((fallbackColor, i) => getCssColor(`--rm-map-route-${i}`, fallbackColor));
}

function stableColorIndex(routeId: string, fallbackIndex: number) {
  let hash = fallbackIndex;
  for (let index = 0; index < routeId.length; index += 1) {
    hash = ((hash << 5) - hash + routeId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
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
