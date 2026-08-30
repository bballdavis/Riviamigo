import type { ChartDefinitionV1, ChartSourceManifest, ChartSeriesDefinition, MetricCatalogEntry } from '@riviamigo/types';
import { BUNDLED_CHART_DEFINITIONS } from './defaults';

export interface CurveCatalogOption {
  id: string;
  label: string;
  category: string;
  description: string;
  sourceId: string;
  field?: string;
  domainKey: string;
  domainLabel: string;
  domainKind: 'time' | 'number' | 'category';
  domainUnit?: string;
  domainSignature: string;
  enabled: boolean;
  disabledReason?: string;
}

export function buildCurveCatalog(manifests: readonly ChartSourceManifest[], metrics: readonly MetricCatalogEntry[], definition: ChartDefinitionV1): CurveCatalogOption[] {
  const used = new Set(definition.sources.map((source) => source.sourceId));
  const first = sharedDomain(definition, manifests);
  const currentSignature = domainSignature(first.kind, first.field, first.unit);
  const options: CurveCatalogOption[] = metrics.filter((metric) => metric.supports_series).map((metric) => {
    const reusable = definition.sources.some((source) => source.sourceId === 'metrics.series' && source.params.metric === metric.id);
    const hasCapacity = reusable || definition.sources.length < 4;
    const compatible = definition.series.length === 0 || currentSignature === 'time';
    const belowCurveLimit = definition.series.length < 12;
    return {
      id: `metric:${metric.id}`, label: metric.label, category: metric.source, description: `${metric.source} · ${metric.unit ?? 'unitless'}`,
      sourceId: 'metrics.series', field: metric.id, domainKey: 'timestamp', domainLabel: 'Time', domainKind: 'time', domainSignature: 'time', enabled: hasCapacity && compatible && belowCurveLimit,
      ...(!belowCurveLimit ? { disabledReason: 'A chart can contain up to twelve curves.' } : !hasCapacity ? { disabledReason: 'This would exceed the four data groups limit.' } : !compatible ? { disabledReason: 'This curve uses time values while the chart is plotted over another domain.' } : {}),
    };
  });
  for (const manifest of manifests) {
    if (manifest.id === 'metrics.series') continue;
    for (const field of manifest.fields.filter((candidate) => candidate.roles.includes('y'))) {
      const bundledDomainField = definition.series.length === 0 ? bundledDomainForCurve(manifest.id, field.id) : null;
      const preferredDomainField = bundledDomainField ?? first.field;
      const x = manifest.fields.find((candidate) => candidate.id === preferredDomainField && candidate.roles.includes('x'))
        ?? manifest.fields.find((candidate) => candidate.roles.includes('x'));
      const hasCapacity = used.has(manifest.id) || definition.sources.length < 4;
      const signature = domainSignature(x?.kind ?? 'time', x?.id ?? 'timestamp', x?.unit);
      const compatible = definition.series.length === 0 || signature === currentSignature;
      const belowCurveLimit = definition.series.length < 12;
      options.push({ id: `field:${manifest.id}:${field.id}`, label: field.label, category: manifest.category, description: `${manifest.label} · ${field.unit ?? 'unitless'}`, sourceId: manifest.id, field: field.id, domainKey: x?.id ?? 'timestamp', domainLabel: x?.label ?? 'Time', domainKind: x?.kind ?? 'time', domainSignature: signature, ...(x?.unit ? { domainUnit: x.unit } : {}), enabled: hasCapacity && compatible && belowCurveLimit, ...(!belowCurveLimit ? { disabledReason: 'A chart can contain up to twelve curves.' } : !hasCapacity ? { disabledReason: 'This would exceed the four data groups limit.' } : !compatible ? { disabledReason: `This curve uses ${x?.label ?? 'a different'} values; the chart is plotted over ${first.label}.` } : {}) });
    }
  }
  return options.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

function bundledDomainForCurve(sourceId: string, field: string) {
  for (const definition of BUNDLED_CHART_DEFINITIONS) {
    const curve = definition.series.find((series) => {
      const binding = definition.sources.find((source) => source.id === series.y.sourceBindingId);
      return binding?.sourceId === sourceId && series.y.field === field;
    });
    if (!curve) continue;
    const domainRef = curve.x ?? definition.x.field;
    const domainBinding = definition.sources.find((source) => source.id === domainRef.sourceBindingId);
    if (domainBinding?.sourceId === sourceId) return domainRef.field;
  }
  return null;
}

export function domainSignature(kind: 'time' | 'number' | 'category', field: string, unit?: string) {
  return kind === 'time' ? 'time' : `${kind}:${field}:${unit ?? ''}`;
}

export function sharedDomain(definition: ChartDefinitionV1, manifests: readonly ChartSourceManifest[]) {
  const binding = definition.sources.find((source) => source.id === definition.x.field.sourceBindingId);
  const manifest = manifests.find((candidate) => candidate.id === binding?.sourceId);
  const field = manifest?.fields.find((candidate) => candidate.id === definition.x.field.field);
  return { kind: field?.kind ?? definition.x.kind, field: field?.id ?? definition.x.field.field, label: field?.label ?? definition.x.field.field, unit: field?.unit };
}

export function isMixedDomain(definition: ChartDefinitionV1, manifests: readonly ChartSourceManifest[] = []) {
  const primary = sharedDomain(definition, manifests);
  const primarySignature = domainSignature(primary.kind, primary.field, primary.unit);
  return definition.series.some((series: ChartSeriesDefinition) => {
    if (!series.x) return false;
    const binding = definition.sources.find((source) => source.id === series.x?.sourceBindingId);
    const manifest = manifests.find((candidate) => candidate.id === binding?.sourceId);
    const field = manifest?.fields.find((candidate) => candidate.id === series.x?.field);
    return domainSignature(field?.kind ?? definition.x.kind, field?.id ?? series.x.field, field?.unit) !== primarySignature;
  });
}

export function removeCurveAndUnusedSources(definition: ChartDefinitionV1, index: number): ChartDefinitionV1 {
  const removedCurve = definition.series[index];
  const series = definition.series.filter((_, seriesIndex) => seriesIndex !== index);
  const allCurvesHaveExplicitX = !removedCurve?.x && series.length > 0 && series.every((curve) => curve.x);
  const rebasedX = allCurvesHaveExplicitX ? series[0]!.x : undefined;
  const referenced = new Set([
    ...(series.length > 0 ? [rebasedX?.sourceBindingId ?? definition.x.field.sourceBindingId] : []),
    ...series.flatMap((curve) => [curve.y.sourceBindingId, ...(curve.x ? [curve.x.sourceBindingId] : [])]),
  ]);
  return {
    ...definition,
    ...(rebasedX ? { x: { ...definition.x, field: rebasedX } } : {}),
    series,
    sources: definition.sources.filter((source) => referenced.has(source.id)),
  };
}
