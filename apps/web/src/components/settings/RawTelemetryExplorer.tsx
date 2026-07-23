import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Clipboard, Database, RefreshCw, Search, SlidersHorizontal,
} from 'lucide-react';
import { api } from '@riviamigo/hooks';
import type { RawEventDetail, RawTelemetrySample, Vehicle } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { CHART_COLORS, RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { formatAppDateTime } from '@riviamigo/ui/lib/dateTime';

type FieldGroup = 'Battery & charging' | 'Drive & location' | 'Climate' | 'Tires' | 'Closures & locks' | 'Software & health';

type FieldDefinition = {
  key: keyof RawTelemetrySample;
  label: string;
  group: FieldGroup;
  unit?: string;
};

const FIELD_DEFINITIONS: FieldDefinition[] = [
  { key: 'battery_level', label: 'State of charge', group: 'Battery & charging', unit: '%' },
  { key: 'battery_capacity_wh', label: 'Battery capacity', group: 'Battery & charging', unit: 'Wh' },
  { key: 'distance_to_empty_mi', label: 'Estimated range', group: 'Battery & charging', unit: 'mi' },
  { key: 'battery_limit', label: 'Charge limit', group: 'Battery & charging', unit: '%' },
  { key: 'charger_state', label: 'Charger state', group: 'Battery & charging' },
  { key: 'charger_status', label: 'Charger status', group: 'Battery & charging' },
  { key: 'time_to_end_of_charge_min', label: 'Time to limit', group: 'Battery & charging', unit: 'min' },
  { key: 'power_kw', label: 'Power', group: 'Battery & charging', unit: 'kW' },
  { key: 'regen_power_kw', label: 'Regen power', group: 'Battery & charging', unit: 'kW' },
  { key: 'speed_mph', label: 'Speed', group: 'Drive & location', unit: 'mph' },
  { key: 'odometer_miles', label: 'Odometer', group: 'Drive & location', unit: 'mi' },
  { key: 'drive_mode', label: 'Drive mode', group: 'Drive & location' },
  { key: 'gear_status', label: 'Gear', group: 'Drive & location' },
  { key: 'latitude', label: 'Latitude', group: 'Drive & location' },
  { key: 'longitude', label: 'Longitude', group: 'Drive & location' },
  { key: 'altitude_m', label: 'Altitude', group: 'Drive & location', unit: 'm' },
  { key: 'heading_deg', label: 'Heading', group: 'Drive & location', unit: '°' },
  { key: 'cabin_temp_c', label: 'Cabin temperature', group: 'Climate', unit: '°C' },
  { key: 'driver_temp_c', label: 'Driver temperature', group: 'Climate', unit: '°C' },
  { key: 'outside_temp_c', label: 'Outside temperature', group: 'Climate', unit: '°C' },
  { key: 'hvac_active', label: 'HVAC active', group: 'Climate' },
  { key: 'tire_fl_psi', label: 'Front-left pressure', group: 'Tires', unit: 'psi' },
  { key: 'tire_fr_psi', label: 'Front-right pressure', group: 'Tires', unit: 'psi' },
  { key: 'tire_rl_psi', label: 'Rear-left pressure', group: 'Tires', unit: 'psi' },
  { key: 'tire_rr_psi', label: 'Rear-right pressure', group: 'Tires', unit: 'psi' },
  { key: 'tire_fl_status', label: 'Front-left status', group: 'Tires' },
  { key: 'tire_fr_status', label: 'Front-right status', group: 'Tires' },
  { key: 'tire_rl_status', label: 'Rear-left status', group: 'Tires' },
  { key: 'tire_rr_status', label: 'Rear-right status', group: 'Tires' },
  { key: 'tire_fl_valid', label: 'Front-left valid', group: 'Tires' },
  { key: 'tire_fr_valid', label: 'Front-right valid', group: 'Tires' },
  { key: 'tire_rl_valid', label: 'Rear-left valid', group: 'Tires' },
  { key: 'tire_rr_valid', label: 'Rear-right valid', group: 'Tires' },
  { key: 'door_front_left_locked', label: 'Front-left lock', group: 'Closures & locks' },
  { key: 'door_front_right_locked', label: 'Front-right lock', group: 'Closures & locks' },
  { key: 'door_rear_left_locked', label: 'Rear-left lock', group: 'Closures & locks' },
  { key: 'door_rear_right_locked', label: 'Rear-right lock', group: 'Closures & locks' },
  { key: 'door_front_left_closed', label: 'Front-left door', group: 'Closures & locks' },
  { key: 'door_front_right_closed', label: 'Front-right door', group: 'Closures & locks' },
  { key: 'door_rear_left_closed', label: 'Rear-left door', group: 'Closures & locks' },
  { key: 'door_rear_right_closed', label: 'Rear-right door', group: 'Closures & locks' },
  { key: 'closure_frunk_closed', label: 'Frunk', group: 'Closures & locks' },
  { key: 'closure_liftgate_closed', label: 'Liftgate', group: 'Closures & locks' },
  { key: 'closure_tailgate_closed', label: 'Tailgate', group: 'Closures & locks' },
  { key: 'ota_current_version', label: 'Current software', group: 'Software & health' },
  { key: 'ota_available_version', label: 'Available software', group: 'Software & health' },
  { key: 'ota_status', label: 'OTA status', group: 'Software & health' },
  { key: 'ota_current_status', label: 'OTA detail', group: 'Software & health' },
  { key: 'hv_thermal_event', label: 'High-voltage thermal event', group: 'Software & health' },
  { key: 'twelve_volt_health', label: '12V health', group: 'Software & health' },
  { key: 'is_online', label: 'Online', group: 'Software & health' },
];

const GROUPS = Array.from(new Set(FIELD_DEFINITIONS.map((field) => field.group)));

const TIMEFRAMES = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All stored telemetry' },
] as const;

