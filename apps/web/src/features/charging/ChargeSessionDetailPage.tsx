import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useChargeSession, useResolvedVehicleSelection, useSavedPlaces, useUpdateChargeSession, useVehicles } from '@riviamigo/hooks';
import type { ChargeSessionUpdate, Place } from '@riviamigo/types';
import {
  PageLayout, StatCardGrid, StatCard, Card, CardContent, CardHeader, CardTitle, Button, Input, SelectPicker, Badge,
} from '@riviamigo/ui/primitives';
import { DashboardChartWidget } from '@riviamigo/dashboards';
import { AppLayout } from '../../components/layout/AppLayout';
import { NoVehicleState } from '../../components/layout/NoVehicleState';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '@riviamigo/ui/lib/utils';
import { formatAppDate, formatAppTime } from '@riviamigo/ui/lib/dateTime';
import { parseISO } from 'date-fns';
import { ArrowLeft, Database, MapPin, RadioTower, Receipt, Route, RotateCcw, Zap } from 'lucide-react';

export function ChargeSessionContent() {
  return <ChargeSessionContentInner />;
}

function ChargeSessionContentInner() {
  const { effectiveVehicleId, authReady, vehicleSelectionReady } = useResolvedVehicleSelection();
  const navigate = useNavigate();
  const { sessionId } = useParams({ from: '/charging/$sessionId' });

  const { data: session } = useChargeSession(sessionId, effectiveVehicleId);
  const {
    data: places = [],
    isLoading: placesLoading,
    isFetching: placesFetching,
    isError: placesError,
  } = useSavedPlaces();
  const updateSession = useUpdateChargeSession(effectiveVehicleId);
  const { data: vehicles = [] } = useVehicles();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const hasVehicle = !!effectiveVehicleId;
  const isPlacesLoading = placesLoading || placesFetching;

  const chargeCurveInstance = {
    id: `charge-session-curve-${sessionId}`,
    componentType: 'chart' as const,
    definitionId: 'catalog',
    title: 'Charge Curve',
    layout: { x: 0, y: 0, w: 12, h: 8 },
    options: {
      page: 'charging',
      chartId: 'charge-session-curve',
      chartIds: ['charge-session-curve'],
      showPicker: false,
      timeFilter: '15m',
      headerSubtitle: 'Charge rate (kW) and cumulative energy (kWh) over time',
    },
  };

  const title = session
    ? (() => {
      const start = parseISO(session.started_at);
      const dateStr = formatAppDate(start, { month: 'long', day: 'numeric', year: 'numeric' });
      const startTime = formatAppTime(start);
      const endTime = session.ended_at ? formatAppTime(parseISO(session.ended_at)) : null;
      return endTime ? `${dateStr} - ${startTime} - ${endTime}` : `${dateStr} - ${startTime}`;
    })()
    : 'Charge Session';

  const locationSubtitle = session?.location_name ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg">
      <MapPin className="h-3.5 w-3.5 text-accent" />
      <span className="max-w-52 truncate" title={session.location_name}>{session.location_name}</span>
    </span>
  ) : null;
  const membershipRole = vehicles.find((vehicle) => vehicle.id === effectiveVehicleId)?.membership_role ?? 'viewer';
  const canManageSession = membershipRole === 'owner' || membershipRole === 'manager';

  const backButton = (
    <button
      type="button"
      aria-label="Back to charging"
      className="inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-lg border border-accent bg-bg-surface text-accent transition-colors hover:bg-accent/10 focus:outline-none focus:ring-1 focus:ring-accent"
      onClick={() => navigate({ to: '/charging' })}
    >
      <ArrowLeft className="h-6 w-6" />
    </button>
  );

  return (
    <AppLayout activeKey="charging">
      <PageLayout
        title={title}
        subtitle={locationSubtitle}
        titleAction={backButton}
        titleActionPosition="left"
      >
        {!authReady || !vehicleSelectionReady ? (
          <div className="p-4 text-xs text-fg-tertiary">Loading...</div>
        ) : !hasVehicle ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account before opening charging session details."
          />
        ) : (
          <>
            {session && <SessionSourcePanel session={session} />}

            {session && (
              <ChargeSessionCorrectionPanel
                session={session}
                places={places}
                placesLoading={isPlacesLoading}
                placesError={placesError}
                canManage={canManageSession}
                isPending={updateSession.isPending}
                {...(updateSession.error?.message ? { error: updateSession.error.message } : {})}
                {...(saveMessage ? { successMessage: saveMessage } : {})}
                onSave={(body) => {
                  setSaveMessage(null);
                  updateSession.mutate({ sessionId, ...body }, { onSuccess: () => setSaveMessage('Corrections saved.') });
                }}
              />
            )}

            <StatCardGrid>
              <StatCard label="Energy Added" value={session ? formatKwh(session.energy_added_kwh ?? 0) : '-'} accent />
              <StatCard
                label="SoC"
                value={
                  session?.soc_start != null && session?.soc_end != null
                    ? `${formatPercent(session.soc_start, 0)} -> ${formatPercent(session.soc_end, 0)}`
                    : '-'
                }
              />
              <StatCard
                label="Duration"
                value={session ? formatDuration((session as unknown as { duration_min?: number }).duration_min ?? 0) : '-'}
              />
              <StatCard
                label="Cost"
                value={session?.cost_usd != null ? formatCurrency(session.cost_usd) : '-'}
              />
            </StatCardGrid>

            {/* Charge curve + cumulative energy on a shared time axis.
                DashboardChartWidget renders its own compact header (title +
                settings button) so the card only needs to host the widget. */}
            <div className="bg-bg-surface border border-border rounded-xl p-5">
              <div style={{ height: 400 }}>
                {session && (
                  <DashboardChartWidget
                    instance={chargeCurveInstance}
                    ctx={{
                      vehicleId: effectiveVehicleId,
                      timeframe: {
                        kind: 'custom',
                        from: new Date(session.started_at),
                        to: new Date(session.ended_at ?? session.started_at),
                      },
                      from: session.started_at,
                      to: session.ended_at ?? session.started_at,
                      chargeSessionId: sessionId,
                      chargeSessionEnergyKwh: session.energy_added_kwh ?? null,
                    }}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </PageLayout>
    </AppLayout>
  );
}

function ChargeSessionCorrectionPanel({
  session,
  places,
  placesLoading,
  placesError,
  canManage,
  isPending,
  error,
  successMessage,
  onSave,
}: {
  session: ChargeSessionDetail;
  places: Place[];
  placesLoading: boolean;
  placesError: boolean;
  canManage: boolean;
  isPending: boolean;
  error?: string;
  successMessage?: string;
  onSave: (body: ChargeSessionUpdate) => void;
}) {
  type LocationMode = NonNullable<ChargeSessionDetail['location_override_mode']>;
  type CostMode = NonNullable<ChargeSessionDetail['cost_override_mode']>;
  const sortedPlaces = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [places],
  );
  const initialLocationMode: LocationMode = session.location_override_mode ?? 'automatic';
  const initialCostMode: CostMode = session.cost_override_mode ?? 'automatic';
  const [locationMode, setLocationMode] = useState<LocationMode>(initialLocationMode);
  const [costMode, setCostMode] = useState<CostMode>(initialCostMode);
  const [placeId, setPlaceId] = useState('');
  const [manualCost, setManualCost] = useState(session.cost_override_usd?.toFixed(2) ?? '');

  useEffect(() => {
    setLocationMode(session.location_override_mode ?? 'automatic');
    setCostMode(session.cost_override_mode ?? 'automatic');
    setManualCost(session.cost_override_usd?.toFixed(2) ?? '');
    const matchingPlace = places.find((place) => place.name.trim().toLocaleLowerCase() === session.location_name?.trim().toLocaleLowerCase());
    setPlaceId(matchingPlace?.id ?? '');
  }, [session.id, session.location_override_mode, session.cost_override_mode, session.cost_override_usd, session.location_name, places]);

  const trimmedManualCost = manualCost.trim();
  const parsedManualCost = Number(trimmedManualCost);
  const manualCostError = costMode === 'manual' && (!trimmedManualCost || !Number.isFinite(parsedManualCost) || parsedManualCost < 0)
    ? 'Enter a non-negative USD amount.'
    : undefined;
  const locationError = locationMode === 'saved_place' && !placeId
    ? 'Choose a saved place before saving.'
    : undefined;
  const sourceLocation = formatCoordinates(session.source_location_lat, session.source_location_lng);
  const effectiveLocation = session.location_name ?? formatCoordinates(session.location_lat, session.location_lng) ?? 'No location';
  const costDescription = costMode === 'free'
    ? 'Marked free for this session.'
    : costMode === 'manual'
      ? 'Manually set for this session.'
      : 'Calculated from charging data, network preferences, or saved-place pricing.';

  function save() {
    if (manualCostError || locationError) return;
    onSave({
      location_mode: locationMode,
      ...(locationMode === 'saved_place' ? { place_id: placeId } : {}),
      cost_mode: costMode,
      ...(costMode === 'manual' ? { cost_usd: parsedManualCost } : {}),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Corrections</CardTitle>
          <p className="mt-1 text-sm text-fg-tertiary">Refine this charge without replacing its original telemetry.</p>
        </div>
        <Badge variant={canManage ? 'info' : 'default'}>{canManage ? 'Editable' : 'Read only'}</Badge>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Effective location</p>
            <p className="mt-1 truncate text-sm font-medium text-fg" title={effectiveLocation}>{effectiveLocation}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Original telemetry</p>
            <p className="mt-1 truncate text-sm text-fg-secondary" title={sourceLocation ?? undefined}>{sourceLocation ?? 'Unavailable'}</p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 lg:gap-6">
          <fieldset className="min-w-0" disabled={!canManage || isPending}>
            <legend className="text-sm font-medium text-fg">Location</legend>
            <p className="mt-1 text-xs text-fg-tertiary">Use automatic matching, a saved place, or intentionally clear the location.</p>
            <ModeSegments
              label="Location source"
              value={locationMode}
              options={[
                { value: 'automatic', label: 'Automatic' },
                { value: 'saved_place', label: 'Saved place' },
                { value: 'none', label: 'No location' },
              ]}
              onChange={setLocationMode}
            />
            {locationMode === 'saved_place' ? (
              <div className="mt-3">
                <SelectPicker
                  className="w-full"
                  value={placeId}
                  aria-label="Saved place"
                  onChange={setPlaceId}
                  disabled={placesLoading || placesError || !canManage || isPending}
                  placeholder={placesLoading ? 'Loading saved places…' : placesError ? 'Unable to load saved places' : 'Choose a saved place'}
                  options={sortedPlaces.map((place) => ({ value: place.id, label: place.name, description: place.address?.display_name ?? undefined }))}
                />
                {locationError ? <p className="mt-1 text-xs text-status-danger">{locationError}</p> : null}
              </div>
            ) : null}
            {locationMode !== 'automatic' && canManage ? (
              <button type="button" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover focus:outline-none focus:ring-1 focus:ring-accent" onClick={() => onSave({ location_mode: 'automatic' })} disabled={isPending}>
                <RotateCcw className="h-4 w-4" /> Restore automatic location
              </button>
            ) : null}
          </fieldset>

          <fieldset className="min-w-0" disabled={!canManage || isPending}>
            <legend className="text-sm font-medium text-fg">Cost</legend>
            <p className="mt-1 text-xs text-fg-tertiary">{costDescription}</p>
            <ModeSegments
              label="Cost source"
              value={costMode}
              options={[
                { value: 'automatic', label: 'Automatic' },
                { value: 'free', label: 'Free' },
                { value: 'manual', label: 'Manual' },
              ]}
              onChange={setCostMode}
            />
            {costMode === 'manual' ? (
              <Input label="Manual cost (USD)" value={manualCost} onChange={(event) => setManualCost(event.target.value)} inputMode="decimal" {...(manualCostError ? { error: manualCostError } : {})} className="mt-3" />
            ) : null}
            {costMode !== 'automatic' && canManage ? (
              <button type="button" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover focus:outline-none focus:ring-1 focus:ring-accent" onClick={() => onSave({ cost_mode: 'automatic' })} disabled={isPending}>
                <RotateCcw className="h-4 w-4" /> Restore automatic cost
              </button>
            ) : null}
          </fieldset>
        </div>

        {error ? <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">{error} Try again.</p> : null}
        {successMessage ? <p role="status" className="rounded-lg border border-status-positive/30 bg-status-positive/10 px-3 py-2 text-sm text-status-positive">{successMessage}</p> : null}
        {canManage ? (
          <div className="flex justify-end">
            <Button size="md" className="min-h-11" loading={isPending} disabled={Boolean(manualCostError || locationError)} onClick={save}>Save corrections</Button>
          </div>
        ) : (
          <p className="text-sm text-fg-tertiary">Only the vehicle owner or a manager can change charging corrections.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ModeSegments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-border bg-bg-page/60 p-1">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={`min-h-11 rounded-lg px-2 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-accent ${value === option.value ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-secondary hover:bg-bg-elevated/70 hover:text-fg'}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function formatCoordinates(lat: number | null | undefined, lng: number | null | undefined) {
  return lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null;
}

type ChargeSessionDetail = NonNullable<ReturnType<typeof useChargeSession>['data']>;

function SessionSourcePanel({ session }: { session: ChargeSessionDetail }) {
  const telemetryCount = session.telemetry_sample_count ?? 0;
  const telemetryLabel = telemetryCount > 0
    ? `${telemetryCount.toLocaleString()} samples matched`
    : 'No telemetry samples matched';
  const networkLabel = session.network_vendor
    ?? (session.location_name?.toLowerCase().includes('home') ? 'Home' : null)
    ?? session.charger_id
    ?? session.rivian_charger_type
    ?? (session.charger_type ? session.charger_type.toUpperCase() : 'Unknown');
  const evidence = [
    session.range_added_km != null
      ? { icon: <Route className="h-4 w-4" />, label: 'Range', value: `${session.range_added_km.toFixed(1)} km added` }
      : null,
    session.rivian_paid_total != null
      ? { icon: <Receipt className="h-4 w-4" />, label: 'Rivian billed', value: formatCurrency(session.rivian_paid_total) }
      : null,
    session.is_free_session
      ? { icon: <Receipt className="h-4 w-4" />, label: 'Billing', value: 'Free session' }
      : null,
    session.rivian_city
      ? { icon: <MapPin className="h-4 w-4" />, label: 'Rivian city', value: session.rivian_city }
      : null,
  ].filter(Boolean) as Array<{ icon: React.ReactNode; label: string; value: string }>;

  return (
    <Card padding="md" className="grid gap-x-6 gap-y-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
      <SourceFact
        icon={<Database className="h-4 w-4" />}
        label="Source"
        value={formatSourceLabel(session.source, telemetryCount)}
      />
      <SourceFact icon={<RadioTower className="h-4 w-4" />} label="Telemetry" value={telemetryLabel} />
      <SourceFact icon={<Zap className="h-4 w-4" />} label="Network" value={networkLabel} />
      {evidence.map((fact) => (
        <SourceFact key={`${fact.label}-${fact.value}`} icon={fact.icon} label={fact.label} value={fact.value} />
      ))}
    </Card>
  );
}

function formatSourceLabel(source: string | null | undefined, telemetryCount: number) {
  if (source === 'rivian_api' && telemetryCount > 0) return 'Telemetry + Rivian API';
  if (source === 'rivian_api') return 'Rivian API backfill';
  if (source === 'telemetry+rivian_api') return 'Telemetry + Rivian API';
  return 'Live telemetry';
}

function SourceFact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-accent">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{label}</p>
        <p className="truncate text-sm font-medium text-fg">{value}</p>
      </div>
    </div>
  );
}
