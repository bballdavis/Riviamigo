import * as React from 'react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, Brush,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatPercent } from '../lib/utils';

export interface PhantomDrainPoint {
  date: string;        // ISO date "2024-01-15"
  drain_pct: number;   // percent lost overnight
}

export interface PhantomDrainChartProps {
  data: PhantomDrainPoint[];
  loading?: boolean;
  height?: number;
  showBrush?: boolean;
}

function drainColor(pct: number): string {
  if (pct < 1) return CHART_COLORS.success;
  if (pct < 3) return CHART_COLORS.warning;
  return CHART_COLORS.danger;
}

export function PhantomDrainChart({
  data,
  loading = false,
  height = 200,
  showBrush = false,
}: PhantomDrainChartProps) {
  if (loading) return <ChartSkeleton height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height + (showBrush ? 36 : 0)}>
      <BarChart data={data} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="date"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => format(parseISO(v), 'M/d')}
          minTickGap={20}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={32}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => [formatPercent(v ?? 0, 1), 'Drain']} />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Bar dataKey="drain_pct" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((entry, i) => (
            <Cell key={i} fill={drainColor(entry.drain_pct)} fillOpacity={0.8} />
          ))}
        </Bar>
        {showBrush && (
          <Brush
            dataKey="date"
            height={28}
            stroke={CHART_COLORS.muted}
            tickFormatter={(v: string) => format(parseISO(v), 'M/d')}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
