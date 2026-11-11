import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/primitives')>();
  const mock = await import('./mockPrimitives');
  return { ...actual, SelectPicker: mock.SelectPicker };
});

// The real map needs WebGL; record what the overview hands it instead.
vi.mock('@riviamigo/ui/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/charts')>();
  return {
    ...actual,
    TripMapChart: (props: { focusPoint?: { lat: number; lng: number } | null; mapStyle?: string; mapStylePreference?: string }) => (
      <div
        data-testid="trip-map"
        data-focus={props.focusPoint ? `${props.focusPoint.lat},${props.focusPoint.lng}` : 'none'}
        data-mode={props.mapStyle}
        data-style={props.mapStylePreference}
      />
    ),
  };
});

const vehicleStatus = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  const authState = { defaultVehicleId: 'vehicle-1', accessToken: 'token' };
  return {
    ...actual,
    useAuth: (selector?: (state: typeof authState) => unknown) => (selector ? selector(authState) : authState),
    useMetricCatalog: () => ({ data: [] }),
    useBatteryHealth: () => ({ data: undefined }),
    useBasemapConfig: () => ({ data: { enabled: true, revision: 'r1', styles: [] }, isError: false, refetch: vi.fn() }),
    useUserPreferences: () => ({ data: { map_style: 'liberty' } }),
    useCurrentVehicleStatus: () => ({ data: vehicleStatus.current }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', model: 'R1S', images: null }] }),
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: undefined, isLoading: false, isFetching: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

import { DashboardRenderer } from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import { WidgetEditForm } from '../../../../packages/dashboards/src/editor/WidgetEditForm';
import { resolveOverviewMapOptions } from '../../../../packages/dashboards/src/widgets/custom/overviewMap';

type Widget = DashboardConfig['widgets'][number];

function overviewWidget(options: Record<string, unknown> = {}): Widget {
  return {
    id: 'overview-vehicle',
    componentType: 'custom',
    definitionId: 'overview.vehicle',
    title: 'Vehicle Overview',
    options,
    layout: { x: 0, y: 0, w: 12, h: 7 },
  };
}

function renderOverview(options?: Record<string, unknown>) {
  const config: DashboardConfig = {
    schemaVersion: 2,
    id: 'overview-map-test',
    slug: 'overview-map-test',
    name: 'Overview Map Test',
    isDefault: false,
    isLocked: false,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [overviewWidget(options)],
  };
  render(<DashboardRenderer config={config} ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }} />);
}

beforeEach(() => {
  vehicleStatus.current = {
    vehicle_id: 'vehicle-1',
    battery_level: 64,
    latitude: 37.77,
    longitude: -122.42,
    last_updated: '2026-05-12T12:00:00Z',
  };
});

describe('vehicle overview location map', () => {
  it('starts on the cluster view with an icon-only telemetry indicator', () => {
    renderOverview();
    const freshness = screen.getByTestId('overview-telemetry-freshness');
    expect(freshness).toHaveAttribute('aria-label', expect.stringMatching(/^Updated /));
    expect(freshness).toHaveAttribute('data-tone', 'fresh');
    expect(freshness.textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Vehicle cluster' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('overview-image-stage')).toHaveAttribute('data-view', 'cluster');
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument();
  });

  it('marks stale telemetry with the warning tone', () => {
    vehicleStatus.current = { ...vehicleStatus.current, telemetry_stale: true };
    renderOverview();
    const freshness = screen.getByTestId('overview-telemetry-freshness');
    expect(freshness).toHaveAttribute('aria-label', 'Telemetry stale');
    expect(freshness).toHaveAttribute('data-tone', 'stale');
  });

  it('shows the current location with the app map style when the map view is chosen', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    expect(screen.getByRole('button', { name: 'Current location map' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('overview-image-stage')).toHaveAttribute('data-view', 'map');
    const map = screen.getByTestId('trip-map');
    expect(map).toHaveAttribute('data-focus', '37.77,-122.42');
    expect(map).toHaveAttribute('data-style', 'liberty');
    // The stat rows stay in place beside the map.
    expect(screen.getByTestId('overview-stats').children).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Vehicle cluster' }));
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument();
  });

  it('applies the widget map type and light/dark overrides', () => {
    renderOverview({ mapStyle: 'fiord', mapMode: 'dark' });
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    const map = screen.getByTestId('trip-map');
    expect(map).toHaveAttribute('data-style', 'fiord');
    expect(map).toHaveAttribute('data-mode', 'dark');
  });

  it('explains a missing location instead of rendering an empty map', () => {
    vehicleStatus.current = { ...vehicleStatus.current, latitude: null, longitude: null };
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    expect(screen.getByTestId('overview-location-empty')).toHaveTextContent('No location reported yet');
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument();
  });

  it('offers no view toggle when the map is turned off for the widget', () => {
    renderOverview({ locationMap: false });
    expect(screen.queryByRole('group', { name: 'Overview view' })).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-telemetry-freshness')).toBeInTheDocument();
  });

  it('bleeds the outer panels to the card edge in the three-column tiers', () => {
    renderOverview();
    expect(screen.getByTestId('overview-layout').className).toContain('@min-[34rem]/overview:-mx-4');
    expect(screen.getByTestId('overview-soc-panel').className).toContain('@min-[34rem]/overview:border-l-0');
    for (const row of Array.from(screen.getByTestId('overview-stats').children)) {
      expect(row.className).toContain('@min-[34rem]/overview:border-r-0');
    }
  });
});

describe('resolveOverviewMapOptions', () => {
  it('defaults to an enabled map that follows the app', () => {
    expect(resolveOverviewMapOptions(undefined)).toEqual({ enabled: true, mode: 'auto', style: 'app' });
  });

  it('keeps known values and drops unknown ones', () => {
    expect(resolveOverviewMapOptions({ locationMap: false, mapMode: 'light', mapStyle: 'bright' }))
      .toEqual({ enabled: false, mode: 'light', style: 'bright' });
    expect(resolveOverviewMapOptions({ mapMode: 'sepia', mapStyle: 'follow-theme' }))
      .toEqual({ enabled: true, mode: 'auto', style: 'app' });
  });
});

describe('overview editor location map section', () => {
  it('saves the map type and light/dark choice into the widget options', () => {
    const onChange = vi.fn();
    render(<WidgetEditForm widget={overviewWidget()} onChange={onChange} onClose={vi.fn()} />);
    const section = within(screen.getByText('Location map').closest('section') as HTMLElement);

    fireEvent.change(section.getByLabelText('Map type'), { target: { value: 'positron' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ mapStyle: 'positron' }) }));

    fireEvent.change(section.getByLabelText('Map light or dark mode'), { target: { value: 'light' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ mapMode: 'light' }) }));

    fireEvent.click(section.getByRole('switch', { name: 'Offer location map' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ locationMap: false }) }));
  });

  it('hides the map pickers while the map is turned off', () => {
    render(<WidgetEditForm widget={overviewWidget({ locationMap: false })} onChange={vi.fn()} onClose={vi.fn()} />);
    const section = within(screen.getByText('Location map').closest('section') as HTMLElement);
    expect(section.getByRole('switch', { name: 'Offer location map' })).toHaveAttribute('aria-checked', 'false');
    expect(section.queryByLabelText('Map type')).not.toBeInTheDocument();
  });
});
