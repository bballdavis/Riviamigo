import React from 'react';
import type { ChartDataset, ChartDefinitionV1 } from '@riviamigo/types';
import { getChartColor, RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { useDocumentTheme } from '@riviamigo/ui/hooks';
import type { RichSeries } from '@riviamigo/ui/charts';

export interface ChartDefinitionRendererProps {
  definition: ChartDefinitionV1;
  datasets: ChartDataset[];
  height: number;
  loading?: boolean;
  presentation?: 'embedded' | 'mobile-viewer';
}

function domainKey(value: string | number): string {
  return typeof value === 'number' ? `n:${value}` : `s:${value}`;
}

function compareDomainValues(left: string | number, right: string | number, kind: ChartDefinitionV1['x']['kind']) {
  if (kind === 'category') return 0;
  const leftValue = typeof left === 'number' ? left : Date.parse(left);
  const rightValue = typeof right === 'number' ? right : Date.parse(right);
  return Number.isFinite(leftValue) && Number.isFinite(rightValue) ? leftValue - rightValue : String(left).localeCompare(String(right));
}

function numericValuesForDomain(dataset: ChartDataset, fieldName: string, domain: Array<string | number>, xField?: string) {
  const field = dataset.fields[fieldName];
  if (!field) return [];
  const sourceDomain = xField ? dataset.fields[xField]?.values : dataset.domain.values;
  const byX = new Map((sourceDomain ?? []).flatMap((value, index) => value == null ? [] : [[domainKey(value), field.values[index]] as const]));
  return domain.map((value) => {
    const candidate = byX.get(domainKey(value));
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
  });
}

export function ChartDefinitionRenderer({ definition, datasets, height, loading = false, presentation = 'embedded' }: ChartDefinitionRendererProps) {
  const isDark = useDocumentTheme();
  const primary = datasets[0];
  // Keep one shared X domain for uPlot, retaining samples from every source and
  // filling gaps rather than pairing values by array index.
  const domain = Array.from(new Map(datasets.flatMap((dataset) => dataset.domain.values).map((value) => [domainKey(value), value])).values());
  if (definition.x.kind !== 'category') domain.sort((left, right) => compareDomainValues(left, right, definition.x.kind));
  const points = domain.map((value) => ({ ts: value }));
  const series = definition.series.flatMap((definitionSeries) => {
    const dataset = datasets.find((candidate) => candidate.sourceBindingId === definitionSeries.y.sourceBindingId);
    const field = dataset?.fields[definitionSeries.y.field];
    if (!dataset || !field) return [];
    const xField = definitionSeries.x?.sourceBindingId === dataset.sourceBindingId ? definitionSeries.x.field : undefined;
    return [{
      key: definitionSeries.id,
      label: definitionSeries.label,
      color: definitionSeries.color.mode === 'token' ? getChartColor(definitionSeries.color.token) : isDark ? definitionSeries.color.dark : definitionSeries.color.light,
      values: numericValuesForDomain(dataset, definitionSeries.y.field, domain, xField),
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
  const numericRange = (axis: ChartDefinitionV1['axes'][keyof ChartDefinitionV1['axes']]) => (
    axis?.domain.mode === 'fixed' ? [axis.domain.min, axis.domain.max] as [number, number] : undefined
  );
  return <RichTimeSeriesChart
    points={points}
    series={series}
    height={height}
    loading={loading}
    mode="line"
    xTime={definition.x.kind === 'time'}
    xUnit={definition.axes.x.unit}
    xAxisLabel={definition.axes.x.label}
    yAxisLabel={definition.axes.y.label}
    yRightAxisLabel={definition.axes.y2?.label}
    yUnit={definition.axes.y.unit}
    yRightUnit={definition.axes.y2?.unit}
    xRange={numericRange(definition.axes.x)}
    yRange={numericRange(definition.axes.y)}
    yRightRange={definition.axes.y2 ? numericRange(definition.axes.y2) : undefined}
    smoothness={definition.display.curveSmoothness}
    showLegend={definition.display.legend !== 'hide'}
    showGrid={definition.display.grid}
    showTooltip={definition.display.tooltip}
    showPoints={definition.display.showPoints ?? false}
    emptyTitle={definition.display.emptyTitle}
    emptyDescription={definition.display.emptyDescription}
    stepInterpolation={definition.series.some((item) => item.mark === 'step')}
    connectGaps={definition.interaction.connectGaps}
    referenceLines={(definition.annotations ?? []).filter((item) => item.kind === 'horizontal_reference_line').map((item) => ({
      value: item.value,
      ...(item.label ? { label: item.label } : {}),
      color: item.color.mode === 'token' ? getChartColor(item.color.token) : isDark ? item.color.dark : item.color.light,
    }))}
    interactionMode={presentation === 'mobile-viewer' ? 'touch-explore' : 'standard'}
  />;
}
