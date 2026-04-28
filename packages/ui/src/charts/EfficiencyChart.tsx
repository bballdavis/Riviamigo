import * as React from 'react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ErrorBar,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';

export interface EfficiencyByModePoint {
  drive_mode: string;
  avg_efficiency: number;   // Wh/mi
  p10_efficiency: number;
  p90_efficiency: number;
}

export interface EfficiencyChartProps {
  data: EfficiencyByModePoint[];
  loading?: boolean;
  height?: number;
}

const MODE_LABELS: Record<string, string> = {
  sport: 'Sport', everyday: 'Everyday',
  conserve: 'Conserve', off_road_auto: 'Off-Road Auto',
};

export function EfficiencyChart({
  data,
  loading = false,
  height = 200,
}: EfficiencyChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  const chartData = data.map((d) => ({
    ...d,
    label: MODE_LABELS[d.drive_mode] ?? d.drive_mode,
    range: [d.p10_efficiency, d.p90_efficiency - d.p10_efficiency] as [number, number],
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}Wh`}
          width={40}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => [`${(v ?? 0).toFixed(0)} Wh/mi`, 'Avg']} />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Bar
          dataKey="avg_efficiency"
          fill={CHART_COLORS.accent}
          fillOpacity={0.8}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          <ErrorBar
            dataKey="range"
            width={4}
            strokeWidth={2}
            stroke={CHART_COLORS.muted}
            direction="y"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
