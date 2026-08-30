import { describe, expect, it } from 'vitest';
import canonicalSeeds from '../../../../packages/dashboards/src/charts/defaults/defaults.json';
import {
  BUNDLED_CHART_DEFINITIONS,
  BUNDLED_CHART_SLUGS,
  BUNDLED_RENDERER_CAPABILITIES,
  getChartDefinition,
  normalizeLegacyBundledChartRecord,
  CHART_SOURCE_MANIFESTS,
  ChartDefinitionV1Schema,
  buildChartManagerEntries,
  resolveAssignedCharts,
  resolveChartSourceCapabilities,
  exportChartJson,
  parseChartJson,
  parseSafeMathExpression,
  resolveSafeExpression,
  validateChartDefinitionAgainstSources,
  validateBundledRendererDefinition,
  supportsBundledRichEditing,
} from '@riviamigo/dashboards';
import type { ChartRecord } from '@riviamigo/types';

function firstBaselineMileageConfig({
  primaryField,
  primaryLabel,
  primaryUnit,
  primaryToken,
  showPoints,
}: {
  primaryField: string;
  primaryLabel: string;
  primaryUnit: string;
  primaryToken: 'accent' | 'emerald' | 'violet';
  showPoints?: boolean;
}): ChartRecord['config'] {
  return {
    schemaVersion: 1,
    placements: [{ dashboardSlug: 'overview' }, { dashboardSlug: 'battery' }],
    timeframe: { mode: 'dashboard' },
    sources: [{ id: 'main', sourceId: 'battery.mileage', params: {}, filters: [], inherit: { vehicle: true, timeframe: true } }],
    x: { field: { sourceBindingId: 'main', field: 'odometer_miles' }, kind: 'number' },
    series: [{ id: primaryField, label: primaryLabel, y: { sourceBindingId: 'main', field: primaryField }, mark: 'line', yAxis: 'y', color: { mode: 'token', token: primaryToken }, transforms: [], visibleInLegend: true }],
    axes: { x: { scale: 'linear', domain: { mode: 'auto' } }, y: { scale: 'linear', unit: primaryUnit, domain: { mode: 'auto' } } },
    display: { legend: 'hide', grid: true, tooltip: true, timeFilter: 'raw', curveSmoothness: 'gentle', ...(showPoints ? { showPoints: true } : {}) },
    interaction: { panZoom: true, touchExplore: true, connectGaps: false },
  };
}

