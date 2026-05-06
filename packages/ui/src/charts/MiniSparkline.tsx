import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  YAxis,
} from 'recharts';
import { CHART_COLORS } from './ChartProvider';

export type MiniSparklineType = 'none' | 'line' | 'area' | 'bar';

export interface MiniSparklineProps {
  data: Array<{ ts?: string; value: number | null | undefined }>;
  type?: MiniSparklineType;
  height?: number;
  color?: string;
}

export function MiniSparkline({
  data,
  type = 'line',
  height = 42,
  color = CHART_COLORS.accent,
}: MiniSparklineProps) {
  if (type === 'none') return null;

  const chartData = data
    .map((point, index) => ({ x: point.ts ?? String(index), value: point.value ?? null }))
    .filter((point) => point.value != null && Number.isFinite(point.value));

  if (chartData.length < 2) {
    return <div style={{ height }} className="rounded bg-bg-elevated/40" />;
  }

  if (type === 'bar') {
    return (
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <YAxis hide domain={['auto', 'auto']} />
            <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const Chart = type === 'area' ? AreaChart : LineChart;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis hide domain={['auto', 'auto']} />
          {type === 'area' ? (
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.5}
              fill={color}
              fillOpacity={0.16}
              dot={false}
              isAnimationActive={false}
            />
          ) : (
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}
