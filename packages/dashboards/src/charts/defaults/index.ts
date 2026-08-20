import type {
  ChartColorDefinition,
  ChartDefinitionV1,
  ChartMark,
} from '@riviamigo/types';
import { ChartDefinitionV1Schema } from '../schema';

const accent: ChartColorDefinition = { mode: 'token', token: 'accent' };
const emerald: ChartColorDefinition = { mode: 'token', token: 'emerald' };
const sky: ChartColorDefinition = { mode: 'token', token: 'sky' };
const violet: ChartColorDefinition = { mode: 'token', token: 'violet' };
const amber: ChartColorDefinition = { mode: 'token', token: 'amber' };

function definition({
  slug: _slug,
  placements,
  sourceId,
  xField,
  xKind,
  yUnit,
  yFields,
  marks = [],
  title,
  description,
  emptyTitle,
  timeframe = { mode: 'dashboard' },
}: {
  slug: string;
  placements: string[];
  sourceId: string;
  xField: string;
  xKind: 'time' | 'number' | 'category';
  yUnit?: string;
  yFields: Array<{ field: string; label: string; unit?: string; color?: ChartColorDefinition }>;
  marks?: ChartMark[];
  title?: string;
  description?: string;
  emptyTitle?: string;
  timeframe?: ChartDefinitionV1['timeframe'];
}): ChartDefinitionV1 {
  const series = yFields.map((field, index) => ({
    id: field.field,
    label: field.label,
    y: { sourceBindingId: 'main', field: field.field },
    mark: marks[index] ?? (xKind === 'category' ? 'bar' : 'line'),
    yAxis: 'y' as const,
    color: field.color ?? [accent, emerald, sky, violet, amber][index % 5]!,
    transforms: [],
    visibleInLegend: true,
    ...(field.unit ? { valueFormat: 'unit' as const } : {}),
  }));
  return ChartDefinitionV1Schema.parse({
    schemaVersion: 1,
    placements: placements.map((dashboardSlug) => ({ dashboardSlug })),
    timeframe,
    sources: [{
      id: 'main',
      sourceId,
      params: {},
      filters: [],
      inherit: { vehicle: true, timeframe: true, tripTags: true },
    }],
    x: {
      field: { sourceBindingId: 'main', field: xField },
      kind: xKind,
      unit: xKind === 'time' ? undefined : undefined,
    },
    series,
    axes: {
      x: { scale: 'linear', domain: { mode: 'auto' } },
      y: { scale: 'linear', unit: yUnit, domain: { mode: 'auto', includeZero: xKind === 'category' } },
    },
    display: {
      legend: yFields.length > 1 ? 'auto' : 'hide',
      grid: true,
      tooltip: true,
      timeFilter: 'raw',
      curveSmoothness: 'gentle',
      showPoints: xKind !== 'time',
      emptyTitle: emptyTitle ?? `No ${title?.toLowerCase() ?? 'chart'} data available`,
      emptyDescription: `No ${title?.toLowerCase() ?? 'chart'} data is available for this range.`,
    },
    interaction: { panZoom: true, touchExplore: true, connectGaps: false },
    ...(description ? { annotations: [] } : {}),
  }) as ChartDefinitionV1;
}

