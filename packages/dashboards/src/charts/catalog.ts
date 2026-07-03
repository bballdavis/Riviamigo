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

export type DashboardChartAxisId = 'x' | 'y' | 'y2';
export type DashboardChartXDomainSource = 'dashboard-timeframe' | 'chart-local';

export interface DashboardChartAxisCapability {
  label: string;
  unit?: string;
}

export interface DashboardChartSettingsCapabilities {
  smoothing: boolean;
  axes: Partial<Record<DashboardChartAxisId, DashboardChartAxisCapability>>;
  xDomainSource: DashboardChartXDomainSource;
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

export function getChartSettingsCapabilities(definition: DashboardChartDefinition): DashboardChartSettingsCapabilities {
  switch (definition.source) {
    case 'soc_history':
      return {
        smoothing: true,
        axes: {
          y: axisCapability('Battery level', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'range_history':
      return {
        smoothing: true,
        axes: {
          y: axisCapability('Range', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'charging_weekly_energy':
      return {
        smoothing: false,
        axes: {
          y: axisCapability('Energy charged', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'charge_session_curve':
      return {
        smoothing: true,
        axes: {
          y: { label: 'Charge rate', unit: 'kW' },
          y2: { label: 'Energy added', unit: 'kWh' },
        },
        xDomainSource: 'chart-local',
      };
    case 'charging_curve_analysis':
      return {
        smoothing: false,
        axes: {
          x: { label: 'Charge level', unit: '%' },
          y: { label: 'Charge rate', unit: 'kW' },
        },
        xDomainSource: 'chart-local',
      };
    case 'efficiency_trend':
      return {
        smoothing: true,
        axes: {
          y: { label: 'Efficiency' },
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'phantom_drain':
      return {
        smoothing: true,
        axes: {
          y: axisCapability('Battery drain', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'battery_degradation':
      return {
        smoothing: true,
        axes: {
          y: axisCapability('Battery health', definition.yUnit),
        },
        xDomainSource: 'dashboard-timeframe',
      };
    case 'battery_capacity_mileage':
      return {
        smoothing: true,
        axes: {
          x: { label: 'Mileage', unit: 'mi' },
          y: axisCapability('Usable capacity', definition.yUnit),
        },
        xDomainSource: 'chart-local',
      };
    case 'projected_range_mileage':
      return {
        smoothing: true,
        axes: {
          y: axisCapability('Projected max range', definition.yUnit),
          y2: { label: 'Mileage', unit: 'mi' },
        },
        xDomainSource: 'dashboard-timeframe',
      };
    default:
      return {
        smoothing: false,
        axes: {},
        xDomainSource: 'dashboard-timeframe',
      };
  }
}

function axisCapability(label: string, unit?: string): DashboardChartAxisCapability {
  return unit ? { label, unit } : { label };
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
