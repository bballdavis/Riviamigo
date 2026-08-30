import type { ChartDefinitionV1 } from '@riviamigo/types';
import defaultData from './defaults.json';
import { ChartDefinitionV1Schema } from '../schema';

type BundledChartDefinition = ChartDefinitionV1 & {
  slug: string;
  title: string;
  description: string;
};

/**
 * The installation/reset baseline has one serialized owner. Runtime database
 * records use the same validated ChartDefinitionV1 shape.
 */
export const BUNDLED_CHART_DEFINITIONS: ReadonlyArray<BundledChartDefinition> = defaultData.map((entry) => ({
  slug: entry.slug,
  title: entry.name,
  description: entry.description,
  ...ChartDefinitionV1Schema.parse(entry.definition),
})) as ReadonlyArray<BundledChartDefinition>;

export const BUNDLED_CHART_SLUGS = BUNDLED_CHART_DEFINITIONS.map((chart) => chart.slug);

export function getBundledChartDefinition(slug: string) {
  return BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === slug);
}
