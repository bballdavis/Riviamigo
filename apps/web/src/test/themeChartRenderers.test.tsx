import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_COLORS } from '../../../../packages/ui/src/charts/ChartProvider';
import { MiniSparkline } from '../../../../packages/ui/src/charts/MiniSparkline';
import { buildRichTimeSeriesUPlotSeries, RichTimeSeriesChart } from '../../../../packages/ui/src/charts/RichTimeSeriesChart';
import { TripMapChart } from '../../../../packages/ui/src/charts/TripMapChart';
import { applyThemePreferences, applyThemeRuntime, getThemeRuntimeSnapshot } from '@riviamigo/ui/lib/theme';
import { resolveTheme } from '../../../../packages/themes/src/index';

function setPalette(palette: 'classic' | 'rad') {
  applyThemePreferences({ mode: 'dark', palette });
}

function makeCanvasContext() {
  return {
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    stroke() {},
    arc() {},
    fill() {},
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineJoin: 'round' as CanvasLineJoin,
    lineCap: 'round' as CanvasLineCap,
    globalAlpha: 1,
  };
}

class MockMap {
  handlers = new Map<string, Array<() => void>>();
  sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  layers = new Set<string>();

  addSource = vi.fn((id: string) => {
    this.sources.set(id, { setData: vi.fn() });
  });
  getSource = vi.fn((id: string) => this.sources.get(id));
  addLayer = vi.fn((layer: { id: string }) => this.layers.add(layer.id));
  getLayer = vi.fn((id: string) => this.layers.has(id) ? { id } : undefined);
  removeLayer = vi.fn((id: string) => this.layers.delete(id));
  removeSource = vi.fn((id: string) => this.sources.delete(id));
  setPaintProperty = vi.fn();
  fitBounds = vi.fn();
  resize = vi.fn();
  remove = vi.fn();
  setStyle = vi.fn();
  getCanvas = vi.fn(() => ({ style: {} as CSSStyleDeclaration }));

  on = vi.fn((event: string, handler: (() => void) | string, maybeHandler?: () => void) => {
    const callback = typeof handler === 'function' ? handler : maybeHandler;
    if (callback) this.handlers.set(event, [...(this.handlers.get(event) ?? []), callback]);
  });
  off = vi.fn();

  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }
}

beforeEach(() => {
  setPalette('classic');
});