type Timeframe = typeof TIMEFRAMES[number]['value'];

export function RawTelemetryExplorer({ vehicles, isAdmin }: { vehicles: Vehicle[]; isAdmin: boolean }) {
  const [vehicleId, setVehicleId] = React.useState('');
  const [timeframe, setTimeframe] = React.useState<Timeframe>('24h');
  const [search, setSearch] = React.useState('');
  const [selectedField, setSelectedField] = React.useState('');
  const [populatedOnly, setPopulatedOnly] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [selectedSampleTime, setSelectedSampleTime] = React.useState<string | null>(null);
  const [showEmptyFields, setShowEmptyFields] = React.useState(false);
  const [eventsOpen, setEventsOpen] = React.useState(false);
  const [selectedEventId, setSelectedEventId] = React.useState<string | null>(null);
  const [eventType, setEventType] = React.useState('');
  const [collectorOpen, setCollectorOpen] = React.useState(false);

  React.useEffect(() => {
    if (!vehicleId && vehicles[0]) setVehicleId(vehicles[0].id);
    if (vehicleId && !vehicles.some((vehicle) => vehicle.id === vehicleId)) setVehicleId(vehicles[0]?.id ?? '');
  }, [vehicleId, vehicles]);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const canInspectEvents = selectedVehicle?.membership_role === 'owner' || selectedVehicle?.membership_role === 'manager';
  const bounds = React.useMemo(() => timeframeBounds(timeframe), [timeframe]);
  const query = useQuery({
    queryKey: ['raw-telemetry', vehicleId, bounds.from, bounds.to, page, search, selectedField, populatedOnly],
    queryFn: () => api.getRawTelemetry(vehicleId, {
      ...bounds,
      page,
      per_page: 25,
      search,
      populated_only: populatedOnly,
      ...(selectedField ? { fields: [selectedField] } : {}),
    }),
    enabled: !!vehicleId,
  });
  const laneQuery = useQuery({
    queryKey: ['raw-telemetry-lanes', vehicleId, bounds.from, bounds.to],
    queryFn: () => api.getTelemetryLanes(vehicleId, {
      ...bounds,
      lanes: ['battery', 'drive', 'location'],
      resolution: 'auto',
      max_points: 256,
    }),
    enabled: !!vehicleId && timeframe !== 'all',
  });
  const eventQuery = useQuery({
    queryKey: ['raw-events', vehicleId, bounds.from, bounds.to, eventType],
    queryFn: () => api.getRawEvents(vehicleId, { ...bounds, per_page: 25, ...(eventType ? { event_type: eventType } : {}) }),
    enabled: eventsOpen && canInspectEvents && !!vehicleId,
  });
  const eventDetail = useQuery({
    queryKey: ['raw-event', vehicleId, selectedEventId],
    queryFn: () => api.getRawEvent(vehicleId, selectedEventId!),
    enabled: eventsOpen && canInspectEvents && !!vehicleId && !!selectedEventId,
  });
  const stewardship = useQuery({
    queryKey: ['rivian-stewardship'],
    queryFn: () => api.getRivianStewardship(),
    enabled: isAdmin && collectorOpen,
  });

  const samples = query.data?.samples ?? [];
  const selectedSample = samples.find((sample) => sample.ts === selectedSampleTime) ?? samples[0] ?? null;
  const total = query.data?.total ?? query.data?.coverage.sample_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (query.data?.per_page ?? 25)));
  const fieldCoverage = React.useMemo(
    () => new Map((query.data?.field_coverage ?? []).map((item) => [item.field, item.sample_count])),
    [query.data?.field_coverage],
  );
  const populatedFieldCount = [...fieldCoverage.values()].filter((count) => count > 0).length;
  const lanePoints = laneQuery.data?.spine.map((ts) => ({ ts })) ?? [];
  const laneSeries = React.useMemo(() => {
    const frame = laneQuery.data;
    return [
      { key: 'battery_level', label: 'State of charge', color: CHART_COLORS.emerald, values: frame?.lanes.battery?.numeric.battery_level ?? [], yScale: 'y' as const },
      { key: 'speed_mph', label: 'Speed', color: CHART_COLORS.sky, values: frame?.lanes.drive?.numeric.speed_mph ?? [], yScale: 'y2' as const },
      { key: 'power_kw', label: 'Power', color: CHART_COLORS.violet, values: frame?.lanes.drive?.numeric.power_kw ?? [], yScale: 'y2' as const },
    ].filter((series) => series.values.some((value) => value !== null));
  }, [laneQuery.data]);

  function resetPage() {
    setPage(1);
    setSelectedSampleTime(null);
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Telemetry Explorer</CardTitle>
            <p className="mt-1 text-sm text-fg-tertiary">Search stored, normalized Rivian telemetry before promoting a field to a dashboard.</p>
          </div>
          <Button variant="secondary" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} loading={query.isFetching} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(10rem,0.8fr)_11rem_minmax(0,1fr)_auto] lg:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Vehicle</span>
              <SelectPicker value={vehicleId} onChange={(value) => { setVehicleId(value); resetPage(); }} aria-label="Telemetry vehicle" options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.display_name }))} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Timeframe</span>
              <SelectPicker value={timeframe} onChange={(value) => { setTimeframe(value as Timeframe); resetPage(); }} aria-label="Telemetry timeframe" options={TIMEFRAMES.map((item) => ({ value: item.value, label: item.label }))} />
            </label>
            <label className="relative grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Search fields or values</span>
              <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-fg-tertiary" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="e.g. tire, charging, 78" className="h-9 w-full rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-tertiary focus:border-accent" />
            </label>
            <label className="flex min-h-9 items-center gap-2 text-sm text-fg-secondary">
              <input type="checkbox" checked={populatedOnly} onChange={(event) => { setPopulatedOnly(event.target.checked); resetPage(); }} className="h-4 w-4 accent-accent" />
              Has a value
            </label>
          </div>
          {selectedField ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-fg">
              <span>Filtering records with <strong>{fieldLabel(selectedField)}</strong>.</span>
              <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => { setSelectedField(''); resetPage(); }}>Clear field</button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Telemetry health summary">
        <SummaryCard label="Stored samples" value={formatCount(query.data?.coverage.sample_count)} detail={timeframe === 'all' ? 'All retained telemetry' : TIMEFRAMES.find((item) => item.value === timeframe)?.label} />
        <SummaryCard label="Latest sample" value={formatDate(query.data?.coverage.last_event_at)} detail={query.data?.coverage.last_event_at ? 'Within this filter' : 'No matching sample'} />
        <SummaryCard label="History starts" value={formatDate(query.data?.coverage.first_event_at)} detail="Filtered result span" />
        <SummaryCard label="Fields populated" value={String(populatedFieldCount)} detail={`${FIELD_DEFINITIONS.length} tracked fields`} />
      </section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Telemetry density</CardTitle>
            <p className="mt-1 text-sm text-fg-tertiary">Bucketed lanes keep long history bounded for charts; select a record below for normalized field detail.</p>
          </div>
          {laneQuery.data ? <Badge variant="info">{laneQuery.data.window.resolution_seconds}s resolution</Badge> : null}
        </CardHeader>
        <CardContent>
          {timeframe === 'all' ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-fg-tertiary">Choose a bounded timeframe to visualize dense telemetry history.</p> : null}
          {timeframe !== 'all' && laneQuery.isLoading ? <p className="rounded-xl border border-border p-4 text-sm text-fg-tertiary">Loading bucketed telemetry lanes…</p> : null}
          {timeframe !== 'all' && !laneQuery.isLoading && lanePoints.length > 0 && laneSeries.length > 0 ? (
            <RichTimeSeriesChart points={lanePoints} series={laneSeries} height={260} xTime yUnit="%" yRightUnit="mixed" emptyTitle="No bucketed telemetry" cursorSyncKey="settings-raw-telemetry" />
          ) : null}
          {timeframe !== 'all' && !laneQuery.isLoading && lanePoints.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-fg-tertiary">No bucketed telemetry is available for this timeframe.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Field coverage</CardTitle>
            <p className="mt-1 text-sm text-fg-tertiary">Select a field to inspect records where Rivian supplied it.</p>
          </div>
          <Badge variant="info">{populatedFieldCount} populated</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {GROUPS.map((group) => (
            <div key={group} className="rounded-xl border border-border bg-bg-elevated/35 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">{group}</p>
              <div className="grid gap-1">
                {FIELD_DEFINITIONS.filter((field) => field.group === group).map((field) => {
                  const count = fieldCoverage.get(field.key) ?? 0;
                  const active = selectedField === field.key;
                  return (
                    <button key={field.key} type="button" onClick={() => { setSelectedField(active ? '' : field.key); resetPage(); }} className={[
                      'flex min-h-9 items-center justify-between gap-3 rounded-lg px-2 text-left text-sm transition-colors',
                      active ? 'bg-accent/15 text-fg ring-1 ring-inset ring-accent/35' : 'text-fg-secondary hover:bg-bg-elevated hover:text-fg',
                    ].join(' ')}>
                      <span className="min-w-0 truncate">{field.label}</span>
                      <span className="shrink-0 font-mono text-xs text-fg-tertiary">{formatCount(count)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Records</CardTitle>
            <p className="mt-1 text-sm text-fg-tertiary">Select a sample to compare its normalized fields without losing the surrounding timeline.</p>
          </div>
          <Badge variant="default">{formatCount(total)} matches</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-2">
            {query.isLoading ? <p className="rounded-xl border border-border p-4 text-sm text-fg-tertiary">Loading telemetry records…</p> : null}
            {!query.isLoading && samples.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-fg-tertiary">No stored telemetry matches this filter.</p> : null}
            {samples.map((sample) => <TelemetryRecord key={sample.ts} sample={sample} selected={selectedSample?.ts === sample.ts} onSelect={() => setSelectedSampleTime(sample.ts)} />)}
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-fg-tertiary">Page {query.data?.page ?? page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button aria-label="Previous telemetry page" variant="secondary" size="sm" disabled={page <= 1} iconLeft={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => { setPage((current) => Math.max(1, current - 1)); setSelectedSampleTime(null); }}>Previous</Button>
                <Button aria-label="Next telemetry page" variant="secondary" size="sm" disabled={page >= totalPages} iconLeft={<ChevronRight className="h-3.5 w-3.5" />} onClick={() => { setPage((current) => Math.min(totalPages, current + 1)); setSelectedSampleTime(null); }}>Next</Button>
              </div>
            </div>
          </div>
          <TelemetryDetails sample={selectedSample} showEmptyFields={showEmptyFields} onShowEmptyFields={setShowEmptyFields} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Inbound Rivian events</CardTitle>
            <p className="mt-1 text-sm text-fg-tertiary">Exact websocket payloads are retained briefly for upstream troubleshooting.</p>
          </div>
          <Button variant="secondary" size="sm" iconLeft={<Database className="h-3.5 w-3.5" />} onClick={() => setEventsOpen((current) => !current)}>{eventsOpen ? 'Hide events' : 'Inspect events'}</Button>
        </CardHeader>
        {eventsOpen ? (
          <CardContent className="grid gap-4">
            {!canInspectEvents ? <p className="rounded-xl border border-border bg-bg-elevated/35 p-4 text-sm text-fg-tertiary">Original Rivian payloads are available to vehicle owners and managers only.</p> : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="grid gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Event type</span>
                    <input value={eventType} onChange={(event) => { setEventType(event.target.value); setSelectedEventId(null); }} placeholder="Optional exact type" className="h-9 rounded-lg border border-border bg-bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-tertiary focus:border-accent" />
                  </label>
                  <p className="pb-1 text-xs text-fg-tertiary">Stored for {eventQuery.data?.retention_days ?? 7} days. Payload contents may be unstable.</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.2fr)]">
                  <div className="grid content-start gap-2">
                    {eventQuery.isLoading ? <p className="text-sm text-fg-tertiary">Loading retained events…</p> : null}
                    {(eventQuery.data?.items ?? []).map((event) => <button key={event.id} type="button" onClick={() => setSelectedEventId(event.id)} className={['rounded-xl border p-3 text-left transition-colors', selectedEventId === event.id ? 'border-accent bg-accent/10' : 'border-border bg-bg-elevated/35 hover:bg-bg-elevated'].join(' ')}>
                      <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-fg">{event.event_type}</span><Badge variant={event.has_json ? 'success' : 'default'} size="sm">{event.has_json ? 'JSON' : 'Text'}</Badge></div>
                      <p className="mt-1 truncate font-mono text-xs text-fg-tertiary">{event.message_type ?? 'No message type'} · {formatDate(event.received_at)}</p>
                    </button>)}
                    {!eventQuery.isLoading && (eventQuery.data?.items.length ?? 0) === 0 ? <p className="text-sm text-fg-tertiary">No retained Rivian events match this filter.</p> : null}
                  </div>
                  <RawEventDetails event={eventDetail.data} loading={eventDetail.isLoading} />
                </div>
              </>
            )}
          </CardContent>
        ) : null}
      </Card>

      {isAdmin ? <CollectorDiagnostics open={collectorOpen} onToggle={() => setCollectorOpen((current) => !current)} data={stewardship.data} loading={stewardship.isLoading} onRefresh={() => void stewardship.refetch()} /> : null}
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string | undefined }) {
  return <div className="rounded-xl border border-border bg-bg-elevated/35 p-3"><p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{label}</p><p className="mt-1 truncate text-base font-semibold text-fg" title={value}>{value}</p><p className="mt-1 text-xs text-fg-tertiary">{detail}</p></div>;
}

function TelemetryRecord({ sample, selected, onSelect }: { sample: RawTelemetrySample; selected: boolean; onSelect: () => void }) {
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={['rounded-xl border p-3 text-left transition-colors', selected ? 'border-accent bg-accent/10 ring-1 ring-inset ring-accent/30' : 'border-border bg-bg-elevated/35 hover:bg-bg-elevated'].join(' ')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs text-fg">{formatDate(sample.ts)}</span><Badge variant={sample.is_online ? 'success' : 'default'} size="sm">{sample.is_online ? 'Online' : 'Stored'}</Badge></div>
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-secondary sm:grid-cols-4"><span>SOC <strong className="text-fg">{formatValue(sample.battery_level, '%')}</strong></span><span>Range <strong className="text-fg">{formatValue(sample.distance_to_empty_mi, 'mi')}</strong></span><span>Power <strong className="text-fg">{formatValue(sample.power_kw, 'kW')}</strong></span><span className="truncate">{sample.charger_state ?? sample.drive_mode ?? 'No state'}</span></div>
  </button>;
}

function TelemetryDetails({ sample, showEmptyFields, onShowEmptyFields }: { sample: RawTelemetrySample | null; showEmptyFields: boolean; onShowEmptyFields: (value: boolean) => void }) {
  if (!sample) return <div className="rounded-xl border border-dashed border-border p-5 text-sm text-fg-tertiary">Select a record to inspect normalized fields.</div>;
  return <section className="rounded-xl border border-border bg-bg-elevated/25 p-3" aria-label="Selected telemetry record"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-fg">{formatDate(sample.ts)}</p><p className="text-xs text-fg-tertiary">Normalized telemetry fields</p></div><div className="flex items-center gap-2"><label className="flex items-center gap-2 text-xs text-fg-secondary"><input type="checkbox" checked={showEmptyFields} onChange={(event) => onShowEmptyFields(event.target.checked)} className="h-4 w-4 accent-accent" />Show empty</label><CopyJson label="Copy record JSON" value={sample} /></div></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{GROUPS.map((group) => { const fields = FIELD_DEFINITIONS.filter((field) => field.group === group && (showEmptyFields || hasValue(sample[field.key]))); if (fields.length === 0) return null; return <div key={group}><p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">{group}</p><dl className="grid gap-2">{fields.map((field) => <div key={field.key} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 text-sm"><dt className="text-fg-secondary">{field.label}</dt><dd className="max-w-[58%] break-words text-right font-mono text-xs text-fg">{formatValue(sample[field.key], field.unit)}</dd></div>)}</dl></div>; })}</div></section>;
}

function RawEventDetails({ event, loading }: { event: RawEventDetail | undefined; loading: boolean }) {
  if (loading) return <div className="rounded-xl border border-border p-4 text-sm text-fg-tertiary">Loading event payload…</div>;
  if (!event) return <div className="rounded-xl border border-dashed border-border p-5 text-sm text-fg-tertiary">Select a retained event to view its exact Rivian payload.</div>;
  return <section className="rounded-xl border border-border bg-bg-elevated/25 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-fg">{event.event_type}</p><p className="text-xs text-fg-tertiary">{formatDate(event.received_at)} · {event.payload_format}</p></div><CopyJson label="Copy event JSON" value={event.payload} /></div><pre className="mt-3 max-h-[32rem] overflow-auto rounded-lg border border-border bg-bg-surface p-3 text-xs leading-relaxed text-fg whitespace-pre-wrap break-all">{event.payload_format === 'text' ? String(event.payload ?? '') : JSON.stringify(event.payload, null, 2)}</pre></section>;
}

function CopyJson({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = React.useState(false);
  return <Button variant="secondary" size="sm" aria-label={copied ? `${label} copied` : label} iconLeft={<Clipboard className="h-3.5 w-3.5" />} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(value, null, 2)); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }}>{copied ? 'Copied' : 'Copy'}</Button>;
}

function CollectorDiagnostics({ open, onToggle, data, loading, onRefresh }: { open: boolean; onToggle: () => void; data: Awaited<ReturnType<typeof api.getRivianStewardship>> | undefined; loading: boolean; onRefresh: () => void }) {
  return <Card><CardHeader><div><CardTitle>Collector diagnostics</CardTitle><p className="mt-1 text-sm text-fg-tertiary">Installation-wide ingestion and duplicate-suppression health.</p></div><Button variant="secondary" size="sm" iconLeft={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={onToggle}>{open ? 'Hide diagnostics' : 'Show diagnostics'}</Button></CardHeader>{open ? <CardContent className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-fg-tertiary">Raw events retained: {formatCount(data?.raw_events_retained)} · Retention: {data?.retention_days ?? 7} days</p><Button variant="secondary" size="sm" loading={loading} onClick={onRefresh}>Refresh</Button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Active collectors', data?.active_collectors], ['Payload messages', data?.totals_24h.ws_payload_messages_received], ['Writes persisted', data?.totals_24h.telemetry_writes_persisted], ['Writes suppressed', data?.totals_24h.telemetry_writes_suppressed]].map(([label, value]) => <SummaryCard key={String(label)} label={String(label)} value={formatCount(value as number | undefined)} detail="Last 24 hours" />)}</div></CardContent> : null}</Card>;
}

function timeframeBounds(timeframe: Timeframe) {
  if (timeframe === 'all') return {};
  const hours = timeframe === '24h' ? 24 : timeframe === '7d' ? 24 * 7 : 24 * 30;
  return { from: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(), to: new Date().toISOString() };
}

function fieldLabel(key: string) { return FIELD_DEFINITIONS.find((field) => field.key === key)?.label ?? key; }
function hasValue(value: unknown) { return value !== null && value !== undefined; }
function formatCount(value: number | undefined) { return typeof value === 'number' ? value.toLocaleString() : '0'; }
function formatDate(value: string | null | undefined) { return value ? formatAppDateTime(value) : 'No data'; }
function formatValue(value: unknown, unit?: string) { if (value === null || value === undefined) return '—'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; if (typeof value === 'number') return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`; return String(value); }
