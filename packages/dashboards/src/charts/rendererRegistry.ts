import type { ChartDataset, ChartDefinitionV1 } from '@riviamigo/types';
import * as React from 'react';
import { ChartDefinitionRenderer } from '../widgets/chart/ChartDefinitionRenderer';

export interface ChartRendererProps {
  definition: ChartDefinitionV1;
  datasets: ChartDataset[];
  height: number;
  loading?: boolean;
  presentation?: 'embedded' | 'mobile-viewer';
}

export interface ChartRendererPlugin {
  id: string;
  supports: (definition: ChartDefinitionV1) => boolean;
  render: (props: ChartRendererProps) => React.ReactNode;
}

export const CHART_RENDERER_PLUGINS: ReadonlyArray<ChartRendererPlugin> = [
  { id: 'rich-time-series', supports: () => true, render: (props) => React.createElement(ChartDefinitionRenderer, props) },
];

export function getChartRenderer(definition: ChartDefinitionV1) {
  const declared = definition.rendererId ? CHART_RENDERER_PLUGINS.find((plugin) => plugin.id === definition.rendererId) : undefined;
  return declared ?? CHART_RENDERER_PLUGINS.find((plugin) => plugin.supports(definition));
}
