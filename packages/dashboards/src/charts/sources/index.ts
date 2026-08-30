import sourceManifestData from './sources.json';
import type { ChartSourceManifest, MetricCatalogEntry } from '@riviamigo/types';

export const CHART_SOURCE_MANIFESTS: ReadonlyArray<ChartSourceManifest> = sourceManifestData as ReadonlyArray<ChartSourceManifest>;

export function getChartSourceManifest(sourceId: string) {
  return CHART_SOURCE_MANIFESTS.find((manifest) => manifest.id === sourceId);
}

/**
 * Expands the generic metric-series source from the account-visible metric
 * catalog. The static manifest remains the offline/compatibility fallback;
 * the API metric registry is the owner of the complete searchable inventory.
 */
export function resolveChartSourceCapabilities(
  manifests: readonly ChartSourceManifest[],
  metrics: readonly MetricCatalogEntry[],
): ChartSourceManifest[] {
  const seriesMetrics = metrics.filter((metric) => metric.supports_series);
  if (seriesMetrics.length === 0) return manifests.map((manifest) => ({ ...manifest }));
  return manifests.map((manifest) => {
    if (manifest.id !== 'metrics.series') return { ...manifest };
    const timestamp = manifest.fields.find((field) => field.id === 'timestamp') ?? {
      id: 'timestamp',
      label: 'Timestamp',
      kind: 'time' as const,
      roles: ['x', 'detail'] as Array<'x' | 'detail'>,
    };
    return {
      ...manifest,
      parameters: manifest.parameters.map((parameter) => parameter.id === 'metric'
        ? { ...parameter, options: seriesMetrics.map((metric) => metric.id) }
        : parameter),
      fields: [
        timestamp,
        ...seriesMetrics.map((metric) => ({
          id: metric.id,
          label: metric.label,
          kind: 'number' as const,
          ...(metric.unit ? { unit: metric.unit } : {}),
          roles: ['y', 'detail'] as Array<'y' | 'detail'>,
        })),
      ],
    };
  });
}
