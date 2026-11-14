import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Native <select> stand-in so the editor's pickers can be driven in jsdom.
vi.mock('@riviamigo/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/primitives')>();
  const mock = await import('./mockPrimitives');
  return { ...actual, SelectPicker: mock.SelectPicker };
});

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  return {
    ...actual,
    useUpdateOverviewView: () => ({ mutate: vi.fn() }),
    useUpdateOverviewMapExpanded: () => ({ mutate: vi.fn() }),
    useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
    useMetricCatalog: () => ({ data: [] }),
    useBatteryHealth: () => ({ data: { battery_health_pct: 93, usable_now_kwh: 120 } }),
    useCurrentVehicleStatus: () => ({
      data: {
        vehicle_id: 'vehicle-1',
        drive_mode: 'all_purpose',
        gear_status: 'drive',
        battery_level: 64,
        range_miles: 188,
        tire_fl_psi: 48,
        tire_fl_status: 'normal',
        doors_locked: true,
        open_closures: [],
        battery_limit: 80,
        power_state: 'ready',
        charger_state: 'Disconnected',
        charger_status: 'chrgr_sts_not_connected',
        time_to_end_of_charge_min: null,
        speed_mph: 0,
        altitude_m: 100,
        cabin_temp_c: 21,
        outside_temp_c: 10,
        odometer_miles: 12345,
        heading_deg: 92,
        latitude: null,
        longitude: null,
        is_online: true,
        last_updated: '2026-05-12T12:00:00Z',
      },
    }),
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
import { setUnitSystem } from '@riviamigo/ui/lib/utils';
import {
  DEFAULT_OVERVIEW_STAT_IDS,
  OVERVIEW_STAT_DEFINITIONS,
  getOverviewStatOptions,
  resolveOverviewStatIds,
} from '../../../../packages/dashboards/src/widgets/custom/overviewStats';
import { getOverviewStatRequirements } from '../../../../packages/dashboards/src/widgets/custom/overviewStatDisplay';

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
    id: 'overview-stats-test',
    slug: 'overview-stats-test',
    name: 'Overview Stats Test',
    isDefault: false,
    isLocked: false,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [overviewWidget(options)],
  };
  render(
    <DashboardRenderer config={config} ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }} />,
  );
  return within(screen.getByTestId('overview-stats'));
}

