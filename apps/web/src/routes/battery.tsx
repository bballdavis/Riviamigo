import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import {
  useAuth, useSocHistory, useRangeHistory, usePhantomDrain, useDegradation,
} from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard, MetricTabs, DateRangePicker,
} from '@riviamigo/ui/primitives';
import {
  SocAreaChart, RangeAreaChart, PhantomDrainChart, DegradationChart,
} from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';
import { Battery, TrendingDown, Moon, Activity } from 'lucide-react';

export const batteryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/battery',
  component: BatteryPage,
});

const TABS = [
  { key: 'soc',         label: 'State of Charge', icon: <Battery /> },
  { key: 'range',       label: 'Range',            icon: <Activity /> },
  { key: 'phantom',     label: 'Phantom Drain',    icon: <Moon /> },
  { key: 'degradation', label: 'Degradation',      icon: <TrendingDown /> },
];

function BatteryPage() {
  return <AuthGuard><BatteryContent /></AuthGuard>;
}

export function BatteryContent() {
  const { defaultVehicleId } = useAuth();
  const [tab, setTab] = useState('soc');

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  const { data: socData,   isLoading: socLoading }   = useSocHistory(defaultVehicleId, from, to);
  const { data: rangeData, isLoading: rangeLoading } = useRangeHistory(defaultVehicleId, from, to);
  const { data: drainData, isLoading: drainLoading } = usePhantomDrain(defaultVehicleId, from, to);
  const { data: degradData,isLoading: degradLoading }= useDegradation(defaultVehicleId);

  const latestSoc   = socData?.[socData.length - 1]?.soc;
  const latestRange = rangeData?.[rangeData.length - 1]?.range_mi;
  const avgDrain    = drainData?.length
    ? drainData.reduce((sum, point) => sum + (point.drain_pct ?? 0), 0) / drainData.length
    : undefined;
  const latestCapacity = degradData?.[degradData.length - 1]?.capacity_pct;
  const hasVehicle = !!defaultVehicleId;

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
        {!hasVehicle ? (
          <NoVehicleState description="Connect your Rivian account to view battery health, range, and drain analytics." />
        ) : (
          <>
        <StatCardGrid>
          <StatCard
            label="Current SoC"
            value={latestSoc !== undefined ? `${Math.round(latestSoc)}%` : '—'}
            accent
            icon={<Battery className="h-4 w-4" />}
          />
          <StatCard label="Est. Range"       value={latestRange !== undefined ? `${Math.round(latestRange)} mi` : '—'} />
          <StatCard label="Phantom Drain"    value={avgDrain !== undefined ? `${avgDrain.toFixed(1)}%` : '—'} unit="/ hr avg" />
          <StatCard label="Capacity Health"  value={latestCapacity !== undefined ? `${latestCapacity.toFixed(1)}%` : '—'} />
        </StatCardGrid>

        <MetricTabs
          tabs={TABS}
          active={tab}
          onChange={setTab}
          title="Battery"
          subtitle={`${preset} history`}
        >
          {tab === 'soc' && (
            <SocAreaChart data={socData ?? []}
              loading={socLoading} height={240} showBrush />
          )}
          {tab === 'range' && (
            <RangeAreaChart data={rangeData ?? []}
              loading={rangeLoading} height={240} />
          )}
          {tab === 'phantom' && (
            <PhantomDrainChart data={drainData ?? []} loading={drainLoading} height={240} />
          )}
          {tab === 'degradation' && (
            <DegradationChart data={degradData ?? []} loading={degradLoading} height={240} />
          )}
        </MetricTabs>
          </>
        )}
      </PageLayout>
    </AppLayout>
  );
}
