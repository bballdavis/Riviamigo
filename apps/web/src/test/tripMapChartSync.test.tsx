import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripMapChart, type TripMapRoute } from '../../../../packages/ui/src/charts/TripMapChart';

type MapHandler = () => void;

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

  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler();
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

describe('TripMapChart', () => {
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
    expect(mapConstructor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      style: '/v1/external/basemap/openfreemap/styles/positron?v=1',
    }));
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
    ));
    expect(mapConstructor).toHaveBeenCalledTimes(1);
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
        { id: 'follow-theme' as const, label: 'Follow appearance', kind: 'style' as const, light_url: '/v1/external/basemap/styles/positron.json', dark_url: '/v1/external/basemap/styles/dark.json', perspective_3d: false },
        { id: '3d' as const, label: '3D', kind: 'style' as const, light_url: '/v1/external/basemap/styles/liberty.json', dark_url: '/v1/external/basemap/styles/liberty.json', perspective_3d: true },
      ],
    };
    const { rerender } = render(<TripMapChart routes={buildRoutes(1)} track={[]} basemapConfig={config} mapStylePreference="3d" mapLoader={mapLoader as never} />);
    await waitFor(() => expect(mapConstructor).toHaveBeenCalledTimes(1));
    expect(mapConstructor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ style: '/v1/external/basemap/styles/liberty.json' }));
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

    const mapOptions = mapConstructor.mock.calls[0]?.[0] as unknown as { transformRequest: (url: string) => { headers?: Record<string, string> } };
    expect(mapOptions.transformRequest('/v1/external/basemap/raster/light/1/2/3.png').headers).toEqual({ Authorization: 'Bearer first-party-token' });
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
    expect(queryByRole('status')).not.toBeInTheDocument();
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
    expect(queryByRole('status')).not.toBeInTheDocument();

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

    expect(queryByRole('status')).not.toBeInTheDocument();
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
});
