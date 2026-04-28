import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import {
  useAuth, useEfficiencySummary, useEfficiencyByMode,
  useEfficiencyTrend, useEfficiencyVsTemp,
} from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard, MetricTabs, DateRangePicker,
} from '@riviamigo/ui/primitives';
import {
  EfficiencyChart, EfficiencyTrendChart, EfficiencyVsTempChart,
} from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';
import { BarChart2, TrendingUp, Thermometer, Gauge } from 'lucide-react';

export const efficiencyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/efficiency',
  component: EfficiencyPage,
});

const TABS = [
  { key: 'by-mode', label: 'By Drive Mode', icon: <BarChart2 /> },
  { key: 'trend',   label: 'Trend',          icon: <TrendingUp /> },
  { key: 'vs-temp', label: 'vs Temperature', icon: <Thermometer /> },
];

function EfficiencyPage() {
  return <AuthGuard><EfficiencyContent /></AuthGuard>;
}

export function EfficiencyContent() {
  const { defaultVehicleId } = useAuth();
  const [tab, setTab] = useState('by-mode');

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  const { data: summary }               = useEfficiencySummary(defaultVehicleId, from, to);
  const { data: byMode,  isLoading: byModeLoading }  = useEfficiencyByMode(defaultVehicleId, from, to);
  const { data: trend,   isLoading: trendLoading }   = useEfficiencyTrend(defaultVehicleId, from, to);
  const { data: vsTemp,  isLoading: vsTempLoading }  = useEfficiencyVsTemp(defaultVehicleId, from, to);

  return (
    <AppLayout activeKey="efficiency">
      <PageLayout
        title="Efficiency"
        actions={
          <DateRangePicker
            value={range}
            preset={preset}
            onChange={(r, p) => { setRange(r); if (p) setPreset(p); }}
          />
        }
      >
        <StatCardGrid>
          <StatCard label="Avg Efficiency" value={summary ? `${summary.avg_wh_per_mi.toFixed(0)}` : '—'} unit="Wh/mi" accent icon={<Gauge className="h-4 w-4" />} />
          <StatCard label="Best 10%"        value={summary ? `${(summary.p10_wh_per_mi ?? 0).toFixed(0)}` : '—'} unit="Wh/mi" />
          <StatCard label="Worst 10%"       value={summary ? `${(summary.p90_wh_per_mi ?? 0).toFixed(0)}` : '—'} unit="Wh/mi" />
          <StatCard label="Total Miles"     value={summary ? `${(summary.total_miles ?? 0).toFixed(0)}` : '—'} unit="mi" />
        </StatCardGrid>

        <MetricTabs
          tabs={TABS}
          active={tab}
          onChange={setTab}
          title="Efficiency"
          subtitle={`${preset} breakdown`}
        >
          {tab === 'by-mode' && (
            <EfficiencyChart
              data={(byMode ?? []).map((d) => ({
                drive_mode: d.drive_mode,
                avg_efficiency: d.avg_wh_per_mi,
                p10_efficiency: 0,
                p90_efficiency: 0,
              }))}
              loading={byModeLoading}
              height={280}
            />
          )}
          {tab === 'trend' && (
            <EfficiencyTrendChart data={trend ?? []} loading={trendLoading} height={280} showBrush />
          )}
          {tab === 'vs-temp' && (
            <EfficiencyVsTempChart data={vsTemp ?? []} loading={vsTempLoading} height={280} />
          )}
        </MetricTabs>
      </PageLayout>
    </AppLayout>
  );
}
