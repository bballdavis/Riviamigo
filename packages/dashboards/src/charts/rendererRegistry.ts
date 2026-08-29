import type { ChartDataset, ChartDefinitionV1 } from '@riviamigo/types';
import * as React from 'react';
import { ChartDefinitionRenderer } from '../widgets/chart/ChartDefinitionRenderer';
import { BUNDLED_CHART_SLUGS } from './defaults';

export interface ChartRendererProps {
  definition: ChartDefinitionV1;
  datasets: ChartDataset[];
  height: number;
  loading?: boolean;
  partial?: boolean;
  refreshing?: boolean;
  error?: boolean;
  presentation?: 'embedded' | 'mobile-viewer';
}

export interface ChartRendererPlugin {
  id: string;
  supports: (definition: ChartDefinitionV1) => boolean;
  render: (props: ChartRendererProps) => React.ReactNode;
}

export interface SpecializedRendererCompatibility {
  id: string;
  chartSlug: string;
  supportedDefinitionControls: readonly string[];
  supports: (definition: ChartDefinitionV1, bundledDefinition: ChartDefinitionV1) => boolean;
}

export const CHART_RENDERER_PLUGINS: ReadonlyArray<ChartRendererPlugin> = [
  { id: 'rich-time-series', supports: () => true, render: (props) => React.createElement(ChartDefinitionRenderer, props) },
];

export const SPECIALIZED_RENDERER_COMPATIBILITY: ReadonlyArray<SpecializedRendererCompatibility> = BUNDLED_CHART_SLUGS.map((chartSlug) => ({
  id: `bundled-specialized:${chartSlug}`,
  chartSlug,
  // Specialized components support widget-level range and smoothing settings,
  // but currently declare no persisted definition overrides. Any saved render
  // edit therefore takes the complete generic-definition path.
  supportedDefinitionControls: [],
  supports: (definition, bundledDefinition) => stableConfigValue(withoutPlacements(definition)) === stableConfigValue(withoutPlacements(bundledDefinition)),
}));

export function getChartRenderer(definition: ChartDefinitionV1) {
  const declared = definition.rendererId ? CHART_RENDERER_PLUGINS.find((plugin) => plugin.id === definition.rendererId) : undefined;
  return declared ?? CHART_RENDERER_PLUGINS.find((plugin) => plugin.supports(definition));
}

export function supportsSpecializedChartRenderer(chartSlug: string, definition: ChartDefinitionV1, bundledDefinition: ChartDefinitionV1) {
  return SPECIALIZED_RENDERER_COMPATIBILITY.some((renderer) => renderer.chartSlug === chartSlug && renderer.supports(definition, bundledDefinition));
}

function withoutPlacements(definition: ChartDefinitionV1) {
  const { placements, ...renderDefinition } = definition;
  void placements;
  return renderDefinition;
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableConfigValue(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
