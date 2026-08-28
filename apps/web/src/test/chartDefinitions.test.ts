import { describe, expect, it } from 'vitest';
import canonicalSeeds from '../../../../packages/dashboards/src/charts/defaults/defaults.json';
import {
  BUNDLED_CHART_DEFINITIONS,
  BUNDLED_CHART_SLUGS,
  CHART_SOURCE_MANIFESTS,
  ChartDefinitionV1Schema,
  buildChartManagerEntries,
  resolveAssignedCharts,
  exportChartYaml,
  parseChartYaml,
  parseSafeMathExpression,
  resolveSafeExpression,
  validateChartDefinitionAgainstSources,
} from '@riviamigo/dashboards';
import type { ChartRecord } from '@riviamigo/types';

describe('managed chart contracts', () => {
  it('keeps every bundled chart slug stable and complete', () => {
    expect(BUNDLED_CHART_SLUGS).toHaveLength(15);
    expect(new Set(BUNDLED_CHART_SLUGS).size).toBe(15);
    for (const chart of BUNDLED_CHART_DEFINITIONS) {
      const { slug: _slug, title: _title, description: _description, ...definition } = chart;
      expect(ChartDefinitionV1Schema.parse(definition)).toEqual(definition);
      expect(validateChartDefinitionAgainstSources(definition, [...CHART_SOURCE_MANIFESTS])).toEqual([]);
    }
  });

  it('round-trips a definition without changing its portable shape', () => {
    const source = BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === 'soc-history');
    if (!source) throw new Error('soc-history default is missing');
    const { slug: _slug, title: _title, description: _description, ...definition } = source;
    expect(ChartDefinitionV1Schema.parse(JSON.parse(JSON.stringify(definition)))).toEqual(definition);
  });

  it('keeps the API seed inventory synchronized with the frontend slug inventory', () => {
    expect(canonicalSeeds).toHaveLength(BUNDLED_CHART_SLUGS.length);
    expect(new Set(canonicalSeeds.map((chart) => chart.slug))).toEqual(new Set(BUNDLED_CHART_SLUGS));
    for (const chart of canonicalSeeds) expect(() => ChartDefinitionV1Schema.parse(chart.definition)).not.toThrow();
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
    const bundled = BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === 'soc-history');
    if (!bundled) throw new Error('soc-history default is missing');
    const { slug, title, description, ...config } = bundled;
    const yaml = exportChartYaml({ id: 'internal', ownerId: null, slug, name: title, description, isDefault: true, isLocked: true, isEnabled: true, config });
    const parsed = parseChartYaml(yaml);
    expect(parsed.chart.slug).toBe('soc-history');
    expect(parsed.chart.definition.schemaVersion).toBe(1);
    expect(yaml).not.toContain('internal');
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
