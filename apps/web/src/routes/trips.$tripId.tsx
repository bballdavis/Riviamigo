import React from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import {
  useAuth, useTrip, useTripTrack, useTripDetailSeries,
} from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard,
} from '@riviamigo/ui/primitives';
import {
  TripMapChart,
  TripDriveChart as DriveChart,
  SpeedHistogramChart as SpeedHistogram,
  TripTemperatureChart as TemperatureChart,
  TripElevationChart as ElevationChart,
  TripTirePressureChart as TirePressureChart,
} from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import {
  formatMiles,
  formatDuration,
  formatEfficiencyValue,
  formatMph,
  getEfficiencyUnitLabel,
} from '@riviamigo/ui/lib/utils';
import { resolveTripLocation, TRIP_LOCATION_UNAVAILABLE_COPY } from '@riviamigo/ui/lib/tripPresentation';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';

export const tripDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips/$tripId',
  component: TripDetailPage,
});

function TripDetailPage() {
  return <ProtectedRoute><TripDetailContent /></ProtectedRoute>;
}

export function TripDetailContent() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();
  const { tripId } = useParams({ from: '/trips/$tripId' });
  const [activeElapsedS, setActiveElapsedS] = React.useState<number | null>(null);

  const { data: trip } = useTrip(tripId, defaultVehicleId);
  const { data: track, isLoading: trackLoading } = useTripTrack(tripId, defaultVehicleId);
  const { data: series, isLoading: seriesLoading } = useTripDetailSeries(tripId, defaultVehicleId);
  const hasVehicle = !!defaultVehicleId;

  const title = trip
    ? format(parseISO(trip.started_at), 'MMMM d, yyyy · h:mm a')
    : 'Trip Detail';

  const subtitle = React.useMemo(() => {
    if (!trip) return undefined;
    const tripRecord = trip as unknown as Record<string, unknown>;
    const start = resolveTripLocation(tripRecord, 'start');
    const end = resolveTripLocation(tripRecord, 'end');
    if (start.source === 'unavailable' && end.source === 'unavailable') {
      return TRIP_LOCATION_UNAVAILABLE_COPY;
    }
    return `${start.label} -> ${end.label}`;
  }, [trip]);

  const durationSec = (trip as unknown as { duration_seconds?: number })?.duration_seconds;
  const durationMin = (trip as unknown as { duration_min?: number })?.duration_min
    ?? (durationSec !== undefined ? Math.round(durationSec / 60) : undefined);

  const avgSpeed = React.useMemo(() => {
    if (!trip || !durationMin || durationMin <= 0) return null;
    return (trip.distance_mi / durationMin) * 60;
  }, [trip, durationMin]);

  const timeline = React.useMemo(
    () => buildTimeline(trip?.started_at, series ?? [], track ?? []),
    [trip?.started_at, series, track],
  );

  const speedBins = React.useMemo(() => buildSpeedHistogram(timeline), [timeline]);

  const metricCoverage = React.useMemo(() => {
    let powerSamples = 0;
    let tempSamples = 0;
    let tireSamples = 0;

    for (const point of timeline) {
      if (point.power_kw != null || point.regen_kw != null) powerSamples += 1;
      if (point.outside_temp_c != null || point.cabin_temp_c != null || point.driver_temp_c != null) tempSamples += 1;
      if (point.tire_fl_psi != null || point.tire_fr_psi != null || point.tire_rl_psi != null || point.tire_rr_psi != null) {
        tireSamples += 1;
      }
    }

    return {
      powerSamples,
      tempSamples,
      tireSamples,
      totalTimelineSamples: timeline.length,
    };
  }, [timeline]);

  const activeTimelinePoint = React.useMemo(
    () => getNearestTimelinePoint(timeline, activeElapsedS),
    [timeline, activeElapsedS],
  );

  const activeMapPoint = React.useMemo(
    () => (activeTimelinePoint?.lat != null && activeTimelinePoint?.lng != null
      ? { lat: activeTimelinePoint.lat, lng: activeTimelinePoint.lng }
      : null),
    [activeTimelinePoint],
  );

  const activeSpeedBinLabel = React.useMemo(() => {
    if (activeTimelinePoint?.speed_mph == null) return null;
    const found = speedBins.find((bin) => activeTimelinePoint.speed_mph! >= bin.min && activeTimelinePoint.speed_mph! < bin.max);
    return found?.label ?? null;
  }, [activeTimelinePoint, speedBins]);

  const backButton = (
    <button
      type="button"
      aria-label="Back to trips"
      className="inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-lg border border-accent bg-bg-surface text-accent transition-colors hover:bg-accent/10 focus:outline-none focus:ring-1 focus:ring-accent"
      onClick={() => navigate({ to: '/trips' })}
    >
      <ArrowLeft className="h-6 w-6" />
    </button>
  );

  return (
    <AppLayout activeKey="trips">
      <PageLayout
        title={title}
        subtitle={trip ? subtitle : undefined}
        titleAction={backButton}
        titleActionPosition="left"
      >
        {!hasVehicle ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account before opening trip details."
          />
        ) : (
          <>
            <StatCardGrid>
              <StatCard label="Distance Driven" value={trip ? formatMiles(trip.distance_mi) : '—'} accent />
              <StatCard
                label={`Avg. Effic. (${getEfficiencyUnitLabel()})`}
                value={trip?.efficiency_wh_mi != null ? formatEfficiencyValue(trip.efficiency_wh_mi) : '—'}
              />
              <StatCard label="Avg. Speed" value={avgSpeed != null ? formatMph(avgSpeed) : '—'} />
              <StatCard label="Duration" value={durationMin !== undefined ? formatDuration(durationMin) : '—'} />
            </StatCardGrid>

            <section className="space-y-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Route Map</h3>
                    {activeTimelinePoint ? (
                      <p className="text-xs text-fg-tertiary">{formatElapsed(activeTimelinePoint.elapsed_s)}</p>
                    ) : null}
                  </div>
                  {trackLoading ? (
                    <div className="flex h-[360px] items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary">
                      Loading route map...
                    </div>
                  ) : (
                    <TripMapChart
                      track={(track ?? []).map((p) => ({ lat: p.lat, lng: p.lng }))}
                      activePoint={activeMapPoint}
                      height={360}
                    />
                  )}
                </div>

                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Drive Chart</h3>
                    <p className="text-xs text-fg-tertiary">
                      {metricCoverage.powerSamples > 0
                        ? `${metricCoverage.powerSamples} power samples`
                        : 'No power samples in trip telemetry'}
                    </p>
                  </div>
                  <DriveChart
                    data={timeline}
                    loading={seriesLoading}
                    activeElapsedS={activeElapsedS}
                    onActiveElapsedSChange={setActiveElapsedS}
                  />
                </div>

              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Speed Histogram</h3>
                    <p className="text-xs text-fg-tertiary">Distribution across speed bands</p>
                  </div>
                  <SpeedHistogram
                    bins={speedBins}
                    loading={seriesLoading}
                    activeBinLabel={activeSpeedBinLabel}
                    onActiveElapsedSChange={setActiveElapsedS}
                  />
                </div>

                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Temperature</h3>
                    <p className="text-xs text-fg-tertiary">
                      {metricCoverage.tempSamples > 0
                        ? `${metricCoverage.tempSamples} temperature samples`
                        : 'No temperature samples in trip telemetry'}
                    </p>
                  </div>
                  <TemperatureChart
                    data={timeline}
                    loading={seriesLoading}
                    activeElapsedS={activeElapsedS}
                    onActiveElapsedSChange={setActiveElapsedS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Elevation Profile</h3>
                    <p className="text-xs text-fg-tertiary">TeslaMate-style terrain profile across the drive</p>
                  </div>
                  <ElevationChart
                    data={timeline}
                    loading={trackLoading}
                    activeElapsedS={activeElapsedS}
                    onActiveElapsedSChange={setActiveElapsedS}
                  />
                </div>

                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Tire Pressure</h3>
                    <p className="text-xs text-fg-tertiary">
                      {metricCoverage.tireSamples > 0
                        ? `${metricCoverage.tireSamples} tire pressure samples`
                        : 'No tire pressure samples in trip telemetry'}
                    </p>
                  </div>
                  <TirePressureChart
                    data={timeline}
                    loading={seriesLoading}
                    activeElapsedS={activeElapsedS}
                    onActiveElapsedSChange={setActiveElapsedS}
                  />
                </div>
              </div>
            </section>
          </>
        )}
      </PageLayout>
    </AppLayout>
  );
}

