import React, { useState } from 'react';
import { useAuth, useCurrentVehicleStatus, useVehicles, useSocHistory, useRangeHistory, useEfficiencyTrend, useChargingSummary, usePhantomDrain } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { DashboardPageShell } from './DashboardPageShell';
import {
  SocAreaChart,
  RangeAreaChart,
  EfficiencyTrendChart,
  EnergyBarChart,
  PhantomDrainChart,
} from '@riviamigo/ui/charts';
import {
  createDefaultDashboardEditActions,
  CurrentVehicleStatePanel,
  renderDefaultDashboardTitleAction,
  type DashboardPageProps,
} from './DashboardPage';

// ── Available metrics ────────────────────────────────────────────────────────

type MetricKey = 'soc' | 'range' | 'efficiency' | 'energy' | 'phantom';

interface MetricOption {
  key: MetricKey;
  label: string;
  description: string;
}

const METRICS: MetricOption[] = [
  { key: 'soc',        label: 'Battery Level (SoC)',   description: 'State of charge over time' },
  { key: 'range',      label: 'Estimated Range',        description: 'Rated range over time' },
  { key: 'efficiency', label: 'Efficiency Trend',       description: '7-day rolling avg + daily' },
  { key: 'energy',     label: 'Energy Charged',         description: 'Energy added per week' },
  { key: 'phantom',    label: 'Phantom Drain',          description: 'Overnight idle battery loss' },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export function OverviewDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const { defaultVehicleId } = useAuth();
  const updateDashboard = useUpdateDashboard();
  const { data: currentStatus } = useCurrentVehicleStatus(defaultVehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === defaultVehicleId);

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      renderBeforeDashboard={({ isEditMode, ctx }) =>
        !isEditMode ? (
          <>
            <CurrentVehicleStatePanel status={currentStatus} images={activeVehicle?.images} />
            <MetricExplorerPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} />
          </>
        ) : (
          <CurrentVehicleStatePanel status={currentStatus} images={activeVehicle?.images} />
        )
      }
    />
  );
}

// ── Metric explorer ───────────────────────────────────────────────────────────

function MetricExplorerPanel({
  vehicleId,
  from,
  to,
}: {
  vehicleId: string | null;
  from: string;
  to: string;
}) {
  const [activeKey, setActiveKey] = useState<MetricKey>('soc');
  const activeMetric = METRICS.find((m) => m.key === activeKey) ?? METRICS[0];

  return (
    <div className="mb-4 rounded-xl border border-border bg-bg-elevated/70 p-4">
      {/* Selector bar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-fg">{activeMetric.label}</div>
          <div className="text-xs text-fg-tertiary">{activeMetric.description}</div>
        </div>
        <select
          className="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          value={activeKey}
          onChange={(e) => setActiveKey(e.target.value as MetricKey)}
          aria-label="Select metric"
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Chart */}
      <MetricChart metricKey={activeKey} vehicleId={vehicleId} from={from} to={to} />
    </div>
  );
}

function MetricChart({
  metricKey,
  vehicleId,
  from,
  to,
}: {
  metricKey: MetricKey;
  vehicleId: string | null;
  from: string;
  to: string;
}) {
  const { data: soc = [], isFetching: socFetching } = useSocHistory(
    metricKey === 'soc' ? vehicleId : null, from, to
  );
  const { data: range = [], isFetching: rangeFetching } = useRangeHistory(
    metricKey === 'range' ? vehicleId : null, from, to
  );
  const { data: trend = [], isFetching: trendFetching } = useEfficiencyTrend(
    metricKey === 'efficiency' ? vehicleId : null, from, to
  );
  const { data: chargeSummary, isFetching: chargeFetching } = useChargingSummary(
    metricKey === 'energy' ? vehicleId : null, from, to
  );
  const { data: phantom = [], isFetching: phantomFetching } = usePhantomDrain(
    metricKey === 'phantom' ? vehicleId : null, from, to
  );

  const weekly = (chargeSummary?.weekly ?? []).map((w) => ({
    ts: w.week_start,
    energy_added_kwh: w.energy_kwh,
  }));

  switch (metricKey) {
    case 'soc':
      return (
        <SocAreaChart
          data={soc}
          loading={socFetching}
          height={300}
          showBrush
          showGrid
        />
      );
    case 'range':
      return (
        <RangeAreaChart
          data={range}
          loading={rangeFetching}
          height={300}
          showBrush
        />
      );
    case 'efficiency':
      return (
        <EfficiencyTrendChart
          data={trend}
          loading={trendFetching}
          height={300}
          showBrush
        />
      );
    case 'energy':
      return (
        <EnergyBarChart
          data={weekly}
          loading={chargeFetching}
          height={300}
          showBrush
        />
      );
    case 'phantom':
      return (
        <PhantomDrainChart
          data={phantom}
          loading={phantomFetching}
          height={300}
        />
      );
  }
}