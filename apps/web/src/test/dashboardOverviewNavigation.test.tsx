import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real map needs WebGL; record what the overview hands it instead.
vi.mock('@riviamigo/ui/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/charts')>();
  return {
    ...actual,
    TripMapChart: (props: {
      routes?: Array<{ id: string; track: Array<{ lat: number; lng: number }>; colorVar?: string; opacity?: number }>;
      markers?: Array<{ id: string; point: { lat: number; lng: number }; content: React.ReactNode }>;
      camera?: string;
      fitKey?: string;
      fitPadding?: { top: number; right: number; bottom: number; left: number };
      fitMaxZoom?: number;
      focusMarker?: React.ReactNode;
    }) => (
      <div
        data-testid="trip-map"
        data-camera={props.camera}
        data-fit-key={props.fitKey ?? 'none'}
        data-fit-padding={JSON.stringify(props.fitPadding ?? null)}
        data-fit-max-zoom={props.fitMaxZoom}
        data-routes={JSON.stringify((props.routes ?? []).map((route) => ({
          id: route.id,
          points: route.track.length,
          colorVar: route.colorVar,
          opacity: route.opacity,
        })))}
      >
        {props.focusMarker}
        {props.markers?.map((marker) => (
          <div key={marker.id} data-testid="map-marker" data-point={`${marker.point.lat},${marker.point.lng}`}>{marker.content}</div>
        ))}
      </div>
    ),
  };
});

const vehicleStatus = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  const authState = { defaultVehicleId: 'vehicle-1', accessToken: 'token' };
  return {
    ...actual,
    useAuth: (selector?: (state: typeof authState) => unknown) => (selector ? selector(authState) : authState),
    useMetricCatalog: () => ({ data: [] }),
    useBatteryHealth: () => ({ data: undefined }),
    useBasemapConfig: () => ({ data: { enabled: true, revision: 'r1', styles: [] }, isError: false, refetch: vi.fn() }),
    // Open on the map, which is where navigation is shown.
    useUserPreferences: () => ({ data: { map_style: 'liberty', overview_view: 'map', overview_map_expanded: false } }),
    useUpdateOverviewView: () => ({ mutate: vi.fn() }),
    useUpdateOverviewMapExpanded: () => ({ mutate: vi.fn() }),
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
import { useLiveNavigationStore } from '@riviamigo/hooks';
import type { VehicleNavigation } from '@riviamigo/types';
import { getAppTimezone, setAppTimezone } from '@riviamigo/ui/lib/dateTime';
import { DRIVE_WAVE_HEIGHT } from '../../../../packages/dashboards/src/widgets/custom/overviewDriveWaveLayout';

// (38.5, -120.2) → (40.7, -120.95), then on to (43.252, -126.453).
const NAVIGATION: VehicleNavigation = {
  route: {
    id: '4',
    polylines: ['_p~iF~ps|U_ulLnnqC', '_flwFn`faV_mqNvxq`@'],
    polyline_precision: 5,
    stops: [
      { kind: 'charging', name: '12 Donner Pass Rd [RAN]', latitude: 40.7, longitude: -120.95, arrival_at: '2026-11-19T15:58:00Z' },
      { kind: 'place', name: 'Trailhead', latitude: 43.252, longitude: -126.453, arrival_at: '2026-11-19T16:12:00Z' },
    ],
  },
  destination_eta: '2026-11-19T16:12:00Z',
};

function setNavigation(navigation: VehicleNavigation | null) {
  act(() => useLiveNavigationStore.setState({ navigation: navigation ? { 'vehicle-1': navigation } : {} }));
}

function renderOverview() {
  const config: DashboardConfig = {
    schemaVersion: 2,
    id: 'overview-navigation-test',
    slug: 'overview-navigation-test',
    name: 'Overview Navigation Test',
    isDefault: false,
    isLocked: false,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [{
      id: 'overview-vehicle',
      componentType: 'custom',
      definitionId: 'overview.vehicle',
      title: 'Vehicle Overview',
      options: {},
      layout: { x: 0, y: 0, w: 12, h: 7 },
    }],
  };
  render(<DashboardRenderer config={config} ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }} />);
}

