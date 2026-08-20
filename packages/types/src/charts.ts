/**
 * Transport-safe contracts for managed charts.
 *
 * Ownership, lock state, UUIDs, and baseline revisions belong to ChartRecord;
 * ChartDefinitionV1 is the portable, executable-behavior portion only.
 */

export type ChartSchemaVersion = 1;

export type ChartTimeframePolicy =
  | { mode: 'dashboard' }
  | { mode: 'relative'; preset: '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | '1y' }
  | { mode: 'lifetime' };

export interface ChartPlacement {
  dashboardSlug: string;
}

export type ChartSourceFilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

export type ChartSourceFilterValue = string | number | boolean | null | Array<string | number>;

export interface ChartSourceFilter {
  field: string;
  operator: ChartSourceFilterOperator;
  value?: ChartSourceFilterValue;
}

export interface ChartSourceBinding {
  id: string;
  sourceId: string;
  params: Record<string, unknown>;
  filters: ChartSourceFilter[];
  inherit: {
    vehicle: boolean;
    timeframe: boolean;
    tripTags?: boolean;
  };
}

export interface ChartFieldRef {
  sourceBindingId: string;
  field: string;
}

export interface ChartFieldEncoding {
  field: ChartFieldRef;
  kind: 'time' | 'number' | 'category';
  label?: string;
  unit?: string;
}

export type ChartMark = 'line' | 'area' | 'step' | 'bar' | 'scatter' | 'histogram';

export type ChartColorToken =
  | 'accent'
  | 'emerald'
  | 'amber'
  | 'sky'
  | 'violet'
  | 'rose'
  | 'teal'
  | 'indigo'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted';

export type ChartColorDefinition =
  | { mode: 'token'; token: ChartColorToken }
  | { mode: 'custom'; light: string; dark: string };

export type ChartValueFormat =
  | 'number'
  | 'integer'
  | 'percent'
  | 'currency'
  | 'duration'
  | 'unit';

export type ChartTransformDefinition =
  | { kind: 'none' }
  | { kind: 'scale'; factor: number }
  | { kind: 'offset'; amount: number }
  | { kind: 'delta' }
  | { kind: 'cumulative' }
  | { kind: 'rolling_average'; window: number }
  | { kind: 'rolling_median'; window: number }
  | { kind: 'fixed_time_bin'; milliseconds: number }
  | { kind: 'histogram_bin'; size: number }
  | { kind: 'expression'; formula: string };

export interface ChartSeriesDefinition {
  id: string;
  label: string;
  y: ChartFieldRef;
  x?: ChartFieldRef;
  mark: ChartMark;
  yAxis: 'y' | 'y2';
  color: ChartColorDefinition;
  strokeWidth?: number;
  pointSize?: number;
  stackId?: string;
  connectGaps?: boolean;
  visibleInLegend?: boolean;
  transforms: ChartTransformDefinition[];
  valueFormat?: ChartValueFormat;
}

export interface ChartAxisDefinition {
  label?: string;
  unit?: string;
  scale: 'linear' | 'log';
  domain:
    | { mode: 'auto'; includeZero?: boolean; padding?: number }
    | { mode: 'fixed'; min: number; max: number };
  tickFormat?: ChartValueFormat;
}

export interface ChartAxesDefinition {
  x: ChartAxisDefinition;
  y: ChartAxisDefinition;
  y2?: ChartAxisDefinition;
}

export interface ChartDataSmoothing {
  kind: 'rolling_average' | 'rolling_median';
  window: number;
}

export interface ChartDisplayDefaults {
  legend: 'auto' | 'show' | 'hide';
  grid: boolean;
  tooltip: boolean;
  timeFilter: 'raw' | '15m' | '1h' | '6h' | '24h' | '3d' | '7d';
  curveSmoothness: 'straight' | 'gentle' | 'smooth';
  dataSmoothing?: ChartDataSmoothing;
  showPoints?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export interface ChartInteractionDefaults {
  panZoom: boolean;
  touchExplore: boolean;
  connectGaps: boolean;
}

export interface ChartAnnotationDefinition {
  kind: 'horizontal_reference_line';
  value: number;
  label?: string;
  color: ChartColorDefinition;
}

export interface ChartDefinitionV1 {
  schemaVersion: ChartSchemaVersion;
  placements: ChartPlacement[];
  timeframe: ChartTimeframePolicy;
  sources: ChartSourceBinding[];
  x: ChartFieldEncoding;
  series: ChartSeriesDefinition[];
  axes: ChartAxesDefinition;
  display: ChartDisplayDefaults;
  interaction: ChartInteractionDefaults;
  annotations?: ChartAnnotationDefinition[];
  rendererId?: string;
}

export interface ChartRecord {
  id: string;
  ownerId: string | null;
  slug: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isLocked: boolean;
  isEnabled: boolean;
  baselineRevision?: number | null;
  config: ChartDefinitionV1;
}

export type ChartOrigin = 'system' | 'override' | 'personal';

export interface ChartPermissions {
  read: boolean;
  edit: boolean;
  duplicate: boolean;
  reset: boolean;
  restore: boolean;
  delete: boolean;
  lock: boolean;
}

export interface ChartManagerEntry {
  effective: ChartRecord;
  systemBase?: ChartRecord;
  personalOverride?: ChartRecord;
  origin: ChartOrigin;
  permissions: ChartPermissions;
}

export type ChartSourceFieldKind = 'time' | 'number' | 'category';

export interface ChartSourceFieldManifest {
  id: string;
  label: string;
  kind: ChartSourceFieldKind;
  unit?: string;
  roles: Array<'x' | 'y' | 'group' | 'detail'>;
}

export interface ChartSourceParameterManifest {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  required: boolean;
  options?: string[];
}

export interface ChartSourceManifest {
  id: string;
  label: string;
  description: string;
  category: string;
  parameters: ChartSourceParameterManifest[];
  fields: ChartSourceFieldManifest[];
  requiredContext: Array<'vehicle' | 'timeframe' | 'tripTags' | 'chargeSession'>;
  filterableFields: Array<{ field: string; operators: ChartSourceFilterOperator[] }>;
  compatibleMarks: ChartMark[];
  supportsTripTagInheritance: boolean;
  supportsIntervals: boolean;
  supportsReferenceLines: boolean;
}

export interface ChartDatasetField {
  kind: 'number' | 'category' | 'time';
  unit?: string;
  values: Array<number | string | null>;
}

export interface ChartInterval {
  start: string | number;
  end: string | number;
  label?: string;
  tone?: ChartColorToken;
}

export interface ChartReferenceLine {
  value: number;
  label?: string;
  unit?: string;
}

export interface ChartDataset {
  sourceBindingId: string;
  domain: {
    kind: 'time' | 'number' | 'category';
    field: string;
    values: Array<number | string>;
  };
  fields: Record<string, ChartDatasetField>;
  intervals?: ChartInterval[];
  referenceLines?: ChartReferenceLine[];
  rowDetails?: Array<Record<string, string | number | null>>;
  meta: {
    sourceId: string;
    sampled: boolean;
    partial: boolean;
    staleAt?: string;
    sourcePointCount: number;
  };
}

export interface ChartValidationError {
  path: string;
  message: string;
}

export interface PortableChartDocument {
  kind: 'riviamigo-chart';
  version: 1;
  chart: {
    slug: string;
    name: string;
    description?: string;
    enabled: boolean;
    definition: ChartDefinitionV1;
  };
}
