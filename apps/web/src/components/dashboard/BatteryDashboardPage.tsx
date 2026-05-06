import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useBatteryHealth, useBatteryMileage, useCurrentVehicleStatus, useDegradation } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { BatteryCapacityByMileageChart, DegradationChart, ProjectedRangeByMileageChart } from '@riviamigo/ui/charts';
import { ChartPicker, StatCard, Card } from '@riviamigo/ui/primitives';
import { formatKwh, formatNumber } from '@riviamigo/ui/lib/utils';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

type BatteryChartKey = 'capacity-mileage' | 'projected-range-mileage' | 'degradation';

function ComparisonCard({
  label,
  labelSuffix,
  nowValue,
  newValue,
  onNewClick,
  loading = false,
}: {
  label: string;
  labelSuffix: string;
  nowValue: string;
  newValue: string;
  onNewClick: () => void;
  loading?: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-fg-tertiary uppercase tracking-wider">
          {label}
          <span className="ml-1 text-[10px] font-normal leading-none">({labelSuffix})</span>
        </p>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-fg">
          {loading ? '...' : nowValue}
        </span>
        <button
          onClick={onNewClick}
          disabled={loading}
          className="text-sm font-mono tabular-nums text-fg-tertiary hover:text-fg-secondary hover:underline disabled:opacity-50 transition-colors"
        >
          {loading ? '...' : `/${newValue}`}
        </button>
      </div>
    </Card>
  );
}

const BATTERY_CHART_OPTIONS: Array<{ value: BatteryChartKey; label: string }> = [
  { value: 'capacity-mileage', label: 'Battery Capacity by Mileage' },
  { value: 'projected-range-mileage', label: 'Projected Range - Mileage' },
  { value: 'degradation', label: 'Battery Health' },
];

export function BatteryDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      renderBeforeDashboard={({ isEditMode, ctx }) =>
        !isEditMode ? <BatteryPanel vehicleId={ctx.vehicleId} /> : null
      }
      renderDashboard={({ isEditMode }) => isEditMode}
    />
  );
}

function BatteryPanel({ vehicleId }: { vehicleId: string | null }) {
  const navigate = useNavigate();

  const [chartKey, setChartKey] = useState<BatteryChartKey>('capacity-mileage');
  const [chartSearch, setChartSearch] = useState('');
  const { data: currentStatus, isLoading: statusLoading } = useCurrentVehicleStatus(vehicleId);
  const { data: health, isLoading: healthLoading } = useBatteryHealth(vehicleId);
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(vehicleId);
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(vehicleId);

  const remainingRangeNow = currentStatus?.range_miles ?? null;
  const batteryLevelNow = currentStatus?.battery_level ?? null;
  const chargingCycles = health?.charging_cycles ?? health?.charge_count ?? null;
  const maxRangeNow = (remainingRangeNow != null && batteryLevelNow != null && batteryLevelNow > 0)
    ? (remainingRangeNow / batteryLevelNow * 100)
    : null;
  const maxRangeNew = (maxRangeNow != null && health?.battery_health_pct != null && health.battery_health_pct > 0)
    ? (maxRangeNow / health.battery_health_pct * 100)
    : null;
  const rangeLoading = healthLoading || statusLoading;

  return (
    <section className="mb-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Battery Health"
          value={healthLoading ? '...' : formatPercentValue(health?.battery_health_pct)}
          accent
        />
        <StatCard
          label="Estimated Degradation"
          value={healthLoading ? '...' : formatPercentValue(health?.estimated_degradation_pct)}
        />
        <ComparisonCard
          label="Capacity"
          labelSuffix="now/new"
          nowValue={healthLoading ? '...' : formatKwh(health?.usable_now_kwh)}
          newValue={healthLoading ? '...' : formatKwh(health?.usable_new_kwh)}
          onNewClick={() => navigate({ to: '/settings', search: `?section=vehicles&vehicleId=${vehicleId}` })}
          loading={healthLoading}
        />
        <ComparisonCard
          label="Max Range"
          labelSuffix="now/new"
          nowValue={rangeLoading ? '...' : maxRangeNow != null ? `${formatNumber(maxRangeNow, 0)} mi` : '-'}
          newValue={rangeLoading ? '...' : maxRangeNew != null ? `${formatNumber(maxRangeNew, 0)} mi` : '-'}
          onNewClick={() => navigate({ to: '/settings', search: `?section=vehicles&vehicleId=${vehicleId}` })}
          loading={rangeLoading}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Charges"
          value={healthLoading ? '...' : String(health?.charge_count ?? 0)}
        />
        <StatCard
          label="Charging Cycles"
          value={healthLoading ? '...' : formatStatNumber(chargingCycles, 0)}
        />
        <StatCard
          label="Energy Added"
          value={healthLoading ? '...' : formatKwh(health?.total_energy_added_kwh)}
        />
        <StatCard
          label="Charging Efficiency"
          value={healthLoading ? '...' : formatPercentValue(health?.charging_efficiency_pct)}
        />
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated/70 p-4">
        <ChartPicker
          value={chartKey}
          options={BATTERY_CHART_OPTIONS}
          onChange={setChartKey}
          searchValue={chartSearch}
          onSearchChange={setChartSearch}
        />
        {chartKey === 'capacity-mileage' ? (
          <BatteryCapacityByMileageChart data={mileage} loading={mileageLoading} height={300} />
        ) : chartKey === 'projected-range-mileage' ? (
          <ProjectedRangeByMileageChart data={mileage} loading={mileageLoading} height={300} />
        ) : (
          <DegradationChart data={degradation} loading={degradationLoading} height={300} showBrush />
        )}
      </div>
    </section>
  );
}

function formatStatNumber(value: number | null | undefined, decimals = 1) {
  return value == null ? '-' : formatNumber(value, decimals);
}

function formatPercentValue(value: number | null | undefined) {
  return value == null ? '-' : `${formatNumber(value, 1)}%`;
}
