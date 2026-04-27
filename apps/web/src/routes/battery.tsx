import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useSocHistory, useRangeHistory, usePhantomDrain } from '@riviamigo/hooks';
import {
  PageLayout, ChartSection, StatCardGrid, StatCard, DateRangePicker,
} from '@riviamigo/ui/primitives';
import { SocAreaChart, RangeAreaChart, PhantomDrainChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';
import { Battery } from 'lucide-react';

export const batteryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/battery',
  component: BatteryPage,
});

function BatteryPage() {
  return <AuthGuard><BatteryContent /></AuthGuard>;
}

function BatteryContent() {
  const { defaultVehicleId } = useAuth();

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  const { data: socData,   isLoading: socLoading }   = useSocHistory(defaultVehicleId, from, to);
  const { data: rangeData, isLoading: rangeLoading } = useRangeHistory(defaultVehicleId, from, to);
  const { data: drainData, isLoading: drainLoading } = usePhantomDrain(defaultVehicleId, from, to);

  const latestSoc   = socData?.[socData.length - 1]?.soc;
  const latestRange = rangeData?.[rangeData.length - 1]?.range_mi;
  const avgDrain    = drainData?.length
    ? drainData.reduce((s, d) => s + d.drain_pct, 0) / drainData.length
    : undefined;

  return (
    <AppLayout activeKey="battery">
      <PageLayout
        title="Battery"
        actions={
          <DateRangePicker
            value={range}
            preset={preset}
            onChange={(r, p) => { setRange(r); if (p) setPreset(p); }}
          />
        }
      >
        <StatCardGrid>
          <StatCard
            label="Current SoC"
            value={latestSoc !== undefined ? `${Math.round(latestSoc)}%` : '—'}
            accent
            icon={<Battery className="h-4 w-4" />}
          />
          <StatCard label="Est. Range"        value={latestRange !== undefined ? `${Math.round(latestRange)} mi` : '—'} />
          <StatCard label="Avg Phantom Drain" value={avgDrain !== undefined ? `${avgDrain.toFixed(1)}%` : '—'} unit="/ night" />
        </StatCardGrid>

        <ChartSection title="State of Charge" subtitle={`${preset} history`}>
          <SocAreaChart data={socData ?? []} loading={socLoading} height={240} />
        </ChartSection>

        <ChartSection title="Estimated Range" subtitle={`${preset} history`}>
          <RangeAreaChart data={rangeData ?? []} loading={rangeLoading} height={200} />
        </ChartSection>

        <ChartSection title="Phantom Drain" subtitle="Overnight SoC loss">
          <PhantomDrainChart data={drainData ?? []} loading={drainLoading} height={200} />
        </ChartSection>
      </PageLayout>
    </AppLayout>
  );
}
