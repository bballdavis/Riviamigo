import * as React from 'react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Brush,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatKwh } from '../lib/utils';

export interface EnergyBarPoint {
  ts: string;
  energy_added_kwh: number;
}

export interface EnergyBarChartProps {
  data: EnergyBarPoint[];
  loading?: boolean;
  height?: number;
  showBrush?: boolean;
}

export function EnergyBarChart({
  data,
  loading = false,
  height = 200,
  showBrush = false,
}: EnergyBarChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  return (
    <ResponsiveContainer width="100%" height={height + (showBrush ? 36 : 0)}>
      <BarChart data={data} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="ts"
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
          tickFormatter={(v: number) => `${v}kWh`}
          width={44}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => [formatKwh(v ?? 0), 'Energy Added']} />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Bar
          dataKey="energy_added_kwh"
          fill={CHART_COLORS.accent}
          fillOpacity={0.8}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        {showBrush && (
          <Brush
            dataKey="ts"
            height={28}
            stroke={CHART_COLORS.muted}
            tickFormatter={(v: string) => format(parseISO(v), 'M/d')}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
