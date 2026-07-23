import React from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import {
  useAuth, useResolvedVehicleSelection, useTripDetailData, useDocumentTheme,
} from '@riviamigo/hooks';
import {
  PageLayout,
} from '@riviamigo/ui/primitives';
import { SensorChipSummary } from '@riviamigo/dashboards';
import type { TripDetailSamples } from '@riviamigo/types';
import {
  TripMapChart,
  RichTimeSeriesChart,
  CHART_COLORS,
  SpeedHistogramChart as SpeedHistogram,
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
  getUnitPreferences,
} from '@riviamigo/ui/lib/utils';
import { resolveTripLocation, TRIP_LOCATION_UNAVAILABLE_COPY } from '@riviamigo/ui/lib/tripPresentation';
import { formatAppDateTime } from '@riviamigo/ui/lib/dateTime';
import { parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';

const TRIP_PRIMARY_CHART_HEIGHT = 360;

export const tripDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips/$tripId',
  component: TripDetailPage,
});

function TripDetailPage() {
  return <ProtectedRoute><TripDetailContent /></ProtectedRoute>;
}

export function TripDetailContent() {
  const { accessToken } = useAuth();
  const {
    authReady,
    effectiveVehicleId,
    vehicleSelectionReady,
  } = useResolvedVehicleSelection();
  const navigate = useNavigate();
  const { tripId } = useParams({ from: '/trips/$tripId' });
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const pendingActiveIndexRef = React.useRef<number | null>(null);
  const activeIndexFrameRef = React.useRef<number | null>(null);
  const isDark = useDocumentTheme();

  const setActiveIndexThrottled = React.useCallback((value: number | null) => {
    if (pendingActiveIndexRef.current === value) return;
    pendingActiveIndexRef.current = value;
    if (activeIndexFrameRef.current !== null) return;

    activeIndexFrameRef.current = requestAnimationFrame(() => {
      activeIndexFrameRef.current = null;
      setActiveIndex((previous) => previous === pendingActiveIndexRef.current
        ? previous
        : pendingActiveIndexRef.current);
    });
  }, []);

  React.useEffect(() => () => {
    if (activeIndexFrameRef.current !== null) {
      cancelAnimationFrame(activeIndexFrameRef.current);
      activeIndexFrameRef.current = null;
    }
  }, []);

  const { data: detailData, isLoading: detailLoading } = useTripDetailData(tripId, effectiveVehicleId);
  const trip = detailData?.trip;
  const samples = detailData?.samples;
  const hasVehicle = !!effectiveVehicleId;
  const chartLoading = detailLoading;
  const trackLoading = detailLoading;
  const mapStyle = isDark ? 'dark' : 'light';

  const title = trip
    ? formatAppDateTime(trip.started_at, { month: 'long', day: 'numeric', year: 'numeric' })
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
    () => buildTimeline(trip?.started_at, samples),
    [trip?.started_at, samples],
  );

  const mapTrack = React.useMemo(
    () => (samples?.lat ?? []).flatMap((lat, index) => {
      const lng = samples?.lng[index] ?? null;
      return lat != null && lng != null ? [{ lat, lng }] : [];
    }),
    [samples],
  );

  const speedBins = React.useMemo(
    () => buildSpeedHistogram(timeline, detailData?.sample_interval_seconds ?? 10),
    [detailData?.sample_interval_seconds, timeline],
  );
  const chartPoints = React.useMemo(
    () => timeline.map((point) => ({ ts: point.elapsed_s })),
    [timeline],
  );
  const unitPreferences = getUnitPreferences();
  const temperatureFactor = unitPreferences.temperature_unit === 'fahrenheit' ? 9 / 5 : 1;
  const temperatureOffset = unitPreferences.temperature_unit === 'fahrenheit' ? 32 : 0;
  const pressureFactor = unitPreferences.pressure_unit === 'kpa' ? 6.89476 : 1;
  const temperatureUnitLabel = unitPreferences.temperature_unit === 'fahrenheit' ? '°F' : '°C';
  const pressureUnitLabel = unitPreferences.pressure_unit === 'kpa' ? 'kPa' : 'psi';
  const outsideTemperatureLabel = detailData?.outside_temperature?.source === 'open_meteo'
    ? 'Outside (estimated)'
    : detailData?.outside_temperature?.source === 'mixed'
      ? 'Outside (mixed)'
      : 'Outside';
  const drivePowerSource = detailData?.power?.source
    ?? (timeline.some((point) => point.power_kw != null || point.regen_kw != null) ? 'direct' : 'unavailable');
  const drivePowerIsEstimated = drivePowerSource === 'estimated_soc';
  const chartSeries = React.useMemo(() => ({
    drive: [
      ...(drivePowerIsEstimated
        ? [{ key: 'estimated_net_power', label: 'Estimated net power', color: CHART_COLORS.accent, values: timeline.map((point) => point.estimated_net_power_kw) }]
        : [
          { key: 'power', label: 'Power', color: CHART_COLORS.accent, values: timeline.map((point) => point.power_kw) },
          { key: 'regen', label: 'Regen', color: CHART_COLORS.success, values: timeline.map((point) => point.regen_kw) },
        ]),
      { key: 'speed', label: 'Speed', color: CHART_COLORS.sky, yScale: 'y2' as const, values: timeline.map((point) => point.speed_mph) },
    ],
    temperature: [
      { key: 'outside', label: outsideTemperatureLabel, color: CHART_COLORS.sky, values: timeline.map((point) => point.outside_temp_c == null ? null : point.outside_temp_c * temperatureFactor + temperatureOffset) },
      { key: 'cabin', label: 'Cabin', color: CHART_COLORS.emerald, values: timeline.map((point) => point.cabin_temp_c == null ? null : point.cabin_temp_c * temperatureFactor + temperatureOffset) },
      { key: 'driver', label: 'Driver setpoint', color: CHART_COLORS.warning, values: timeline.map((point) => point.driver_temp_c == null ? null : point.driver_temp_c * temperatureFactor + temperatureOffset) },
    ],
    elevation: [
      { key: 'elevation', label: 'Elevation', color: CHART_COLORS.teal, values: timeline.map((point) => point.altitude_m == null ? null : point.altitude_m * 3.28084) },
    ],
    tires: [
      { key: 'tire_fl', label: 'Front Left', color: CHART_COLORS.accent, values: timeline.map((point) => point.tire_fl_psi == null ? null : point.tire_fl_psi * pressureFactor) },
      { key: 'tire_fr', label: 'Front Right', color: CHART_COLORS.sky, values: timeline.map((point) => point.tire_fr_psi == null ? null : point.tire_fr_psi * pressureFactor) },
      { key: 'tire_rl', label: 'Rear Left', color: CHART_COLORS.success, values: timeline.map((point) => point.tire_rl_psi == null ? null : point.tire_rl_psi * pressureFactor) },
      { key: 'tire_rr', label: 'Rear Right', color: CHART_COLORS.warning, values: timeline.map((point) => point.tire_rr_psi == null ? null : point.tire_rr_psi * pressureFactor) },
    ],
  }), [drivePowerIsEstimated, outsideTemperatureLabel, pressureFactor, temperatureFactor, temperatureOffset, timeline]);

  const metricCoverage = React.useMemo(() => {
    let powerSamples = 0;
    let tempSamples = 0;
    let tireSamples = 0;

    for (const point of timeline) {
      if (drivePowerIsEstimated
        ? point.estimated_net_power_kw != null
        : point.power_kw != null || point.regen_kw != null) powerSamples += 1;
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
  }, [drivePowerIsEstimated, timeline]);

  const activeTimelinePoint = React.useMemo(
    () => (activeIndex == null ? null : timeline[activeIndex] ?? null),
    [timeline, activeIndex],
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
        {!authReady || !vehicleSelectionReady ? (
          <div className="p-4 text-xs text-fg-tertiary">Loading...</div>
        ) : !hasVehicle ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account before opening trip details."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SensorChipSummary title="Distance Driven" value={trip ? formatMiles(trip.distance_mi) : '—'} icon="lucide:map-pin" />
              <SensorChipSummary
                title={`Avg. Effic. (${getEfficiencyUnitLabel()})`}
                value={trip?.efficiency_wh_mi != null ? formatEfficiencyValue(trip.efficiency_wh_mi) : '—'}
                icon="lucide:gauge"
              />
              <SensorChipSummary title="Avg. Speed" value={avgSpeed != null ? formatMph(avgSpeed) : '—'} icon="lucide:car" />
              <SensorChipSummary title="Duration" value={durationMin !== undefined ? formatDuration(durationMin) : '—'} icon="lucide:clock-3" />
            </div>

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
                      track={mapTrack}
                      activePoint={activeMapPoint}
                      height={TRIP_PRIMARY_CHART_HEIGHT}
                      mapStyle={mapStyle}
                      accessToken={accessToken}
                    />
                  )}
                </div>

                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Drive Chart</h3>
                    <p className="text-xs text-fg-tertiary">
                      {drivePowerIsEstimated
                        ? `${detailData?.power?.sample_count ?? metricCoverage.powerSamples} estimated intervals${detailData?.power?.median_interval_seconds != null ? ` · median ${Math.round(detailData.power.median_interval_seconds)}s` : ''}`
                        : metricCoverage.powerSamples > 0
                        ? `${metricCoverage.powerSamples} power samples`
                        : 'No power samples in trip telemetry'}
                    </p>
                  </div>
                  <RichTimeSeriesChart
                    points={chartPoints}
                    series={chartSeries.drive}
                    loading={chartLoading}
                    height={TRIP_PRIMARY_CHART_HEIGHT}
                    xTime={false}
                    xUnit="s"
                    xValueFormatter={(value) => formatElapsed(value)}
                    yUnit="kW"
                    yRightUnit="mph"
                    yValueFormatter={(value, unit) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ${unit ?? ''}`}
                    cursorSyncKey={`trip-${tripId}`}
                    onCursorIndexChange={setActiveIndexThrottled}
                    connectGaps={!drivePowerIsEstimated}
                    emptyTitle="No drive profile data for this trip."
                  />
                  {drivePowerIsEstimated ? (
                    <p className="mt-2 text-xs leading-5 text-fg-tertiary">
                      Averaged between state-of-charge updates. Negative values indicate net regeneration; short acceleration and braking peaks are not available from Rivian.
                    </p>
                  ) : null}
                </div>

              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Speed Histogram</h3>
                    <p className="text-xs text-fg-tertiary">Approximate time across speed bands</p>
                  </div>
                  <SpeedHistogram
                    bins={speedBins}
                    loading={chartLoading}
                    activeBinLabel={activeSpeedBinLabel}
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
                  <RichTimeSeriesChart
                    points={chartPoints}
                    series={chartSeries.temperature}
                    loading={chartLoading}
                    height={280}
                    xTime={false}
                    xUnit="s"
                    xValueFormatter={(value) => formatElapsed(value)}
                    yUnit={temperatureUnitLabel}
                    yValueFormatter={(value, unit) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ${unit ?? ''}`}
                    cursorSyncKey={`trip-${tripId}`}
                    onCursorIndexChange={setActiveIndexThrottled}
                    connectGaps
                    emptyTitle="No temperature data for this trip."
                  />
                  {detailData?.outside_temperature?.attribution && (
                    <p className="mt-2 text-xs text-fg-tertiary">
                      Estimated exterior temperature: {' '}
                      <a
                        className="text-accent hover:underline"
                        href={detailData.outside_temperature.attribution.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {detailData.outside_temperature.attribution.name}
                      </a>
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-border bg-bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg">Elevation Profile</h3>
                    <p className="text-xs text-fg-tertiary">TeslaMate-style terrain profile across the drive</p>
                  </div>
                  <RichTimeSeriesChart
                    points={chartPoints}
                    series={chartSeries.elevation}
                    loading={chartLoading}
                    height={240}
                    xTime={false}
                    xUnit="s"
                    xValueFormatter={(value) => formatElapsed(value)}
                    yUnit="ft"
                    yValueFormatter={(value, unit) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ${unit ?? ''}`}
                    cursorSyncKey={`trip-${tripId}`}
                    onCursorIndexChange={setActiveIndexThrottled}
                    connectGaps
                    emptyTitle="No elevation profile data for this trip."
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
                  <RichTimeSeriesChart
                    points={chartPoints}
                    series={chartSeries.tires}
                    loading={chartLoading}
                    height={240}
                    xTime={false}
                    xUnit="s"
                    xValueFormatter={(value) => formatElapsed(value)}
                    yUnit={pressureUnitLabel}
                    yValueFormatter={(value, unit) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ${unit ?? ''}`}
                    cursorSyncKey={`trip-${tripId}`}
                    onCursorIndexChange={setActiveIndexThrottled}
                    connectGaps
                    emptyTitle="No tire pressure data for this trip."
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
  estimated_net_power_kw: number | null;
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
  duration_seconds: number;
  sample_elapsed_s: number | null;
}

function formatElapsed(seconds: number) {
  const min = Math.floor(seconds / 60);
  const sec = Math.max(0, Math.floor(seconds % 60));
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function buildTimeline(
  tripStartIso: string | undefined,
  samples: TripDetailSamples | undefined,
): TimelinePoint[] {
  if (!tripStartIso || !samples) return [];
  const tripStartMs = parseISO(tripStartIso).getTime();
  if (!Number.isFinite(tripStartMs)) return [];
  return samples.elapsed_s.map((elapsed, index) => ({
    elapsed_s: elapsed,
    ts: new Date(tripStartMs + elapsed * 1000).toISOString(),
    speed_mph: samples.speed_mph[index] ?? null,
    power_kw: samples.power_kw[index] ?? null,
    regen_kw: samples.regen_power_kw[index] != null ? -Math.abs(samples.regen_power_kw[index]!) : null,
    estimated_net_power_kw: samples.estimated_net_power_kw?.[index] ?? null,
    battery_level: samples.battery_level[index] ?? null,
    outside_temp_c: samples.outside_temp_c[index] ?? null,
    cabin_temp_c: samples.cabin_temp_c[index] ?? null,
    driver_temp_c: samples.driver_temp_c[index] ?? null,
    hvac_active: samples.hvac_active[index] ?? null,
    tire_fl_psi: samples.tire_fl_psi[index] ?? null,
    tire_fr_psi: samples.tire_fr_psi[index] ?? null,
    tire_rl_psi: samples.tire_rl_psi[index] ?? null,
    tire_rr_psi: samples.tire_rr_psi[index] ?? null,
    altitude_m: samples.altitude_m[index] ?? null,
    lat: samples.lat[index] ?? null,
    lng: samples.lng[index] ?? null,
  }));
}

function buildSpeedHistogram(timeline: TimelinePoint[], sampleIntervalSeconds = 10, binSize = 5): HistogramBin[] {
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
      duration_seconds: 0,
      sample_elapsed_s: null,
    });
  }

  for (const row of speedRows) {
    const speedMph = row.speed_mph ?? 0;
    const index = Math.min(bins.length - 1, Math.floor(speedMph / binSize));
    const bin = bins[index];
    if (!bin) continue;
    bin.count += 1;
    bin.duration_seconds += sampleIntervalSeconds;
    if (bin.sample_elapsed_s == null) {
      bin.sample_elapsed_s = row.elapsed_s;
    }
  }

  return bins;
}