describe('overview stat rows', () => {
  it('shows the five default sensors when nothing is configured', () => {
    const stats = renderOverview();
    for (const label of ['Driver mode', 'Altitude', 'Cabin', 'Speed', 'Software']) {
      expect(stats.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByTestId('overview-stats').children).toHaveLength(5);
  });

  it('shows exactly the sensors saved in the widget options, in order', () => {
    const stats = renderOverview({ stats: ['odometer', 'outside_temp', 'heading', 'speed', 'cabin_temp'] });
    const labels = Array.from(screen.getByTestId('overview-stats').children).map(
      (row) => row.firstElementChild?.textContent,
    );
    expect(labels).toEqual(['Odometer', 'Outside', 'Heading', 'Speed', 'Cabin']);
    expect(stats.getByText('12,345 mi')).toBeInTheDocument();
    expect(stats.getByText('E 92°')).toBeInTheDocument();
    expect(stats.queryByText('Altitude')).not.toBeInTheDocument();
  });

  it('never blanks a row for unknown, duplicate or missing entries', () => {
    renderOverview({ stats: ['nope', 'speed', 'speed'] });
    expect(screen.getByTestId('overview-stats').children).toHaveLength(5);
  });
});

describe('resolveOverviewStatIds', () => {
  it('returns the defaults for missing or non-array input', () => {
    expect(resolveOverviewStatIds(undefined)).toEqual([...DEFAULT_OVERVIEW_STAT_IDS]);
    expect(resolveOverviewStatIds('speed')).toEqual([...DEFAULT_OVERVIEW_STAT_IDS]);
  });

  it('always yields five unique known ids', () => {
    for (const input of [[], ['speed'], ['x', 'x', 'x'], ['speed', 'speed', 'speed', 'speed', 'speed', 'speed']]) {
      const ids = resolveOverviewStatIds(input);
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
      ids.forEach((id) => expect(OVERVIEW_STAT_DEFINITIONS.some((d) => d.id === id)).toBe(true));
    }
  });

  it('keeps valid choices in their slots', () => {
    expect(resolveOverviewStatIds(['odometer', 'nope', 'heading'])).toEqual([
      'odometer', 'altitude', 'heading', 'speed', 'software',
    ]);
  });
});

describe('overview stat editor', () => {
  it('lists the five sensors currently shown, one picker per row', () => {
    render(<WidgetEditForm widget={overviewWidget()} onChange={() => undefined} onClose={() => undefined} />);
    const values = [1, 2, 3, 4, 5].map(
      (row) => (screen.getByLabelText(`Stat row ${row}`) as HTMLSelectElement).value,
    );
    expect(values).toEqual([...DEFAULT_OVERVIEW_STAT_IDS]);
  });

  it('saves a changed sensor into the widget options', () => {
    const onChange = vi.fn();
    render(<WidgetEditForm widget={overviewWidget()} onChange={onChange} onClose={() => undefined} />);

    fireEvent.change(screen.getByLabelText('Stat row 2'), { target: { value: 'odometer' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].options).toMatchObject({
      stats: ['driver_mode', 'odometer', 'cabin_temp', 'speed', 'software'],
    });
  });

  it('does not offer a sensor that another row already shows', () => {
    render(<WidgetEditForm widget={overviewWidget()} onChange={() => undefined} onClose={() => undefined} />);
    const row1 = within(screen.getByLabelText('Stat row 1')).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(row1).toContain('driver_mode');
    expect(row1).toContain('odometer');
    expect(row1).not.toContain('altitude');
    expect(row1).not.toContain('software');
  });

  it('resets to the default sensors', () => {
    const onChange = vi.fn();
    render(
      <WidgetEditForm
        widget={overviewWidget({ stats: ['odometer', 'heading', 'speed', 'cabin_temp', 'software'], keep: true })}
        onChange={onChange}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    const next = onChange.mock.calls[0]![0].options;
    expect(next).not.toHaveProperty('stats');
    expect(next).toMatchObject({ keep: true });
  });

  it('does not show the stat rows for other custom widgets', () => {
    render(
      <WidgetEditForm
        widget={{ ...overviewWidget(), definitionId: 'charging.connection' }}
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByLabelText('Stat row 1')).toBeNull();
  });
});

describe('overview rows show current readings from any sensor', () => {
  afterEach(() => setUnitSystem('imperial'));

  it('shows live state, status sensors and battery health side by side', () => {
    renderOverview({
      stats: ['battery_level', 'tire_fl', 'hv_thermal', 'battery_health_pct', 'doors_locked'],
    });
    const rows = Array.from(screen.getByTestId('overview-stats').children).map((row) => ({
      label: row.firstElementChild?.textContent,
      value: row.lastElementChild?.textContent,
    }));
    expect(rows).toEqual([
      { label: 'Battery', value: '64%' },
      { label: 'Tire FL', value: '48 psi' },
      { label: 'HV Thermal', value: 'Unavailable' },
      { label: 'Battery Health', value: '93%' },
      { label: 'Doors', value: 'Locked' },
    ]);
  });

  it('converts distances, speeds, temperatures, pressures and altitude to the chosen units', () => {
    setUnitSystem('metric');
    renderOverview({ stats: ['range', 'tire_fl', 'cabin_temp', 'odometer', 'altitude'] });
    const values = Array.from(screen.getByTestId('overview-stats').children).map((row) => row.lastElementChild?.textContent);
    expect(values).toEqual(['302.6 km', '331 kPa', '21 C', '19,867.4 km', '100 m']);
  });

  it('re-formats the rows when the unit settings change', () => {
    renderOverview({ stats: ['range', 'tire_fl', 'cabin_temp', 'odometer', 'altitude'] });
    const read = () => Array.from(screen.getByTestId('overview-stats').children).map((row) => row.lastElementChild?.textContent);
    expect(read()).toEqual(['188 mi', '48 psi', '70 F', '12,345 mi', '328 ft']);

    act(() => setUnitSystem('metric'));

    expect(read()).toEqual(['302.6 km', '331 kPa', '21 C', '19,867.4 km', '100 m']);
  });

  it('keeps sensor choices when the saved rows are resolved and drops statistics', () => {
    expect(resolveOverviewStatIds(['battery_health_pct', 'hv_thermal', 'total_miles', 'metric:tire_fl_psi'])).toEqual([
      'battery_health_pct',
      'hv_thermal',
      'cabin_temp',
      'speed',
      'software',
    ]);
  });

  it('lists each reading once, grouped, and only current values', () => {
    const options = getOverviewStatOptions();
    const ids = options.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('battery_health_pct');
    expect(ids).toContain('hv_thermal');
    // Statistics over a date range stay on sensor chips.
    for (const statistic of ['total_miles', 'avg_efficiency', 'charging_total_cost', 'trip_miles', 'charging_sessions_summary']) {
      expect(ids).not.toContain(statistic);
    }
    // Status-backed rows already cover these.
    expect(ids).not.toContain('twelve_volt_health');
    expect(new Set(options.map((option) => option.group))).toEqual(
      new Set(['Vehicle state', 'Battery health', 'Vehicle systems']),
    );
  });

  it('asks the dashboard for battery health only when a chosen row reads it', () => {
    expect(getOverviewStatRequirements(['speed', 'altitude'])).toEqual({ status: true });
    expect(getOverviewStatRequirements(['speed', 'battery_health_pct'])).toEqual({ status: true, batteryHealth: true });
  });

  it('offers every current reading in the editor, searchable', () => {
    render(<WidgetEditForm widget={overviewWidget()} onChange={() => undefined} onClose={() => undefined} />);
    const row1 = within(screen.getByLabelText('Stat row 1')).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(row1).toContain('battery_health_pct');
    expect(row1).toContain('hv_thermal');
    expect(row1).toContain('tire_fl');
    expect(row1).not.toContain('total_miles');
  });
});
