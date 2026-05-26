import * as React from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatPercent, formatKwh, formatSmartNumber } from '../lib/utils';

export interface ChargeCurvePoint {
  soc: number;
  power_kw: number;
}

export interface ChargeCurveChartProps {
  data: ChargeCurvePoint[];
  loading?: boolean;
  height?: number;
}

export function ChargeCurveChart({
  data,
  loading = false,
  height = 200,
}: ChargeCurveChartProps) {
  if (loading) return <ChartSkeleton height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="soc"
          type="number"
          domain={[0, 100]}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${Math.round(v)}%`}
          label={{ value: 'State of Charge', position: 'insideBottom', offset: -2, ...TICK_STYLE }}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${formatSmartNumber(v, Math.abs(v) >= 100 ? 0 : 1)} kW`}
          width={40}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(v, name) =>
                name === 'power_kw'
                  ? [formatKwh(v ?? 0), 'Power']
                  : [formatPercent(v ?? 0), 'SoC']
              }
            />
          }
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Line
          type="monotone"
          dataKey="power_kw"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--rm-bg)' }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
