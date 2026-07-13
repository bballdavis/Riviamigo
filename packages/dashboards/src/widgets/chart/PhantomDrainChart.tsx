import * as React from 'react';
import type { PhantomDrainPeriod } from '@riviamigo/types';
import { RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { formatPercent } from '@riviamigo/ui/lib/utils';

export interface PhantomDrainDailyPoint {
  ts: string;
  drainRate: number;
  socLost: number;
  parkedHours: number;
  periodCount: number;
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
      };

      current.socLost += segmentLoss;
      current.parkedHours += segmentHours;
      current.periodCount += 1;
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
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function PhantomDrainChart({
  periods,
  loading = false,
  height = 280,
  yUnit = '%/h',
  emptyTitle = 'No phantom drain data for this period',
  yRange,
  interactionMode = 'standard',
}: PhantomDrainChartProps) {
  const data = React.useMemo(() => buildPhantomDrainDailySeries(periods), [periods]);

  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={[
        {
          key: 'phantom-drain',
          label: 'Drain Rate',
          values: data.map((point) => point.drainRate),
          mode: 'bar',
          tooltipFormatter: (value) => value == null ? '-' : `${formatPercent(value, 2)} / h`,
        },
        {
          key: 'phantom-drain-loss',
          label: 'SoC Lost',
          values: data.map((point) => point.socLost),
          tooltipOnly: true,
          tooltipFormatter: (value) => value == null ? '-' : formatPercent(value, 2),
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
          label: 'Periods',
          values: data.map((point) => point.periodCount),
          tooltipOnly: true,
          tooltipFormatter: (value) => value == null ? '-' : String(Math.round(value)),
        },
      ]}
      loading={loading}
      emptyTitle={emptyTitle}
      height={height}
      yUnit={yUnit}
      {...(yRange ? { yRange } : {})}
      mode="bar"
      smoothing={0}
      interactionMode={interactionMode}
    />
  );
}
