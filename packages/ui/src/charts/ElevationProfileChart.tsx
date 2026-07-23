import * as React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { colors } from '../tokens/colors';
import { formatAppTime } from '../lib/dateTime';

export interface ElevationPoint {
  ts: string;
  value: number | null;
}

export interface ElevationProfileChartProps {
  data: ElevationPoint[];
  loading?: boolean;
  height?: number;
  unit?: 'ft' | 'm';
}

const M_TO_FT = 3.28084;

export function ElevationProfileChart({
  data,
  loading = false,
  height = 140,
  unit = 'ft',
}: ElevationProfileChartProps) {
  if (loading) return <ChartSkeleton height={height} />;

  const chartData = data.map((d) => ({
    ts: d.ts,
    elev: d.value !== null
      ? unit === 'ft' ? d.value * M_TO_FT : d.value
      : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={CHART_MARGINS.withYAxis}>
        <defs>
          <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={colors.dataViz.teal} stopOpacity={0.3} />
            <stop offset="95%" stopColor={colors.dataViz.teal} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />

        <XAxis
          dataKey="ts"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => formatAppTime(v)}
          minTickGap={60}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${Math.round(v)}`}
          unit={unit === 'ft' ? 'ft' : 'm'}
          width={44}
        />

        <Tooltip
          content={<ChartTooltip
            labelFormatter={(v: string) => formatAppTime(v, { second: '2-digit' })}
            formatter={(v) => [
              v !== undefined ? `${Math.round(v)} ${unit}` : '—',
              'Elevation',
            ]}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />

        <Area
          type="monotone"
          dataKey="elev"
          stroke={colors.dataViz.teal}
          strokeWidth={1.5}
          fill="url(#elevGradient)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: colors.dataViz.teal }}
          isAnimationActive={false}
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
