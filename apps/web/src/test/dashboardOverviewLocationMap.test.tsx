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
    TripMapChart: (props: {
      focusPoint?: { lat: number; lng: number } | null;
      focusMarker?: React.ReactNode;
      focusRotation?: number | null;
      mapStyle?: string;
      mapStylePreference?: string;
      compactAttributionPlacement?: string;
    }) => (
      <div
        data-testid="trip-map"
        data-focus={props.focusPoint ? `${props.focusPoint.lat},${props.focusPoint.lng}` : 'none'}
        data-rotation={props.focusRotation ?? 'none'}
        data-mode={props.mapStyle}
        data-style={props.mapStylePreference}
        data-attribution={props.compactAttributionPlacement ?? 'bottom-right'}
      >
        {props.focusMarker}
      </div>
    ),
  };
});

const vehicleStatus = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const artworkState = vi.hoisted(() => ({ loading: false }));
const savedPreferences = vi.hoisted(() => ({
  overviewView: undefined as string | undefined,
  updateOverviewView: { mutate: (() => undefined) as (view: string) => void },
  mapExpanded: undefined as boolean | undefined,
  updateOverviewMapExpanded: { mutate: (() => undefined) as (expanded: boolean) => void },
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
    useUserPreferences: () => ({
      data: {
        map_style: 'liberty',
        overview_view: savedPreferences.overviewView,
        overview_map_expanded: savedPreferences.mapExpanded,
      },
    }),
    useUpdateOverviewView: () => savedPreferences.updateOverviewView,
    useUpdateOverviewMapExpanded: () => savedPreferences.updateOverviewMapExpanded,
    useCurrentVehicleStatus: () => ({ data: vehicleStatus.current }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', model: 'R1S', images: null }] }),
    useVehicleArtwork: (source: string | null | undefined) => (artworkState.loading
      ? { src: null, restoring: false, isLoading: true, isError: false }
      : actual.useVehicleArtwork(source)),
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
import { resolveOverviewMapOptions, resolveVehicleFacingDeg } from '../../../../packages/dashboards/src/widgets/custom/overviewMap';
import { DRIVE_WAVE_HEIGHT, layoutDriveWave, resolveDriveWaveState } from '../../../../packages/dashboards/src/widgets/custom/overviewDriveWaveLayout';
import { getUnitPreferences, setUnitPreferences } from '@riviamigo/ui/lib/utils';

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
  savedPreferences.overviewView = undefined;
  savedPreferences.updateOverviewView = { mutate: vi.fn() };
  savedPreferences.mapExpanded = undefined;
  savedPreferences.updateOverviewMapExpanded = { mutate: vi.fn() };
  vehicleStatus.current = {
    vehicle_id: 'vehicle-1',
    battery_level: 64,
    latitude: 37.77,
    longitude: -122.42,
    heading_deg: 92,
    last_updated: '2026-05-12T12:00:00Z',
  };
});

describe('vehicle overview location map', () => {
  it('starts on the cluster view without a telemetry indicator', () => {
    renderOverview();
    expect(screen.queryByTestId('overview-telemetry-freshness')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vehicle cluster' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('overview-stats').children).toHaveLength(5);
    expect(screen.queryByTestId('overview-location-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument();
  });

  it('swaps the stat column for the current-location map and keeps the vehicle image', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    expect(screen.getByRole('button', { name: 'Current location map' })).toHaveAttribute('aria-pressed', 'true');
    const panel = screen.getByTestId('overview-location-panel');
    const map = within(panel).getByTestId('trip-map');
    expect(map).toHaveAttribute('data-focus', '37.77,-122.42');
    expect(map).toHaveAttribute('data-style', 'liberty');
    expect(screen.queryByTestId('overview-stats')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-image-stage')).toContainElement(screen.getByTestId('overview-vehicle-art-frame'));

    fireEvent.click(screen.getByRole('button', { name: 'Vehicle cluster' }));
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-stats').children).toHaveLength(5);
  });

  it('keeps the map canvas at the expanded width so expanding never resizes it', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    const canvas = screen.getByTestId('overview-map-canvas');
    const collapsedClass = canvas.className;
    expect(collapsedClass).toContain('@min-[58rem]/overview:w-[28.25rem]');
    expect(collapsedClass).toContain('-translate-x-1/2');
    expect(canvas.style.getPropertyValue('--rm-map-overlay-inset-x')).toBe('calc((100% - 100cqw) / 2)');
    const expand = screen.getByTestId('overview-map-expand');
    expect(expand.className).toContain('text-accent');
    fireEvent.click(expand);
    expect(screen.getByTestId('overview-map-canvas').className).toBe(collapsedClass);
  });

  it('marks the vehicle with its own artwork outlined in the accent color, turned to its heading', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    const map = screen.getByTestId('trip-map');
    expect(map).toHaveAttribute('data-rotation', '92');
    const marker = within(map).getByTestId('overview-map-vehicle-marker');
    // The outline follows the vehicle's silhouette; there is no ring around it.
    expect(marker).not.toHaveClass('rounded-full');
    const art = within(marker).getByTestId('overview-map-vehicle-art');
    expect(art).toHaveClass('h-12');
    expect(art.style.filter).toContain('drop-shadow(2px 0 0 var(--rm-accent))');
    expect(art.style.filter).toContain('drop-shadow(0 -2px 0 var(--rm-accent))');
  });

  it('shows a level loading wave on the marker until the vehicle artwork is ready', () => {
    artworkState.loading = true;
    try {
      renderOverview();
      fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
      const map = screen.getByTestId('trip-map');
      expect(map).toHaveAttribute('data-rotation', 'none');
      const marker = within(map).getByTestId('overview-map-vehicle-marker');
      expect(within(marker).getByRole('status')).toHaveTextContent('Loading vehicle picture');
      expect(within(marker).queryByTestId('overview-map-vehicle-art')).toBeNull();
    } finally {
      artworkState.loading = false;
    }
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
  });

  it('bleeds the outer panels to the card edge in the three-column tiers', () => {
    renderOverview();
    expect(screen.getByTestId('overview-layout').className).toContain('@min-[34rem]/overview:-mx-4');
    expect(screen.getByTestId('overview-soc-panel').className).toContain('@min-[34rem]/overview:border-l-0');
    for (const row of Array.from(screen.getByTestId('overview-stats').children)) {
      expect(row.className).toContain('@min-[34rem]/overview:border-r-0');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    expect(screen.getByTestId('overview-location-panel').className).toContain('@min-[34rem]/overview:border-r-0');
  });
});

describe('saved overview view', () => {
  it('opens on the view the user last chose', () => {
    savedPreferences.overviewView = 'map';
    renderOverview();
    expect(screen.getByRole('button', { name: 'Current location map' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('overview-location-panel')).toBeInTheDocument();
  });

  it('saves each choice to the account and switches immediately', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    expect(savedPreferences.updateOverviewView.mutate).toHaveBeenLastCalledWith('map');
    expect(screen.getByTestId('overview-location-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Vehicle cluster' }));
    expect(savedPreferences.updateOverviewView.mutate).toHaveBeenLastCalledWith('cluster');
    expect(screen.getByTestId('overview-stats')).toBeInTheDocument();
  });

  it('stays on the cluster when the saved map view is turned off for the widget', () => {
    savedPreferences.overviewView = 'map';
    renderOverview({ locationMap: false });
    expect(screen.queryByTestId('overview-location-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-stats').children).toHaveLength(5);
  });
});

describe('vehicle overview map expansion', () => {
  it('collapses the SoC panel to its battery rail and gives the map the freed width', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    const layout = screen.getByTestId('overview-layout');
    expect(layout.className).toContain('@min-[34rem]/overview:grid-cols-[11.25rem_minmax(0,1fr)_8.75rem]');

    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }));
    expect(layout).toHaveAttribute('data-map-expanded', 'true');
    expect(layout.className).toContain('@min-[34rem]/overview:grid-cols-[3.75rem_minmax(0,1fr)_16.25rem]');
    expect(layout.className).toContain('@min-[58rem]/overview:grid-cols-[5.75rem_minmax(22rem,1fr)_28.25rem]');
    expect(layout.className).not.toContain('11.25rem');
    expect(screen.getByTestId('overview-soc-panel')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('overview-soc-details').className).toContain('@min-[34rem]/overview:hidden');
    // The battery rail stays, and still says the charge level.
    expect(screen.getByRole('img', { name: 'State of charge 64%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse map' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('overview-image-stage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse map' }));
    expect(layout).not.toHaveAttribute('data-map-expanded');
    expect(screen.getByTestId('overview-soc-details').className).not.toContain('hidden');
  });

  it('returns to the normal layout when switching back to the cluster', () => {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vehicle cluster' }));
    expect(screen.getByTestId('overview-layout')).not.toHaveAttribute('data-map-expanded');
    expect(screen.getByTestId('overview-soc-panel')).not.toHaveAttribute('data-collapsed');
    expect(screen.getByTestId('overview-stats').children).toHaveLength(5);
  });

  it('saves each expand and collapse to the account and applies it immediately', () => {
    savedPreferences.overviewView = 'map';
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }));
    expect(savedPreferences.updateOverviewMapExpanded.mutate).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('overview-layout')).toHaveAttribute('data-map-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse map' }));
    expect(savedPreferences.updateOverviewMapExpanded.mutate).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('overview-layout')).not.toHaveAttribute('data-map-expanded');
  });

  it('opens the map at the size the user last chose', () => {
    savedPreferences.overviewView = 'map';
    savedPreferences.mapExpanded = true;
    renderOverview();
    expect(screen.getByTestId('overview-layout')).toHaveAttribute('data-map-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Collapse map' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the saved expansion off the cluster view', () => {
    savedPreferences.mapExpanded = true;
    renderOverview();
    expect(screen.getByTestId('overview-layout')).not.toHaveAttribute('data-map-expanded');
    expect(screen.getByTestId('overview-soc-panel')).not.toHaveAttribute('data-collapsed');

    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    expect(screen.getByTestId('overview-layout')).toHaveAttribute('data-map-expanded', 'true');
  });
});

