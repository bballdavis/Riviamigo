import React from 'react';
import type { ChartDataset, ChartDefinitionV1 } from '@riviamigo/types';
import { getChartColor, RichTimeSeriesChart } from '@riviamigo/ui/charts';
import type { RichSeries } from '@riviamigo/ui/charts';

export interface ChartDefinitionRendererProps {
  definition: ChartDefinitionV1;
  datasets: ChartDataset[];
  height: number;
  loading?: boolean;
  presentation?: 'embedded' | 'mobile-viewer';
}

export function ChartDefinitionRenderer({ definition, datasets, height, loading = false, presentation = 'embedded' }: ChartDefinitionRendererProps) {
  const primary = datasets[0];
  const points = primary?.domain.values.map((value) => ({ ts: value })) ?? [];
  const series = definition.series.flatMap((definitionSeries) => {
    const dataset = datasets.find((candidate) => candidate.sourceBindingId === definitionSeries.y.sourceBindingId);
    const field = dataset?.fields[definitionSeries.y.field];
    if (!field) return [];
    return [{
      key: definitionSeries.id,
      label: definitionSeries.label,
      color: definitionSeries.color.mode === 'token' ? getChartColor(definitionSeries.color.token) : definitionSeries.color.light,
      values: field.values.map((value) => typeof value === 'number' ? value : null),
      mode: definitionSeries.mark === 'histogram' ? 'bar' as const : definitionSeries.mark === 'scatter' ? 'scatter' as const : definitionSeries.mark === 'bar' ? 'bar' as const : definitionSeries.mark === 'area' ? 'area' as const : 'line' as const,
      pointSize: definitionSeries.pointSize,
      strokeWidth: definitionSeries.strokeWidth,
      yScale: definitionSeries.yAxis,
      stackId: definitionSeries.stackId,
      showInLegend: definitionSeries.visibleInLegend,
    }];
  }) as unknown as RichSeries[];
  if (!primary || series.length === 0) {
    return <div className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary" style={{ height }}>{loading ? 'Loading chart data…' : definition.display.emptyTitle ?? 'No chart data available'}</div>;
  }
  return <RichTimeSeriesChart points={points} series={series} height={height} loading={loading} mode="line" xTime={definition.x.kind === 'time'} yUnit={definition.axes.y.unit} yRightUnit={definition.axes.y2?.unit} smoothness={definition.display.curveSmoothness} stepInterpolation={definition.series.some((item) => item.mark === 'step')} connectGaps={definition.interaction.connectGaps} interactionMode={presentation === 'mobile-viewer' ? 'touch-explore' : 'standard'} />;
}
