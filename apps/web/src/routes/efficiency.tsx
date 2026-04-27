import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useEfficiencySummary, useEfficiencyByMode } from '@riviamigo/hooks';
import {
  PageLayout, ChartSection, StatCardGrid, StatCard, DateRangePicker,
} from '@riviamigo/ui/primitives';
import { EfficiencyChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';

export const efficiencyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/efficiency',
  component: EfficiencyPage,
});

function EfficiencyPage() {
  return <AuthGuard><EfficiencyContent /></AuthGuard>;
}

function EfficiencyContent() {
  const { defaultVehicleId } = useAuth();

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  const { data: summary, isLoading: summaryLoading } = useEfficiencySummary(defaultVehicleId, from, to);
  const { data: byMode,  isLoading: byModeLoading }  = useEfficiencyByMode(defaultVehicleId, from, to);

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
          <StatCard label="Avg Efficiency" value={summary ? `${summary.avg.toFixed(0)}` : '—'} unit="Wh/mi" accent />
          <StatCard label="Best 10%"        value={summary ? `${summary.p10.toFixed(0)}` : '—'} unit="Wh/mi" />
          <StatCard label="Worst 10%"       value={summary ? `${summary.p90.toFixed(0)}` : '—'} unit="Wh/mi" />
        </StatCardGrid>

        <ChartSection title="Efficiency by Drive Mode" subtitle="Average with p10–p90 range">
          <EfficiencyChart data={byMode ?? []} loading={byModeLoading} height={280} />
        </ChartSection>
      </PageLayout>
    </AppLayout>
  );
}