describe('overview map drive wave', () => {
  function openMap() {
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    return within(screen.getByTestId('overview-location-panel')).getByTestId('overview-drive-wave');
  }

  it('reads Parked while the vehicle is in park', () => {
    vehicleStatus.current = { ...vehicleStatus.current, gear_status: 'park', speed_mph: 0 };
    const wave = openMap();
    expect(wave).toHaveAttribute('data-state', 'parked');
    expect(within(wave).getAllByText('Parked').length).toBeGreaterThan(0);
  });

  it('shows the gear and speed once the vehicle is in drive', () => {
    vehicleStatus.current = { ...vehicleStatus.current, gear_status: 'drive', speed_mph: 41.6 };
    const wave = openMap();
    expect(wave).toHaveAttribute('data-state', 'moving-D');
    expect(within(wave).getByText('Drive, 42 mph')).toHaveClass('sr-only');
    expect(within(wave).getByText('42')).toBeInTheDocument();
    expect(within(wave).getByText('mph')).toBeInTheDocument();
  });

  it('shows the speed in the custom speed unit from settings', () => {
    const previous = getUnitPreferences();
    setUnitPreferences({ ...previous, mode: 'custom', distance_unit: 'miles', speed_unit: 'kmh' }, { suppressEvent: true });
    try {
      vehicleStatus.current = { ...vehicleStatus.current, gear_status: 'drive', speed_mph: 41.6 };
      const wave = openMap();
      expect(within(wave).getByText('67')).toBeInTheDocument();
      expect(within(wave).getByText('km/h')).toBeInTheDocument();
      expect(within(wave).getByText('Drive, 67 km/h')).toHaveClass('sr-only');
    } finally {
      setUnitPreferences(previous, { suppressEvent: true });
    }
  });

  it('moves the map credits off the bottom edge the wave runs along', () => {
    openMap();
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-attribution', 'top-left');
  });
});

