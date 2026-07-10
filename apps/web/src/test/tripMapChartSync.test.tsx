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
  it('syncs the latest routes when the map load event fires after routes changed', async () => {
    const mockMap = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(() => mockMap) }));

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
    const mapLoader = vi.fn(async () => ({ Map: vi.fn(() => mockMap) }));
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
});