export const BUNDLED_CHART_DEFINITIONS: ReadonlyArray<ChartDefinitionV1 & {
  slug: string;
  title: string;
  description: string;
}> = [
  {
    slug: 'battery-capacity-mileage',
    title: 'Battery Capacity by Mileage',
    description: 'Usable battery capacity over time with a filled trend and a secondary mileage axis.',
    ...definition({ slug: 'battery-capacity-mileage', placements: ['overview', 'battery'], sourceId: 'battery.mileage', xField: 'odometer_miles', xKind: 'number', yUnit: 'kWh', yFields: [{ field: 'usable_kwh', label: 'Usable Capacity', unit: 'kWh', color: accent }] }),
  },
  {
    slug: 'battery-degradation',
    title: 'Battery Health',
    description: 'Estimated battery capacity percentage over time.',
    ...definition({ slug: 'battery-degradation', placements: ['overview', 'battery'], sourceId: 'battery.degradation', xField: 'timestamp', xKind: 'time', yUnit: '%', yFields: [{ field: 'capacity_pct', label: 'Battery Health', unit: '%', color: accent }] }),
  },
  {
    slug: 'charge-level',
    title: 'Charge Level',
    description: 'State-of-charge from telemetry over time, showing charge and discharge patterns.',
    ...definition({ slug: 'charge-level', placements: ['overview', 'charging'], sourceId: 'metrics.series', xField: 'timestamp', xKind: 'time', yUnit: '%', yFields: [{ field: 'battery_level', label: 'State of Charge', unit: '%', color: accent }], marks: ['area'] }),
  },
  {
    slug: 'charge-session-curve',
    title: 'Charge Rate Curve',
    description: 'Charge rate over state of charge for the selected session.',
    ...definition({ slug: 'charge-session-curve', placements: ['charging'], sourceId: 'charging.charge-curve', xField: 'elapsed_minutes', xKind: 'number', yUnit: 'kW', yFields: [{ field: 'power_kw', label: 'Charge Rate', unit: 'kW', color: accent }, { field: 'energy_kwh', label: 'Energy Added', unit: 'kWh', color: emerald }] }),
  },
  {
    slug: 'charging-curve-analysis',
    title: 'DC Charging Curve Trend',
    description: 'Verified DC charge sessions by exact state of charge, with dense power-colored evidence points and an optional observed or best-observed local-regression trend line.',
    ...definition({ slug: 'charging-curve-analysis', placements: ['charging'], sourceId: 'charging.curve-analysis', xField: 'soc_pct', xKind: 'number', yUnit: 'kW', yFields: [{ field: 'power_kw', label: 'Power', unit: 'kW', color: accent }], marks: ['scatter'] }),
  },
  {
    slug: 'charging-sessions-energy',
    title: 'Daily Charge Sessions',
    description: 'Daily stacked charge sessions, with AC/DC/Unknown grouping, legend, and day-level hover details.',
    ...definition({ slug: 'charging-sessions-energy', placements: ['overview', 'charging'], sourceId: 'charging.sessions', xField: 'day_start', xKind: 'time', yUnit: 'kWh', yFields: [{ field: 'total_energy_kwh', label: 'Energy Charged', unit: 'kWh', color: accent }], marks: ['bar'] }),
  },
  {
    slug: 'charging-weekly-energy',
    title: 'Energy Charged',
    description: 'Daily total charging energy from stored charging sessions, shown as filled bars with day-level hover details.',
    ...definition({ slug: 'charging-weekly-energy', placements: ['overview', 'charging'], sourceId: 'charging.sessions', xField: 'day_start', xKind: 'time', yUnit: 'kWh', yFields: [{ field: 'total_energy_kwh', label: 'Energy Charged', unit: 'kWh', color: emerald }], marks: ['bar'] }),
  },
  {
    slug: 'efficiency-mode',
    title: 'Efficiency by Drive Mode',
    description: 'Average driving efficiency grouped by Rivian drive mode.',
    ...definition({ slug: 'efficiency-mode', placements: ['overview', 'efficiency'], sourceId: 'efficiency.drive-mode', xField: 'drive_mode', xKind: 'category', yUnit: 'Wh/mi', yFields: [{ field: 'avg_efficiency_wh_mi', label: 'Efficiency', unit: 'Wh/mi', color: accent }], marks: ['bar'] }),
  },
  {
    slug: 'efficiency-tags',
    title: 'Efficiency by Tag',
    description: 'Distance-weighted driving efficiency grouped by shared trip tags.',
    ...definition({ slug: 'efficiency-tags', placements: ['efficiency'], sourceId: 'efficiency.trip-tags', xField: 'tag_name', xKind: 'category', yUnit: 'Wh/mi', yFields: [{ field: 'avg_efficiency_wh_mi', label: 'Efficiency', unit: 'Wh/mi', color: violet }], marks: ['bar'] }),
  },
  {
    slug: 'efficiency-temperature',
    title: 'Efficiency by Temperature',
    description: 'Driving efficiency against outside temperature bins.',
    ...definition({ slug: 'efficiency-temperature', placements: ['overview', 'efficiency'], sourceId: 'efficiency.temperature', xField: 'temp_c_low', xKind: 'number', yUnit: 'Wh/mi', yFields: [{ field: 'avg_efficiency_wh_mi', label: 'Efficiency', unit: 'Wh/mi', color: sky }], marks: ['scatter'] }),
  },
  {
    slug: 'efficiency-trend',
    title: 'Efficiency Trend',
    description: 'Per-trip driving efficiency and a distance-weighted rolling 24-hour trend.',
    ...definition({ slug: 'efficiency-trend', placements: ['overview', 'efficiency', 'trips'], sourceId: 'efficiency.trend', xField: 'timestamp', xKind: 'time', yUnit: 'Wh/mi', yFields: [{ field: 'trip_efficiency_wh_mi', label: 'Trip Efficiency', unit: 'Wh/mi', color: accent }, { field: 'rolling_24h_wh_mi', label: '24-hour Average', unit: 'Wh/mi', color: emerald }] }),
  },
  {
    slug: 'phantom-drain',
    title: 'Daily Phantom Drain',
    description: 'Battery lost during validated parked periods, grouped by day.',
    ...definition({ slug: 'phantom-drain', placements: ['overview', 'battery'], sourceId: 'battery.idle-drain', xField: 'day_start', xKind: 'time', yUnit: '% SoC lost', yFields: [{ field: 'soc_lost_pct', label: 'SoC Lost', unit: '%', color: amber }], marks: ['bar'] }),
  },
  {
    slug: 'projected-range-mileage',
    title: 'Projected Range by Mileage',
    description: 'Projected max range over time with a secondary mileage axis.',
    ...definition({ slug: 'projected-range-mileage', placements: ['overview', 'battery'], sourceId: 'battery.mileage', xField: 'odometer_miles', xKind: 'number', yUnit: 'mi', yFields: [{ field: 'projected_max_range_mi', label: 'Projected Range', unit: 'mi', color: emerald }] }),
  },
  {
    slug: 'soc-history',
    title: 'State of Charge',
    description: 'State of charge over time. Hover to see active range.',
    ...definition({ slug: 'soc-history', placements: ['overview', 'battery'], sourceId: 'metrics.series', xField: 'timestamp', xKind: 'time', yUnit: '%', yFields: [{ field: 'battery_level', label: 'State of Charge', unit: '%', color: accent }], marks: ['area'] }),
  },
  {
    slug: 'tire-pressure-trips',
    title: 'Tire Pressure and Trips',
    description: 'Full-density tire pressure readings aligned with the trips that occurred in the same timeframe.',
    ...definition({ slug: 'tire-pressure-trips', placements: ['overview', 'trips'], sourceId: 'trips.tire-pressure-timeline', xField: 'timestamp', xKind: 'time', yUnit: 'psi', yFields: [{ field: 'front_left_psi', label: 'Front Left', unit: 'psi', color: accent }, { field: 'front_right_psi', label: 'Front Right', unit: 'psi', color: emerald }, { field: 'rear_left_psi', label: 'Rear Left', unit: 'psi', color: sky }, { field: 'rear_right_psi', label: 'Rear Right', unit: 'psi', color: violet }] }),
  },
].map((entry) => {
  const { slug, title, description, ...config } = entry;
  return { slug, title, description, ...ChartDefinitionV1Schema.parse(config) };
}) as ReadonlyArray<ChartDefinitionV1 & { slug: string; title: string; description: string }>;

export const BUNDLED_CHART_SLUGS = BUNDLED_CHART_DEFINITIONS.map((chart) => chart.slug);

export function getBundledChartDefinition(slug: string) {
  return BUNDLED_CHART_DEFINITIONS.find((chart) => chart.slug === slug);
}
