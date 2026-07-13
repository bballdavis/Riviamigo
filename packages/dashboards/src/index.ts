// Side-effect: registers all widgets into the registry.
import './widgets/index';

export { DashboardRenderer } from './DashboardRenderer';
export { DashboardGrid } from './DashboardGrid';
export { WidgetHost } from './WidgetHost';
export { WidgetChrome } from './WidgetChrome';
export { DashboardChartWidget, DashboardChartRenderer } from './widgets/chart/DashboardChartWidget';
export { PhantomDrainChart, buildPhantomDrainDailySeries } from './widgets/chart/PhantomDrainChart';
export type { PhantomDrainChartProps, PhantomDrainDailyPoint } from './widgets/chart/PhantomDrainChart';
export { SensorChipSummary } from './widgets/sensor/SensorChipSummary';
export { registerWidget, getWidget, getAllWidgets, getWidgetKeys, getWidgetEditorMeta } from './registry';
export type { WidgetDef, WidgetCtx, WidgetEditorMeta } from './registry';
export * from './schema';
export * from './api';
export * from './dashboardModel';
export { getChartDefinition, getChartDefinitions, getChartOptions, getChartSettingsCapabilities } from './charts/catalog';
export type {
  DashboardChartAxisCapability,
  DashboardChartAxisId,
  DashboardChartDefinition,
  DashboardChartPage,
  DashboardChartSettingsCapabilities,
  DashboardChartSource,
  DashboardChartXDomainSource,
} from './charts/catalog';
export { sanitizeDashboardConfig, sanitizeWidgetInstance, sanitizeWidgetLayout } from './layout';
export { exportDashboardYaml, downloadDashboardYaml, importDashboardYaml } from './yaml';
export { DEFAULT_DASHBOARDS, getDefaultBySlug } from './defaults/index';
export { DashboardDataProvider, collectDashboardDataRequirements, useDashboardDataSelector, useDashboardMetric } from './dashboardData';
export type { DashboardDataRequirements, DashboardDataSnapshot } from './dashboardData';
