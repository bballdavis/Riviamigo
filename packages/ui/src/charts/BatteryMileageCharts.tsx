import * as React from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatKwh, formatMiles } from '../lib/utils';

export interface BatteryMileageDatum {
  ts: string;
  odometer_mi: number | null;
  usable_kwh: number | null;
  range_mi: number | null;
}

export interface BatteryMileageChartProps {
  data: BatteryMileageDatum[];
  loading?: boolean;
  height?: number;
}

function ChartEmptyState({ height, message = 'No data yet' }: { height: number; message?: string }) {
  return (
    <div style={{ height }} className="flex items-center justify-center text-sm text-text-muted">
      {message}
    </div>
  );
}

export function BatteryCapacityByMileageChart({
  data,
  loading = false,
  height = 300,
}: BatteryMileageChartProps) {
  if (loading) return <ChartSkeleton height={height} />;

  const chartData = data
    .filter((point) => point.odometer_mi != null && point.usable_kwh != null)
    .map((point) => ({
      ...point,
      odometer_mi: point.odometer_mi ?? 0,
      usable_kwh: point.usable_kwh ?? 0,
    }));

  if (chartData.length === 0) return <ChartEmptyState height={height} message="No battery capacity data recorded yet" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart data={chartData} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="odometer_mi"
          type="number"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatMiles(value).replace(/\s.*/, '')}
          name="Mileage"
          width={52}
        />
        <YAxis
          dataKey="usable_kwh"
          type="number"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value.toFixed(0)} kWh`}
          name="Capacity"
          width={56}
        />
        <Tooltip
          cursor={TOOLTIP_CURSOR_STYLE}
          content={<ChartTooltip
            formatter={(value, name) => {
              if (name === 'usable_kwh') return [formatKwh(value ?? null), 'Battery capacity'];
              return [formatMiles(value ?? null), 'Mileage'];
            }}
            multiLine
          />}
        />
        <Scatter
          dataKey="usable_kwh"
          fill={CHART_COLORS.accent}
          fillOpacity={0.82}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ProjectedRangeByMileageChart({
  data,
  loading = false,
  height = 300,
}: BatteryMileageChartProps) {
  if (loading) return <ChartSkeleton height={height} />;

  const chartData = data
    .filter((point) => point.odometer_mi != null && point.range_mi != null)
    .map((point) => ({
      ...point,
      odometer_mi: point.odometer_mi ?? 0,
      range_mi: point.range_mi ?? 0,
    }));

  if (chartData.length === 0) return <ChartEmptyState height={height} message="No range data recorded yet" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="odometer_mi"
          type="number"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatMiles(value).replace(/\s.*/, '')}
          minTickGap={40}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatMiles(value).replace(/\s.*/, '')}
          width={52}
        />
        <Tooltip
          cursor={TOOLTIP_CURSOR_STYLE}
          content={<ChartTooltip
            formatter={(value, name) => {
              if (name === 'range_mi') return [formatMiles(value ?? null), 'Projected range'];
              return [formatMiles(value ?? null), 'Mileage'];
            }}
            multiLine
          />}
        />
        <Line
          type="monotone"
          dataKey="range_mi"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={{ r: 3, fill: CHART_COLORS.accent, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
