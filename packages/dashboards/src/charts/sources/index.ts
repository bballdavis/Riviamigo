import sourceManifestData from './sources.json';
import type { ChartSourceManifest } from '@riviamigo/types';

export const CHART_SOURCE_MANIFESTS: ReadonlyArray<ChartSourceManifest> = sourceManifestData as ReadonlyArray<ChartSourceManifest>;

export function getChartSourceManifest(sourceId: string) {
  return CHART_SOURCE_MANIFESTS.find((manifest) => manifest.id === sourceId);
}