function routes(): Array<{ id: string; points: number; colorVar?: string; opacity?: number }> {
  return JSON.parse(screen.getByTestId('trip-map').getAttribute('data-routes') ?? '[]');
}

let timezone: string;

beforeEach(() => {
  timezone = getAppTimezone();
  setAppTimezone('UTC');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T15:49:00Z'));
  useLiveNavigationStore.setState({ navigation: {} });
  // Halfway along the first leg, in drive.
  vehicleStatus.current = {
    vehicle_id: 'vehicle-1',
    battery_level: 64,
    latitude: 39.6,
    longitude: -120.575,
    heading_deg: 350,
    gear_status: 'drive',
    speed_mph: 43,
    power_state: 'go',
    last_updated: '2026-11-19T15:49:00Z',
  };
});

afterEach(() => {
  vi.useRealTimers();
  setAppTimezone(timezone);
});

describe('overview map while the vehicle is not navigating', () => {
  it('follows the vehicle with no route, pins, route toggle, or arrival time', () => {
    renderOverview();
    const map = screen.getByTestId('trip-map');
    expect(map).toHaveAttribute('data-camera', 'follow-focus');
    expect(routes()).toEqual([]);
    expect(screen.queryByTestId('map-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('overview-map-route')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-map-expand')).toBeInTheDocument();
    expect(screen.getByTestId('overview-drive-wave-arrival')).toBeEmptyDOMElement();
  });
});

