import * as React from 'react';
import type { PhantomDrainPeriod } from '@riviamigo/types';
import { CHART_COLORS, RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { formatPercent } from '@riviamigo/ui/lib/utils';

const SESSION_COLORS = [
  CHART_COLORS.accent,
  CHART_COLORS.emerald,
  CHART_COLORS.sky,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.teal,
  CHART_COLORS.amber,
  CHART_COLORS.indigo,
] as const;

interface PhantomDrainDailySession {
  socLost: number;
  parkedHours: number;
  drainRate: number;
  startedAt: string;
}

export interface PhantomDrainDailyPoint {
  ts: string;
  drainRate: number;
  socLost: number;
  parkedHours: number;
  periodCount: number;
  sessions: PhantomDrainDailySession[];
}

export interface PhantomDrainChartProps {
  periods: PhantomDrainPeriod[];
  loading?: boolean;
  height?: number;
  yUnit?: string | undefined;
  emptyTitle?: string | undefined;
  yRange?: [number, number] | undefined;
  interactionMode?: 'standard' | 'touch-explore' | undefined;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function buildPhantomDrainDailySeries(periods: PhantomDrainPeriod[]): PhantomDrainDailyPoint[] {
  const byDay = new Map<string, PhantomDrainDailyPoint>();

  for (const period of periods) {
    if (period.validation_status !== 'validated') continue;
    const start = period.period_start ? new Date(period.period_start) : null;
    const end = period.period_end ? new Date(period.period_end) : null;
    const socLost = period.soc_lost_pct;
    if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || !isFiniteNumber(socLost) || end <= start) {
      continue;
    }

    const totalMilliseconds = end.getTime() - start.getTime();
    let cursor = new Date(start);
    while (cursor < end) {
      const nextDay = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      const segmentEnd = nextDay < end ? nextDay : end;
      const segmentMilliseconds = segmentEnd.getTime() - cursor.getTime();
      if (segmentMilliseconds <= 0) break;

      const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      const key = dayStart.toISOString();
      const segmentHours = segmentMilliseconds / (60 * 60 * 1000);
      const segmentLoss = socLost * (segmentMilliseconds / totalMilliseconds);
      const current = byDay.get(key) ?? {
        ts: key,
        drainRate: 0,
        socLost: 0,
        parkedHours: 0,
        periodCount: 0,
        sessions: [],
      };

      current.socLost += segmentLoss;
      current.parkedHours += segmentHours;
      current.periodCount += 1;
      current.sessions.push({
        socLost: segmentLoss,
        parkedHours: segmentHours,
        drainRate: segmentHours > 0 ? segmentLoss / segmentHours : 0,
        startedAt: period.period_start ?? cursor.toISOString(),
      });
      byDay.set(key, current);
      cursor = segmentEnd;
    }
  }

  return [...byDay.values()]
    .map((point) => ({
      ...point,
      drainRate: point.parkedHours > 0 ? point.socLost / point.parkedHours : 0,
    }))
    .filter((point) => Number.isFinite(point.drainRate))
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((point) => ({
      ...point,
      sessions: point.sessions.sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    }));
}

function withDailyHeadroom(maximum: number) {
  if (!Number.isFinite(maximum) || maximum <= 0) return 1;
  const padded = maximum * 1.25;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / magnitude) * magnitude;
}

function formatSessionDetail(session: { startedAt: string; parkedHours: number; drainRate: number }) {
  const startedAt = new Date(session.startedAt);
  const started = Number.isFinite(startedAt.getTime())
    ? startedAt.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Unknown start';
  return `${started} · ${session.parkedHours.toFixed(1)} h · ${formatPercent(session.drainRate, 2)} / h`;
}

export function PhantomDrainChart({
  periods,
  loading = false,
  height = 280,
  yUnit = '% SoC lost',
  emptyTitle = 'No phantom drain data for this period',
  yRange,
  interactionMode = 'standard',
}: PhantomDrainChartProps) {
  const data = React.useMemo(() => buildPhantomDrainDailySeries(periods), [periods]);
  const dailyYRange = React.useMemo<[number, number] | undefined>(() => {
    if (yRange) return yRange;
    const maximum = Math.max(0, ...data.map((point) => point.socLost));
    return maximum > 0 ? [0, withDailyHeadroom(maximum)] : undefined;
  }, [data, yRange]);
  const sessionCount = React.useMemo(() => Math.max(0, ...data.map((point) => point.sessions.length)), [data]);
  const sessionSeries = Array.from({ length: sessionCount }, (_, sessionIndex) => ({
    key: `phantom-drain-session-${sessionIndex}`,
    label: `Drain session ${sessionIndex + 1}`,
    color: SESSION_COLORS[sessionIndex % SESSION_COLORS.length]!,
    values: data.map((point) => point.sessions[sessionIndex]?.socLost ?? null),
    mode: 'bar' as const,
    stackId: 'phantom-drain-day',
    showInLegend: false,
    tooltipFormatter: (value: number | null | undefined) => value == null ? '-' : formatPercent(value, 2),
  }));
  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={[
        ...sessionSeries,
        {
          key: 'phantom-drain-rate',
          label: 'Daily average rate',
          values: data.map((point) => point.drainRate),
          tooltipOnly: true,
          tooltipFormatter: (value) => value == null ? '-' : `${formatPercent(value, 2)} / h`,
        },
        {
          key: 'phantom-drain-hours',
          label: 'Parked',
          values: data.map((point) => point.parkedHours),
          tooltipOnly: true,
          tooltipFormatter: (value) => value == null ? '-' : `${value.toFixed(1)} h`,
        },
        {
          key: 'phantom-drain-periods',
          label: 'Drain sessions',
          values: data.map((point) => point.periodCount),
          tooltipOnly: true,
          tooltipFormatter: (value) => value == null ? '-' : String(Math.round(value)),
        },
      ]}
      loading={loading}
      emptyTitle={emptyTitle}
      height={height}
      yUnit={yUnit}
      {...(dailyYRange ? { yRange: dailyYRange } : {})}
      mode="bar"
      interactionMode={interactionMode}
    />
  );
}
