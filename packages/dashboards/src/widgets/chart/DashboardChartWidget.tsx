import React from 'react';
import {
  useBatteryMileage,
  useChargeSessions,
  useChargingSummary,
  useDegradation,
  useEfficiencyByMode,
  useEfficiencyTrend,
  useEfficiencyVsTemp,
  usePhantomDrain,
  useRangeHistory,
  useSocHistory,
} from '@riviamigo/hooks';
import { RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { ChartPicker } from '@riviamigo/ui/primitives';
import {
  formatMiles,
  formatTemp,
  getEfficiencyDisplay,
  getUnitSystem,
  whPerMileToKmPerKwh,
  whPerMileToMiPerKwh,
  whPerMileToWhPerKm,
} from '@riviamigo/ui/lib/utils';
import type { ChargeSession } from '@riviamigo/types';
import {
  getChartDefinition,
  getChartDefinitions,
  getChartOptions,
  type DashboardChartDefinition,
  type DashboardChartPage,
} from '../../charts/catalog';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import { useMeasuredWidgetHeight } from '../useMeasuredWidgetHeight';

interface DashboardChartOptions {
  chartId?: string;
  chartIds?: string[];
  page?: DashboardChartPage;
  showPicker?: boolean;
}

interface ResolvedDashboardChartOptions {
  chartId: string;
  chartIds: string[];
  page?: DashboardChartPage;
  showPicker: boolean;
}

function readOptions(instance: WidgetInstance): ResolvedDashboardChartOptions {
  const options = (instance.options ?? {}) as DashboardChartOptions;
  const page = isDashboardChartPage(options.page) ? options.page : undefined;
  const pageDefinitions = getChartDefinitions(page);
  const validIds = new Set(pageDefinitions.map((definition) => definition.id));
  const chartIds = Array.isArray(options.chartIds)
    ? options.chartIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))
    : [];
  const fallbackIds = chartIds.length > 0 ? chartIds : pageDefinitions.map((definition) => definition.id);
  const fallbackChartId = fallbackIds[0] ?? getChartDefinitions()[0]?.id ?? 'soc-history';
  const chartId = typeof options.chartId === 'string' && validIds.has(options.chartId)
    ? options.chartId
    : fallbackChartId;

  return {
    chartId,
    chartIds: fallbackIds,
    showPicker: options.showPicker ?? fallbackIds.length > 1,
    ...(page ? { page } : {}),
  };
}

export function DashboardChartWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const options = readOptions(instance);
  const chartOptions = getChartOptions(options.page).filter((option) => options.chartIds.includes(option.value));
  const [chartId, setChartId] = React.useState(options.chartId);
  const [search, setSearch] = React.useState('');
  const { ref, height } = useMeasuredWidgetHeight(260, 160);

  React.useEffect(() => {
    if (!options.chartIds.includes(chartId)) {
      setChartId(options.chartId);
    }
  }, [chartId, options.chartId, options.chartIds]);

  const activeChartId = options.chartIds.includes(chartId) ? chartId : options.chartId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {options.showPicker && chartOptions.length > 1 ? (
        <ChartPicker
          value={activeChartId}
          options={chartOptions}
          onChange={setChartId}
          searchValue={search}
          onSearchChange={setSearch}
          className="shrink-0"
        />
      ) : null}
      <div ref={ref} className="min-h-0 flex-1">
        <DashboardChartRenderer chartId={activeChartId} ctx={ctx} height={height} />
      </div>
    </div>
  );
}

