// Side-effect: registers all widgets into the registry.
import './widgets/index';

export { DashboardRenderer } from './DashboardRenderer';
export { WidgetHost } from './WidgetHost';
export { DashboardChartWidget, DashboardChartRenderer } from './widgets/chart/DashboardChartWidget';
export { registerWidget, getWidget, getAllWidgets, getWidgetKeys } from './registry';
export type { WidgetDef, WidgetCtx } from './registry';
export * from './schema';
export * from './api';
export { exportDashboardYaml, downloadDashboardYaml, importDashboardYaml } from './yaml';
export { DEFAULT_DASHBOARDS, getDefaultBySlug } from './defaults/index';
