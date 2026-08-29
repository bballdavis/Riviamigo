import type { ChartDefinitionV1 } from '@riviamigo/types';
import type { WidgetDef } from '../registry';
import bundledRendererData from './bundled-renderers.json';
import { BUNDLED_CHART_DEFINITIONS } from './defaults';
import { ChartDefinitionV1Schema } from './schema';

export type DashboardChartPage = 'overview' | 'battery' | 'charging' | 'efficiency' | 'trips';

export type DashboardChartSource =
  | 'soc_history'
  | 'charging_sessions_energy'
  | 'charging_weekly_energy'
  | 'charge_session_curve'
  | 'charging_curve_analysis'
  | 'efficiency_trend'
  | 'efficiency_temperature'
  | 'efficiency_mode'
  | 'efficiency_tags'
  | 'phantom_drain'
  | 'battery_degradation'
  | 'battery_capacity_mileage'
  | 'projected_range_mileage'
  | 'tire_pressure_trips';

export interface DashboardChartDefinition {
  id: string;
  title: string;
  description?: string;
  pages: DashboardChartPage[];
  source: DashboardChartSource;
  config: ChartDefinitionV1;
  mode?: 'line' | 'area' | 'bar' | 'scatter';
  yUnit?: string;
  yRange?: [number, number];
  stepInterpolation?: boolean;
  defaultSize?: WidgetDef['defaultSize'];
  minSize?: WidgetDef['minSize'];
  emptyTitle?: string;
}

export type DashboardChartAxisId = 'x' | 'y' | 'y2';
export type DashboardChartXDomainSource = 'dashboard-timeframe' | 'chart-local';

export interface DashboardChartAxisCapability {
  label: string;
  unit?: string;
}

export interface DashboardChartSettingsCapabilities {
  timeFilter: boolean;
  smoothness?: boolean;
  axes: Partial<Record<DashboardChartAxisId, DashboardChartAxisCapability>>;
  xDomainSource: DashboardChartXDomainSource;
}

export function supportsDashboardChartSmoothness(definition: DashboardChartDefinition): boolean {
  return definition.mode === 'line' || definition.mode === 'area';
}

type DashboardChartRouting = Pick<DashboardChartDefinition, 'source' | 'defaultSize' | 'minSize'>;

/**
 * Renderer routing and widget layout are application metadata, not a second
 * chart configuration. Every visual/data setting comes from ChartDefinitionV1.
 */
