import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MAP_TILE_LOAD_TIMEOUT_MS,
  MAP_TILE_LOADING_INDICATOR_DELAY_MS,
  TripMapChart,
  type TripMapRoute,
} from '../../../../packages/ui/src/charts/TripMapChart';

type MapHandler = (event?: unknown) => void;

class MockMap {
  handlers = new Map<string, MapHandler[]>();
  sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  layers = new Set<string>();
  fitBounds = vi.fn();
  resize = vi.fn();
  remove = vi.fn();
  addLayer = vi.fn((layer: { id: string }) => {
    this.layers.add(layer.id);
  });
  getLayer = vi.fn((id: string) => this.layers.has(id) ? { id } : undefined);
  removeLayer = vi.fn((id: string) => {
    this.layers.delete(id);
  });
  addSource = vi.fn((id: string, _source?: unknown) => {
    this.sources.set(id, { setData: vi.fn() });
  });
  getSource = vi.fn((id: string) => this.sources.get(id));
  removeSource = vi.fn((id: string) => {
    this.sources.delete(id);
  });
  setPaintProperty = vi.fn();
  getCanvas = vi.fn(() => ({ style: {} as CSSStyleDeclaration }));
  setStyle = vi.fn();
  triggerRepaint = vi.fn();
  setPitch = vi.fn();
  setBearing = vi.fn();
  dragRotate = { enable: vi.fn(), disable: vi.fn() };

  on = vi.fn((event: string, layerIdOrHandler: string | MapHandler, maybeHandler?: MapHandler) => {
    if (typeof layerIdOrHandler === 'function') {
      const list = this.handlers.get(event) ?? [];
      list.push(layerIdOrHandler);
      this.handlers.set(event, list);
      return;
    }
    if (maybeHandler) {
      const list = this.handlers.get(`${event}:${layerIdOrHandler}`) ?? [];
      list.push(maybeHandler);
      this.handlers.set(`${event}:${layerIdOrHandler}`, list);
    }
  });

  off = vi.fn();

  emit(event: string, payload?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

function buildRoutes(count: number): TripMapRoute[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `trip-${index + 1}`,
    track: [
      { lat: index, lng: index },
      { lat: index + 0.1, lng: index + 0.1 },
    ],
  }));
}

const THEMED_STYLE_OPTIONS = expect.objectContaining({ transformStyle: expect.any(Function) });

const VECTOR_CONFIG = {
  enabled: true,
  provider_preference: 'openfreemap' as const,
  resolved_provider: 'openfreemap' as const,
  revision: 'vector-2',
  attributions: [],
  styles: [
    { id: 'follow-theme' as const, label: 'Follow appearance', kind: 'style' as const, light_url: '/v1/external/basemap/openfreemap/styles/positron?v=2', dark_url: '/v1/external/basemap/openfreemap/styles/dark?v=2', perspective_3d: false },
    { id: 'positron' as const, label: 'Positron', kind: 'style' as const, light_url: '/v1/external/basemap/openfreemap/styles/positron?v=2', dark_url: '/v1/external/basemap/openfreemap/styles/positron?v=2', perspective_3d: false },
  ],
};

const RASTER_CONFIG = {
  enabled: true,
  provider_preference: 'carto' as const,
  resolved_provider: 'carto' as const,
  revision: 'raster-1',
  attributions: [],
  styles: [{ id: 'follow-theme' as const, label: 'Follow appearance', kind: 'raster' as const, light_url: '/v1/external/basemap/light/{z}/{x}/{y}.png', dark_url: '/v1/external/basemap/dark/{z}/{x}/{y}.png', perspective_3d: false }],
};

interface StyleFixture { sources: Record<string, unknown>; layers: Array<{ id: string; type: string; source?: string; 'source-layer'?: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> }> }

function stockStyleFixture(): StyleFixture {
  return {
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': 'rgb(27,27,29)' } },
      { id: 'highway_minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#181818' } },
      { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': '{name}' }, paint: { 'text-color': 'rgb(101,101,101)', 'text-halo-width': 1 } },
      { id: 'trip-routes-line', type: 'line', source: 'trip-routes', paint: { 'line-color': ['get', 'color'] } },
    ],
  };
}

