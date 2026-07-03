import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('./mockPrimitives');
  return m;
});

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  return {
    ...actual,
    useMetricValue: () => ({
      data: {
        metric: 'avg_efficiency',
        value: 200,
        unit: 'Wh/mi',
        label: 'Avg Efficiency',
        ts: '2026-05-07T00:00:00Z',
      },
    }),
    useMetricSeries: () => ({
      data: [
        { ts: '2026-05-01T00:00:00Z', value: 1000 },
        { ts: '2026-05-02T00:00:00Z', value: 330 },
        { ts: '2026-05-03T00:00:00Z', value: 999 },
      ],
    }),
    useEfficiencySummary: () => ({
      data: {
        avg: 200,
        p10: 180,
        p90: 220,
        total_miles: 120,
      },
    }),
  };
});

import { DashboardRenderer, type DashboardConfig } from '@riviamigo/dashboards';
import { registerTripsInStore, resetTripSelection, toggleTripSelection } from '../../../../packages/dashboards/src/widgets/table/tripSelectionStore';

function config(): DashboardConfig {
  return {
    schemaVersion: 2,
    id: '00000000-0000-0000-0000-000000000098',
    slug: 'trips-weighted-test',
    name: 'Trips Weighted Test',
    isDefault: false,
    isLocked: false,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [
      {
        id: 'd5000005-0000-0000-0000-000000000003',
        componentType: 'custom',
        definitionId: 'trips.stat',
        title: 'Avg Efficiency',
        options: { stat: 'efficiency', metric: 'avg_efficiency', icon: 'gauge', accentBorder: false },
        layout: { x: 0, y: 0, w: 3, h: 2 },
      },
    ],
  };
}

describe('Trips weighted efficiency stat', () => {
  beforeEach(() => {
    resetTripSelection('vehicle-1::2026-05-01T00:00:00Z::2026-05-07T00:00:00Z', { force: true });
  });

  it('uses the weighted average for selected trips and the metric summary when nothing is selected', async () => {
    render(
      <DashboardRenderer
        config={config()}
        ctx={{
          vehicleId: 'vehicle-1',
          timeframe: {
            kind: 'custom',
            from: new Date('2026-05-01T00:00:00Z'),
            to: new Date('2026-05-07T00:00:00Z'),
          },
          from: '2026-05-01T00:00:00Z',
          to: '2026-05-07T00:00:00Z',
        }}
      />
    );

    await waitFor(() => expect(screen.getByText('5.0 mi/kWh')).toBeInTheDocument());

    registerTripsInStore([
      { id: 'trip-short', distance_mi: 1, duration_min: 5, efficiency_wh_mi: 1000 },
      { id: 'trip-long', distance_mi: 100, duration_min: 180, efficiency_wh_mi: 330 },
      { id: 'trip-other', distance_mi: 12, duration_min: 20, efficiency_wh_mi: 400 },
    ] as never);

    act(() => {
      toggleTripSelection('trip-short');
      toggleTripSelection('trip-long');
    });

    await waitFor(() => expect(screen.getByText('3.0 mi/kWh')).toBeInTheDocument());
    expect(screen.queryByText('5.0 mi/kWh')).not.toBeInTheDocument();
  });
});