const CHART_ROUTING: Record<string, DashboardChartRouting> = {
  'battery-capacity-mileage': {
    source: 'battery_capacity_mileage',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'battery-degradation': {
    source: 'battery_degradation',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'charge-level': { source: 'soc_history', defaultSize: { w: 12, h: 4 }, minSize: { w: 4, h: 3 } },
  'charging-curve-analysis': {
    source: 'charging_curve_analysis',
    defaultSize: { w: 12, h: 6 },
    minSize: { w: 6, h: 5 },
  },
  'charging-sessions-energy': {
    source: 'charging_sessions_energy',
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'charging-weekly-energy': {
    source: 'charging_weekly_energy',
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'efficiency-mode': {
    source: 'efficiency_mode',
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'efficiency-tags': {
    source: 'efficiency_tags',
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'efficiency-temperature': {
    source: 'efficiency_temperature',
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'efficiency-trend': {
    source: 'efficiency_trend',
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'phantom-drain': {
    source: 'phantom_drain',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'projected-range-mileage': {
    source: 'projected_range_mileage',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'soc-history': { source: 'soc_history', defaultSize: { w: 6, h: 4 }, minSize: { w: 4, h: 3 } },
  'tire-pressure-trips': {
    source: 'tire_pressure_trips',
    defaultSize: { w: 12, h: 7 },
    minSize: { w: 6, h: 5 },
  },
};

/**
 * Fields the established renderer for each bundled chart can consume. This is
 * an editor capability boundary, not visual configuration: it prevents a
 * valid database definition from offering a curve the selected production
 * component would have no semantic slot for.
 */
export type BundledRendererCapability = {
  slug: string;
  source: DashboardChartSource;
  renderer: string;
  editing: 'rich' | 'color';
  x: { sourceId: string; field: string; kind: ChartDefinitionV1['x']['kind'] };
  curves: readonly { sourceId: string; field: string }[];
};

export const BUNDLED_RENDERER_CAPABILITIES = bundledRendererData as BundledRendererCapability[];
const bundledCapabilityBySlug = new Map(
  BUNDLED_RENDERER_CAPABILITIES.map((capability) => [capability.slug, capability])
);

export function getBundledRendererFields(slug: string): readonly string[] | undefined {
  return bundledCapabilityBySlug.get(slug)?.curves.map((curve) => curve.field);
}

export function supportsBundledRendererCurve(
  slug: string,
  sourceId: string,
  field: string | undefined
): boolean | undefined {
  const supported = bundledCapabilityBySlug.get(slug)?.curves;
  return supported
    ? field !== undefined &&
        supported.some((curve) => curve.sourceId === sourceId && curve.field === field)
    : undefined;
}

export function supportsBundledRichEditing(slug: string): boolean | undefined {
  const capability = bundledCapabilityBySlug.get(slug);
  return capability ? capability.editing === 'rich' : undefined;
}

function sameConfigValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateBundledRendererDefinition(
  slug: string,
  definition: ChartDefinitionV1
): Array<{ path: string; message: string }> {
  const capability = bundledCapabilityBySlug.get(slug);
  if (!capability) return [];
  const errors: Array<{ path: string; message: string }> = [];
  const canonical = BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === slug);
  const xBinding = definition.sources.find(
    (source) => source.id === definition.x.field.sourceBindingId
  );
  if (
    !xBinding ||
    xBinding.sourceId !== capability.x.sourceId ||
    definition.x.field.field !== capability.x.field ||
    definition.x.kind !== capability.x.kind
  ) {
    errors.push({
      path: 'config.x',
      message: `The ${slug} production renderer requires ${capability.x.kind} X data from ${capability.x.sourceId}.${capability.x.field}.`,
    });
  }
  if (canonical) {
    if (!sameConfigValue(definition.timeframe, canonical.timeframe)) {
      errors.push({
        path: 'config.timeframe',
        message: 'Bundled charts inherit the active dashboard timeframe so preview and dashboard data stay identical.',
      });
    }
    for (const axisId of ['x', 'y', 'y2'] as const) {
      if (definition.axes[axisId]?.unit !== canonical.axes[axisId]?.unit) {
        errors.push({
          path: `config.axes.${axisId}.unit`,
          message: 'Bundled renderer units are owned by the production data adapter.',
        });
      }
    }
    if (
      definition.display.emptyTitle !== canonical.display.emptyTitle ||
      definition.display.emptyDescription !== canonical.display.emptyDescription
    ) {
      errors.push({
        path: 'config.display.emptyTitle',
        message: 'Bundled empty-state copy is owned by the production renderer.',
      });
    }
    if (definition.rendererId !== canonical.rendererId) {
      errors.push({
        path: 'config.rendererId',
        message: 'Bundled renderer selection cannot be changed.',
      });
    }
  }
  if (canonical && capability.editing !== 'rich') {
    if (!sameConfigValue(definition.sources, canonical.sources)) {
      errors.push({
        path: 'config.sources',
        message: 'This bundled renderer owns its data bindings; duplicate the chart to build a custom source configuration.',
      });
    }
    const withoutColors = (series: ChartDefinitionV1['series']) =>
      series.map(({ color: _color, ...item }) => item);
    if (!sameConfigValue(withoutColors(definition.series), withoutColors(canonical.series))) {
      errors.push({
        path: 'config.series',
        message: 'This bundled renderer supports curve color edits only; its curve order, labels, marks, and axes are fixed.',
      });
    }
    if (!sameConfigValue(definition.x, canonical.x)) {
      errors.push({
        path: 'config.x',
        message: 'This bundled renderer owns its X-axis encoding.',
      });
    }
    const comparableAxes = structuredClone(definition.axes);
    const canonicalAxes = structuredClone(canonical.axes);
    const supportsYDomain = [
      'daily-charge-sessions',
      'daily-energy-bars',
      'phantom-drain',
      'tire-pressure-timeline',
    ].includes(capability.renderer);
    if (supportsYDomain) comparableAxes.y.domain = canonicalAxes.y.domain;
    if (!sameConfigValue(comparableAxes, canonicalAxes)) {
      errors.push({
        path: 'config.axes',
        message: 'This bundled renderer supports only its production axis contract; use dashboard chart settings for a temporary range.',
      });
    }
    if (!sameConfigValue(definition.display, canonical.display)) {
      errors.push({
        path: 'config.display',
        message: 'This bundled renderer owns its legend, grid, tooltip, and smoothing presentation.',
      });
    }
    if (!sameConfigValue(definition.interaction, canonical.interaction)) {
      errors.push({
        path: 'config.interaction',
        message: 'This bundled renderer owns its interaction behavior.',
      });
    }
  }
  definition.series.forEach((series, index) => {
    const binding = definition.sources.find((source) => source.id === series.y.sourceBindingId);
    if (
      !binding ||
      !capability.curves.some(
        (curve) => curve.sourceId === binding.sourceId && curve.field === series.y.field
      )
    ) {
      errors.push({
        path: `config.series.${index}.y`,
        message: `The ${slug} production renderer does not support this curve.`,
      });
    }
    if (series.x) errors.push({ path: `config.series.${index}.x`, message: 'Per-series X fields are supported only by independent custom charts.' });
    if (series.transforms.some((transform) => transform.kind !== 'none'))
      errors.push({ path: `config.series.${index}.transforms`, message: 'Transforms are not supported by bundled production renderers.' });
    if (series.stackId && series.mark !== 'bar' && series.mark !== 'histogram')
      errors.push({ path: `config.series.${index}.stackId`, message: 'Stacking is supported only for bar or histogram curves.' });
    if (series.connectGaps !== undefined)
      errors.push({ path: `config.series.${index}.connectGaps`, message: 'Use the chart-level connectGaps setting for bundled charts.' });
    if (series.valueFormat !== undefined)
      errors.push({ path: `config.series.${index}.valueFormat`, message: 'Per-curve value formatting is not supported by bundled production renderers.' });
  });
  if (definition.annotations && definition.annotations.length > 0)
    errors.push({ path: 'config.annotations', message: 'Annotations are supported only by independent custom charts.' });
  if (definition.display.dataSmoothing)
    errors.push({ path: 'config.display.dataSmoothing', message: 'Use curve smoothness for bundled production renderers.' });
  if (!definition.interaction.panZoom)
    errors.push({ path: 'config.interaction.panZoom', message: 'Bundled production charts require pan and zoom.' });
  if (!definition.interaction.touchExplore)
    errors.push({ path: 'config.interaction.touchExplore', message: 'Bundled production charts require touch exploration.' });
  for (const [axisId, axis] of Object.entries(definition.axes)) {
    if (axis?.scale === 'log')
      errors.push({ path: `config.axes.${axisId}.scale`, message: 'Logarithmic axes are not supported by bundled production renderers.' });
    if (axis?.tickFormat)
      errors.push({ path: `config.axes.${axisId}.tickFormat`, message: 'Custom tick formats are not supported by bundled production renderers.' });
  }
  return errors;
}

const definitions = BUNDLED_CHART_DEFINITIONS.map((chart) => normalizeChartDefinition(chart)).sort(
  (a, b) => a.title.localeCompare(b.title)
);

const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));

export function getChartDefinitions(page?: DashboardChartPage): DashboardChartDefinition[] {
  if (!page) return definitions;
  return definitions.filter((definition) => definition.pages.includes(page));
}

export function getChartDefinition(
  id: string | null | undefined
): DashboardChartDefinition | undefined {
  return id ? definitionById.get(id) : undefined;
}

export function getChartOptions(page?: DashboardChartPage) {
  return getChartDefinitions(page).map((definition) => ({
    value: definition.id,
    label: definition.title,
  }));
}

export function getChartSettingsCapabilities(
  definition: DashboardChartDefinition
): DashboardChartSettingsCapabilities {
  switch (definition.source) {
    case 'soc_history':
      return {
        timeFilter: true,
        axes: {
          y: axisCapability('State of Charge', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'charging_weekly_energy':
      return {
        timeFilter: false,
        axes: {
          y: axisCapability('Energy charged', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'charge_session_curve':
      return {
        timeFilter: true,
        axes: {
          y: { label: 'Charge rate', unit: 'kW' },
          y2: { label: 'Energy added', unit: 'kWh' },
        },
        xDomainSource: 'chart-local',
      };
    case 'charging_curve_analysis':
      return {
        timeFilter: false,
        axes: {
          x: { label: 'Charge level', unit: '%' },
          y: { label: 'Charge rate', unit: 'kW' },
        },
        xDomainSource: 'chart-local',
      };
    case 'efficiency_trend':
      return {
        timeFilter: true,
        axes: {
          y: { label: 'Efficiency' },
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'phantom_drain':
      return {
        timeFilter: false,
        axes: {
          y: axisCapability('Drain rate', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'battery_degradation':
      return {
        timeFilter: true,
        axes: {
          y: axisCapability('Battery health', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'battery_capacity_mileage':
      return {
        timeFilter: true,
        axes: {
          y: axisCapability('Usable capacity', definition.yUnit),
          y2: { label: 'Mileage', unit: 'mi' },
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'projected_range_mileage':
      return {
        timeFilter: true,
        axes: {
          y: axisCapability('Projected max range', definition.yUnit),
          y2: { label: 'Mileage', unit: 'mi' },
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'tire_pressure_trips':
      return {
        timeFilter: false,
        axes: {
          y: axisCapability('Tire pressure', definition.yUnit),
          y2: { label: 'Trips', unit: 'Trips' },
        },
        xDomainSource: 'dashboard-timeframe',
      };
    default:
      return {
        timeFilter: false,
        axes: {},
        xDomainSource: 'dashboard-timeframe',
      };
  }
}

function axisCapability(label: string, unit?: string): DashboardChartAxisCapability {
  return unit ? { label, unit } : { label };
}

function normalizeChartDefinition(
  chart: (typeof BUNDLED_CHART_DEFINITIONS)[number]
): DashboardChartDefinition {
  const routing = CHART_ROUTING[chart.slug];
  if (!routing) throw new Error(`Missing renderer routing for bundled chart: ${chart.slug}`);
  const primarySeries = chart.series[0];
  const primaryAxis = primarySeries?.yAxis === 'y2' ? chart.axes.y2 : chart.axes.y;
  const yRange = fixedRange(primaryAxis);
  const config = ChartDefinitionV1Schema.parse(chart) as unknown as ChartDefinitionV1;
  return {
    id: chart.slug,
    title: chart.title,
    description: chart.description,
    pages: chart.placements
      .map((placement) => placement.dashboardSlug)
      .filter(isDashboardChartPage),
    source: routing.source,
    config,
    mode: seriesMode(primarySeries),
    ...(primaryAxis?.unit ? { yUnit: primaryAxis.unit } : {}),
    ...(yRange ? { yRange } : {}),
    stepInterpolation: primarySeries?.mark === 'step',
    defaultSize: routing.defaultSize ?? { w: 12, h: 8 },
    minSize: routing.minSize ?? { w: 4, h: 6 },
    ...(chart.display.emptyTitle ? { emptyTitle: chart.display.emptyTitle } : {}),
  };
}

function isDashboardChartPage(value: string): value is DashboardChartPage {
  return (
    value === 'overview' ||
    value === 'battery' ||
    value === 'charging' ||
    value === 'efficiency' ||
    value === 'trips'
  );
}

function seriesMode(
  series: ChartDefinitionV1['series'][number] | undefined
): NonNullable<DashboardChartDefinition['mode']> {
  if (!series) return 'line';
  if (series.mark === 'area' || series.fill) return 'area';
  if (series.mark === 'bar' || series.mark === 'scatter') return series.mark;
  return 'line';
}

function fixedRange(
  axis: ChartDefinitionV1['axes']['y'] | undefined
): [number, number] | undefined {
  return axis?.domain.mode === 'fixed' ? [axis.domain.min, axis.domain.max] : undefined;
}
