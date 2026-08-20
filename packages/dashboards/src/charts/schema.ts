import { z } from 'zod';
import type {
  ChartFieldRef,
  ChartDefinitionV1,
  ChartSourceManifest,
  ChartValidationError,
} from '@riviamigo/types';

const finiteNumber = z.number().refine(Number.isFinite, 'Must be a finite number');
const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use lowercase letters, numbers, dots, hyphens, or underscores');
const humanText = z.string().trim().min(1).max(160);
const cssColor = z
  .string()
  .trim()
  .regex(
    /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\))$/i,
    'Use a hex, rgb, rgba, hsl, or hsla color',
  );

export const ChartPlacementSchema = z.object({
  dashboardSlug: identifier,
});

export const ChartTimeframePolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('dashboard') }),
  z.object({
    mode: z.literal('relative'),
    preset: z.enum(['1h', '6h', '24h', '7d', '30d', '90d', '1y']),
  }),
  z.object({ mode: z.literal('lifetime') }),
]);

const sourceFilterValue = z.union([
  z.string().max(160),
  finiteNumber,
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(160), finiteNumber])).max(100),
]);

export const ChartSourceFilterSchema = z.object({
  field: identifier,
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_null', 'is_not_null']),
  value: sourceFilterValue.optional(),
});

export const ChartSourceBindingSchema = z.object({
  id: identifier,
  sourceId: identifier,
  params: z.record(z.string().max(80), z.unknown()).default({}),
  filters: z.array(ChartSourceFilterSchema).max(20).default([]),
  inherit: z.object({
    vehicle: z.boolean(),
    timeframe: z.boolean(),
    tripTags: z.boolean().optional(),
  }),
});

export const ChartFieldRefSchema = z.object({
  sourceBindingId: identifier,
  field: identifier,
});

export const ChartFieldEncodingSchema = z.object({
  field: ChartFieldRefSchema,
  kind: z.enum(['time', 'number', 'category']),
  label: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(40).optional(),
});

export const ChartColorDefinitionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('token'),
    token: z.enum([
      'accent',
      'emerald',
      'amber',
      'sky',
      'violet',
      'rose',
      'teal',
      'indigo',
      'success',
      'warning',
      'danger',
      'muted',
    ]),
  }),
  z.object({
    mode: z.literal('custom'),
    light: cssColor,
    dark: cssColor,
  }),
]);

export const ChartTransformDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('scale'), factor: finiteNumber }),
  z.object({ kind: z.literal('offset'), amount: finiteNumber }),
  z.object({ kind: z.literal('delta') }),
  z.object({ kind: z.literal('cumulative') }),
  z.object({ kind: z.literal('rolling_average'), window: z.number().int().min(2).max(1000) }),
  z.object({ kind: z.literal('rolling_median'), window: z.number().int().min(2).max(1000) }),
  z.object({ kind: z.literal('fixed_time_bin'), milliseconds: z.number().int().min(1).max(31_536_000_000) }),
  z.object({ kind: z.literal('histogram_bin'), size: finiteNumber.refine((value) => value > 0, 'Must be greater than zero') }),
  z.object({
    kind: z.literal('expression'),
    formula: z.string().trim().min(1).max(512),
  }),
]);

export const ChartSeriesDefinitionSchema = z.object({
  id: identifier,
  label: humanText,
  y: ChartFieldRefSchema,
  x: ChartFieldRefSchema.optional(),
  mark: z.enum(['line', 'area', 'step', 'bar', 'scatter', 'histogram']),
  yAxis: z.enum(['y', 'y2']),
  color: ChartColorDefinitionSchema,
  strokeWidth: finiteNumber.pipe(z.number().min(0.5).max(12)).optional(),
  pointSize: finiteNumber.pipe(z.number().min(1).max(24)).optional(),
  stackId: identifier.optional(),
  connectGaps: z.boolean().optional(),
  visibleInLegend: z.boolean().optional(),
  transforms: z.array(ChartTransformDefinitionSchema).max(12).default([]),
  valueFormat: z.enum(['number', 'integer', 'percent', 'currency', 'duration', 'unit']).optional(),
});

export const ChartAxisDefinitionSchema = z.object({
  label: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(40).optional(),
  scale: z.enum(['linear', 'log']),
  domain: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('auto'),
      includeZero: z.boolean().optional(),
      padding: finiteNumber.pipe(z.number().min(0).max(1)).optional(),
    }),
    z.object({
      mode: z.literal('fixed'),
      min: finiteNumber,
      max: finiteNumber,
    }),
  ]),
  tickFormat: z.enum(['number', 'integer', 'percent', 'currency', 'duration', 'unit']).optional(),
});

