// Side-effect: registers all widgets into the registry.
import './widgets/index';

export { DashboardRenderer } from './DashboardRenderer';
export { DashboardContent } from './DashboardContent';
export { WidgetHost } from './WidgetHost';
export { registerWidget, getWidget, getAllWidgets, getWidgetIds } from './registry';
export type { WidgetDef, WidgetCtx } from './registry';
export * from './schema';
export * from './api';
export { exportDashboardYaml, downloadDashboardYaml, importDashboardYaml } from './yaml';
export { DEFAULT_DASHBOARDS, getDefaultBySlug } from './defaults/index';
