import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth, useSummaryStats, useVehicles, useSocHistory, useEfficiencyTrend } from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard, MetricTabs,
  StatCardSkeleton, EmptyState, DateRangePicker, presetToRange,
} from '@riviamigo/ui/primitives';
import { SocAreaChart, EfficiencyTrendChart } from '@riviamigo/ui/charts';
import { formatMiles, formatKwh } from '@riviamigo/ui/lib/utils';
import { Car, Battery, TrendingUp } from 'lucide-react';
import type { PresetKey } from '@riviamigo/ui/primitives';

interface DateRange {
  from: Date;
  to: Date;
}

function rangeToIso(range: DateRange): { from: string; to: string } {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  };
}

const TABS = [
  { key: 'soc', label: 'State of Charge', icon: <Battery /> },
  { key: 'efficiency', label: 'Efficiency Trend', icon: <TrendingUp /> },
];

export function DashboardContent() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('soc');

  const [preset, setPreset] = useState<PresetKey>('30d');
  const [range, setRange] = useState(presetToRange('30d'));
  const { from, to } = rangeToIso(range);

  const { data: stats, isLoading: statsLoading } = useSummaryStats(defaultVehicleId);
  const { data: socData, isLoading: socLoading } = useSocHistory(defaultVehicleId, from, to);
  const { data: trendData, isLoading: trendLoading } = useEfficiencyTrend(defaultVehicleId, from, to);
  const { data: vehicles } = useVehicles();

  const hasVehicle = !!defaultVehicleId;

  return (
    <PageLayout
      title="Dashboard"
      subtitle={vehicles?.[0]?.display_name ?? undefined}
      actions={
        <DateRangePicker
          value={range}
          preset={preset}
          onChange={(r, p) => {
            setRange(r);
            if (p) setPreset(p);
          }}
        />
      }
    >
      {!hasVehicle ? (
        <EmptyState
          icon={<Car />}
          title="No vehicle connected"
          description="Connect your Rivian account to start tracking telemetry."
          action={{ label: 'Connect Rivian', onClick: () => navigate({ to: '/connect' }) }}
        />
      ) : (
        <>
          <StatCardGrid>
            {statsLoading ? (
              Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard label="Total Miles" value={formatMiles(stats?.total_miles ?? 0)} accent />
                <StatCard label="Total Trips" value={stats?.total_trips ?? 0} />
                <StatCard label="Energy Charged" value={formatKwh(stats?.total_energy_kwh ?? 0)} />
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
  );
}