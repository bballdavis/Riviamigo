import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { DashboardContent } from '@riviamigo/dashboards';

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const TABS = [
  { key: 'soc',        label: 'State of Charge', icon: <Battery /> },
  { key: 'efficiency', label: 'Efficiency Trend', icon: <TrendingUp /> },
];

function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

function DashboardContent() {
  const { defaultVehicleId } = useAuth();
  const [tab, setTab] = useState('soc');

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  const { data: stats, isLoading: statsLoading } = useSummaryStats(defaultVehicleId);
  const { data: socData,  isLoading: socLoading }       = useSocHistory(defaultVehicleId, from, to);
  const { data: trendData, isLoading: trendLoading }    = useEfficiencyTrend(defaultVehicleId, from, to);
  const { data: vehicles }                              = useVehicles();

  const hasVehicle = !!defaultVehicleId;

  return (
    <AppLayout activeKey="dashboard">
      <PageLayout
        title="Dashboard"
        subtitle={vehicles?.[0]?.display_name ?? undefined}
        actions={
          <DateRangePicker
            value={range}
            preset={preset}
            onChange={(r, p) => { setRange(r); if (p) setPreset(p); }}
          />
        }
      >
        {!hasVehicle ? (
          <NoVehicleState />
        ) : (
          <>
            <StatCardGrid>
              {statsLoading ? (
                Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
              ) : (
                <>
                  <StatCard label="Total Miles"     value={formatMiles(stats?.total_miles ?? 0)} accent />
                  <StatCard label="Total Trips"     value={stats?.total_trips ?? 0} />
                  <StatCard label="Energy Charged"  value={formatKwh(stats?.total_energy_kwh ?? 0)} />
                  <StatCard
                    label="Avg Efficiency"
                    value={stats?.avg_efficiency_wh_mi?.toFixed(0) ?? '—'}
                    unit="Wh/mi"
                  />
                </>
              )}
            </StatCardGrid>

            <MetricTabs
              tabs={TABS}
              active={tab}
              onChange={setTab}
              title="Overview"
              subtitle={`Last ${preset}`}
            >
              {tab === 'soc' && (
                <SocAreaChart
                  data={socData ?? []}
                  loading={socLoading}
                  height={240}
                  showBrush
                />
              )}
              {tab === 'efficiency' && (
                <EfficiencyTrendChart
                  data={trendData ?? []}
                  loading={trendLoading}
                  height={240}
                  showBrush
                />
              )}
            </MetricTabs>
          </>
        )}
      </PageLayout>
    </AppLayout>
  );
}
