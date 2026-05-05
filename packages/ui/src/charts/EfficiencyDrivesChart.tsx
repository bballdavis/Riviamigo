/**
 * EfficiencyDrivesChart — combines a 7-day rolling-average line with scatter
 * dots for individual drives, so you can see both the trend and the raw
 * per-drive data on one interactive canvas.
 */
import * as React from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Scatter,
  XAxis, YAxis, CartesianGrid, ZAxis, Legend, Tooltip,
} from 'recharts';
import { format } from 'date-fns';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import {
  getUnitSystem,
  whPerMileToMiPerKwh,
  whPerMileToKmPerKwh,
  formatMiles,
  formatDuration,
} from '../lib/utils';
import type { EfficiencyTrendPoint } from './EfficiencyTrendChart';
import type { Trip } from '@riviamigo/types';

export interface EfficiencyDrivesChartProps {
  trend: EfficiencyTrendPoint[];
  drives: Trip[];
  loading?: boolean;
  height?: number;
  title?: string;
}

function convertEff(wh_mi: number | null | undefined, isMetric: boolean): number | null {
  if (wh_mi == null) return null;
  return isMetric ? whPerMileToKmPerKwh(wh_mi) : whPerMileToMiPerKwh(wh_mi);
}

interface DrivePoint {
  ts: number;
  eff: number;
  dist: number;
  label: string;
  endLabel: string;
  duration: number | null;
}

interface RollingPoint {
  ts: number;
  rolling: number;
}

const DriveTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: DrivePoint }> }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[160px] rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm shadow-lg">
      <div className="font-semibold text-fg truncate max-w-[200px]">{p.label}</div>
      {p.endLabel ? (
        <div className="text-fg-secondary truncate max-w-[200px]">→ {p.endLabel}</div>
      ) : null}
      <div className="mt-1.5 space-y-0.5 text-fg-secondary">
        <div>{typeof p.eff === 'number' ? `${p.eff.toFixed(2)} ${getUnitSystem() === 'metric' ? 'km/kWh' : 'mi/kWh'}` : '-'}</div>
        <div>{formatMiles(p.dist)}</div>
        {p.duration ? <div>{formatDuration(p.duration)}</div> : null}
      </div>
    </div>
  );
};

const RollingTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: RollingPoint }> }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const unit = getUnitSystem() === 'metric' ? 'km/kWh' : 'mi/kWh';
  return (
    <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm shadow-lg">
      <div className="text-fg-secondary">{format(new Date(p.ts), 'MMM d, yyyy')}</div>
      <div className="font-semibold text-fg">7-day avg: {typeof p.rolling === 'number' ? `${p.rolling.toFixed(2)} ${unit}` : '-'}</div>
    </div>
  );
};

export function EfficiencyDrivesChart({
  trend,
  drives,
  loading = false,
  height = 300,
  title,
}: EfficiencyDrivesChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  const isMetric = getUnitSystem() === 'metric';
  const unit = isMetric ? 'km/kWh' : 'mi/kWh';

  const rollingData: RollingPoint[] = trend
    .filter((p) => p.rolling_7d_wh_mi != null)
    .map((p) => ({
      ts: new Date(p.day).getTime(),
      rolling: convertEff(p.rolling_7d_wh_mi, isMetric) ?? 0,
    }));

  const drivePoints: DrivePoint[] = drives
    .filter((d) => d.efficiency_wh_mi != null)
    .map((d) => ({
      ts: new Date(d.started_at).getTime(),
      eff: convertEff(d.efficiency_wh_mi, isMetric) ?? 0,
      dist: d.distance_mi ?? 0,
      label: d.start_place ?? d.start_address ?? 'Drive',
      endLabel: d.end_place ?? d.end_address ?? '',
      duration: d.duration_min ?? null,
    }));

  const allTs = [...rollingData.map((p) => p.ts), ...drivePoints.map((p) => p.ts)];
  const tsDomain: [number, number] =
    allTs.length ? [Math.min(...allTs) - 86400_000, Math.max(...allTs) + 86400_000] : [0, 1];

  const allEff = [
    ...rollingData.map((p) => p.rolling),
    ...drivePoints.map((p) => p.eff),
  ].filter((v) => v > 0);
  const effDomain: [number, number] = allEff.length
    ? [Math.max(0, Math.min(...allEff) * 0.85), Math.max(...allEff) * 1.1]
    : [0, 5];

  const maxDist = Math.max(...drivePoints.map((d) => d.dist), 1);

  return (
    <div>
      {title ? (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">{title}</div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={CHART_MARGINS.withYAxis}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={tsDomain}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => format(new Date(v), 'MMM d')}
            minTickGap={48}
          />
          <YAxis
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            domain={effDomain}
            tickFormatter={(v: number) => v.toFixed(1)}
            unit={` ${unit}`}
            width={60}
          />
          {/* ZAxis scales scatter dot size by trip distance */}
          <ZAxis
            dataKey="dist"
            range={[
              Math.max(16, Math.round(2000 / Math.max(drivePoints.length, 1))),
              Math.min(120, Math.round(8000 / Math.max(drivePoints.length, 1))),
            ]}
          />
          <Tooltip content={<DriveTooltip />} cursor={TOOLTIP_CURSOR_STYLE} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted, paddingTop: 8 }}
          />

          {/* Individual drives */}
          <Scatter
            name="Drives"
            data={drivePoints}
            dataKey="eff"
            fill={CHART_COLORS.accent}
            fillOpacity={0.6}
            isAnimationActive={false}
          />

          {/* 7-day rolling average */}
          <Line
            name="7-day avg"
            data={rollingData}
            dataKey="rolling"
            type="monotone"
            dot={false}
            stroke={CHART_COLORS.success}
            strokeWidth={2.5}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {drives.length === 0 && !loading ? (
        <div className="mt-2 text-center text-xs text-fg-tertiary">No drive data for this range.</div>
      ) : null}
    </div>
  );
}