function DashboardChartRenderer({ chartId, ctx, height }: { chartId: string; ctx: WidgetCtx; height: number }) {
  const definition = getChartDefinition(chartId);
  const source = definition?.source;
  const { data: soc = [], isLoading: socLoading } = useSocHistory(source === 'soc_history' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: range = [], isLoading: rangeLoading } = useRangeHistory(source === 'range_history' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: chargeSummary, isLoading: chargeSummaryLoading } = useChargingSummary(source === 'charging_weekly_energy' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: sessionsPage, isLoading: sessionsLoading } = useChargeSessions(
    source === 'charging_sessions_energy' || source === 'charge_level' ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
    1,
    200,
  );
  const { data: trend = [], isLoading: trendLoading } = useEfficiencyTrend(source === 'efficiency_trend' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: efficiencyByMode = [], isLoading: efficiencyByModeLoading } = useEfficiencyByMode(source === 'efficiency_mode' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: efficiencyByTemp = [], isLoading: efficiencyByTempLoading } = useEfficiencyVsTemp(source === 'efficiency_temperature' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: phantom = [], isLoading: phantomLoading } = usePhantomDrain(source === 'phantom_drain' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(source === 'battery_degradation' ? ctx.vehicleId : null);
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(
    source === 'battery_capacity_mileage' || source === 'projected_range_mileage' ? ctx.vehicleId : null,
  );

  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown chart: {chartId}
      </div>
    );
  }

  const sessions = sessionsPage?.items ?? [];
  const weekly = chargeSummary?.weekly ?? [];

  switch (definition.source) {
    case 'soc_history':
      return renderSingleChart(definition, height, socLoading, soc.map((point) => ({ ts: point.ts, value: point.soc ?? null })));
    case 'range_history':
      return renderSingleChart(definition, height, rangeLoading, range.map((point) => ({ ts: point.ts, value: point.range_mi ?? null })));
    case 'charge_level':
      return renderSingleChart(definition, height, sessionsLoading, buildChargeLevelSeries(sessions).map((point) => ({ ts: point.ts, value: point.soc })));
    case 'charging_sessions_energy':
      return (
        <ChargingSessionsChart
          definition={definition}
          sessions={sessions}
          loading={sessionsLoading}
          height={height}
        />
      );
    case 'charging_weekly_energy':
      return renderSingleChart(
        definition,
        height,
        chargeSummaryLoading,
        weekly.map((point) => ({ ts: point.week_start, value: point.energy_kwh ?? null })),
      );
    case 'efficiency_trend':
      return <EfficiencyTrendChart definition={definition} trend={trend} loading={trendLoading} height={height} />;
    case 'efficiency_temperature':
      return <EfficiencyTemperatureChart definition={definition} data={efficiencyByTemp} loading={efficiencyByTempLoading} height={height} />;
    case 'efficiency_mode':
      return <EfficiencyModeChart definition={definition} data={efficiencyByMode} loading={efficiencyByModeLoading} height={height} />;
    case 'phantom_drain':
      return renderSingleChart(definition, height, phantomLoading, phantom.map((point) => ({ ts: point.date, value: point.drain_pct ?? null })));
    case 'battery_degradation':
      return renderSingleChart(definition, height, degradationLoading, degradation.map((point) => ({ ts: point.ts, value: point.capacity_pct ?? null })));
    case 'battery_capacity_mileage':
      return (
        <MileageChart
          definition={definition}
          loading={mileageLoading}
          height={height}
          points={mileage.map((point) => ({ x: point.odometer_mi, y: point.usable_kwh }))}
        />
      );
    case 'projected_range_mileage':
      return (
        <MileageChart
          definition={definition}
          loading={mileageLoading}
          height={height}
          points={mileage.map((point) => ({ x: point.odometer_mi, y: point.range_mi }))}
        />
      );
  }
}

