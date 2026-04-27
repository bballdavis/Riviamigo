import * as React from 'react';

export interface LatLng { lat: number; lng: number; }

export interface TripMapChartProps {
  track: LatLng[];
  startPoint?: LatLng;
  endPoint?: LatLng;
  height?: number;
  className?: string;
}

/**
 * Lazy-loads MapLibre GL to avoid bundling it in SSR/test contexts.
 * The map renders a single polyline for the trip track.
 */
export function TripMapChart({ track, height = 320, className }: TripMapChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<unknown>(null);

  React.useEffect(() => {
    if (!containerRef.current || track.length === 0) return;

    let map: {
      remove(): void;
      addControl(c: unknown): void;
      on(event: string, cb: () => void): void;
    };

    (async () => {
      const maplibregl = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');

      const bounds = track.reduce(
        (b, p) => [[Math.min(b[0][0], p.lng), Math.min(b[0][1], p.lat)],
                   [Math.max(b[1][0], p.lng), Math.max(b[1][1], p.lat)]] as [[number,number],[number,number]],
        [[track[0].lng, track[0].lat], [track[0].lng, track[0].lat]] as [[number,number],[number,number]]
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
        const geojson = {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: track.map((p) => [p.lng, p.lat]),
          },
          properties: {},
        };

        (map as unknown as {
          addSource(id: string, source: unknown): void;
          addLayer(layer: unknown): void;
        }).addSource('trip', { type: 'geojson', data: geojson });
        (map as unknown as {
          addSource(id: string, source: unknown): void;
          addLayer(layer: unknown): void;
        }).addLayer({
          id: 'trip-line',
          type: 'line',
          source: 'trip',
          paint: {
            'line-color': '#F59E0B',
            'line-width': 3,
            'line-opacity': 0.9,
          },
        });
      });
    })();

    return () => {
      map?.remove();
    };
  }, [track]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className={className ?? 'w-full rounded-xl overflow-hidden'}
    />
  );
}