interface TimelinePoint {
  elapsed_s: number;
  ts: string;
  speed_mph: number | null;
  power_kw: number | null;
  regen_kw: number | null;
  battery_level: number | null;
  outside_temp_c: number | null;
  cabin_temp_c: number | null;
  driver_temp_c: number | null;
  hvac_active: boolean | null;
  tire_fl_psi: number | null;
  tire_fr_psi: number | null;
  tire_rl_psi: number | null;
  tire_rr_psi: number | null;
  altitude_m: number | null;
  lat: number | null;
  lng: number | null;
}

interface HistogramBin {
  label: string;
  min: number;
  max: number;
  count: number;
  sample_elapsed_s: number | null;
}

function formatElapsed(seconds: number) {
  const min = Math.floor(seconds / 60);
  const sec = Math.max(0, Math.floor(seconds % 60));
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function buildTimeline(
  tripStartIso: string | undefined,
  series: Array<{
    ts: string;
    speed_mph: number | null;
    power_kw: number | null;
    regen_power_kw: number | null;
    battery_level: number | null;
    outside_temp_c: number | null;
    cabin_temp_c: number | null;
    driver_temp_c: number | null;
    hvac_active: boolean | null;
    tire_fl_psi: number | null;
    tire_fr_psi: number | null;
    tire_rl_psi: number | null;
    tire_rr_psi: number | null;
  }>,
  track: Array<{ ts: string; lat: number; lng: number; altitude_m: number | null }>,
): TimelinePoint[] {
  if (!tripStartIso) return [];
  const tripStartMs = parseISO(tripStartIso).getTime();
  if (!Number.isFinite(tripStartMs)) return [];

  const seriesByElapsed = new Map<number, {
    speed_mph: number | null;
    power_kw: number | null;
    regen_kw: number | null;
    battery_level: number | null;
    outside_temp_c: number | null;
    cabin_temp_c: number | null;
    driver_temp_c: number | null;
    hvac_active: boolean | null;
    tire_fl_psi: number | null;
    tire_fr_psi: number | null;
    tire_rl_psi: number | null;
    tire_rr_psi: number | null;
  }>();
  for (const point of series) {
    const tsMs = parseISO(point.ts).getTime();
    if (!Number.isFinite(tsMs)) continue;
    const elapsed = Math.round((tsMs - tripStartMs) / 1000);
    seriesByElapsed.set(elapsed, {
      speed_mph: point.speed_mph,
      power_kw: point.power_kw,
      regen_kw: point.regen_power_kw != null ? -Math.abs(point.regen_power_kw) : null,
      battery_level: point.battery_level,
      outside_temp_c: point.outside_temp_c,
      cabin_temp_c: point.cabin_temp_c,
      driver_temp_c: point.driver_temp_c,
      hvac_active: point.hvac_active,
      tire_fl_psi: point.tire_fl_psi,
      tire_fr_psi: point.tire_fr_psi,
      tire_rl_psi: point.tire_rl_psi,
      tire_rr_psi: point.tire_rr_psi,
    });
  }

  const trackRows = track
    .map((point) => ({
      tsMs: typeof point.ts === 'string' ? parseISO(point.ts).getTime() : Number.NaN,
      lat: point.lat,
      lng: point.lng,
      altitude_m: point.altitude_m,
    }))
    .filter((point) => Number.isFinite(point.tsMs))
    .sort((a, b) => a.tsMs - b.tsMs);

  const elapsedKeys = new Set<number>();
  for (const key of seriesByElapsed.keys()) elapsedKeys.add(key);

  return [...elapsedKeys]
    .filter((elapsed) => elapsed >= 0)
    .sort((a, b) => a - b)
    .map((elapsed) => {
      const targetTs = tripStartMs + elapsed * 1000;
      const trackPoint = findNearestTrackPoint(trackRows, targetTs);
      const seriesPoint = seriesByElapsed.get(elapsed);
      return {
        elapsed_s: elapsed,
        ts: new Date(targetTs).toISOString(),
        speed_mph: seriesPoint?.speed_mph ?? null,
        power_kw: seriesPoint?.power_kw ?? null,
        regen_kw: seriesPoint?.regen_kw ?? null,
        battery_level: seriesPoint?.battery_level ?? null,
        outside_temp_c: seriesPoint?.outside_temp_c ?? null,
        cabin_temp_c: seriesPoint?.cabin_temp_c ?? null,
        driver_temp_c: seriesPoint?.driver_temp_c ?? null,
        hvac_active: seriesPoint?.hvac_active ?? null,
        tire_fl_psi: seriesPoint?.tire_fl_psi ?? null,
        tire_fr_psi: seriesPoint?.tire_fr_psi ?? null,
        tire_rl_psi: seriesPoint?.tire_rl_psi ?? null,
        tire_rr_psi: seriesPoint?.tire_rr_psi ?? null,
        altitude_m: trackPoint?.altitude_m ?? null,
        lat: trackPoint?.lat ?? null,
        lng: trackPoint?.lng ?? null,
      };
    });
}

function findNearestTrackPoint(
  rows: Array<{ tsMs: number; lat: number; lng: number; altitude_m: number | null }>,
  targetTsMs: number,
) {
  if (rows.length === 0) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midRow = rows[mid];
    if (!midRow) break;
    if (midRow.tsMs < targetTsMs) lo = mid + 1;
    else hi = mid;
  }
  const right = rows[lo] ?? rows[rows.length - 1];
  const left = rows[Math.max(0, lo - 1)] ?? right;
  if (!right || !left) return null;
  return Math.abs(right.tsMs - targetTsMs) < Math.abs(left.tsMs - targetTsMs) ? right : left;
}