function renderSingleChart(
  definition: DashboardChartDefinition,
  height: number,
  loading: boolean,
  data: Array<{ ts: string; value: number | null }>,
) {
  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={[{ key: definition.id, label: definition.title, values: data.map((point) => point.value) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      mode={definition.mode}
    />
  );
}

function ChargingSessionsChart({
  definition,
  sessions,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  sessions: ChargeSession[];
  loading: boolean;
  height: number;
}) {
  const sorted = [...sessions].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  return (
    <RichTimeSeriesChart
      points={sorted.map((session) => ({ ts: session.started_at }))}
      series={[{ key: 'energy', label: definition.title, values: sorted.map((session) => session.energy_added_kwh ?? null) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      mode={definition.mode}
    />
  );
}

function EfficiencyTrendChart({
  definition,
  trend,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  trend: Array<{ day: string; day_avg_wh_mi: number | null; rolling_7d_wh_mi: number | null }>;
  loading: boolean;
  height: number;
}) {
  const unit = getEfficiencyUnit();
  return (
    <RichTimeSeriesChart
      points={trend.map((point) => ({ ts: point.day }))}
      series={[
        { key: 'daily', label: 'Daily', values: trend.map((point) => convertEfficiency(point.day_avg_wh_mi)) },
        { key: 'rolling', label: '7-day avg', values: trend.map((point) => convertEfficiency(point.rolling_7d_wh_mi)) },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={unit}
      mode={definition.mode}
    />
  );
}

function EfficiencyTemperatureChart({
  definition,
  data,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  data: Array<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null }>;
  loading: boolean;
  height: number;
}) {
  const points = data
    .filter((point) => point.avg_efficiency_wh_mi != null)
    .map((point) => ({
      x: (point.temp_c_low + point.temp_c_high) / 2,
      y: convertEfficiency(point.avg_efficiency_wh_mi),
    }));

  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point.x }))}
      series={[{ key: 'efficiency', label: definition.title, values: points.map((point) => point.y) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      xUnit={getUnitSystem() === 'metric' ? 'C' : 'F'}
      yUnit={getEfficiencyUnit()}
      mode="scatter"
      xValueFormatter={(value) => formatTemp(value)}
    />
  );
}

function EfficiencyModeChart({
  definition,
  data,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  data: Array<{ drive_mode: string; avg_efficiency: number | null }>;
  loading: boolean;
  height: number;
}) {
  const rows = data.filter((point) => point.avg_efficiency != null);
  return (
    <RichTimeSeriesChart
      points={rows.map((_, index) => ({ ts: index + 1 }))}
      series={[{ key: 'efficiency', label: definition.title, values: rows.map((point) => convertEfficiency(point.avg_efficiency)) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      yUnit={getEfficiencyUnit()}
      mode="bar"
      xValueFormatter={(value) => rows[Math.round(value) - 1]?.drive_mode ?? ''}
    />
  );
}

function MileageChart({
  definition,
  points,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  points: Array<{ x: number | null; y: number | null }>;
  loading: boolean;
  height: number;
}) {
  const rows = points
    .filter((point): point is { x: number; y: number } => point.x != null && point.y != null)
    .sort((a, b) => a.x - b.x);

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: point.x }))}
      series={[{ key: definition.id, label: definition.title, values: rows.map((point) => point.y) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      xUnit="mi"
      yUnit={definition.yUnit}
      mode={definition.mode}
      xValueFormatter={(value) => formatMiles(value).replace(/\s.*/, '')}
    />
  );
}

function buildChargeLevelSeries(sessions: Array<{ started_at: string; ended_at?: string | null; soc_start?: number | null; soc_end?: number | null }>) {
  return [...sessions]
    .filter((session) => session.soc_end != null)
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
    .flatMap((session) => {
      const points: Array<{ ts: string; soc: number | null }> = [];
      if (session.soc_start != null) points.push({ ts: session.started_at, soc: session.soc_start });
      points.push({ ts: session.ended_at ?? session.started_at, soc: session.soc_end ?? null });
      return points;
    });
}

function getEfficiencyUnit() {
  const isMetric = getUnitSystem() === 'metric';
  const display = getEfficiencyDisplay();
  return display === 'energy_per_distance'
    ? isMetric ? 'Wh/km' : 'Wh/mi'
    : isMetric ? 'km/kWh' : 'mi/kWh';
}

function convertEfficiency(value: number | null | undefined) {
  if (value == null) return null;
  const isMetric = getUnitSystem() === 'metric';
  const display = getEfficiencyDisplay();
  if (display === 'energy_per_distance') {
    return isMetric ? whPerMileToWhPerKm(value) : value;
  }
  return isMetric ? whPerMileToKmPerKwh(value) : whPerMileToMiPerKwh(value);
}

function isDashboardChartPage(value: unknown): value is DashboardChartPage {
  return value === 'overview' || value === 'battery' || value === 'charging' || value === 'efficiency' || value === 'trips';
}

registerWidget({
  componentType: 'chart',
  definitionId: 'catalog',
  title: 'Chart',
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 4, h: 6 },
  defaultOptions: {
    page: 'overview',
    chartId: 'soc-history',
    showPicker: true,
  },
  component: DashboardChartWidget,
});
