import React, { useEffect, useMemo, useState } from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSession, useSavedPlaces, useUpdateChargeSessionLocation } from '@riviamigo/hooks';
import type { Place } from '@riviamigo/types';
import {
  PageLayout, StatCardGrid, StatCard, Card,
} from '@riviamigo/ui/primitives';
import { DashboardChartWidget } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ChevronDown, Database, MapPin, RadioTower, Receipt, Route, Zap } from 'lucide-react';

export const chargingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charging/$sessionId',
  component: ChargeSessionContent,
});

export function ChargeSessionContent() {
  return <AuthGuard><ChargeSessionContentInner /></AuthGuard>;
}

function ChargeSessionContentInner() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();
  const { sessionId } = useParams({ from: '/charging/$sessionId' });

  const { data: session } = useChargeSession(sessionId, defaultVehicleId);
  const {
    data: places = [],
    isLoading: placesLoading,
    isFetching: placesFetching,
    isError: placesError,
  } = useSavedPlaces();
  const { mutate: updateLocation, isPending: isUpdatingLocation } = useUpdateChargeSessionLocation(defaultVehicleId);
  const [selectedLocationName, setSelectedLocationName] = useState<string | null>(null);
  const hasVehicle = !!defaultVehicleId;
  const isPlacesLoading = placesLoading || placesFetching;

  useEffect(() => {
    if (!session) return;
    setSelectedLocationName(session.location_name);
  }, [session?.location_name, session?.id]);
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
      curveSmoothing: 0.2,
      headerSubtitle: 'Charge rate (kW) and cumulative energy (kWh) over time',
    },
  };

  const title = session
    ? (() => {
      const start = parseISO(session.started_at);
      const dateStr = format(start, 'MMMM d, yyyy');
      const startTime = format(start, 'h:mm a');
      const endTime = session.ended_at ? format(parseISO(session.ended_at), 'h:mm a') : null;
      return endTime ? `${dateStr} - ${startTime} - ${endTime}` : `${dateStr} - ${startTime}`;
    })()
    : 'Charge Session';

  const selectedLocationMatchesPlace = Boolean(
    selectedLocationName
      && places.find((place) => place.name.trim().toLowerCase() === selectedLocationName.trim().toLowerCase()),
  );
  const shouldShowLocationSelector = !selectedLocationName || selectedLocationMatchesPlace;

  const locationSubtitle = session ? (
    shouldShowLocationSelector ? (
      <SessionLocationChip
        currentLocationName={selectedLocationName}
        places={places}
        isLoading={isPlacesLoading}
        isError={placesError}
        isBusy={isUpdatingLocation}
        disabled={isUpdatingLocation}
        onChange={(placeId, placeName) => {
          setSelectedLocationName(placeName);
          updateLocation({ sessionId, placeId, placeName });
        }}
      />
    ) : (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg">
        <MapPin className="h-3.5 w-3.5 text-accent" />
        <span className="max-w-52 truncate" title={selectedLocationName ?? undefined}>
          {selectedLocationName}
        </span>
      </span>
    )
  ) : null;

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
        {!hasVehicle ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account before opening charging session details."
          />
        ) : (
          <>
            {session && <SessionSourcePanel session={session} />}

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
                      vehicleId: defaultVehicleId,
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

function SessionLocationChip({
  currentLocationName,
  places,
  isLoading,
  isError,
  isBusy,
  disabled,
  onChange,
}: {
  currentLocationName: string | null;
  places: Place[];
  isLoading: boolean;
  isError: boolean;
  isBusy: boolean;
  disabled: boolean;
  onChange: (placeId: string | null, placeName: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const sortedPlaces = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [places],
  );
  const hasLocation = !!currentLocationName?.trim();
  const chipLabel = currentLocationName?.trim() || 'Add location';

  const handleSelect = (placeId: string | null, placeName: string | null) => {
    onChange(placeId, placeName);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2.5 text-xs font-medium text-fg transition-colors hover:bg-bg-surface disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled}
      >
        <MapPin className="h-3.5 w-3.5 text-accent" />
        <span className="max-w-36 truncate" title={chipLabel}>
          {chipLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-fg-tertiary" />
      </button>

      {isOpen ? (
        <div className="absolute z-20 mt-2 w-80 rounded-lg border border-border bg-bg-surface p-2 shadow-lg">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            {isLoading ? 'Loading saved places...' : isError ? 'Unable to load saved places.' : 'Use one of your saved places'}
          </p>
          <div className="max-h-60 space-y-1 overflow-auto">
            {hasLocation ? (
              <button
                type="button"
                className="flex w-full rounded-md border border-dashed border-border px-2.5 py-2 text-left text-sm text-fg transition-colors hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => handleSelect(null, null)}
                disabled={isBusy}
              >
                Clear location
              </button>
            ) : null}
            {isLoading || isError ? null : (
              sortedPlaces.map((place) => (
                <button
                  type="button"
                  key={place.id}
                  className="flex w-full flex-col rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => handleSelect(place.id, place.name)}
                  disabled={isBusy}
                >
                  <span className="font-medium text-fg">{place.name}</span>
                  {place.address?.display_name ? (
                    <span className="text-xs text-fg-tertiary">{place.address.display_name}</span>
                  ) : null}
                  {place.id === places.find((candidate) => candidate.name === currentLocationName)?.id ? (
                    <span className="text-xs text-fg-tertiary">Current location</span>
                  ) : null}
                </button>
              ))
            )}
            {isLoading ? null : isError ? (
              <p className="px-2.5 py-2 text-sm text-fg-tertiary">
                Unable to load saved places. Reload this page and try again.
              </p>
            ) : sortedPlaces.length === 0 ? (
              <p className="px-2.5 py-2 text-sm text-fg-tertiary">No saved places yet.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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
