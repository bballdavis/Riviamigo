import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WidgetCtx } from '@riviamigo/dashboards';

const hooks = vi.hoisted(() => ({
  metricBatch: vi.fn<(...args: unknown[]) => { data: { values: never[]; series: never[] }; isFetching: boolean }>((..._args) => ({ data: { values: [], series: [] }, isFetching: false })),
  status: vi.fn<(...args: unknown[]) => { data: null; isFetching: boolean }>((..._args) => ({ data: null, isFetching: false })),
  batteryHealth: vi.fn<(...args: unknown[]) => { data: null; isFetching: boolean }>((..._args) => ({ data: null, isFetching: false })),
  chargingSummary: vi.fn<(...args: unknown[]) => { data: null; isFetching: boolean }>((..._args) => ({ data: null, isFetching: false })),
  efficiencySummary: vi.fn<(...args: unknown[]) => { data: null; isFetching: boolean }>((..._args) => ({ data: null, isFetching: false })),
}));

vi.mock('@riviamigo/hooks', () => ({
  useMetricBatch: (...args: unknown[]) => hooks.metricBatch(...args),
  useCurrentVehicleStatus: (...args: unknown[]) => hooks.status(...args),
  useBatteryHealth: (...args: unknown[]) => hooks.batteryHealth(...args),
  useChargingSummary: (...args: unknown[]) => hooks.chargingSummary(...args),
  useEfficiencySummary: (...args: unknown[]) => hooks.efficiencySummary(...args),
}));

import { DashboardDataProvider } from '../../../../packages/dashboards/src/dashboardData';

describe('DashboardDataProvider trip-tag filters', () => {
  it('passes the same normalized cohort into metric batch and efficiency summary requests', () => {
    const filter = { tagIds: ['tag-bike', 'tag-rack'], tagMatch: 'any' as const, untagged: false };
    const ctx: WidgetCtx = {
      vehicleId: 'vehicle-1',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-31T23:59:59Z',
      tripTagFilter: filter,
    };

    render(
      <DashboardDataProvider ctx={ctx} requirements={{ metrics: [{ metric: 'avg_efficiency' }], efficiencySummary: true }}>
        <div />
      </DashboardDataProvider>,
    );

    expect(hooks.metricBatch).toHaveBeenLastCalledWith(
      'vehicle-1',
      [{ metric: 'avg_efficiency' }],
      ctx.from,
      ctx.to,
      false,
      filter,
    );
    expect(hooks.efficiencySummary).toHaveBeenLastCalledWith('vehicle-1', ctx.from, ctx.to, filter);
  });
});
