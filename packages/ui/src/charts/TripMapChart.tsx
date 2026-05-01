import * as React from 'react';

export interface LatLng { lat: number; lng: number; }

export interface TripMapRoute {
  id: string;
  track: LatLng[];
  color?: string;
}

export interface TripMapChartProps {
  track: LatLng[];
  routes?: TripMapRoute[];
  selectedRouteIds?: string[];
  onRouteClick?: (routeId: string) => void;
  startPoint?: LatLng;
  endPoint?: LatLng;
  height?: number;
  className?: string;
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
}: TripMapChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<unknown>(null);
  const routeList = React.useMemo(
    () => (routes?.length ? routes : [{ id: 'trip', track }]).filter((route) => route.track.length > 1),
    [routes, track],
  );

  React.useEffect(() => {
    if (!containerRef.current || routeList.length === 0) return;

    let map: {
      remove(): void;
      on(event: string, cb: () => void): void;
    };

    (async () => {
      const maplibregl = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');

      const allPoints = routeList.flatMap((route) => route.track);
      const first = allPoints[0]!;
      const bounds = allPoints.reduce(
        (b, p) => [[Math.min(b[0][0], p.lng), Math.min(b[0][1], p.lat)],
                   [Math.max(b[1][0], p.lng), Math.max(b[1][1], p.lat)]] as [[number,number],[number,number]],
        [[first.lng, first.lat], [first.lng, first.lat]] as [[number,number],[number,number]]
      );

      map = new maplibregl.default.Map({
        container: containerRef.current!,
        style: {
          version: 8,
          sources: {
            'carto-dark': {
              type: 'raster',
              tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap © CARTO',
            },
          },
          layers: [{ id: 'background', type: 'raster', source: 'carto-dark' }],
        },
        bounds,
        fitBoundsOptions: { padding: 48 },
        attributionControl: false,
      }) as typeof map;

      mapRef.current = map;

      map.on('load', () => {
        const api = map as unknown as {
          addSource(id: string, source: unknown): void;
          addLayer(layer: unknown): void;
          on(event: string, layerId: string, cb: (event: unknown) => void): void;
          getCanvas(): { style: CSSStyleDeclaration };
        };

        routeList.forEach((route, index) => {
          const sourceId = `trip-${route.id}`;
          const lineId = `${sourceId}-line`;
          const hitId = `${sourceId}-hit`;
          const selected = selectedRouteIds.includes(route.id);
          const dimUnselected = selectedRouteIds.length > 0 && !selected;
          const geojson = {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: route.track.map((p) => [p.lng, p.lat]),
            },
            properties: { id: route.id },
          };

          api.addSource(sourceId, { type: 'geojson', data: geojson });
          api.addLayer({
            id: lineId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': selected ? '#F59E0B' : (route.color ?? ROUTE_COLORS[index % ROUTE_COLORS.length]),
              'line-width': selected ? 5 : 3,
              'line-opacity': dimUnselected ? 0.28 : 0.9,
            },
          });
          api.addLayer({
            id: hitId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': '#000000',
              'line-width': 18,
              'line-opacity': 0,
            },
          });

          if (onRouteClick) {
            api.on('click', hitId, () => onRouteClick(route.id));
            api.on('mouseenter', hitId, () => {
              api.getCanvas().style.cursor = 'pointer';
            });
            api.on('mouseleave', hitId, () => {
              api.getCanvas().style.cursor = '';
            });
          }
        });
      });
    })();

    return () => {
      map?.remove();
    };
  }, [onRouteClick, routeList, selectedRouteIds]);

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
