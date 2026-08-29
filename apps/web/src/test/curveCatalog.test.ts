import { describe, expect, it } from 'vitest';
import { buildCurveCatalog, isMixedDomain, removeCurveAndUnusedSources, sharedDomain, CHART_SOURCE_MANIFESTS, getBundledChartDefinition } from '@riviamigo/dashboards';

describe('curve-first chart catalog', () => {
  const definition = getBundledChartDefinition('soc-history')!;

  it('groups searchable metric and specialized values by category', () => {
    const catalog = buildCurveCatalog(CHART_SOURCE_MANIFESTS, [{ id: 'battery_level', label: 'State of Charge', unit: '%', kind: 'percent', source: 'telemetry', supports_series: true, default_aggregation: 'latest' }], definition);
    expect(catalog.some((option) => option.id === 'metric:battery_level' && option.category === 'telemetry')).toBe(true);
    expect(catalog.some((option) => option.id === 'field:battery.mileage:projected_max_range_mi')).toBe(true);
  });

  it('infers the existing shared domain and flags legacy mixed domains', () => {
    expect(sharedDomain(definition, CHART_SOURCE_MANIFESTS)).toMatchObject({ kind: 'time', field: 'timestamp' });
    expect(isMixedDomain({ ...definition, series: [{ ...definition.series[0]!, x: { sourceBindingId: 'main', field: 'odometer_miles' } }] }, CHART_SOURCE_MANIFESTS)).toBe(true);
  });

  it('disables new groups once four distinct source groups are used', () => {
    const four = { ...definition, sources: ['a', 'b', 'c', 'd'].map((id, i) => ({ ...definition.sources[0]!, id, sourceId: ['battery.mileage', 'battery.degradation', 'charging.sessions', 'efficiency.trend'][i]! })) };
    const option = buildCurveCatalog(CHART_SOURCE_MANIFESTS, [], four).find((item) => item.sourceId === 'trips.tire-pressure-timeline');
    expect(option?.enabled).toBe(false);
    expect(option?.disabledReason).toContain('four data groups');
  });

  it('keeps numeric domains semantically compatible instead of treating every number as interchangeable', () => {
    const mileage = getBundledChartDefinition('projected-range-mileage')!;
    const catalog = buildCurveCatalog(CHART_SOURCE_MANIFESTS, [], mileage);
    expect(catalog.find((item) => item.id === 'field:battery.mileage:usable_kwh')?.enabled).toBe(true);
    expect(catalog.find((item) => item.id === 'field:charging.charge-curve:power_kw')?.enabled).toBe(false);
    expect(catalog.find((item) => item.id === 'field:efficiency.temperature:avg_efficiency_wh_mi')?.enabled).toBe(false);
  });

  it('uses the established bundled domain when the first curve defines a new chart', () => {
    const empty = { ...definition, series: [] };
    const projectedRange = buildCurveCatalog(CHART_SOURCE_MANIFESTS, [], empty).find((item) => item.id === 'field:battery.mileage:projected_max_range_mi');
    expect(projectedRange).toMatchObject({ domainKey: 'odometer_miles', domainKind: 'number', domainUnit: 'mi' });
  });

  it('releases an unreferenced data group when its last curve is removed', () => {
    const extraSource = { ...definition.sources[0]!, id: 'extra', params: { metric: 'range_miles' } };
    const withExtra = { ...definition, sources: [...definition.sources, extraSource], series: [...definition.series, { ...definition.series[0]!, id: 'range', y: { sourceBindingId: 'extra', field: 'range_miles' } }] };
    const removed = removeCurveAndUnusedSources(withExtra, withExtra.series.length - 1);
    expect(removed.sources.some((source) => source.id === 'extra')).toBe(false);
    expect(removed.sources.some((source) => source.id === definition.x.field.sourceBindingId)).toBe(true);
  });

  it('rebases the global domain when the remaining curves have explicit x refs', () => {
    const withExplicitDomain = {
      ...definition,
      sources: [
        ...definition.sources,
        { ...definition.sources[0]!, id: 'secondary', sourceId: 'battery.mileage' },
      ],
      series: [
        { ...definition.series[0]!, id: 'global', y: { sourceBindingId: 'main', field: 'battery_level' } },
        { ...definition.series[0]!, id: 'explicit', y: { sourceBindingId: 'secondary', field: 'battery_level' }, x: { sourceBindingId: 'secondary', field: 'odometer_miles' } },
      ],
    };
    const removed = removeCurveAndUnusedSources(withExplicitDomain, 0);
    expect(removed.x).toMatchObject({ field: { sourceBindingId: 'secondary', field: 'odometer_miles' } });
    expect(removed.sources.map((source) => source.id)).toEqual(['secondary']);
  });
});