describe('TripMapChart', () => {
  it('shows a loading indicator instead of tile errors while the first tiles load', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={{ enabled: true, resolved_provider: 'openfreemap', revision: 'vector-1' }}
        mapLoader={mapLoader as never}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Loading map…');
    await act(async () => {
      mockMap.emit('error', { error: new Error('tile timed out'), status: 504, sourceId: 'planet', resourceType: 'Tile' });
      mockMap.emit('load');
    });

    // A slow or failed tile during the initial load is logged but is not an outage.
    expect(consoleError).toHaveBeenCalled();
    expect(screen.queryByText('Map tiles unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading map…');

    await act(async () => mockMap.emit('idle'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Map tiles unavailable')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('reports tiles unavailable only after the load timeout passes without an idle map', async () => {
    vi.useFakeTimers();
    try {
      const mockMap = new MockMap();
      const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      render(
        <TripMapChart
          routes={buildRoutes(1)}
          track={[]}
          basemapConfig={{ enabled: true, resolved_provider: 'openfreemap', revision: 'vector-1' }}
          mapLoader={mapLoader as never}
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(MAP_TILE_LOAD_TIMEOUT_MS - 1);
        mockMap.emit('error', { error: new Error('style request failed'), status: 503 });
      });
      expect(screen.getByRole('status')).toHaveTextContent('Loading map…');
      expect(screen.queryByText('Map tiles unavailable')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('Map tiles unavailable')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      // Retry restarts the loading state rather than leaving the error up.
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(screen.queryByText('Map tiles unavailable')).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MAP_TILE_LOADING_INDICATOR_DELAY_MS);
      });
      expect(screen.getByRole('status')).toHaveTextContent('Loading map…');
      expect(mockMap.triggerRepaint).toHaveBeenCalled();
      consoleError.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs MapLibre failures after loading and retries the active style', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const config = {
      enabled: true,
      resolved_provider: 'openfreemap' as const,
      revision: 'vector-1',
      attributions: [],
      styles: [{
        id: 'follow-theme' as const,
        label: 'Follow appearance',
        kind: 'style' as const,
        light_url: '/v1/external/basemap/openfreemap/styles/positron?v=1',
        dark_url: '/v1/external/basemap/openfreemap/styles/dark?v=1',
        perspective_3d: false,
      }],
    };

    render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={config}
        mapStyle="light"
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockMap.emit('load');
      mockMap.emit('idle');
      mockMap.emit('error', {
        error: new Error('style request failed'),
        status: 503,
        url: '/v1/external/basemap/openfreemap/planet/1/2/3.pbf',
        sourceId: 'planet',
        resourceType: 'Tile',
      });
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[Riviamigo client] maplibre.error: Error: style request failed'),
      expect.objectContaining({
        event: 'maplibre.error',
        status: 503,
        provider: 'openfreemap',
        resourceKind: 'Tile',
        url: '/v1/external/basemap/openfreemap/planet/<tile>.pbf',
      }),
    );
    expect(screen.getByText('Map tiles unavailable')).toBeInTheDocument();

    mockMap.setStyle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockMap.setStyle).toHaveBeenCalledWith('/v1/external/basemap/openfreemap/styles/positron?v=1', THEMED_STYLE_OPTIONS);
    consoleError.mockRestore();
  });

  it('ignores expected resource aborts during a MapLibre style swap', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={{
          enabled: true,
          resolved_provider: 'openfreemap',
          revision: 'vector-1',
          attributions: [],
          styles: [{
            id: 'follow-theme',
            label: 'Follow appearance',
            kind: 'style',
            light_url: '/v1/external/basemap/openfreemap/styles/positron?v=1',
            dark_url: '/v1/external/basemap/openfreemap/styles/dark?v=1',
            perspective_3d: false,
          }],
        }}
        mapStyle="light"
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockMap.emit('load');
      mockMap.emit('error', { error: new DOMException('The operation was aborted', 'AbortError') });
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(screen.queryByText('Map tiles unavailable')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('shows and retries the map recovery state when MapLibre initialization fails', async () => {
    const mockMap = new MockMap();
    const mapConstructor = vi.fn(function Map() { return mockMap; });
    const mapLoader = vi.fn()
      .mockRejectedValueOnce(new Error('MapLibre failed to load'))
      .mockResolvedValue({ Map: mapConstructor });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={{ enabled: true, resolved_provider: 'openfreemap', revision: 'vector-1' }}
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(screen.getByText('Map tiles unavailable')).toBeInTheDocument());
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[Riviamigo client] maplibre.initialization_failed: Error: MapLibre failed to load'),
      expect.objectContaining({ event: 'maplibre.initialization_failed', area: 'map' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(2));
    expect(mapConstructor).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('keeps configuration failures distinct from tile failures', () => {
    render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapError="Map configuration unavailable"
        onBasemapRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Map configuration unavailable')).toBeInTheDocument();
  });

  it('maps Follow appearance to Positron in light mode and Dark in dark mode', async () => {
    const mockMap = new MockMap();
    const mapConstructor = vi.fn(function Map(_options: unknown) { return mockMap; });
    const mapLoader = vi.fn(async () => ({ Map: mapConstructor }));
    const config = {
      enabled: true,
      provider_preference: 'openfreemap' as const,
      resolved_provider: 'openfreemap' as const,
      revision: 'vector-theme-1',
      attributions: [],
      styles: [{
        id: 'follow-theme' as const,
        label: 'Follow appearance',
        kind: 'style' as const,
        light_url: '/v1/external/basemap/openfreemap/styles/positron?v=1',
        dark_url: '/v1/external/basemap/openfreemap/styles/dark?v=1',
        perspective_3d: false,
      }],
    };
    const { rerender } = render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={config}
        mapStyle="light"
        mapStylePreference="follow-theme"
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapConstructor).toHaveBeenCalledTimes(1));
    // Follow appearance is theme-painted, which the constructor cannot do.
    expect(mapConstructor.mock.calls[0]?.[0]).not.toHaveProperty('style');
    expect(mockMap.setStyle).toHaveBeenCalledWith('/v1/external/basemap/openfreemap/styles/positron?v=1', THEMED_STYLE_OPTIONS);
    await act(async () => mockMap.emit('load'));

    rerender(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={config}
        mapStyle="dark"
        mapStylePreference="follow-theme"
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mockMap.setStyle).toHaveBeenCalledWith(
      '/v1/external/basemap/openfreemap/styles/dark?v=1',
      THEMED_STYLE_OPTIONS,
    ));
    expect(mapConstructor).toHaveBeenCalledTimes(1);
  });

  it('paints Follow appearance from theme tokens and leaves app overlays alone', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map(_options: unknown) { return mockMap; }) }));
    render(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={VECTOR_CONFIG} mapStyle="dark" mapLoader={mapLoader as never} />);
    await waitFor(() => expect(mockMap.setStyle).toHaveBeenCalledTimes(1));

    const options = mockMap.setStyle.mock.calls[0]?.[1] as { transformStyle: (previous: unknown, next: unknown) => StyleFixture };
    const stock = stockStyleFixture();
    const themed = options.transformStyle(undefined, stock);
    const paint = (id: string) => themed.layers.find((layer) => layer.id === id)?.paint;
    expect(paint('background')?.['background-color']).not.toBe('rgb(12,12,12)');
    expect(paint('label_city')?.['text-halo-width']).toBeGreaterThan(1);
    expect(themed.layers.find((layer) => layer.id === 'trip-routes-line')).toBe(stock.layers.find((layer) => layer.id === 'trip-routes-line'));
    // The provider JSON itself is not mutated.
    expect(stock.layers[0]?.paint?.['background-color']).toBe('rgb(12,12,12)');
  });

  it('keeps explicitly chosen presets and raster providers on their stock look', async () => {
    const vectorMap = new MockMap();
    const vectorConstructor = vi.fn(function Map(_options: unknown) { return vectorMap; });
    render(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={VECTOR_CONFIG} mapStyle="light" mapStylePreference="positron" mapLoader={vi.fn(async () => ({ Map: vectorConstructor })) as never} />);
    await waitFor(() => expect(vectorConstructor).toHaveBeenCalledTimes(1));
    expect(vectorConstructor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ style: '/v1/external/basemap/openfreemap/styles/positron?v=2' }));
    expect(vectorMap.setStyle).not.toHaveBeenCalled();

    const rasterMap = new MockMap();
    const rasterConstructor = vi.fn(function Map(_options: unknown) { return rasterMap; });
    render(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={RASTER_CONFIG} mapStyle="light" mapLoader={vi.fn(async () => ({ Map: rasterConstructor })) as never} />);
    await waitFor(() => expect(rasterConstructor).toHaveBeenCalledTimes(1));
    expect(rasterConstructor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      style: expect.objectContaining({ sources: { 'carto-base': expect.objectContaining({ type: 'raster' }) } }),
    }));
    expect(rasterMap.setStyle).not.toHaveBeenCalled();
  });

  it('loads OpenFreeMap vector styles and applies then resets the 3D camera', async () => {
    const mockMap = new MockMap();
    const mapConstructor = vi.fn(function Map(_options: unknown) { return mockMap; });
    const mapLoader = vi.fn(async () => ({ Map: mapConstructor }));
    const config = {
      enabled: true,
      provider_preference: 'openfreemap' as const,
      resolved_provider: 'openfreemap' as const,
      revision: 'vector-1',
      attributions: [],
      styles: [
        { id: 'follow-theme' as const, label: 'Follow appearance', kind: 'style' as const, light_url: '/v1/external/basemap/openfreemap/styles/positron?v=1', dark_url: '/v1/external/basemap/openfreemap/styles/dark?v=1', perspective_3d: false },
        { id: '3d' as const, label: '3D', kind: 'style' as const, light_url: '/v1/external/basemap/openfreemap/styles/liberty?v=1', dark_url: '/v1/external/basemap/openfreemap/styles/liberty?v=1', perspective_3d: true },
      ],
    };
    const { rerender } = render(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={config} mapStylePreference="3d" mapLoader={mapLoader as never} />);
    await waitFor(() => expect(mapConstructor).toHaveBeenCalledTimes(1));
    expect(mapConstructor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ style: '/v1/external/basemap/openfreemap/styles/liberty?v=1' }));
    await act(async () => mockMap.emit('load'));
    expect(mockMap.setPitch).toHaveBeenCalledWith(45);
    expect(mockMap.dragRotate.enable).toHaveBeenCalled();

    rerender(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={config} mapStylePreference="follow-theme" mapLoader={mapLoader as never} />);
    await act(async () => mockMap.emit('style.load'));
    expect(mockMap.setPitch).toHaveBeenCalledWith(0);
    expect(mockMap.dragRotate.disable).toHaveBeenCalled();
  });

  it('restores an unchanged active point after a style swap clears map sources', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
    const activePoint = { lat: 39.7392, lng: -104.9903 };
    const { rerender } = render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        activePoint={activePoint}
        mapStyle="dark"
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    await act(async () => mockMap.emit('load'));
    expect(mockMap.addSource.mock.calls.filter(([id]) => id === 'trip-active-point')).toHaveLength(1);

    rerender(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        activePoint={activePoint}
        mapStyle="light"
        mapLoader={mapLoader as never}
      />,
    );
    mockMap.sources.clear();
    mockMap.layers.clear();
    await act(async () => mockMap.emit('style.load'));

    expect(mockMap.addSource.mock.calls.filter(([id]) => id === 'trip-active-point')).toHaveLength(2);
    expect(mockMap.addLayer.mock.calls.filter(([layer]) => layer.id === 'trip-active-point-layer')).toHaveLength(2);
  });

  it('syncs the latest routes when the map load event fires after routes changed', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));

    const { rerender } = render(
      <TripMapChart routes={buildRoutes(1)} track={[]} height={320} mapLoader={mapLoader as never} />,
    );

    await waitFor(() => {
      expect(mapLoader).toHaveBeenCalledTimes(1);
      expect(mockMap.on).toHaveBeenCalled();
    });

    rerender(
      <TripMapChart routes={buildRoutes(15)} track={[]} height={320} mapLoader={mapLoader as never} />,
    );

    await act(async () => {
      mockMap.emit('load');
    });

    expect(mockMap.addSource).toHaveBeenCalledTimes(1);
    expect(mockMap.sources.has('trip-routes')).toBe(true);
    expect(mockMap.layers.has('trip-routes-line')).toBe(true);
    expect(mockMap.layers.has('trip-routes-hit')).toBe(true);
    expect(mockMap.addSource).toHaveBeenCalledWith(
      'trip-routes',
      expect.objectContaining({ data: expect.objectContaining({ features: expect.any(Array) }) }),
    );
    const sourceCall = mockMap.addSource.mock.calls[0]?.[1] as unknown as { data: { features: unknown[] } };
    expect(sourceCall.data.features).toHaveLength(15);
    expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('assigns consecutive route colors in order before cycling and preserves explicit colors', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
    const routeColors = ['#110000', '#002200', '#000033', '#444400', '#550055', '#006666'];
    routeColors.forEach((color, index) => document.documentElement.style.setProperty(`--rm-map-route-${index}`, color));
    const routes = buildRoutes(8);
    routes[2] = { ...routes[2]!, color: '#ABCDEF' };

    render(<TripMapChart routes={routes} track={[]} height={320} mapLoader={mapLoader as never} />);
    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    await act(async () => mockMap.emit('load'));

    const sourceCall = mockMap.addSource.mock.calls.find(([id]) => id === 'trip-routes')?.[1] as unknown as {
      data: { features: Array<{ properties: { color: string } }> };
    };
    expect(sourceCall.data.features.map((feature) => feature.properties.color)).toEqual([
      routeColors[0], routeColors[1], '#ABCDEF', routeColors[3], routeColors[4], routeColors[5], routeColors[0], routeColors[1],
    ]);
    routeColors.forEach((_, index) => document.documentElement.style.removeProperty(`--rm-map-route-${index}`));
  });

  it('shows only selected routes and refits to their bounds when selection changes', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
    const routes = buildRoutes(2);

    const { rerender } = render(
      <TripMapChart routes={routes} track={[]} height={320} mapLoader={mapLoader as never} />,
    );

    await waitFor(() => {
      expect(mapLoader).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      mockMap.emit('load');
    });

    expect(mockMap.sources.has('trip-routes')).toBe(true);

    rerender(
      <TripMapChart
        routes={routes}
        track={[]}
        selectedRouteIds={['trip-2']}
        height={320}
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => {
      expect(mockMap.sources.has('trip-routes')).toBe(true);
    });

    expect(mockMap.fitBounds).toHaveBeenLastCalledWith(
      [[1, 1], [1.1, 1.1]],
      { padding: 48, animate: false },
    );
  });

  it('authenticates only Riviamigo basemap proxy requests without fetching configuration', async () => {
    const mockMap = new MockMap();
    const mapConstructor = vi.fn(function Map(_options: unknown) { return mockMap; });
    const mapLoader = vi.fn(async () => ({ Map: mapConstructor }));
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    render(<TripMapChart
      routes={buildRoutes(1)}
      track={[]}
      accessToken="first-party-token"
      basemapConfig={{
        enabled: true,
        carto_api_key_missing: false,
        revision: 'first',
        light_url: '/v1/external/basemap/raster/light/{z}/{x}/{y}.png',
        dark_url: '/v1/external/basemap/raster/dark/{z}/{x}/{y}.png',
        attribution: null,
        attribution_url: null,
      }}
      mapLoader={mapLoader as never}
    />);

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();

    const mapOptions = mapConstructor.mock.calls[0]?.[0] as unknown as { transformRequest: (url: string) => { url: string; headers?: Record<string, string> } };
    expect(mapOptions.transformRequest('/v1/external/basemap/raster/light/1/2/3.png').headers).toEqual({ Authorization: 'Bearer first-party-token' });
    expect(mapOptions.transformRequest('https://riviamigo.invalid/v1/external/basemap/openfreemap/sprites/ofm_f384/ofm.json?cf=v3')).toEqual({
      url: 'http://localhost:3000/v1/external/basemap/openfreemap/sprites/ofm_f384/ofm.json?cf=v3',
      headers: { Authorization: 'Bearer first-party-token' },
      credentials: 'same-origin',
    });
    expect(mapOptions.transformRequest('https://provider.invalid/1/2/3.png').headers).toBeUndefined();
    fetchMock.mockRestore();
  });

  it('keeps the map interactive without a CARTO missing-key warning', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));

    const { queryByRole, queryByText } = render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={{
          enabled: true,
          carto_api_key_missing: true,
          revision: 'first',
          light_url: '/v1/external/basemap/raster/light/{z}/{x}/{y}.png',
          dark_url: '/v1/external/basemap/raster/dark/{z}/{x}/{y}.png',
          attribution: null,
          attribution_url: null,
        }}
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    expect(queryByRole('status', { name: /CARTO/i })).not.toBeInTheDocument();
    expect(queryByText(/CARTO Basemap key required/)).not.toBeInTheDocument();
    await act(async () => {
      mockMap.emit('load');
    });
    expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('does not show the CARTO notice for configured or non-remote basemaps', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));

    const { queryByRole, rerender } = render(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={{
          enabled: true,
          carto_api_key_missing: false,
          revision: 'first',
          light_url: '/v1/external/basemap/raster/light/{z}/{x}/{y}.png',
          dark_url: '/v1/external/basemap/raster/dark/{z}/{x}/{y}.png',
          attribution: null,
          attribution_url: null,
        }}
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    expect(queryByRole('status', { name: /CARTO/i })).not.toBeInTheDocument();

    rerender(
      <TripMapChart
        routes={buildRoutes(1)}
        track={[]}
        basemapConfig={{
          enabled: false,
          carto_api_key_missing: false,
          revision: 'neutral',
          light_url: '',
          dark_url: '',
          attribution: null,
          attribution_url: null,
        }}
        mapLoader={mapLoader as never}
      />,
    );

    expect(queryByRole('status', { name: /CARTO/i })).not.toBeInTheDocument();
  });

  it('replaces MapLibre tile URLs when the non-secret basemap revision changes', async () => {
    const mockMap = new MockMap();
    const mapConstructor = vi.fn(function Map(_options: unknown) { return mockMap; });
    const mapLoader = vi.fn(async () => ({ Map: mapConstructor }));
    const baseConfig = {
      enabled: true,
      carto_api_key_missing: false,
      revision: '1710000000000',
      light_url: '/v1/external/basemap/raster/light/{z}/{x}/{y}.png?v=1710000000000',
      dark_url: '/v1/external/basemap/raster/dark/{z}/{x}/{y}.png?v=1710000000000',
      attribution: null,
      attribution_url: null,
    };
    const { rerender } = render(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={baseConfig} mapLoader={mapLoader as never} />);

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    const initialStyle = (mapConstructor.mock.calls[0]?.[0] as { style: { sources: Record<string, { tiles: string[] }> } }).style;
    expect(initialStyle.sources['carto-base']?.tiles[0]).toContain('v=1710000000000');
    expect(JSON.stringify(initialStyle)).not.toContain('carto-secret');
    await act(async () => { mockMap.emit('load'); });

    rerender(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={{
      ...baseConfig,
      revision: '1710000000001',
      light_url: '/v1/external/basemap/raster/light/{z}/{x}/{y}.png?v=1710000000001',
      dark_url: '/v1/external/basemap/raster/dark/{z}/{x}/{y}.png?v=1710000000001',
    }} mapLoader={mapLoader as never} />);

    await waitFor(() => expect(mockMap.setStyle).toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.objectContaining({
        'carto-base': expect.objectContaining({ tiles: ['/v1/external/basemap/raster/dark/{z}/{x}/{y}.png?v=1710000000001'] }),
      }),
    })));
  });

  it('renders around a focus point without any routes and follows it as it moves', async () => {
    const mockMap = Object.assign(new MockMap(), { jumpTo: vi.fn() });
    const MapCtor = vi.fn(function Map() { return mockMap; });
    const mapLoader = vi.fn(async () => ({ Map: MapCtor }));

    const { rerender } = render(
      <TripMapChart
        track={[]}
        focusPoint={{ lat: 37.77, lng: -122.42 }}
        basemapConfig={{ enabled: true, resolved_provider: 'openfreemap', revision: 'vector-1' }}
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(MapCtor).toHaveBeenCalledWith(expect.objectContaining({
      center: [-122.42, 37.77],
      zoom: 14,
    })));
    expect(screen.queryByText('No route points in this period')).not.toBeInTheDocument();

    await act(async () => mockMap.emit('load'));
    await waitFor(() => expect(mockMap.layers.has('trip-active-point-layer')).toBe(true));
    expect(mockMap.fitBounds).not.toHaveBeenCalled();

    rerender(
      <TripMapChart
        track={[]}
        focusPoint={{ lat: 37.8, lng: -122.4 }}
        basemapConfig={{ enabled: true, resolved_provider: 'openfreemap', revision: 'vector-1' }}
        mapLoader={mapLoader as never}
      />,
    );
    await waitFor(() => expect(mockMap.jumpTo).toHaveBeenCalledWith({ center: [-122.4, 37.8] }));
  });

  it('shows the empty label when there is neither a route nor a focus point', () => {
    render(<TripMapChart track={[]} focusPoint={null} emptyLabel="Nothing to map" />);
    expect(screen.getByText('Nothing to map')).toBeInTheDocument();
  });

  it('pins custom focus marker content in place of the dot and turns it with the heading', async () => {
    const mockMap = Object.assign(new MockMap(), { jumpTo: vi.fn() });
    const markers: Array<{ element: HTMLElement; setLngLat: ReturnType<typeof vi.fn>; setRotation: ReturnType<typeof vi.fn>; addTo: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }> = [];
    const Marker = vi.fn(function Marker(options: { element: HTMLElement }) {
      const marker = {
        element: options.element,
        setLngLat: vi.fn(() => marker),
        setRotation: vi.fn(() => marker),
        addTo: vi.fn(() => marker),
        remove: vi.fn(),
      };
      markers.push(marker);
      return marker;
    });
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }), Marker }));
    const props = {
      track: [],
      basemapConfig: { enabled: true, resolved_provider: 'openfreemap', revision: 'vector-1' },
      mapLoader: mapLoader as never,
      focusMarker: <span data-testid="custom-marker">car</span>,
    };

    const { rerender, unmount } = render(<TripMapChart {...props} focusPoint={{ lat: 1, lng: 2 }} focusRotation={90} />);
    await waitFor(() => expect(mapLoader).toHaveBeenCalled());
    await act(async () => mockMap.emit('load'));

    await waitFor(() => expect(markers).toHaveLength(1));
    const marker = markers[0]!;
    expect(marker.setLngLat).toHaveBeenCalledWith([2, 1]);
    expect(marker.setRotation).toHaveBeenCalledWith(90);
    expect(marker.addTo).toHaveBeenCalledWith(mockMap);
    expect(within(marker.element).getByTestId('custom-marker')).toHaveTextContent('car');
    // The default dot is not drawn under the custom marker.
    await waitFor(() => expect(mockMap.layers.has('trip-active-point-layer')).toBe(false));

    rerender(<TripMapChart {...props} focusPoint={{ lat: 3, lng: 4 }} focusRotation={180} />);
    await waitFor(() => expect(marker.setLngLat).toHaveBeenLastCalledWith([4, 3]));
    expect(marker.setRotation).toHaveBeenLastCalledWith(180);

    unmount();
    expect(marker.remove).toHaveBeenCalled();
  });

  it('collapses basemap credits behind an info button in compact mode', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(function Map() { return mockMap; }) }));
    render(
      <TripMapChart
        track={[]}
        focusPoint={{ lat: 1, lng: 2 }}
        compactAttribution
        basemapConfig={{
          enabled: true,
          resolved_provider: 'openfreemap',
          revision: 'vector-1',
          attributions: [{ label: 'OpenFreeMap', url: 'https://openfreemap.org' }, { label: 'OpenStreetMap', url: null }],
        }}
        mapLoader={mapLoader as never}
      />,
    );

    expect(screen.queryByText('OpenFreeMap')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show map credits' }));
    expect(screen.getByRole('link', { name: 'OpenFreeMap' })).toHaveAttribute('href', 'https://openfreemap.org');
    expect(screen.getByText(/OpenStreetMap/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide map credits' }));
    expect(screen.queryByText('OpenFreeMap')).not.toBeInTheDocument();
  });
});
