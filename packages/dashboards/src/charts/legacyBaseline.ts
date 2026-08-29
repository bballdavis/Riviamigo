import type {
  ChartColorDefinition,
  ChartDefinitionV1,
  ChartRecord,
} from '@riviamigo/types';
import { getBundledChartDefinition } from './defaults';
import { ChartDefinitionV1Schema } from './schema';

interface LegacyMileageBaseline {
  primaryField: string;
  definition: ChartDefinitionV1;
}

const LEGACY_MILEAGE_BASELINES: Record<string, LegacyMileageBaseline> = {
  'battery-capacity-mileage': {
    primaryField: 'usable_kwh',
    definition: legacyMileageDefinition({
      primaryField: 'usable_kwh',
      primaryLabel: 'Usable Capacity',
      primaryUnit: 'kWh',
      primaryColor: { mode: 'token', token: 'accent' },
      showPoints: true,
    }),
  },
  'projected-range-mileage': {
    primaryField: 'projected_max_range_mi',
    definition: legacyMileageDefinition({
      primaryField: 'projected_max_range_mi',
      primaryLabel: 'Projected Range',
      primaryUnit: 'mi',
      primaryColor: { mode: 'token', token: 'emerald' },
    }),
  },
};

/**
 * Repairs the two exact incomplete mileage-chart definitions shipped by the
 * first persisted-chart baseline. Placement, timeframe, and primary color are
 * deliberately ignored by the fingerprint because those values could differ
 * without correcting the broken renderer geometry. Every other serialized
 * field must still match the obsolete baseline.
 */
export function normalizeLegacyBundledChartRecord(record: ChartRecord): ChartRecord {
  const baseline = LEGACY_MILEAGE_BASELINES[record.slug];
  if (!baseline || !matchesLegacyMileageBaseline(record.config, baseline.definition)) {
    return record;
  }

  const bundled = getBundledChartDefinition(record.slug);
  if (!bundled) return record;
  const canonical = ChartDefinitionV1Schema.parse(bundled) as unknown as ChartDefinitionV1;
  const legacyPrimary = record.config.series[0];

  canonical.placements = structuredClone(record.config.placements);
  canonical.series = canonical.series.map((series) =>
    series.y.field === baseline.primaryField && legacyPrimary
      ? { ...series, color: structuredClone(legacyPrimary.color) }
      : series
  );

  return { ...record, config: canonical };
}

function matchesLegacyMileageBaseline(
  definition: ChartDefinitionV1,
  baseline: ChartDefinitionV1
) {
  const candidate = structuredClone(definition);
  candidate.placements = structuredClone(baseline.placements);
  candidate.timeframe = structuredClone(baseline.timeframe);
  if (candidate.series[0] && baseline.series[0]) {
    candidate.series[0].color = structuredClone(baseline.series[0].color);
  }
  return structurallyEqual(candidate, baseline);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    structurallyEqual(leftKeys, rightKeys) &&
    leftKeys.every((key) => structurallyEqual(leftRecord[key], rightRecord[key]))
  );
}

function legacyMileageDefinition({
  primaryField,
  primaryLabel,
  primaryUnit,
  primaryColor,
  showPoints,
}: {
  primaryField: string;
  primaryLabel: string;
  primaryUnit: string;
  primaryColor: ChartColorDefinition;
  showPoints?: boolean;
}): ChartDefinitionV1 {
  return {
    schemaVersion: 1,
    placements: [{ dashboardSlug: 'overview' }, { dashboardSlug: 'battery' }],
    timeframe: { mode: 'dashboard' },
    sources: [
      {
        id: 'main',
        sourceId: 'battery.mileage',
        params: {},
        filters: [],
        inherit: { vehicle: true, timeframe: true },
      },
    ],
    x: { field: { sourceBindingId: 'main', field: 'odometer_miles' }, kind: 'number' },
    series: [
      {
        id: primaryField,
        label: primaryLabel,
        y: { sourceBindingId: 'main', field: primaryField },
        mark: 'line',
        yAxis: 'y',
        color: primaryColor,
        transforms: [],
        visibleInLegend: true,
      },
    ],
    axes: {
      x: { scale: 'linear', domain: { mode: 'auto' } },
      y: { scale: 'linear', unit: primaryUnit, domain: { mode: 'auto' } },
    },
    display: {
      legend: 'hide',
      grid: true,
      tooltip: true,
      timeFilter: 'raw',
      curveSmoothness: 'gentle',
      ...(showPoints ? { showPoints: true } : {}),
    },
    interaction: { panZoom: true, touchExplore: true, connectGaps: false },
  };
}
