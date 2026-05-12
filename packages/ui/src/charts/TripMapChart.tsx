import * as React from 'react';

export interface LatLng { lat: number; lng: number; }

export interface TripMapRoute {
  id: string;
  track: LatLng[];
  color?: string;
}

export type MapStyleMode = 'dark' | 'light';

export interface TripMapChartProps {
  track: LatLng[];
  routes?: TripMapRoute[];
  selectedRouteIds?: string[];
  onRouteClick?: (routeId: string) => void;
  startPoint?: LatLng;
  endPoint?: LatLng;
  height?: number;
  className?: string;
  mapStyle?: MapStyleMode;
}

interface MapSourceApi {
  setData(data: unknown): void;
}

interface MapApi {
  remove(): void;
  on(event: string, cb: () => void): void;
  on(event: string, layerId: string, cb: () => void): void;
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

const TILE_URLS: Record<MapStyleMode, string> = {
  dark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  light: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
};

function buildMapLibreStyle(mode: MapStyleMode) {
  return {
    version: 8 as const,
    sources: {
      'carto-base': {
        type: 'raster' as const,
        tiles: [TILE_URLS[mode]],
        tileSize: 256,
        attribution: '© OpenStreetMap © CARTO',
      },
    },
    layers: [{ id: 'background', type: 'raster' as const, source: 'carto-base' }],
  };
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
  height = 320,
  className,
  mapStyle = 'dark',
}: TripMapChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapApi | null>(null);
  const isLoadedRef = React.useRef(false);
  const syncedRouteIdsRef = React.useRef<string[]>([]);
  const lastRouteSignatureRef = React.useRef<string>('');
  const onRouteClickRef = React.useRef(onRouteClick);

  const routeList = React.useMemo(
    () => (routes?.length ? routes : [{ id: 'trip', track }]).filter((route) => route.track.length > 1),
    [routes, track],
  );
  const routeSignature = React.useMemo(
    () => routeList.map((route) => `${route.id}:${route.track.length}:${serializePoint(route.track[0])}:${serializePoint(route.track.at(-1))}`).join('|'),
    [routeList],
  );

  React.useEffect(() => {
    onRouteClickRef.current = onRouteClick;
  }, [onRouteClick]);

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Create or recreate the map when the route set or theme style changes.
  React.useEffect(() => {
    if (!containerRef.current || routeList.length === 0 || mapRef.current) return;

    let cancelled = false;
    let map: MapApi | null = null;

    (async () => {
      const maplibregl = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');

      if (cancelled || !containerRef.current) return;

      const firstPoint = routeList[0]?.track[0];
      if (!firstPoint) return;

      map = new maplibregl.default.Map({
        container: containerRef.current!,
        style: buildMapLibreStyle(mapStyle),
        center: [firstPoint.lng, firstPoint.lat],
        zoom: 12,
        attributionControl: false,
      }) as MapApi;

      mapRef.current = map;

      map.on('load', () => {
        if (!mapRef.current) return;

        isLoadedRef.current = true;
        syncRoutes(mapRef.current, routeList, selectedRouteIds, onRouteClickRef);
        requestAnimationFrame(() => {
          mapRef.current?.resize();
        });
      });
    })();

    return () => {
      cancelled = true;
      isLoadedRef.current = false;
      syncedRouteIdsRef.current = [];
      lastRouteSignatureRef.current = '';
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [routeList.length, mapStyle]);

  // Sync routes whenever routes or selection changes
  React.useEffect(() => {
    if (!isLoadedRef.current || !mapRef.current || routeList.length === 0) return;

    syncRoutes(mapRef.current, routeList, selectedRouteIds, onRouteClickRef);
  }, [routeList, routeSignature, selectedRouteIds]);

  function syncRoutes(
    map: MapApi,
    nextRoutes: TripMapRoute[],
    nextSelectedRouteIds: string[],
    routeClickRef: React.MutableRefObject<TripMapChartProps['onRouteClick']>,
  ) {
    const nextRouteIds = new Set(nextRoutes.map((route) => route.id));

    syncedRouteIdsRef.current.forEach((routeId) => {
      if (nextRouteIds.has(routeId)) return;
      const sourceId = `trip-${routeId}`;
      const lineId = `${sourceId}-line`;
      const hitId = `${sourceId}-hit`;

      if (map.getLayer(hitId)) map.removeLayer(hitId);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    });

    nextRoutes.forEach((route, index) => {
      const sourceId = `trip-${route.id}`;
      const lineId = `${sourceId}-line`;
      const hitId = `${sourceId}-hit`;
      const selected = nextSelectedRouteIds.includes(route.id);
      const dimUnselected = nextSelectedRouteIds.length > 0 && !selected;
      const geojson = {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: route.track.map((point) => [point.lng, point.lat]),
        },
        properties: { id: route.id },
      };

      const source = map.getSource(sourceId);
      if (source) {
        source.setData(geojson);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geojson });
      }

      if (!map.getLayer(lineId)) {
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': route.color ?? ROUTE_COLORS[index % ROUTE_COLORS.length],
            'line-width': 3,
            'line-opacity': 0.9,
          },
        });
      }

      if (!map.getLayer(hitId)) {
        map.addLayer({
          id: hitId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': '#000000',
            'line-width': 18,
            'line-opacity': 0,
          },
        });

        map.on('click', hitId, () => {
          routeClickRef.current?.(route.id);
        });
        map.on('mouseenter', hitId, () => {
          map.getCanvas().style.cursor = routeClickRef.current ? 'pointer' : '';
        });
        map.on('mouseleave', hitId, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      map.setPaintProperty(lineId, 'line-color', selected ? '#F59E0B' : (route.color ?? ROUTE_COLORS[index % ROUTE_COLORS.length]));
      map.setPaintProperty(lineId, 'line-width', selected ? 5 : 3);
      map.setPaintProperty(lineId, 'line-opacity', dimUnselected ? 0.28 : 0.9);
    });

    const shouldRefit = lastRouteSignatureRef.current !== routeSignature;
    if (shouldRefit) {
      map.fitBounds(getRouteBounds(nextRoutes), { padding: 48, animate: false });
      map.resize();
      lastRouteSignatureRef.current = routeSignature;
    }

    syncedRouteIdsRef.current = nextRoutes.map((route) => route.id);
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
      <div
        ref={containerRef}
        style={{ height }}
        className={className ?? 'w-full rounded-xl overflow-hidden'}
      />
    )
  );
}

const ROUTE_COLORS = ['#38BDF8', '#34D399', '#A78BFA', '#F472B6', '#F59E0B', '#F87171'];

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