describe('overview map while the vehicle is navigating', () => {
  it('draws the route in the wave teal, dimming the part already driven', () => {
    renderOverview();
    setNavigation(NAVIGATION);
    expect(routes()).toEqual([
      { id: 'navigation-traveled', points: 2, colorVar: '--rm-drive-wave-line', opacity: 0.35 },
      { id: 'navigation-ahead', points: 3, colorVar: '--rm-drive-wave-line', opacity: 0.95 },
    ]);
    // Still following the vehicle: the route alone does not move the camera.
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-camera', 'follow-focus');
  });

  it('pins the destination with the Rivian mark in the wave gold and a bolt at a charging stop', () => {
    renderOverview();
    setNavigation(NAVIGATION);
    const [charger, destination] = screen.getAllByTestId('map-marker');
    expect(charger).toHaveAttribute('data-point', '40.7,-120.95');
    const bolt = within(charger!).getByRole('img', { name: 'Charging stop: 12 Donner Pass Rd [RAN]' });
    expect(bolt).toHaveAttribute('data-stop-kind', 'charging');
    expect(bolt.style.color).toBe('var(--rm-drive-wave-line)');

    expect(destination).toHaveAttribute('data-point', '43.252,-126.453');
    const pin = within(destination!).getByRole('img', { name: 'Destination: Trailhead' });
    expect(pin.style.color).toBe('var(--rm-drive-wave-crest)');
    // The mark itself, not a dot.
    expect(pin.querySelector('svg path')).not.toBeNull();
    expect(pin).not.toHaveClass('rounded-full');
    expect(within(pin).getByText('Trailhead')).toBeInTheDocument();
  });

  it('frames the whole route only while its toggle is on, clear of the tabs and the wave', () => {
    renderOverview();
    setNavigation(NAVIGATION);
    const toggle = screen.getByRole('button', { name: 'Show whole route' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // It shares the corner with the expand tab, which is still there.
    expect(toggle.parentElement).toContainElement(screen.getByTestId('overview-map-expand'));

    fireEvent.click(toggle);
    const map = screen.getByTestId('trip-map');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(map).toHaveAttribute('data-camera', 'fit-routes');
    expect(map).toHaveAttribute('data-fit-key', '4');
    const padding = JSON.parse(map.getAttribute('data-fit-padding')!);
    expect(padding.bottom).toBeGreaterThan(DRIVE_WAVE_HEIGHT);
    expect(padding.top).toBeGreaterThanOrEqual(44);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-camera', 'follow-focus');
  });

  it('goes back to following when navigation ends, and starts the next trip following', () => {
    renderOverview();
    setNavigation(NAVIGATION);
    fireEvent.click(screen.getByRole('button', { name: 'Show whole route' }));
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-camera', 'fit-routes');

    setNavigation(null);
    expect(screen.queryByTestId('overview-map-route')).not.toBeInTheDocument();
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-camera', 'follow-focus');
    expect(routes()).toEqual([]);
    expect(screen.queryByTestId('map-marker')).not.toBeInTheDocument();

    setNavigation({ ...NAVIGATION, route: { ...NAVIGATION.route, id: '5' } });
    expect(screen.getByRole('button', { name: 'Show whole route' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-camera', 'follow-focus');
  });
});

describe('drive wave arrival time', () => {
  it('shows the arrival time with a smaller, muted day period and the time left', () => {
    renderOverview();
    setNavigation(NAVIGATION);
    const arrival = screen.getByTestId('overview-drive-wave-arrival');
    expect(arrival).toHaveClass('opacity-100');
    const time = within(arrival).getByText('4:12');
    const period = within(arrival).getByText('PM');
    expect(time).toHaveClass('text-fg');
    expect(period).toHaveClass('text-fg-secondary', 'text-[9px]');
    expect(Number.parseInt(time.style.fontSize, 10)).toBeGreaterThan(9);
    expect(within(arrival).getByText('23 min')).toHaveClass('text-fg-secondary');
    expect(screen.getByTestId('overview-drive-wave')).toHaveTextContent('Drive, 43 mph, arriving 4:12 PM, in 23 min');
  });

  it('counts the time left down while the page stays open', () => {
    renderOverview();
    setNavigation(NAVIGATION);
    act(() => vi.advanceTimersByTime(60_000));
    expect(within(screen.getByTestId('overview-drive-wave-arrival')).getByText('22 min')).toBeInTheDocument();
  });

  it('follows a live arrival time and clears when navigation ends', () => {
    renderOverview();
    setNavigation(NAVIGATION);
    setNavigation({ ...NAVIGATION, destination_eta: '2026-11-19T16:20:00Z' });
    const arrival = screen.getByTestId('overview-drive-wave-arrival');
    expect(within(arrival).getByText('4:20')).toBeInTheDocument();
    expect(within(arrival).getByText('31 min')).toBeInTheDocument();

    setNavigation(null);
    expect(arrival).toHaveClass('opacity-0');
    expect(arrival).toBeEmptyDOMElement();
  });

  it('shows charging, Parked, and the arrival time together at a charging stop along the way', () => {
    vehicleStatus.current = { ...vehicleStatus.current, gear_status: 'park', speed_mph: 0, charger_state: 'Charging', power_state: 'charging' };
    renderOverview();
    setNavigation(NAVIGATION);
    const wave = screen.getByTestId('overview-drive-wave');
    expect(wave).toHaveTextContent('Parked, charging, arriving 4:12 PM, in 23 min');
    expect(within(wave).getByTestId('overview-drive-wave-charging')).toHaveAttribute('data-charging-state', 'charging');
    expect(screen.getByTestId('overview-drive-wave-arrival')).toHaveClass('opacity-100');
  });

  it('keeps the arrival time beside Parked at a stop along the way', () => {
    vehicleStatus.current = { ...vehicleStatus.current, gear_status: 'park', speed_mph: 0 };
    renderOverview();
    setNavigation(NAVIGATION);
    expect(screen.getByTestId('overview-drive-wave')).toHaveTextContent('Parked, arriving 4:12 PM, in 23 min');
  });
});