export const ChartAxesDefinitionSchema = z.object({
  x: ChartAxisDefinitionSchema,
  y: ChartAxisDefinitionSchema,
  y2: ChartAxisDefinitionSchema.optional(),
});

export const ChartDisplayDefaultsSchema = z.object({
  legend: z.enum(['auto', 'show', 'hide']),
  grid: z.boolean(),
  tooltip: z.boolean(),
  timeFilter: z.enum(['raw', '15m', '1h', '6h', '24h', '3d', '7d']),
  curveSmoothness: z.enum(['straight', 'gentle', 'smooth']),
  dataSmoothing: z.object({
    kind: z.enum(['rolling_average', 'rolling_median']),
    window: z.number().int().min(2).max(1000),
  }).optional(),
  showPoints: z.boolean().optional(),
  emptyTitle: z.string().trim().max(160).optional(),
  emptyDescription: z.string().trim().max(500).optional(),
});

export const ChartInteractionDefaultsSchema = z.object({
  panZoom: z.boolean(),
  touchExplore: z.boolean(),
  connectGaps: z.boolean(),
});

export const ChartAnnotationDefinitionSchema = z.object({
  kind: z.literal('horizontal_reference_line'),
  value: finiteNumber,
  label: z.string().trim().max(120).optional(),
  color: ChartColorDefinitionSchema,
});

const forbiddenKeys = new Set(['url', 'remoteurl', 'sql', 'javascript', 'script', 'templatehtml', 'css']);