describe('resolveDriveWaveState', () => {
  it('maps the reported gear to a letter and treats park and sleep as parked', () => {
    expect(resolveDriveWaveState({ gear_status: 'Drive', speed_mph: 30 } as never)).toEqual({ kind: 'moving', gear: 'D', speedMph: 30 });
    expect(resolveDriveWaveState({ gear_status: 'reverse', speed_mph: 3 } as never)).toEqual({ kind: 'moving', gear: 'R', speedMph: 3 });
    expect(resolveDriveWaveState({ gear_status: 'neutral', speed_mph: null } as never)).toEqual({ kind: 'moving', gear: 'N', speedMph: null });
    expect(resolveDriveWaveState({ gear_status: 'park', speed_mph: 0 } as never)).toEqual({ kind: 'parked' });
    expect(resolveDriveWaveState({ gear_status: 'drive', speed_mph: 0, power_state: 'sleep' } as never)).toEqual({ kind: 'parked' });
  });

  it('falls back to speed when no gear is reported, and to nothing without a status', () => {
    expect(resolveDriveWaveState({ gear_status: null, speed_mph: 25 } as never)).toEqual({ kind: 'moving', gear: null, speedMph: 25 });
    expect(resolveDriveWaveState({ gear_status: null, speed_mph: 0.5 } as never)).toEqual({ kind: 'parked' });
    expect(resolveDriveWaveState(null)).toBeNull();
  });
});

