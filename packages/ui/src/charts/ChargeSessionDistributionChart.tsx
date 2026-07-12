import * as React from 'react';
import { CHART_BAR_STYLE, CHART_COLORS, CHART_FONT } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatSmartNumber } from '../lib/utils';

export interface ChargeSessionDistributionBand {
  label: string;
  count: number;
  averageRateKw: number | null;
}

export interface ChargeSessionDistributionChartProps {
  bands: ChargeSessionDistributionBand[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
}

function formatCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatRate(value: number | null) {
  return value == null || !Number.isFinite(value) ? '-' : `${formatSmartNumber(value, Math.abs(value) >= 100 ? 0 : 1)} kW`;
}

export function ChargeSessionDistributionChart({
  bands,
  height = 280,
  loading = false,
  emptyTitle = 'No charging sessions for this period',
}: ChargeSessionDistributionChartProps) {
  if (loading) {
    return <ChartSkeleton height={height} />;
  }

  const populatedBands = bands.filter((band) => band.count > 0 || band.averageRateKw != null);
  if (populatedBands.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary"
        style={{ height }}
      >
        {emptyTitle}
      </div>
    );
  }

  const width = 960;
  const chartHeight = Math.max(220, height);
  const margin = { top: 18, right: 96, bottom: 64, left: 96 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;
  const maxCount = Math.max(1, ...bands.map((band) => band.count));
  const maxRate = Math.max(1, ...bands.map((band) => band.averageRateKw ?? 0));
  const bandWidth = innerWidth / Math.max(1, bands.length);
  const barWidth = Math.min(72, bandWidth * 0.56);

  const countY = (value: number) => margin.top + innerHeight - (value / maxCount) * innerHeight;
  const rateY = (value: number) => margin.top + innerHeight - (value / maxRate) * innerHeight;
  const linePoints = bands
    .map((band, index) => {
      if (band.averageRateKw == null) return null;
      const x = margin.left + bandWidth * index + bandWidth / 2;
      return `${x},${rateY(band.averageRateKw)}`;
    })
    .filter((point): point is string => point != null)
    .join(' ');

  const tickFractions = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-3">
      <svg
        aria-label="Charging session distribution"
        role="img"
        viewBox={`0 0 ${width} ${chartHeight}`}
        width="100%"
        height={chartHeight}
      >
        {tickFractions.map((fraction) => {
          const y = margin.top + innerHeight - fraction * innerHeight;
          return (
            <g key={`grid-${fraction}`}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke={CHART_COLORS.grid} strokeWidth={1} />
              <text x={margin.left - 14} y={y + 4} textAnchor="end" fill={CHART_COLORS.muted} fontFamily={CHART_FONT.fontFamily} fontSize={CHART_FONT.fontSize} fontWeight={CHART_FONT.fontWeight}>
                {formatCount(maxCount * fraction)}
              </text>
              <text x={width - margin.right + 14} y={y + 4} textAnchor="start" fill={CHART_COLORS.muted} fontFamily={CHART_FONT.fontFamily} fontSize={CHART_FONT.fontSize} fontWeight={CHART_FONT.fontWeight}>
                {formatRate(maxRate * fraction)}
              </text>
            </g>
          );
        })}

        {bands.map((band, index) => {
          const centerX = margin.left + bandWidth * index + bandWidth / 2;
          const barTop = countY(band.count);
          const barHeight = Math.max(0, margin.top + innerHeight - barTop);
          const ratePointY = band.averageRateKw == null ? null : rateY(band.averageRateKw);

          return (
            <g key={band.label}>
              <rect
                x={centerX - barWidth / 2}
                y={barTop}
                width={barWidth}
                height={barHeight}
                rx={CHART_BAR_STYLE.radius}
                fill={CHART_COLORS.accent}
                opacity={CHART_BAR_STYLE.fillOpacity}
              />
              <text x={centerX} y={barTop - 8} textAnchor="middle" fill={CHART_COLORS.accent} fontFamily={CHART_FONT.fontFamily} fontSize={CHART_FONT.fontSize} fontWeight={CHART_FONT.fontWeight}>
                {band.count > 0 ? band.count : ''}
              </text>
              {ratePointY != null && (
                <circle cx={centerX} cy={ratePointY} r={5} fill={CHART_COLORS.sky} stroke={CHART_COLORS.sky} />
              )}
              <text x={centerX} y={chartHeight - 24} textAnchor="middle" fill={CHART_COLORS.muted} fontFamily={CHART_FONT.fontFamily} fontSize={CHART_FONT.fontSize} fontWeight={CHART_FONT.fontWeight}>
                {band.label}
              </text>
            </g>
          );
        })}

        {linePoints && (
          <polyline
            points={linePoints}
            fill="none"
            stroke={CHART_COLORS.sky}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        <text
          x={24}
          y={margin.top + innerHeight / 2}
          fill={CHART_COLORS.accent}
          fontFamily={CHART_FONT.fontFamily}
          fontSize={CHART_FONT.fontSize + 1}
          fontWeight={700}
          textAnchor="middle"
          transform={`rotate(-90 24 ${margin.top + innerHeight / 2})`}
        >
          Sessions
        </text>
        <text
          x={width - 24}
          y={margin.top + innerHeight / 2}
          fill={CHART_COLORS.sky}
          fontFamily={CHART_FONT.fontFamily}
          fontSize={CHART_FONT.fontSize + 1}
          fontWeight={700}
          textAnchor="middle"
          transform={`rotate(-90 ${width - 24} ${margin.top + innerHeight / 2})`}
        >
          Avg charge rate
        </text>
      </svg>
    </div>
  );
}
