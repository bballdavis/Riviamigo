import React, { useState } from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import {
  useAuth, useTrip, useTripTrack, useSpeedProfile, useElevationProfile,
} from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard, MetricTabs, Button,
} from '@riviamigo/ui/primitives';
import {
  TripMapChart, SpeedProfileChart, ElevationProfileChart,
} from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { formatMiles, formatDuration, formatKwh } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Map, Gauge, Mountain } from 'lucide-react';

export const tripDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips/$tripId',
  component: TripDetailPage,
});

const TABS = [
  { key: 'map',       label: 'Route Map',      icon: <Map /> },
  { key: 'speed',     label: 'Speed',          icon: <Gauge /> },
  { key: 'elevation', label: 'Elevation',      icon: <Mountain /> },
];

function TripDetailPage() {
  return <AuthGuard><TripDetailContent /></AuthGuard>;
}

function TripDetailContent() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();
  const { tripId } = useParams({ from: '/trips/$tripId' });
  const [tab, setTab] = useState('map');

  const { data: trip  } = useTrip(tripId, defaultVehicleId);
  const { data: track, isLoading: trackLoading } = useTripTrack(tripId, defaultVehicleId);
  const { data: speed, isLoading: speedLoading } = useSpeedProfile(tripId, defaultVehicleId);
  const { data: elev,  isLoading: elevLoading  } = useElevationProfile(tripId, defaultVehicleId);

  const title = trip
    ? format(parseISO(trip.started_at), 'MMMM d, yyyy · h:mm a')
    : 'Trip Detail';

  const durationSec = (trip as unknown as { duration_seconds?: number })?.duration_seconds;
  const durationMin = durationSec !== undefined ? Math.round(durationSec / 60) : undefined;

  return (
    <AppLayout activeKey="trips">
      <PageLayout
        title={title}
        actions={
          <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate({ to: '/trips' })}>
            Back
          </Button>
        }
      >
        <StatCardGrid>
          <StatCard label="Distance"    value={trip ? formatMiles(trip.distance_mi) : '—'} accent />
          <StatCard label="Duration"    value={durationMin !== undefined ? formatDuration(durationMin) : '—'} />
          <StatCard label="Energy Used" value={trip ? formatKwh(trip.energy_used_kwh ?? 0) : '—'} />
          <StatCard label="Efficiency"  value={trip?.efficiency_wh_mi ? `${trip.efficiency_wh_mi.toFixed(0)}` : '—'} unit="Wh/mi" />
        </StatCardGrid>

        <MetricTabs tabs={TABS} active={tab} onChange={setTab} title="Trip Analysis">
          {tab === 'map' && (
            <TripMapChart
              track={(track ?? []).map((p) => ({ lat: p.lat, lng: p.lng }))}
              loading={trackLoading}
              height={360}
            />
          )}
          {tab === 'speed' && (
            <SpeedProfileChart data={speed ?? []} loading={speedLoading} height={280} />
          )}
          {tab === 'elevation' && (
            <ElevationProfileChart data={elev ?? []} loading={elevLoading} height={280} />
          )}
        </MetricTabs>
      </PageLayout>
    </AppLayout>
  );
}
