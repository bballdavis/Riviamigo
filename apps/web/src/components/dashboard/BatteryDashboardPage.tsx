import React, { useState } from 'react';
import { useBatteryHealth, useBatteryMileage, useDegradation } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { BatteryCapacityByMileageChart, DegradationChart, ProjectedRangeByMileageChart } from '@riviamigo/ui/charts';
import { ChartPicker, StatCard } from '@riviamigo/ui/primitives';
import { formatKwh, formatNumber } from '@riviamigo/ui/lib/utils';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

type BatteryChartKey = 'capacity-mileage' | 'projected-range-mileage' | 'degradation';

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
  const [chartKey, setChartKey] = useState<BatteryChartKey>('capacity-mileage');
  const [chartSearch, setChartSearch] = useState('');
  const { data: health, isLoading: healthLoading } = useBatteryHealth(vehicleId);
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(vehicleId);
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(vehicleId);

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
        <StatCard
          label="Usable Now"
          value={healthLoading ? '...' : formatKwh(health?.usable_now_kwh)}
        />
        <StatCard
          label="Usable New"
          value={healthLoading ? '...' : formatKwh(health?.usable_new_kwh)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Charges"
          value={healthLoading ? '...' : String(health?.charge_count ?? 0)}
        />
        <StatCard
          label="Charging Cycles"
          value={healthLoading ? '...' : formatStatNumber(health?.charging_cycles, 0)}
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
