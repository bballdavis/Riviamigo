import type { WidgetDef } from '../registry';

export type DashboardChartPage = 'overview' | 'battery' | 'charging' | 'efficiency' | 'trips';

export type DashboardChartSource =
  | 'soc_history'
  | 'range_history'
  | 'charging_sessions_energy'
  | 'charging_weekly_energy'
  | 'charge_session_curve'
  | 'charging_curve_analysis'
  | 'efficiency_trend'
  | 'efficiency_temperature'
  | 'efficiency_mode'
  | 'phantom_drain'
  | 'battery_degradation'
  | 'battery_capacity_mileage'
  | 'projected_range_mileage';

export interface DashboardChartDefinition {
  id: string;
  title: string;
  description?: string;
  pages: DashboardChartPage[];
  source: DashboardChartSource;
  mode?: 'line' | 'area' | 'bar' | 'scatter';
  yUnit?: string;
  yRange?: [number, number];
  stepInterpolation?: boolean;
  defaultSize?: WidgetDef['defaultSize'];
  minSize?: WidgetDef['minSize'];
  emptyTitle?: string;
}

const rawModules = import.meta.glob<DashboardChartDefinition>('./definitions/*.chart.json', {
  eager: true,
  import: 'default',
});

const definitions = Object.values(rawModules)
  .map(normalizeChartDefinition)
  .sort((a, b) => a.title.localeCompare(b.title));

const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));

export function getChartDefinitions(page?: DashboardChartPage): DashboardChartDefinition[] {
  if (!page) return definitions;
  return definitions.filter((definition) => definition.pages.includes(page));
}

export function getChartDefinition(id: string | null | undefined): DashboardChartDefinition | undefined {
  return id ? definitionById.get(id) : undefined;
}

export function getChartOptions(page?: DashboardChartPage) {
  return getChartDefinitions(page).map((definition) => ({
    value: definition.id,
    label: definition.title,
  }));
}

function normalizeChartDefinition(definition: DashboardChartDefinition): DashboardChartDefinition {
  if (!definition.id || !definition.title || !definition.source) {
    throw new Error(`Invalid dashboard chart definition: ${JSON.stringify(definition)}`);
  }

  return {
    ...definition,
    pages: Array.isArray(definition.pages) && definition.pages.length > 0 ? definition.pages : ['overview'],
    mode: definition.mode ?? 'line',
    defaultSize: definition.defaultSize ?? { w: 12, h: 8 },
    minSize: definition.minSize ?? { w: 4, h: 6 },
  };
}
