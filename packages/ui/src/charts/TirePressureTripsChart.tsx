import * as React from 'react';
import type { TirePressureTimelineSample, TirePressureTimelineTrip } from '@riviamigo/types';
import { formatAppDateTime } from '../lib/dateTime';
import { formatDuration, formatMiles, formatNumber } from '../lib/utils';
import { CHART_COLORS } from './ChartProvider';
import { RichTimeSeriesChart, type PackedRichTimeInterval } from './RichTimeSeriesChart';

export interface TirePressureTripsChartProps {
  samples: TirePressureTimelineSample[];
  trips: TirePressureTimelineTrip[];
  targetPressure: number;
  pressureFactor?: number;
  pressureUnit?: string;
  height?: number;
  loading?: boolean;
  emptyTitle?: string;
  interactionMode?: 'standard' | 'touch-explore';
  onTripClick?: (tripId: string) => void;
}

const TIRE_SERIES = [
  { key: 'tire_fl_psi', label: 'Front left', color: CHART_COLORS.accent },
  { key: 'tire_fr_psi', label: 'Front right', color: CHART_COLORS.sky },
  { key: 'tire_rl_psi', label: 'Rear left', color: CHART_COLORS.emerald },
  { key: 'tire_rr_psi', label: 'Rear right', color: CHART_COLORS.amber },
] as const;

function tripLabel(trip: TirePressureTimelineTrip) {
  const start = trip.start_place || trip.start_address;
  const end = trip.end_place || trip.end_address;
  if (start && end) return `${start} → ${end}`;
  if (start) return `${start} → Trip`;
  if (end) return `Trip → ${end}`;
  return `Trip ${trip.id.slice(0, 8)}`;
}

function tripDetails(trip: TirePressureTimelineTrip) {
  const duration = trip.duration_min != null ? formatDuration(trip.duration_min) : null;
  const distance = trip.distance_miles != null ? formatMiles(trip.distance_miles) : null;
  const when = `${formatAppDateTime(trip.started_at)}–${formatAppDateTime(trip.ended_at)}`;
  return [when, duration, distance].filter(Boolean).join(' · ');
}

function convertedPressure(value: number | null, factor: number) {
  return value == null ? null : value * factor;
}

export function TirePressureTripsChart({
  samples,
  trips,
  targetPressure,
  pressureFactor = 1,
  pressureUnit = 'psi',
  height = 320,
  loading = false,
  emptyTitle = 'No tire pressure or trip data for this period',
  interactionMode = 'standard',
  onTripClick,
}: TirePressureTripsChartProps) {
  const points = React.useMemo(() => {
    const timestamps = new Set<string>();
    for (const sample of samples) timestamps.add(sample.ts);
    for (const trip of trips) {
      timestamps.add(trip.started_at);
      timestamps.add(trip.ended_at);
    }
    return [...timestamps].sort((a, b) => Date.parse(a) - Date.parse(b)).map((ts) => ({ ts }));
  }, [samples, trips]);

  const samplesByTimestamp = React.useMemo(
    () => new Map(samples.map((sample) => [sample.ts, sample])),
    [samples],
  );

  const intervals = React.useMemo(() => trips.map((trip) => ({
    id: trip.id,
    start: trip.started_at,
    end: trip.ended_at,
    label: tripLabel(trip),
    details: tripDetails(trip),
    color: CHART_COLORS.accent,
  })), [trips]);

  const series = TIRE_SERIES.map((tire) => ({
    key: tire.key,
    label: tire.label,
    color: tire.color,
    strokeWidth: 2.5,
    values: points.map((point) => convertedPressure(samplesByTimestamp.get(point.ts)?.[tire.key] ?? null, pressureFactor)),
    tooltipFormatter: (value: number | null | undefined) => value == null ? '—' : `${formatNumber(value, 0)} ${pressureUnit}`,
  }));

  return (
    <RichTimeSeriesChart
      points={points}
      series={series}
      height={height}
      loading={loading}
      emptyTitle={emptyTitle}
      yUnit={pressureUnit}
      yValueFormatter={(value, unit) => value == null ? '—' : `${formatNumber(value, 0)} ${unit ?? pressureUnit}`}
      yRange={undefined}
      mode="line"
      timeFilter="raw"
      smoothness="straight"
      connectGaps
      yRightUnit="Trips"
      intervalBandRatio={0.3}
      yRightAxisValueFormatter={(value) => value == null ? '' : `${Math.round(value)}`}
      intervals={intervals}
      referenceLines={[{ value: targetPressure * pressureFactor, label: 'Target', color: CHART_COLORS.muted }]}
      onIntervalClick={(interval: PackedRichTimeInterval) => onTripClick?.(interval.id)}
      interactionMode={interactionMode}
    />
  );
}