function findForbiddenKeys(value: unknown, path: string, errors: ChartValidationError[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}.${index}`, errors));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.replaceAll('_', '').toLowerCase())) {
      errors.push({ path: `${path}.${key}`, message: 'Executable, remote, SQL, HTML, or CSS fields are not allowed' });
    }
    findForbiddenKeys(child, `${path}.${key}`, errors);
  }
}

function fieldReferenceErrors(definition: ChartDefinitionV1, errors: ChartValidationError[]) {
  const bindingIds = new Set(definition.sources.map((source) => source.id));
  const references: Array<{ path: string; reference: ChartFieldRef }> = [
    { path: 'x.field', reference: definition.x.field },
    ...definition.series.flatMap((series, index) => [
      { path: `series.${index}.y`, reference: series.y },
      ...(series.x ? [{ path: `series.${index}.x`, reference: series.x }] : []),
    ]),
  ];
  for (const { path, reference } of references) {
    if (!bindingIds.has(reference.sourceBindingId)) {
      errors.push({ path: `config.${path}.sourceBindingId`, message: `Unknown source binding '${reference.sourceBindingId}'` });
    }
  }
  if (definition.series.some((series) => series.yAxis === 'y2') && !definition.axes.y2) {
    errors.push({ path: 'config.axes.y2', message: 'A right-axis series requires a y2 axis definition' });
  }
}

export const ChartDefinitionV1Schema = z.object({
  schemaVersion: z.literal(1),
  placements: z.array(ChartPlacementSchema).max(20),
  timeframe: ChartTimeframePolicySchema,
  sources: z.array(ChartSourceBindingSchema).min(1).max(4),
  x: ChartFieldEncodingSchema,
  series: z.array(ChartSeriesDefinitionSchema).min(1).max(12),
  axes: ChartAxesDefinitionSchema,
  display: ChartDisplayDefaultsSchema,
  interaction: ChartInteractionDefaultsSchema,
  annotations: z.array(ChartAnnotationDefinitionSchema).max(20).optional(),
  rendererId: identifier.optional(),
}).superRefine((definition, context) => {
  const errors: ChartValidationError[] = [];
  const sourceIds = definition.sources.map((source) => source.id);
  const seriesIds = definition.series.map((series) => series.id);
  if (new Set(sourceIds).size !== sourceIds.length) errors.push({ path: 'config.sources', message: 'Source binding IDs must be unique' });
  if (new Set(seriesIds).size !== seriesIds.length) errors.push({ path: 'config.series', message: 'Series IDs must be unique' });
  fieldReferenceErrors(definition as ChartDefinitionV1, errors);
  definition.sources.forEach((source, index) => {
    source.filters.forEach((filter, filterIndex) => {
      const noValue = filter.operator === 'is_null' || filter.operator === 'is_not_null';
      if (noValue && filter.value !== undefined) {
        errors.push({ path: `config.sources.${index}.filters.${filterIndex}.value`, message: 'Null checks do not accept a value' });
      }
      if (!noValue && filter.value === undefined) {
        errors.push({ path: `config.sources.${index}.filters.${filterIndex}.value`, message: 'This filter operator requires a value' });
      }
    });
  });
  const axes = [definition.axes.x, definition.axes.y, definition.axes.y2];
  for (const axis of axes) {
    if (!axis) continue;
    if (axis.domain.mode === 'fixed') {
      if (axis.domain.min >= axis.domain.max) errors.push({ path: 'config.axes', message: 'Fixed axis minimum must be less than maximum' });
      if (axis.scale === 'log' && (axis.domain.min <= 0 || axis.domain.max <= 0)) {
        errors.push({ path: 'config.axes', message: 'Logarithmic axes require positive fixed ranges' });
      }
    }
  }
  findForbiddenKeys(definition, 'config', errors);
  for (const error of errors) context.addIssue({ code: 'custom', path: error.path.split('.'), message: error.message });
});

export const ChartRecordSchema = z.object({
  id: z.guid(),
  ownerId: z.guid().nullable(),
  slug: identifier,
  name: humanText,
  description: z.string().trim().max(500).optional(),
  isDefault: z.boolean(),
  isLocked: z.boolean(),
  isEnabled: z.boolean(),
  baselineRevision: z.number().int().nonnegative().nullable().optional(),
  config: ChartDefinitionV1Schema,
});

export const PortableChartDocumentSchema = z.object({
  kind: z.literal('riviamigo-chart'),
  version: z.literal(1),
  chart: z.object({
    slug: identifier,
    name: humanText,
    description: z.string().trim().max(500).optional(),
    enabled: z.boolean(),
    definition: ChartDefinitionV1Schema,
  }),
});

export function parseChartDefinitionV1(value: unknown): ChartDefinitionV1 {
  return ChartDefinitionV1Schema.parse(value) as ChartDefinitionV1;
}

export function validateChartDefinitionAgainstSources(
  definition: ChartDefinitionV1,
  manifests: ChartSourceManifest[],
): ChartValidationError[] {
  const errors: ChartValidationError[] = [];
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const bindingById = new Map(definition.sources.map((source) => [source.id, source]));

  for (const [bindingId, binding] of bindingById) {
    const manifest = manifestById.get(binding.sourceId);
    if (!manifest) {
      errors.push({ path: `config.sources.${bindingId}.sourceId`, message: `Source '${binding.sourceId}' is not available on this API` });
      continue;
    }
    const filterFields = new Map(manifest.filterableFields.map((field) => [field.field, new Set(field.operators)]));
    for (const filter of binding.filters) {
      const operators = filterFields.get(filter.field);
      if (!operators || !operators.has(filter.operator)) {
        errors.push({ path: `config.sources.${bindingId}.filters.${filter.field}`, message: `Filter '${filter.field} ${filter.operator}' is not supported by ${manifest.label}` });
      }
    }
  }

  const fieldFor = (reference: { sourceBindingId: string; field: string }, path: string) => {
    const binding = bindingById.get(reference.sourceBindingId);
    const manifest = binding ? manifestById.get(binding.sourceId) : undefined;
    const field = manifest?.fields.find((candidate) => candidate.id === reference.field);
    if (!field) {
      errors.push({ path, message: `Field '${reference.field}' is not available from source binding '${reference.sourceBindingId}'` });
    }
    return { field, manifest };
  };

  const x = fieldFor(definition.x.field, 'config.x.field');
  if (x.field && !x.field.roles.includes('x')) errors.push({ path: 'config.x.field', message: `Field '${definition.x.field.field}' cannot be used as an X field` });
  definition.series.forEach((series, index) => {
    const y = fieldFor(series.y, `config.series.${index}.y`);
    if (y.field && !y.field.roles.includes('y')) errors.push({ path: `config.series.${index}.y`, message: `Field '${series.y.field}' cannot be used as a Y field` });
    if (series.x) fieldFor(series.x, `config.series.${index}.x`);
    const compatibleMark = series.mark === 'step' ? 'line' : series.mark === 'histogram' ? 'bar' : series.mark;
    if (y.manifest && !y.manifest.compatibleMarks.includes(compatibleMark)) {
      errors.push({ path: `config.series.${index}.mark`, message: `Mark '${series.mark}' is not supported by source '${y.manifest.id}'` });
    }
  });
  return errors;
}
