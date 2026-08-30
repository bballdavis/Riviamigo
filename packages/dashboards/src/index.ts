// Side-effect: registers all widgets into the registry.
import './widgets/index';

export { DashboardRenderer } from './DashboardRenderer';
export { DashboardGrid } from './DashboardGrid';
export { WidgetHost } from './WidgetHost';
export { WidgetChrome } from './WidgetChrome';
export {
  DashboardChartWidget,
  DashboardChartRenderer,
  ChargeSessionCurveDetail,
  ManagedChartRuntime,
} from './widgets/chart/DashboardChartWidget';
export { ChartDefinitionRenderer } from './widgets/chart/ChartDefinitionRenderer';
export { TripTagPicker } from './widgets/table/TripTagPicker';
export { PhantomDrainChart, buildPhantomDrainDailySeries } from './widgets/chart/PhantomDrainChart';
export type {
  PhantomDrainChartProps,
  PhantomDrainDailyPoint,
} from './widgets/chart/PhantomDrainChart';
export { SensorChipSummary } from './widgets/sensor/SensorChipSummary';
export { CurrentVehicleStatePanel } from './widgets/custom/OverviewVehicleWidget';
export {
  registerWidget,
  getWidget,
  getAllWidgets,
  getWidgetKeys,
  getWidgetEditorMeta,
} from './registry';
export type { WidgetDef, WidgetCtx, WidgetEditorMeta } from './registry';
export * from './schema';
export * from './api';
export * from './dashboardModel';
export * from './dashboardVisibility';
export {
  BUNDLED_RENDERER_CAPABILITIES,
  getBundledRendererFields,
  getChartDefinition,
  getChartDefinitions,
  getChartOptions,
  getChartSettingsCapabilities,
  supportsBundledRichEditing,
  supportsBundledRendererCurve,
  validateBundledRendererDefinition,
} from './charts/catalog';
export {
  parseSafeMathExpression,
  resolveSafeExpression,
  resolveSafeNumberPath,
} from './charts/expressions';
export {
  BUNDLED_CHART_DEFINITIONS,
  BUNDLED_CHART_SLUGS,
  getBundledChartDefinition,
} from './charts/defaults';
export { normalizeLegacyBundledChartRecord } from './charts/legacyBaseline';
export {
  CHART_SOURCE_MANIFESTS,
  getChartSourceManifest,
  resolveChartSourceCapabilities,
} from './charts/sources';
export {
  buildCurveCatalog,
  domainSignature,
  isMixedDomain,
  removeCurveAndUnusedSources,
  sharedDomain,
} from './charts/curveCatalog';
export { CHART_RENDERER_PLUGINS, getChartRenderer } from './charts/rendererRegistry';
export {
  buildChartManagerEntries,
  chartHasPlacement,
  chartOrigin,
  defaultChartPermissions,
  resolveAssignedCharts,
  withChartPlacement,
} from './charts/model';
export {
  CHART_EXPORT_KIND,
  CHART_EXPORT_VERSION,
  downloadChartJson,
  exportChartJson,
  importChartJson,
  parseChartJson,
} from './charts/portable';
export {
  ChartAnnotationDefinitionSchema,
  ChartAxesDefinitionSchema,
  ChartColorDefinitionSchema,
  ChartDefinitionV1Schema,
  ChartFieldEncodingSchema,
  ChartFieldRefSchema,
  ChartInteractionDefaultsSchema,
  ChartPlacementSchema,
  ChartRecordSchema,
  ChartSeriesDefinitionSchema,
  ChartSourceBindingSchema,
  ChartSourceFilterSchema,
  ChartTimeframePolicySchema,
  ChartTransformDefinitionSchema,
  PortableChartDocumentSchema,
  parseChartDefinitionV1,
  validateChartDefinitionAgainstSources,
} from './charts/schema';
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
export {
  DashboardDataProvider,
  collectDashboardDataRequirements,
  useDashboardDataSelector,
  useDashboardMetric,
} from './dashboardData';
export type { DashboardDataRequirements, DashboardDataSnapshot } from './dashboardData';
