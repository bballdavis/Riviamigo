import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  const period = {
    period_start: '2026-05-01T08:00:00Z',
    period_end: '2026-05-01T20:00:00Z',
    duration_hours: 12,
    sleep_share_pct: 0.92,
    state_coverage_pct: 0.97,
    soc_start: 68,
    soc_end: 62,
    soc_lost_pct: 6,
    drain_pct_per_hour: 0.5,
    range_start_mi: 270,
    range_end_mi: 244,
    range_lost_mi: 26,
    range_lost_per_hour_mi: 2.2,
    energy_drained_kwh: 4.8,
    avg_power_w: 400,
    has_reduced_range: false,
    validation_status: 'validated',
    validation_reason: null,
    sample_count: 12,
    start_sample_at: '2026-05-01T08:05:00Z',
    end_sample_at: '2026-05-01T19:55:00Z',
    movement_detected: false,
    overlaps_trip: false,
    overlaps_charge: false,
  };

  return {
    ...actual,
    useAuth: () => ({
      defaultVehicleId: 'vehicle-1',
      activeVehicleId: 'vehicle-1',
      setActiveVehicleId: vi.fn(),
    }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', display_name: 'Demo R1T', model: 'R1T' }] }),
    usePhantomDrainPeriods: () => ({ data: { vehicle_id: 'vehicle-1', periods: [period] }, isLoading: false }),
  };
});

vi.mock('@riviamigo/dashboards', () => ({
  SensorChipSummary: ({ title, value, secondary }: { title: string; value: string; secondary?: string }) => (
    <div data-testid="sensor-chip-summary">
      <div>{title}</div>
      <div>{value}</div>
      {secondary ? <div>{secondary}</div> : null}
    </div>
  ),
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  getDefaultBySlug: () => ({
    schemaVersion: 2,
    id: 'dashboard',
    slug: 'battery',
    name: 'Battery',
    isDefault: true,
    isLocked: false,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [],
  }),
  useDashboardBySlug: () => ({
    data: {
      schemaVersion: 2,
      id: 'dashboard',
      slug: 'battery',
      name: 'Battery',
      isDefault: true,
      isLocked: false,
      ownerId: null,
      controls: { dateRange: true },
      widgets: [],
    },
    isLoading: false,
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/layout/NoVehicleState', () => ({
  NoVehicleState: () => <div>No vehicle</div>,
}));

vi.mock('../../lib/dates', () => ({
  DEFAULT_PRESET: '30d',
  presetToRange: () => ({ from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-05-31T23:59:59Z') }),
  rangeToIso: () => ({ from: '2026-05-01T00:00:00Z', to: '2026-05-31T23:59:59Z' }),
}));

import { BatteryPhantomDrainPage } from '../../components/dashboard/BatteryPhantomDrainPage';

describe('BatteryPhantomDrainPage', () => {
  it('renders unified table controls and combined SoC values', async () => {
    render(<BatteryPhantomDrainPage navKey="battery.phantom-drain" slug="battery" title="Phantom Drain" />);

    expect(screen.getByPlaceholderText('Search periods')).toBeInTheDocument();
    expect(screen.getByText('Rows')).toBeInTheDocument();
    expect(screen.getByText('Avg sleep')).toBeInTheDocument();

    await waitFor(() => expect(
      screen.getByText((content) => content.includes('68') && content.includes('62'))
    ).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Search periods'), { target: { value: '999' } });
    expect(await screen.findByText('No matching phantom drain periods')).toBeInTheDocument();
  });
});