describe('layoutDriveWave', () => {
  const speed = { width: 30, height: 36 };
  const gear = { width: 10, height: 14 };

  it('centers the speed hump with the gear hump beside it, crests clearing the text', () => {
    expect(layoutDriveWave(288, speed, null).center.x).toBe(144);
    const layout = layoutDriveWave(288, speed, gear);
    // The gear hump nudges the pair right only as far as the flat lead-in needs.
    expect(Math.abs(layout.center.x - 144)).toBeLessThan(10);
    expect(layout.gear.b).toBeCloseTo(layout.center.a);
    expect(layout.gear.x).toBeLessThan(layout.center.x);
    expect(layout.center.crest).toBeLessThan(DRIVE_WAVE_HEIGHT - 4 - speed.height);
    expect(layout.gear.crest).toBeGreaterThan(layout.center.crest);
  });

  it('runs the line past both edges and keeps the humps off the corners', () => {
    for (const width of [140, 288, 343, 452]) {
      const layout = layoutDriveWave(width, speed, gear);
      expect(layout.line).toMatch(/^M-\d/);
      expect(Number(layout.line.split(' ').at(-1)!.slice(1).split(',')[0])).toBeGreaterThan(width);
      expect(layout.gear.a).toBeGreaterThanOrEqual(12);
      expect(layout.center.b).toBeLessThanOrEqual(width - 12);
    }
  });

  it('keeps one command list with or without the gear so the line can animate', () => {
    const commands = (path: string) => path.replace(/[^A-Z]/g, '');
    expect(commands(layoutDriveWave(288, speed, null).line)).toBe(commands(layoutDriveWave(288, speed, gear).line));
  });
});

describe('resolveVehicleFacingDeg', () => {
  it('prefers the server facing over the stored course while parked', () => {
    vehicleStatus.current = { ...vehicleStatus.current, heading_deg: -88.6, facing_deg: 91.4, speed_mph: 0, gear_status: 'park' };
    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Current location map' }));
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-rotation', '91.4');
  });

  it('uses the live course while moving, turned around in reverse', () => {
    expect(resolveVehicleFacingDeg({ heading_deg: 10, speed_mph: 12, gear_status: 'drive', facing_deg: 200 } as never)).toBe(10);
    expect(resolveVehicleFacingDeg({ heading_deg: 10, speed_mph: 4, gear_status: 'reverse', facing_deg: 200 } as never)).toBe(190);
    expect(resolveVehicleFacingDeg({ heading_deg: -90, speed_mph: 30, gear_status: 'drive' } as never)).toBe(270);
  });

  it('falls back to the course, and to nothing without either', () => {
    expect(resolveVehicleFacingDeg({ heading_deg: 45, speed_mph: 0 } as never)).toBe(45);
    expect(resolveVehicleFacingDeg({ heading_deg: null, facing_deg: null } as never)).toBeNull();
    expect(resolveVehicleFacingDeg(null)).toBeNull();
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