function buildSpeedHistogram(timeline: TimelinePoint[], binSize = 5): HistogramBin[] {
  const speedRows = timeline.filter((point) => point.speed_mph != null && point.speed_mph >= 0);
  if (speedRows.length === 0) return [];

  const maxSpeed = Math.max(...speedRows.map((point) => point.speed_mph ?? 0));
  const maxEdge = Math.ceil(maxSpeed / binSize) * binSize + binSize;
  const bins: HistogramBin[] = [];

  for (let min = 0; min < maxEdge; min += binSize) {
    bins.push({
      label: `${min}-${min + binSize}`,
      min,
      max: min + binSize,
      count: 0,
      sample_elapsed_s: null,
    });
  }

  for (const row of speedRows) {
    const speedMph = row.speed_mph ?? 0;
    const index = Math.min(bins.length - 1, Math.floor(speedMph / binSize));
    const bin = bins[index];
    if (!bin) continue;
    bin.count += 1;
    if (bin.sample_elapsed_s == null) {
      bin.sample_elapsed_s = row.elapsed_s;
    }
  }

  return bins;
}

function getNearestTimelinePoint(timeline: TimelinePoint[], elapsedS: number | null) {
  if (elapsedS == null || timeline.length === 0) return null;
  let nearest: TimelinePoint | null = null;
  let minDelta = Number.POSITIVE_INFINITY;
  for (const point of timeline) {
    const delta = Math.abs(point.elapsed_s - elapsedS);
    if (delta < minDelta) {
      minDelta = delta;
      nearest = point;
    }
  }
  return nearest;
}

