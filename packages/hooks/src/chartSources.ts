import { useQueries } from '@tanstack/react-query';
import type { ChartDataset, ChartDatasetField, ChartDefinitionV1, ChartSourceBinding } from '@riviamigo/types';
import { api } from './api';
import { useAuthReady } from './useAuthState';
import type { TripTagFilters } from './useTrips';

export interface ChartRuntimeContext {
  vehicleId: string | null;
  from: string | null;
  to: string | null;
  lifetime?: boolean;
  chargeSessionId?: string | null;
  tripTagFilter?: TripTagFilters;
}

export interface ChartSourceQueryArgs {
  binding: ChartSourceBinding;
  definition: ChartDefinitionV1;
  context: ChartRuntimeContext;
}

export interface ChartSourceAdapter {
  id: string;
  fetch: (args: ChartSourceQueryArgs) => Promise<unknown>;
}

function paramsOf(binding: ChartSourceBinding) { return binding.params as Record<string, unknown>; }
function metricName(binding: ChartSourceBinding, definition: ChartDefinitionV1) {
  const configured = paramsOf(binding).metric;
  return typeof configured === 'string' && configured ? configured : definition.series[0]?.y.field ?? null;
}
function lifetimeOf(context: ChartRuntimeContext) { return context.lifetime ?? (!context.from && !context.to); }
const adapter = (id: string, fetch: ChartSourceAdapter['fetch']): ChartSourceAdapter => ({ id, fetch });

export const CHART_SOURCE_ADAPTERS: Readonly<Record<string, ChartSourceAdapter>> = {
  'metrics.series': adapter('metrics.series', ({ binding, definition, context }) => {
    const metric = metricName(binding, definition);
    return context.vehicleId && metric ? api.getMetricSeries(context.vehicleId, metric, context.from, context.to, 'auto') : Promise.resolve([]);
  }),
  'battery.mileage': adapter('battery.mileage', ({ context }) => context.vehicleId ? api.getBatteryMileage(context.vehicleId, context.from, context.to, lifetimeOf(context)) : Promise.resolve([])),
  'battery.degradation': adapter('battery.degradation', ({ context }) => context.vehicleId ? api.getDegradation(context.vehicleId, context.from, context.to, lifetimeOf(context)) : Promise.resolve([])),
  'battery.idle-drain': adapter('battery.idle-drain', ({ context }) => context.vehicleId ? api.getPhantomDrain(context.vehicleId, context.from, context.to, lifetimeOf(context)) : Promise.resolve([])),
  'charging.sessions': adapter('charging.sessions', ({ context }) => context.vehicleId ? api.getChargingChartSeries(context.vehicleId, context.from, context.to, lifetimeOf(context)) : Promise.resolve([])),
  'charging.charge-curve': adapter('charging.charge-curve', ({ context }) => context.vehicleId && context.chargeSessionId ? api.getChargeCurve(context.chargeSessionId, context.vehicleId) : Promise.resolve([])),
  'charging.curve-analysis': adapter('charging.curve-analysis', ({ context }) => context.vehicleId ? api.getChargeCurveAnalysis(context.vehicleId, context.from, context.to, lifetimeOf(context)) : Promise.resolve([])),
  'efficiency.trend': adapter('efficiency.trend', ({ context }) => context.vehicleId ? api.getEfficiencyTrend(context.vehicleId, context.from, context.to, lifetimeOf(context), context.tripTagFilter) : Promise.resolve([])),
  'efficiency.temperature': adapter('efficiency.temperature', ({ context }) => context.vehicleId ? api.getEfficiencyVsTemp(context.vehicleId, context.from, context.to, lifetimeOf(context), context.tripTagFilter) : Promise.resolve([])),
  'efficiency.drive-mode': adapter('efficiency.drive-mode', ({ context }) => context.vehicleId ? api.getEfficiencyByMode(context.vehicleId, context.from, context.to, lifetimeOf(context), context.tripTagFilter) : Promise.resolve([])),
  'efficiency.trip-tags': adapter('efficiency.trip-tags', ({ context }) => context.vehicleId ? api.getEfficiencyByTag(context.vehicleId, context.from, context.to, lifetimeOf(context), context.tripTagFilter) : Promise.resolve([])),
  'trips.tire-pressure-timeline': adapter('trips.tire-pressure-timeline', ({ context }) => context.vehicleId ? api.getTirePressureTimeline(context.vehicleId, context.from, context.to, lifetimeOf(context), context.tripTagFilter) : Promise.resolve({ samples: [], trips: [] })),
};