describe('managed chart contracts', () => {
  it('keeps every bundled chart slug stable and complete', () => {
    expect(BUNDLED_CHART_SLUGS).toHaveLength(14);
    expect(new Set(BUNDLED_CHART_SLUGS).size).toBe(14);
    expect(BUNDLED_CHART_SLUGS).not.toContain('charge-session-curve');
    for (const chart of BUNDLED_CHART_DEFINITIONS) {
      const definition = ChartDefinitionV1Schema.parse(chart) as ChartRecord['config'];
      expect(ChartDefinitionV1Schema.parse(definition)).toEqual(definition);
      expect(validateChartDefinitionAgainstSources(definition, [...CHART_SOURCE_MANIFESTS])).toEqual([]);
    }
  });

  it('assigns every bundled chart to Overview by default', () => {
    for (const chart of BUNDLED_CHART_DEFINITIONS) {
      expect(chart.placements).toContainEqual({ dashboardSlug: 'overview' });
    }
  });

  it('uses the bundled ChartDefinitionV1 as the only visual configuration catalog', () => {
    for (const chart of BUNDLED_CHART_DEFINITIONS) {
      const config = ChartDefinitionV1Schema.parse(chart) as ChartRecord['config'];
      expect(getChartDefinition(chart.slug)?.config).toEqual(config);
    }
  });

  it('expands metric series fields from the queryable metric catalog', () => {
    const manifests = resolveChartSourceCapabilities([...CHART_SOURCE_MANIFESTS], [{ id: 'computed_metric', label: 'Computed Metric', unit: 'kWh', kind: 'energy', source: 'summary', supports_series: true, default_aggregation: 'sum' }]);
    const metrics = manifests.find((manifest) => manifest.id === 'metrics.series');
    expect(metrics?.fields).toContainEqual(expect.objectContaining({ id: 'computed_metric', roles: ['y', 'detail'] }));
    expect(metrics?.parameters.find((parameter) => parameter.id === 'metric')?.options).toContain('computed_metric');
  });

  it('round-trips a definition without changing its portable shape', () => {
    const source = BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === 'soc-history');
    if (!source) throw new Error('soc-history default is missing');
    const definition = ChartDefinitionV1Schema.parse(source) as ChartRecord['config'];
    expect(ChartDefinitionV1Schema.parse(JSON.parse(JSON.stringify(definition)))).toEqual(definition);
  });

  it('keeps the API seed inventory synchronized with the frontend slug inventory', () => {
    expect(canonicalSeeds).toHaveLength(BUNDLED_CHART_SLUGS.length);
    expect(new Set(canonicalSeeds.map((chart) => chart.slug))).toEqual(new Set(BUNDLED_CHART_SLUGS));
    for (const chart of canonicalSeeds) expect(() => ChartDefinitionV1Schema.parse(chart.definition)).not.toThrow();
  });

  it('seeds Battery Capacity as two ordinary time-domain curves', () => {
    const battery = canonicalSeeds.find((chart) => chart.slug === 'battery-capacity-mileage');
    if (!battery) throw new Error('battery-capacity-mileage default is missing');
    expect(battery.definition.x).toEqual({ field: { sourceBindingId: 'main', field: 'timestamp' }, kind: 'time' });
    expect(battery.definition.series).toEqual([
      expect.objectContaining({ id: 'usable_kwh', label: 'Usable Capacity', mark: 'line', fill: true, yAxis: 'y', color: { mode: 'token', token: 'accent' } }),
      expect.objectContaining({ id: 'odometer_miles', label: 'Mileage', mark: 'line', fill: false, yAxis: 'y2', color: { mode: 'token', token: 'emerald' } }),
    ]);
    expect(battery.definition.axes.y2).toEqual(expect.objectContaining({ unit: 'mi' }));
  });

  it('repairs the incomplete first persisted mileage-chart baseline idempotently', () => {
    const bundled = BUNDLED_CHART_DEFINITIONS.find(
      (chart) => chart.slug === 'battery-capacity-mileage'
    );
    if (!bundled) throw new Error('battery-capacity-mileage default is missing');
    const { slug, title, description } = bundled;
    const legacy = {
      id: 'legacy',
      ownerId: 'user-1',
      slug,
      name: title,
      description,
      isDefault: false,
      isLocked: false,
      isEnabled: true,
      config: firstBaselineMileageConfig({ primaryField: 'usable_kwh', primaryLabel: 'Usable Capacity', primaryUnit: 'kWh', primaryToken: 'violet', showPoints: true }),
    } satisfies ChartRecord;
    legacy.config.timeframe = { mode: 'relative', preset: '7d' };

    const repaired = normalizeLegacyBundledChartRecord(legacy);
    expect(repaired).not.toBe(legacy);
    expect(repaired.config.x.kind).toBe('time');
    expect(repaired.config.x.field.field).toBe('timestamp');
    expect(repaired.config.timeframe).toEqual({ mode: 'dashboard' });
    expect(repaired.config.series).toEqual([
      expect.objectContaining({
        y: expect.objectContaining({ field: 'usable_kwh' }),
        fill: true,
        color: { mode: 'token', token: 'violet' },
      }),
      expect.objectContaining({
        y: expect.objectContaining({ field: 'odometer_miles' }),
        yAxis: 'y2',
      }),
    ]);
    expect(normalizeLegacyBundledChartRecord(repaired)).toBe(repaired);

    const projected = {
      ...legacy,
      id: 'legacy-projected',
      slug: 'projected-range-mileage',
      name: 'Projected Range by Mileage',
      config: firstBaselineMileageConfig({ primaryField: 'projected_max_range_mi', primaryLabel: 'Projected Range', primaryUnit: 'mi', primaryToken: 'emerald' }),
    } satisfies ChartRecord;
    const repairedProjected = normalizeLegacyBundledChartRecord(projected);
    expect(repairedProjected.config.x).toEqual({ field: { sourceBindingId: 'main', field: 'timestamp' }, kind: 'time' });
    expect(repairedProjected.config.series.map((series) => series.y.field)).toEqual(['projected_max_range_mi', 'odometer_miles']);
    expect(repairedProjected.config.series[0]).toEqual(expect.objectContaining({ fill: true, color: { mode: 'token', token: 'emerald' } }));

    const intentionalOneCurveEdit = {
      ...legacy,
      config: {
        ...legacy.config,
        series: [{ ...legacy.config.series[0]!, mark: 'area' as const }],
      },
    };
    expect(normalizeLegacyBundledChartRecord(intentionalOneCurveEdit)).toBe(intentionalOneCurveEdit);
  });

  it('rejects invalid ranges and executable definition keys', () => {
    const source = BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === 'soc-history');
    if (!source) throw new Error('soc-history default is missing');
    const invalid = {
      ...source,
      axes: {
        ...source.axes,
        y: { ...source.axes.y, domain: { mode: 'fixed' as const, min: 100, max: 0 } },
      },
      sources: [{ ...source.sources[0]!, params: { javascript: 'return 1' } }],
    };
    expect(() => ChartDefinitionV1Schema.parse(invalid)).toThrow(/Fixed axis minimum|Executable/);
  });

  it('resolves a disabled personal override before filtering placements', () => {
    const bundled = BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === 'soc-history');
    if (!bundled) throw new Error('soc-history default is missing');
    const { slug, title, description, ...config } = bundled;
    const system: ChartRecord = { id: 'system', ownerId: null, slug, name: title, description, isDefault: true, isLocked: false, isEnabled: true, config };
    const personal: ChartRecord = { ...system, id: 'personal', ownerId: 'user-1', isDefault: false, isEnabled: false, config: { ...config, placements: [] } };
    const entries = buildChartManagerEntries([system, personal], 'user-1');
    expect(entries[0]?.origin).toBe('override');
    expect(entries[0]?.effective.isEnabled).toBe(false);
    expect(resolveAssignedCharts(entries, 'battery')).toEqual([]);
  });

  it('round-trips a portable chart document without database metadata', () => {
    const seed = canonicalSeeds.find((chart) => chart.slug === 'battery-capacity-mileage');
    if (!seed) throw new Error('battery-capacity-mileage default is missing');
    const config = ChartDefinitionV1Schema.parse(seed.definition) as ChartRecord['config'];
    const json = exportChartJson({ id: 'internal', ownerId: null, slug: seed.slug, name: seed.name, description: seed.description, isDefault: true, isLocked: true, isEnabled: true, config });
    const parsed = parseChartJson(json);
    expect(parsed.chart.slug).toBe('battery-capacity-mileage');
    expect(parsed.chart.definition.schemaVersion).toBe(1);
    expect(parsed.chart.definition).toEqual(config);
    expect(parsed.chart.definition.series.map((series) => ({ id: series.id, fill: series.fill, color: series.color, axis: series.yAxis }))).toEqual([
      { id: 'usable_kwh', fill: true, color: { mode: 'token', token: 'accent' }, axis: 'y' },
      { id: 'odometer_miles', fill: false, color: { mode: 'token', token: 'emerald' }, axis: 'y2' },
    ]);
    expect(JSON.parse(json)).toEqual(parsed);
    expect(json).not.toContain('internal');
  });

  it('keeps bundled defaults and the specialized renderer capability manifest in lockstep', () => {
    expect(BUNDLED_RENDERER_CAPABILITIES.map((item) => item.slug).sort()).toEqual(
      [...BUNDLED_CHART_SLUGS].sort()
    );
    expect(new Set(BUNDLED_RENDERER_CAPABILITIES.map((item) => item.slug)).size).toBe(
      BUNDLED_RENDERER_CAPABILITIES.length
    );
    for (const definition of BUNDLED_CHART_DEFINITIONS) {
      expect(validateBundledRendererDefinition(definition.slug, definition), definition.slug).toEqual([]);
    }
  });

  it('rejects bundled advanced properties that its specialized renderer cannot apply', () => {
    const bundled = BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === 'battery-capacity-mileage');
    if (!bundled) throw new Error('battery-capacity-mileage default is missing');
    const edited = structuredClone(bundled) as ChartRecord['config'];
    edited.timeframe = { mode: 'relative', preset: '7d' };
    edited.x.kind = 'number';
    edited.axes.y.unit = 'percent';
    edited.display.emptyTitle = 'Edited empty state';
    edited.rendererId = 'other-renderer';
    edited.series[0]!.transforms = [{ kind: 'scale', factor: 2 }];
    edited.series[0]!.x = { sourceBindingId: 'main', field: 'timestamp' };
    edited.annotations = [{
      kind: 'horizontal_reference_line',
      value: 100,
      color: { mode: 'token', token: 'accent' },
    }];
    expect(validateBundledRendererDefinition('battery-capacity-mileage', edited)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'config.x' }),
        expect.objectContaining({ path: 'config.timeframe' }),
        expect.objectContaining({ path: 'config.axes.y.unit' }),
        expect.objectContaining({ path: 'config.display.emptyTitle' }),
        expect.objectContaining({ path: 'config.rendererId' }),
        expect.objectContaining({ path: 'config.series.0.transforms' }),
        expect.objectContaining({ path: 'config.series.0.x' }),
        expect.objectContaining({ path: 'config.annotations' }),
      ])
    );
    expect(validateBundledRendererDefinition('independent-custom-chart', edited)).toEqual([]);
  });

  it('rejects visual edits that aggregate bundled renderers cannot apply', () => {
    const bundled = BUNDLED_CHART_DEFINITIONS.find(
      (chart) => chart.slug === 'charging-weekly-energy'
    );
    if (!bundled) throw new Error('charging-weekly-energy default is missing');
    const edited = structuredClone(bundled) as ChartRecord['config'];
    edited.series[0]!.mark = 'line';
    edited.display.grid = !edited.display.grid;
    expect(validateBundledRendererDefinition('charging-weekly-energy', edited)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'config.series' }),
        expect.objectContaining({ path: 'config.display' }),
      ])
    );
  });

  it('treats Charging Curve Analysis as fixed-geometry despite its rich chart primitive', () => {
    expect(supportsBundledRichEditing('charging-curve-analysis')).toBe(false);
    const bundled = BUNDLED_CHART_DEFINITIONS.find(
      (chart) => chart.slug === 'charging-curve-analysis'
    );
    if (!bundled) throw new Error('charging-curve-analysis default is missing');
    const edited = structuredClone(bundled) as ChartRecord['config'];
    edited.series[0]!.mark = 'line';
    edited.series[0]!.fill = true;
    expect(validateBundledRendererDefinition('charging-curve-analysis', edited)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'config.series' })])
    );
  });
});

describe('safe chart expressions', () => {
  it('supports bracket references, precedence, and unary signs', () => {
    expect(resolveSafeExpression('([battery.level] - 10) / 2', { battery: { level: 84 } })).toBe(37);
    expect(parseSafeMathExpression('-2 + 3 * 4')).toBe(10);
  });

  it('rejects missing values, division by zero, and executable syntax', () => {
    expect(resolveSafeExpression('[missing] + 1', {})).toBeNull();
    expect(parseSafeMathExpression('4 / 0')).toBeNull();
    expect(parseSafeMathExpression('globalThis.alert(1)')).toBeNull();
  });
});