describe('palette-aware chart renderer boundaries', () => {
  it('redraws the Canvas sparkline after an account palette change', async () => {
    const context = makeCanvasContext();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => context as unknown as CanvasRenderingContext2D,
    );

    render(
      <MiniSparkline
        data={[{ ts: '2026-01-01T00:00:00Z', value: 10 }, { ts: '2026-01-01T01:00:00Z', value: 12 }]}
        color={CHART_COLORS.accent}
      />,
    );

    await waitFor(() => expect(context.strokeStyle).toBe('#FD8304'));
    setPalette('rad');
    await waitFor(() => expect(context.strokeStyle).toBe('#D9A441'));
    getContext.mockRestore();
  });

  it('recreates the uPlot instance and resolves the active palette color', async () => {
    const { container } = render(
      <RichTimeSeriesChart
        points={[{ ts: '2026-01-01T00:00:00Z' }, { ts: '2026-01-01T01:00:00Z' }]}
        series={[{ key: 'energy', label: 'Energy', values: [10, 12], color: CHART_COLORS.accent }]}
        height={240}
      />,
    );

    await waitFor(() => expect(container.querySelector('.uplot')).toBeTruthy());
    const classicPlot = container.querySelector('.uplot');
    const classic = buildRichTimeSeriesUPlotSeries(
      [{ key: 'energy', label: 'Energy', values: [10, 12], color: CHART_COLORS.accent }],
      { resolveColor: () => '#FD8304' },
    );
    expect(classic[1]?.stroke).toBe('#FD8304');

    setPalette('rad');
    await waitFor(() => expect(container.querySelector('.uplot')).not.toBe(classicPlot));
    const rad = buildRichTimeSeriesUPlotSeries(
      [{ key: 'energy', label: 'Energy', values: [10, 12], color: CHART_COLORS.accent }],
      { resolveColor: () => '#D9A441' },
    );
    expect(rad[1]?.stroke).toBe('#D9A441');
  });

  it('recreates non-CSS charts when a custom revision changes without changing the palette', async () => {
    const custom = resolveTheme({ theme: 'classic', tokens: { accent: { dark: '#123456' } } });
    applyThemeRuntime({ schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom', revision: 1 } }, custom);
    const { container } = render(
      <RichTimeSeriesChart
        points={[{ ts: '2026-01-01T00:00:00Z' }, { ts: '2026-01-01T01:00:00Z' }]}
        series={[{ key: 'energy', label: 'Energy', values: [10, 12], color: CHART_COLORS.accent }]}
        height={240}
      />,
    );
    await waitFor(() => expect(container.querySelector('.uplot')).toBeTruthy());
    const first = container.querySelector('.uplot');
    applyThemeRuntime({ schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom', revision: 2 } }, custom);
    await waitFor(() => expect(container.querySelector('.uplot')).not.toBe(first));
  });

  it('refreshes MapLibre route data after an account palette change', async () => {
    const map = new MockMap();
    function MapConstructor() {
      return map;
    }
    const mapLoader = vi.fn(async () => ({ Map: MapConstructor }));
    render(
      <TripMapChart
        track={[]}
        routes={[{ id: 'trip-1', track: [{ lat: 1, lng: 1 }, { lat: 1.1, lng: 1.1 }] }]}
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    await act(async () => map.emit('load'));
    const source = map.sources.get('trip-routes');
    expect(source).toBeDefined();

    setPalette('rad');
    await waitFor(() => {
      const lastCall = source?.setData.mock.calls.at(-1)?.[0] as { features?: Array<{ properties?: { color?: string } }> };
      expect(lastCall?.features?.[0]?.properties?.color).toBe(getThemeRuntimeSnapshot().cssVariables['--rm-map-route-3']);
    });
  });

  it('repaints OpenFreeMap routes and active points for theme revisions without reloading the vector style', async () => {
    const map = new MockMap();
    const mapLoader = vi.fn(async () => ({ Map: function MapConstructor() { return map; } }));
    const basemapConfig = {
      enabled: true,
      resolved_provider: 'openfreemap',
      revision: 'vector-1',
      styles: [{
        id: 'follow-theme' as const,
        label: 'Follow appearance',
        kind: 'style' as const,
        light_url: '/v1/external/basemap/styles/positron.json',
        dark_url: '/v1/external/basemap/styles/dark.json',
        perspective_3d: false,
      }],
      attributions: [],
    };
    render(
      <TripMapChart
        track={[]}
        routes={[{ id: 'trip-1', track: [{ lat: 1, lng: 1 }, { lat: 1.1, lng: 1.1 }] }]}
        activePoint={{ lat: 1.05, lng: 1.05 }}
        basemapConfig={basemapConfig}
        mapLoader={mapLoader as never}
      />,
    );

    await waitFor(() => expect(mapLoader).toHaveBeenCalledTimes(1));
    await act(async () => map.emit('load'));
    expect(map.sources.has('trip-routes')).toBe(true);
    expect(map.sources.has('trip-active-point')).toBe(true);
    expect(map.layers.has('trip-routes-line')).toBe(true);
    expect(map.layers.has('trip-active-point-layer')).toBe(true);
    const setStyleCalls = map.setStyle.mock.calls.length;

    setPalette('rad');
    applyThemeRuntime({ schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom', revision: 2 } }, resolveTheme({ theme: 'classic' }));
    await waitFor(() => expect(map.sources.get('trip-routes')?.setData).toHaveBeenCalled());

    expect(map.setStyle).toHaveBeenCalledTimes(setStyleCalls);
    expect(map.sources.has('trip-routes')).toBe(true);
    expect(map.sources.has('trip-active-point')).toBe(true);
    expect(map.layers.has('trip-routes-line')).toBe(true);
    expect(map.layers.has('trip-active-point-layer')).toBe(true);
  });
});