function rowsFrom(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  for (const key of ['daily', 'samples', 'data', 'rows']) if (Array.isArray(record[key])) return rowsFrom(record[key]);
  return [];
}

function valueFor(row: Record<string, unknown>, field: string, binding: ChartSourceBinding) {
  const aliases: Record<string, string[]> = {
    timestamp: ['ts', 'timestamp', 'started_at'], day_start: ['day_start', 'day', 'ts'], odometer_miles: ['odometer_miles', 'odometer_mi'],
    soc_lost_pct: ['soc_lost_pct', 'total_soc_lost'], parked_hours: ['parked_hours', 'hours_parked'], drain_rate_pct_per_hour: ['drain_rate_pct_per_hour', 'avg_drain_rate'],
    elapsed_minutes: ['elapsed_minutes', 'minutes_elapsed'], power_kw: ['power_kw', 'charge_rate_kw'], avg_efficiency_wh_mi: ['avg_efficiency_wh_mi', 'avg_efficiency'],
    front_left_psi: ['front_left_psi', 'tire_fl_psi'], front_right_psi: ['front_right_psi', 'tire_fr_psi'], rear_left_psi: ['rear_left_psi', 'tire_rl_psi'], rear_right_psi: ['rear_right_psi', 'tire_rr_psi'],
  };
  for (const candidate of [field, ...(aliases[field] ?? [])]) if (candidate in row) return row[candidate];
  if ('value' in row) return row.value;
  const metric = paramsOf(binding).metric;
  return typeof metric === 'string' && metric === field ? row.value : null;
}

function normalizeDataset(raw: unknown, binding: ChartSourceBinding, definition: ChartDefinitionV1): ChartDataset {
  const rows = rowsFrom(raw);
  const xField = definition.x.field.field;
  const domainValues = rows.map((row) => valueFor(row, xField, binding)).filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');
  const fields: Record<string, ChartDatasetField> = {};
  for (const series of definition.series) fields[series.y.field] = { kind: 'number', values: rows.map((row) => { const value = valueFor(row, series.y.field, binding); return typeof value === 'string' || typeof value === 'number' ? value : null; }) };
  return { sourceBindingId: binding.id, domain: { kind: definition.x.kind, field: xField, values: domainValues }, fields, meta: { sourceId: binding.sourceId, sampled: false, partial: false, sourcePointCount: rows.length } };
}

export function useChartDatasets(definition: ChartDefinitionV1 | null, context: ChartRuntimeContext) {
  const authReady = useAuthReady();
  const bindings = definition?.sources ?? [];
  const results = useQueries({ queries: bindings.map((binding) => ({
    queryKey: ['chart-dataset', binding.sourceId, binding.id, binding.params, binding.filters, context],
    queryFn: async () => {
      const source = CHART_SOURCE_ADAPTERS[binding.sourceId];
      if (!source) throw new Error(`Chart source '${binding.sourceId}' is unavailable`);
      return source.fetch({ binding, definition: definition!, context });
    },
    enabled: authReady && !!context.vehicleId && !!definition,
    staleTime: 2 * 60 * 1000,
    meta: { persist: false },
  })) });
  const datasets = results.map((result, index) => result.data === undefined || !definition ? null : normalizeDataset(result.data, bindings[index]!, definition)).filter((dataset): dataset is ChartDataset => dataset !== null);
  return { datasets, results, isLoading: results.some((result) => result.isLoading), isFetching: results.some((result) => result.isFetching), isPartial: results.some((result) => result.isError), errors: results.map((result) => result.error).filter(Boolean) };
}
