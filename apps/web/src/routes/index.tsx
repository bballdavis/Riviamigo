import React, { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import {
  useAuth, useSummaryStats, useVehicles, useSocHistory, useEfficiencyTrend,
} from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard, MetricTabs,
  StatCardSkeleton, EmptyState, DateRangePicker,
} from '@riviamigo/ui/primitives';
import { SocAreaChart, EfficiencyTrendChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { formatMiles, formatKwh } from '@riviamigo/ui/lib/utils';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';
import { Battery, TrendingUp } from 'lucide-react';

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
  const navigate = useNavigate();
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
                  <StatCard label="Energy Charged"  value={formatKwh(stats?.total_kwh_charged ?? 0)} />
                  <StatCard
                    label="Avg Efficiency"
                    value={stats?.lifetime_efficiency_wh_mi?.toFixed(0) ?? '—'}
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
                  data={(socData ?? []).map((p) => ({ ts: p.ts, soc: p.value ?? 0 }))}
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
