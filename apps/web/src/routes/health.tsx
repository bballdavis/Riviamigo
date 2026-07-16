import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  BatteryWarning,
  Bell,
  Cable,
  CheckCircle2,
  CircleAlert,
  Cpu,
  DoorOpen,
  Droplets,
  Gauge,
  HeartPulse,
  Info,
  Link2Off,
  LockKeyhole,
  Plug,
  Radio,
  Shield,
  Snowflake,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import {
  api,
  AuthenticatedVehicleArtwork,
  resolveVehicleArtwork,
  useAuth,
  useCurrentVehicleStatus,
  useResolvedVehicleSelection,
  useVehicleHealth,
} from '@riviamigo/hooks';
import type { VehicleHealthClosures, VehicleHealthTires } from '@riviamigo/types';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageLayout,
  SelectPicker,
  Skeleton,
  Tooltip,
  type BadgeProps,
} from '@riviamigo/ui/primitives';
import { formatTireLabel, getTireHealthTone } from '@riviamigo/ui/lib/vehicleTires';
import {
  buildAvailabilityTooltip,
  formatAvailabilityLastUpdated,
  presentVehicleStatusDefinition,
  summarizeStatusAvailability,
  type StatusAvailabilitySummary,
  type StatusTone,
} from '@riviamigo/ui/lib/vehicleStatus';
import { AppLayout } from '../components/layout/AppLayout';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { rootRoute } from './__root';

type BadgeVariant = NonNullable<BadgeProps['variant']>;
type HealthState = { label: string; variant: BadgeVariant };
type DiagnosticState = {
  label: string;
  variant: BadgeVariant;
  isMissing?: boolean;
  tooltip?: string | null;
  lastUpdatedLabel?: string | null;
};

export const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/health',
  component: VehicleHealthPage,
});

function VehicleHealthPage() {
  return (
    <ProtectedRoute>
      <VehicleHealthContent />
    </ProtectedRoute>
  );
}

function VehicleHealthContent() {
  const { accessToken, setActiveVehicleId } = useAuth();
  const setSessionVehicleId = setActiveVehicleId ?? (() => {});
  const {
    authReady,
    effectiveVehicleId,
    vehicleSelectionReady,
    vehicles: availableVehicles,
  } = useResolvedVehicleSelection();
  const hasVehicleChoices = availableVehicles.length > 1;
  const activeVehicle = availableVehicles.find((vehicle) => vehicle.id === effectiveVehicleId);
  const { data, isLoading } = useVehicleHealth(effectiveVehicleId);
  const { data: status } = useCurrentVehicleStatus(effectiveVehicleId);
  const { data: images } = useQuery({
    queryKey: ['vehicles', 'images', effectiveVehicleId],
    queryFn: () => api.vehicleImages(effectiveVehicleId!),
    enabled: authReady && Boolean(effectiveVehicleId) && !!accessToken,
  });

  const diagnostics = summarizeDiagnostics(status);
  const vehicleName = data?.vehicle?.name || data?.vehicle?.model || 'Rivian';
  const displayModel = [data?.vehicle?.model, data?.vehicle?.trim].filter(Boolean).join(' ');
  const freshness = getFreshness(data?.runtime?.last_event_at ?? data?.latest?.ts ?? null);
  const collector = getCollectorState(data?.runtime?.worker_health ?? null);
  const twelveVolt = getHealthState(data?.latest?.twelve_volt_health ?? null);
  const thermal = getThermalState(
    data?.latest?.hv_thermal_event ?? null,
    data?.thermal_events_30d ?? 0
  );
  const closures = summarizeClosures(status, data?.closures ?? null);
  const tireSummary = summarizeTires(status, data?.tires ?? null);
  const softwareHistory = dedupeSoftwareHistory(data?.software_history ?? []);
  const currentSoftwareEntry =
    softwareHistory.find((entry) => !entry.observed_until) ?? softwareHistory[0];
  const currentSoftwareVersion =
    data?.current_software_version ?? currentSoftwareEntry?.version ?? 'Unknown';
  const updateVersion = sanitizeUpdateVersion(
    data?.latest?.ota_available_version ?? null,
    currentSoftwareVersion
  );
  const resolvedHealthArtwork = resolveVehicleArtwork(
    images ?? activeVehicle?.images,
    data?.vehicle?.model ?? activeVehicle?.model,
    'health',
  );
  const heroImageUrl = resolvedHealthArtwork.light;
  const fallbackHeroImageUrl = resolvedHealthArtwork.fallback;
  const closureStatusFallback = {
    closure_frunk_closed:
      status?.closure_frunk_closed ?? data?.closures?.closure_frunk_closed ?? null,
    closure_liftgate_closed:
      status?.closure_liftgate_closed ?? data?.closures?.closure_liftgate_closed ?? null,
    closure_tailgate_closed:
      status?.closure_tailgate_closed ?? data?.closures?.closure_tailgate_closed ?? null,
    door_front_left_closed:
      status?.door_front_left_closed ?? data?.closures?.door_front_left_closed ?? null,
    door_front_right_closed:
      status?.door_front_right_closed ?? data?.closures?.door_front_right_closed ?? null,
    door_rear_left_closed:
      status?.door_rear_left_closed ?? data?.closures?.door_rear_left_closed ?? null,
    door_rear_right_closed:
      status?.door_rear_right_closed ?? data?.closures?.door_rear_right_closed ?? null,
  };

  return (
    <AppLayout activeKey="health">
      <PageLayout
        title="Vehicle Health"
        subtitle="Mechanical signals, software state, and telemetry freshness for your Rivian."
        className="pt-10 lg:pt-0"
        actions={
          hasVehicleChoices ? (
            <SelectPicker
              className="min-w-[11rem]"
              value={effectiveVehicleId ?? ''}
              onChange={(vehicleId) => setSessionVehicleId(vehicleId || null)}
              aria-label="Select vehicle"
              options={availableVehicles.map((vehicle) => ({
                value: vehicle.id,
                label: vehicle.display_name || vehicle.model,
                description: vehicle.display_name && vehicle.model !== vehicle.display_name ? vehicle.model : undefined,
              }))}
            />
          ) : null
        }
      >
        {!authReady || !vehicleSelectionReady ? (
          <div className="text-xs text-fg-tertiary p-4">Loading...</div>
        ) : !effectiveVehicleId ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account to view vehicle health."
          />
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
              <Card
                className="overflow-hidden border-accent/20 p-3"
                style={{
                  background:
                    'radial-gradient(circle at 18% 0%, color-mix(in oklab, var(--rm-accent) 18%, transparent) 32%, transparent), var(--rm-bg-surface)',
                }}
              >
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1">
                    <div className="flex h-full min-h-[14.5rem] flex-col pb-1">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-accent/20 bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
                        <HeartPulse className="h-3.5 w-3.5" />
                        Health Overview
                      </div>
                      <div className="mt-auto">
                        <h2 className="font-display text-4xl font-semibold tracking-tight text-fg">
                          {vehicleName}
                        </h2>
                        <p className="mt-1 text-lg text-fg-secondary">
                          {displayModel || 'Vehicle identity pending telemetry'}
                        </p>
                        {data?.vehicle?.vin ? (
                          <p className="mt-1 font-mono text-sm text-fg-tertiary">
                            VIN {data.vehicle?.vin}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {heroImageUrl || fallbackHeroImageUrl ? (
                      <div className="relative h-56 w-[24rem] shrink-0 overflow-hidden lg:h-64 lg:w-[30rem]">
                        <AuthenticatedVehicleArtwork
                          source={heroImageUrl}
                          fallbackSource={fallbackHeroImageUrl}
                          fallbackProps={{
                            className: 'absolute inset-0 h-full w-full object-contain object-right-bottom',
                          }}
                          alt="Vehicle three-quarter view"
                          className="absolute -right-2 -top-3 h-[110%] w-[110%] object-contain object-right-bottom lg:-right-3 lg:-top-4"
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="grid w-full grid-cols-4 gap-3">
                    <HeroMetric label="Collector" state={collector} kind="collector" />
                    <HeroMetric label="12V" state={twelveVolt} kind="battery" />
                    <HeroMetric label="Thermal" state={thermal} kind="thermal" />
                    <HeroMetric label="Tires" state={tireSummary} kind="tires" />
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Signal Freshness</CardTitle>
                  <Badge variant={freshness.variant} dot>
                    {freshness.label}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <HealthLine
                    icon={<Radio className="h-4 w-4" />}
                    label="Last vehicle event"
                    value={formatDateTime(data?.runtime?.last_event_at ?? data?.latest?.ts)}
                    detail={
                      (data?.runtime?.auth_state === 'needs_reauth'
                        ? 'Rivian access expired. Reconnect this vehicle from Settings.'
                        : data?.runtime?.worker_health_msg) ??
                      'Collector messages will appear here when Rivian access needs attention.'
                    }
                  />
                  <HealthLine
                    icon={<Activity className="h-4 w-4" />}
                    label="API snapshot"
                    value={formatDateTime(data?.generated_at)}
                    detail="Generated from the latest stored telemetry and software periods."
                  />
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <StatusPanel
                icon={<BatteryWarning className="h-4 w-4" />}
                title="12V Battery"
                value={twelveVolt.label}
                detail="Reported by Rivian telemetry when the vehicle publishes low-voltage battery health."
                variant={twelveVolt.variant}
                isLoading={isLoading}
              />
              <StatusPanel
                icon={<Gauge className="h-4 w-4" />}
                title="HV Thermal Activity"
                titleAccessory={
                  <Tooltip content="HV thermal events are usually normal battery temperature regulation. High counts alone do not indicate a fault.">
                    <span className="text-fg-tertiary">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </Tooltip>
                }
                value={thermal.label}
                detail={`${data?.thermal_events_30d ?? 0} thermal regulation events observed in the last 30 days.`}
                variant={thermal.variant}
                isLoading={isLoading}
              />
              <StatusPanel
                icon={<Cpu className="h-4 w-4" />}
                title="Software"
                value={currentSoftwareVersion}
                detailNode={
                  updateVersion ? (
                    <span>{`Update ${updateVersion} available`}</span>
                  ) : data?.ota_release_notes_url ? (
                    <a
                      className="text-accent underline-offset-2 hover:underline"
                      href={data.ota_release_notes_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View release notes
                    </a>
                  ) : (
                    <span>Current version is up to date.</span>
                  )
                }
                variant={updateVersion ? 'info' : 'success'}
                isLoading={isLoading}
              />
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Diagnostics</CardTitle>
                <Badge variant={diagnostics.overall.variant} dot>
                  {diagnostics.overall.label}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {diagnostics.rows.map((row) => (
                    <DiagnosticRow
                      key={row.label}
                      icon={row.icon}
                      label={row.label}
                      state={row.state}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Tire Pressure</CardTitle>
                  <Badge variant={tireSummary.variant}>{tireSummary.detail}</Badge>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <HealthGridSkeleton />
                  ) : !data?.tires ? (
                    <EmptyPanel text="No tire telemetry found yet." />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <TireGauge
                        label="Front Left"
                        value={status?.tire_fl_psi ?? data.tires.tire_fl_psi}
                        status={status?.tire_fl_status ?? data.tires.tire_fl_status}
                        valid={status?.tire_fl_valid ?? null}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, [
                                'tire_fl_psi',
                                'tire_fl_status',
                                'tire_fl_valid',
                              ])
                            : null
                        }
                      />
                      <TireGauge
                        label="Front Right"
                        value={status?.tire_fr_psi ?? data.tires.tire_fr_psi}
                        status={status?.tire_fr_status ?? data.tires.tire_fr_status}
                        valid={status?.tire_fr_valid ?? null}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, [
                                'tire_fr_psi',
                                'tire_fr_status',
                                'tire_fr_valid',
                              ])
                            : null
                        }
                      />
                      <TireGauge
                        label="Rear Left"
                        value={status?.tire_rl_psi ?? data.tires.tire_rl_psi}
                        status={status?.tire_rl_status ?? data.tires.tire_rl_status}
                        valid={status?.tire_rl_valid ?? null}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, [
                                'tire_rl_psi',
                                'tire_rl_status',
                                'tire_rl_valid',
                              ])
                            : null
                        }
                      />
                      <TireGauge
                        label="Rear Right"
                        value={status?.tire_rr_psi ?? data.tires.tire_rr_psi}
                        status={status?.tire_rr_status ?? data.tires.tire_rr_status}
                        valid={status?.tire_rr_valid ?? null}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, [
                                'tire_rr_psi',
                                'tire_rr_status',
                                'tire_rr_valid',
                              ])
                            : null
                        }
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Doors &amp; Gates</CardTitle>
                  <Badge variant={closures.variant} dot>
                    {closures.label}
                  </Badge>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <HealthGridSkeleton />
                  ) : !data?.closures ? (
                    <EmptyPanel text="No door and gate telemetry found yet." />
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ClosureRow
                        label="Frunk"
                        value={closureStatusFallback.closure_frunk_closed}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, ['closure_frunk_closed'])
                            : null
                        }
                      />
                      <ClosureRow
                        label="Liftgate"
                        value={closureStatusFallback.closure_liftgate_closed}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, ['closure_liftgate_closed'])
                            : null
                        }
                      />
                      <ClosureRow
                        label="Tailgate"
                        value={closureStatusFallback.closure_tailgate_closed}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, ['closure_tailgate_closed'])
                            : null
                        }
                      />
                      <ClosureRow
                        label="Front left door"
                        value={closureStatusFallback.door_front_left_closed}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, ['door_front_left_closed'])
                            : null
                        }
                      />
                      <ClosureRow
                        label="Front right door"
                        value={closureStatusFallback.door_front_right_closed}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, ['door_front_right_closed'])
                            : null
                        }
                      />
                      <ClosureRow
                        label="Rear left door"
                        value={closureStatusFallback.door_rear_left_closed}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, ['door_rear_left_closed'])
                            : null
                        }
                      />
                      <ClosureRow
                        label="Rear right door"
                        value={closureStatusFallback.door_rear_right_closed}
                        availability={
                          status
                            ? summarizeStatusAvailability(status, ['door_rear_right_closed'])
                            : null
                        }
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Software History</CardTitle>
                <Badge variant="info" className="max-w-full truncate font-mono">
                  {currentSoftwareVersion}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {softwareHistory.length === 0 ? (
                  <EmptyPanel text="No software version history yet." />
                ) : (
                  <>
                    {currentSoftwareEntry ? (
                      <div className="rounded-xl border border-accent/30 bg-accent-muted/40 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
                          Current version
                        </p>
                        <p className="mt-1 font-mono text-sm text-fg">
                          {currentSoftwareEntry.version}
                        </p>
                        <p className="mt-1 text-xs text-fg-secondary">
                          Observed since {formatDateTime(currentSoftwareEntry.installed_at)}
                        </p>
                        {data?.ota_release_notes_url ? (
                          <a
                            className="mt-2 inline-flex text-xs text-accent underline-offset-2 hover:underline"
                            href={data.ota_release_notes_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Changelog
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    <details className="group rounded-xl border border-border bg-bg-elevated/45 p-3">
                      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
                        <span className="inline-flex items-center gap-2">
                          Full history ({softwareHistory.length} entries)
                          <span className="transition-transform group-open:rotate-180">▾</span>
                        </span>
                      </summary>
                      <div className="relative mt-3 space-y-3 before:absolute before:left-[0.42rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
                        {softwareHistory.map((entry, index) => (
                          <div
                            key={`${entry.version}-${entry.installed_at}-${entry.observed_until ?? 'open'}`}
                            className="relative grid gap-1 pl-6 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1fr)]"
                          >
                            <span
                              className={`absolute left-0 top-1.5 h-3 w-3 rounded-full border ${index === 0 ? 'border-accent bg-accent' : 'border-border-strong bg-bg-elevated'}`}
                            />
                            <div>
                              <p className="font-mono text-sm text-fg">{entry.version}</p>
                              <p className="mt-0.5 text-xs text-fg-tertiary">
                                {entry.observed_until ? 'Previous software' : 'Current software'}
                              </p>
                            </div>
                            <p className="text-sm text-fg-secondary">
                              Observed {formatDateTime(entry.installed_at)}
                              <span className="text-fg-tertiary"> to </span>
                              {entry.observed_until
                                ? formatDateTime(entry.observed_until)
                                : 'Current'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </PageLayout>
    </AppLayout>
  );
}

function HeroMetric({
  label,
  state,
  kind,
}: {
  label: string;
  state: HealthState;
  kind: 'collector' | 'battery' | 'thermal' | 'tires';
}) {
  const indicator = getHeroStateIcon(label, state);
  const leading = getHeroLeadingIcon(kind);

  return (
    <div
      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-bg-glass px-3 py-2.5"
      title={`${label}: ${state.label}`}
      aria-label={`${label}: ${state.label}`}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="text-fg-tertiary">{leading}</span>
        <span className="truncate text-[13px] font-semibold uppercase tracking-wider text-fg-tertiary">
          {label}
        </span>
      </span>
      <span className="shrink-0 text-fg-tertiary">{indicator}</span>
    </div>
  );
}

function StatusPanel({
  icon,
  title,
  titleAccessory,
  value,
  detail,
  detailNode,
  variant,
  isLoading,
}: {
  icon: React.ReactNode;
  title: string;
  titleAccessory?: React.ReactNode;
  value: string;
  detail?: string;
  detailNode?: React.ReactNode;
  variant: BadgeVariant;
  isLoading: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-accent">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
              {title}
              {titleAccessory}
            </p>
            {isLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <Badge variant={variant} className="max-w-full truncate">
                {value}
              </Badge>
            )}
          </div>
          <p className="mt-3 text-sm leading-5 text-fg-secondary">{detailNode ?? detail}</p>
        </div>
      </div>
    </Card>
  );
}

function HealthLine({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-accent">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">{label}</p>
        <p className="mt-1 truncate font-mono text-sm text-fg">{value}</p>
        <p className="mt-1 text-xs leading-5 text-fg-tertiary">{detail}</p>
      </div>
    </div>
  );
}

function TireGauge({
  label,
  value,
  status,
  valid,
  availability,
}: {
  label: string;
  value: number | null;
  status: string | null;
  valid: boolean | null;
  availability: StatusAvailabilitySummary | null;
}) {
  const state = getTireState(status, valid, availability);
  const displayValue =
    valid === false
      ? 'Invalid Sensor'
      : availability?.availability === 'never_seen' && value === null
        ? 'Unavailable'
        : formatTireLabel(value, status);
  const tone = getTireHealthTone({ psi: value, status });
  const valueClass =
    valid === false || availability?.availability === 'never_seen'
      ? 'text-status-info'
      : tone === 'danger'
        ? 'text-status-danger'
        : tone === 'warning'
          ? 'text-status-warning'
          : 'text-fg';
  const badge = (
    <Badge variant={state.variant} size="sm">
      {state.label}
    </Badge>
  );
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/55 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">{label}</p>
        {state.tooltip ? <Tooltip content={state.tooltip}>{badge}</Tooltip> : badge}
      </div>
      <div className="mt-5 flex items-end gap-2">
        <p className={`font-mono text-3xl font-semibold tabular-nums ${valueClass}`}>
          {displayValue}
        </p>
      </div>
      {state.lastUpdatedLabel ? (
        <p className="mt-1 text-[11px] text-fg-tertiary">{state.lastUpdatedLabel}</p>
      ) : null}
    </div>
  );
}

function DiagnosticRow({
  icon,
  label,
  state,
}: {
  icon: React.ReactNode;
  label: string;
  state: DiagnosticState;
}) {
  const badge = (
    <Badge variant={state.variant} size="sm">
      {state.label}
    </Badge>
  );
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/55 px-3 py-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-fg-tertiary">{icon}</span>
          <span className="truncate text-sm text-fg-secondary">{label}</span>
        </div>
        {state.lastUpdatedLabel ? (
          <p className="mt-1 truncate text-[11px] text-fg-tertiary">{state.lastUpdatedLabel}</p>
        ) : null}
      </div>
      {state.tooltip ? <Tooltip content={state.tooltip}>{badge}</Tooltip> : badge}
    </div>
  );
}

function ClosureRow({
  label,
  value,
  availability,
}: {
  label: string;
  value: boolean | null;
  availability: StatusAvailabilitySummary | null;
}) {
  const isUnavailable = availability?.availability === 'never_seen' && value === null;
  const Icon = isUnavailable
    ? CircleAlert
    : value === false
      ? DoorOpen
      : value === true
        ? CheckCircle2
        : CircleAlert;
  const variant = isUnavailable
    ? 'info'
    : value === false
      ? 'warning'
      : value === true
        ? 'success'
        : 'default';
  const badge = (
    <Badge variant={variant}>{isUnavailable ? 'Unavailable' : asOpenClosed(value)}</Badge>
  );
  const tooltip = buildAvailabilityTooltip(
    label,
    availability ?? {
      availability: 'never_seen',
      reasonCode: 'never_seen',
      lastSeenAt: null,
      latestEventAt: null,
      everSeen: false,
    }
  );
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/55 px-3 py-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-fg-tertiary" />
          <span className="truncate text-sm text-fg-secondary">{label}</span>
        </div>
        {availability && formatAvailabilityLastUpdated(availability) ? (
          <p className="mt-1 truncate text-[11px] text-fg-tertiary">
            {formatAvailabilityLastUpdated(availability)}
          </p>
        ) : null}
      </div>
      {tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge}
    </div>
  );
}

function HealthGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-24" />
      ))}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-bg-elevated/40 px-4 py-8 text-center text-sm text-fg-tertiary">
      {text}
    </div>
  );
}

function summarizeTires(
  status: import('@riviamigo/types').VehicleStatus | null | undefined,
  tires: VehicleHealthTires | null
): HealthState & { detail: string } {
  const availability = status?.field_availability?.tire_pressure_status;
  const states = [
    status?.tire_fl_status ?? tires?.tire_fl_status,
    status?.tire_fr_status ?? tires?.tire_fr_status,
    status?.tire_rl_status ?? tires?.tire_rl_status,
    status?.tire_rr_status ?? tires?.tire_rr_status,
  ].filter(Boolean);
  const invalidSensor = [
    status?.tire_fl_valid,
    status?.tire_fr_valid,
    status?.tire_rl_valid,
    status?.tire_rr_valid,
  ].some((value) => value === false);
  const values = [
    status?.tire_fl_psi ?? tires?.tire_fl_psi,
    status?.tire_fr_psi ?? tires?.tire_fr_psi,
    status?.tire_rl_psi ?? tires?.tire_rl_psi,
    status?.tire_rr_psi ?? tires?.tire_rr_psi,
  ].filter((v): v is number => typeof v === 'number');

  if (invalidSensor) return { label: 'Unavailable', detail: 'Invalid sensor', variant: 'info' };
  if (availability?.availability === 'never_seen' && values.length === 0) {
    return { label: 'Unavailable', detail: 'No readings yet', variant: 'info' };
  }
  const hasWarning = states.some((state) => /low|high|warn|critical|fault/i.test(state ?? ''));
  if (hasWarning) return { label: 'Check', detail: 'Attention needed', variant: 'warning' };
  if (values.length === 4)
    return {
      label: 'Normal',
      detail: `${Math.round(Math.min(...values))}-${Math.round(Math.max(...values))} psi`,
      variant: 'success',
    };
  if (values.length > 0)
    return { label: 'Partial', detail: `${values.length}/4 wheels`, variant: 'info' };
  return { label: 'Unavailable', detail: 'No readings yet', variant: 'info' };
}

function summarizeClosures(
  status: import('@riviamigo/types').VehicleStatus | null | undefined,
  closures: VehicleHealthClosures | null
) {
  const values = [
    status?.closure_frunk_closed ?? closures?.closure_frunk_closed ?? null,
    status?.closure_liftgate_closed ?? closures?.closure_liftgate_closed ?? null,
    status?.closure_tailgate_closed ?? closures?.closure_tailgate_closed ?? null,
    status?.door_front_left_closed ?? closures?.door_front_left_closed ?? null,
    status?.door_front_right_closed ?? closures?.door_front_right_closed ?? null,
    status?.door_rear_left_closed ?? closures?.door_rear_left_closed ?? null,
    status?.door_rear_right_closed ?? closures?.door_rear_right_closed ?? null,
  ];
  const open = values.filter((value) => value === false).length;
  if (open > 0) return { label: `${open} open`, variant: 'warning' as const };
  const known = values.filter((value) => value !== null).length;
  return known > 0
    ? { label: 'Secured', variant: 'success' as const }
    : { label: 'Unavailable', variant: 'info' as const };
}

function getCollectorState(value: string | null): HealthState {
  if (!value) return { label: 'Unknown', variant: 'default' };
  if (/connected|healthy|ok/i.test(value)) return { label: titleCase(value), variant: 'success' };
  if (/auth|error|failed/i.test(value)) return { label: titleCase(value), variant: 'danger' };
  return { label: titleCase(value), variant: 'warning' };
}

function getHealthState(value: string | null): HealthState {
  if (!value) return { label: 'Unknown', variant: 'default' };
  if (/normal|good|ok/i.test(value)) return { label: titleCase(value), variant: 'success' };
  if (/critical|fault|fail/i.test(value)) return { label: titleCase(value), variant: 'danger' };
  return { label: titleCase(value), variant: 'warning' };
}

function getThermalState(value: string | null, count: number): HealthState {
  if (value && /fault|fail|critical|error|overheat|warning/i.test(value))
    return { label: titleCase(value), variant: 'warning' };
  if (value && /^(off|none|inactive|normal|ok|good)$/i.test(value))
    return { label: 'Nominal', variant: 'success' };
  if (value && !/^none$/i.test(value)) return { label: titleCase(value), variant: 'warning' };
  if (count >= 0) return { label: 'Nominal', variant: 'success' };
  return { label: 'Nominal', variant: 'success' };
}

function getTireState(
  status: string | null,
  valid: boolean | null,
  availability: StatusAvailabilitySummary | null
): DiagnosticState {
  if (valid === false) {
    return {
      label: 'Invalid Sensor',
      variant: 'info',
      tooltip: buildAvailabilityTooltip('Tire pressure', {
        availability: availability?.availability ?? 'current',
        reasonCode: 'invalid_sensor',
        lastSeenAt: availability?.lastSeenAt ?? null,
        latestEventAt: availability?.latestEventAt ?? null,
        everSeen: availability?.everSeen ?? true,
      }),
      lastUpdatedLabel: formatAvailabilityLastUpdated(
        availability ?? {
          availability: 'current',
          reasonCode: 'invalid_sensor',
          lastSeenAt: null,
          latestEventAt: null,
          everSeen: true,
        }
      ),
    };
  }
  if (availability?.availability === 'never_seen' && !status) {
    return {
      label: 'Unavailable',
      variant: 'info',
      tooltip: buildAvailabilityTooltip('Tire pressure', availability),
    };
  }
  if (!status)
    return {
      label: 'No status',
      variant: 'default',
      lastUpdatedLabel: formatAvailabilityLastUpdated(availability ?? nullSummary()),
    };
  if (/normal|ok/i.test(status))
    return {
      label: titleCase(status),
      variant: 'success',
      lastUpdatedLabel: formatAvailabilityLastUpdated(availability ?? nullSummary()),
    };
  if (/critical|fault/i.test(status)) return { label: titleCase(status), variant: 'danger' };
  return {
    label: titleCase(status),
    variant: 'warning',
    lastUpdatedLabel: formatAvailabilityLastUpdated(availability ?? nullSummary()),
  };
}

function summarizeDiagnostics(status: import('@riviamigo/types').VehicleStatus | null | undefined) {
  const rows = [
    {
      label: 'Brake Fluid',
      icon: <Droplets className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('brake_fluid_warning', status)),
    },
    {
      label: 'Wiper Fluid',
      icon: <Droplets className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('wiper_fluid_warning', status)),
    },
    {
      label: 'Service Mode',
      icon: <Wrench className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('service_mode', status)),
    },
    {
      label: 'Alarm',
      icon: <Bell className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('alarm_status', status)),
    },
    {
      label: 'Gear Guard',
      icon: <Shield className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('gear_guard_locked', status)),
    },
    {
      label: 'Charge Port',
      icon: <Plug className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('charge_port_open', status)),
    },
    {
      label: 'Charger Derate',
      icon: <AlertTriangle className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('charger_derate_active', status)),
    },
    {
      label: 'Defrost',
      icon: <Snowflake className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('defrost_active', status)),
    },
    {
      label: 'Cabin Precondition',
      icon: <Activity className="h-4 w-4" />,
      state: asDiagnosticState(presentVehicleStatusDefinition('cabin_precon', status)),
    },
  ];

  const knownRows = rows.filter((row) => !row.state.isMissing);
  const all =
    knownRows.length > 0 ? knownRows.map((row) => row.state) : rows.map((row) => row.state);
  const overall: DiagnosticState =
    knownRows.length === 0
      ? { label: 'Unavailable', variant: 'info' }
      : all.some((state) => state.variant === 'danger')
        ? { label: 'Attention', variant: 'danger' }
        : all.some((state) => state.variant === 'warning')
          ? { label: 'Check', variant: 'warning' }
          : all.some((state) => state.variant === 'info')
            ? { label: 'Active', variant: 'info' }
            : all.some((state) => state.variant === 'success')
              ? { label: 'All clear', variant: 'success' }
              : { label: 'Unavailable', variant: 'info' };

  return { rows, overall };
}

function asDiagnosticState(
  presented: ReturnType<typeof presentVehicleStatusDefinition>
): DiagnosticState {
  return {
    label: presented.renderUnavailableChip ? 'Unavailable' : presented.label,
    variant: asBadgeVariant(presented.renderUnavailableChip ? 'info' : presented.variant),
    isMissing: presented.renderUnavailableChip,
    tooltip: presented.tooltip,
    lastUpdatedLabel: presented.lastUpdatedLabel,
  };
}

function asBadgeVariant(tone: StatusTone): BadgeVariant {
  if (tone === 'danger') return 'danger';
  if (tone === 'warning') return 'warning';
  if (tone === 'success') return 'success';
  if (tone === 'info') return 'info';
  return 'default';
}

function nullSummary(): StatusAvailabilitySummary {
  return {
    availability: 'never_seen',
    reasonCode: 'never_seen',
    lastSeenAt: null,
    latestEventAt: null,
    everSeen: false,
  };
}

function getFreshness(ts: string | null) {
  if (!ts) return { label: 'No events', variant: 'default' as const };
  const ageMs = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ageMs)) return { label: 'Unknown', variant: 'default' as const };
  if (ageMs < 15 * 60 * 1000) return { label: 'Live', variant: 'success' as const };
  if (ageMs < 2 * 60 * 60 * 1000) return { label: 'Recent', variant: 'info' as const };
  if (ageMs < 24 * 60 * 60 * 1000) return { label: 'Stale', variant: 'warning' as const };
  return { label: 'Old', variant: 'danger' as const };
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function asOpenClosed(value: boolean | null) {
  if (value === null) return 'Unknown';
  return value ? 'Closed' : 'Open';
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sanitizeUpdateVersion(version: string | null, currentVersion: string) {
  if (!version) return null;
  const normalized = version.trim();
  if (!normalized) return null;
  if (/^0+(\.0+)*$/.test(normalized)) return null;
  if (normalized === currentVersion) return null;
  return normalized;
}

function dedupeSoftwareHistory(entries: import('@riviamigo/types').VehicleHealthSoftwareEntry[]) {
  const sorted = entries
    .slice()
    .sort((a, b) => new Date(b.installed_at).getTime() - new Date(a.installed_at).getTime());
  if (sorted.length <= 1) return sorted;
  const deduped: typeof sorted = [];
  for (const entry of sorted) {
    const last = deduped[deduped.length - 1];
    if (!last || last.version !== entry.version) {
      deduped.push(entry);
      continue;
    }
    deduped[deduped.length - 1] = {
      ...last,
      installed_at:
        new Date(entry.installed_at).getTime() < new Date(last.installed_at).getTime()
          ? entry.installed_at
          : last.installed_at,
      observed_until:
        last.observed_until === null || entry.observed_until === null
          ? null
          : new Date(last.observed_until).getTime() > new Date(entry.observed_until).getTime()
            ? last.observed_until
            : entry.observed_until,
    };
  }
  return deduped;
}

function getHeroStateIcon(label: string, state: HealthState) {
  const lower = label.toLowerCase();
  if (lower.includes('collector')) {
    if (state.variant === 'success') return <Cable className="h-5 w-5 text-status-positive" />;
    if (state.variant === 'danger') return <Link2Off className="h-5 w-5 text-status-critical" />;
    return <Radio className="h-5 w-5" />;
  }
  if (lower.includes('12v')) {
    if (state.variant === 'success')
      return <CheckCircle2 className="h-5 w-5 text-status-positive" />;
    if (state.variant === 'danger' || state.variant === 'warning')
      return <BatteryWarning className="h-5 w-5 text-status-warning" />;
    return <BatteryWarning className="h-5 w-5" />;
  }
  if (lower.includes('thermal')) {
    if (state.variant === 'success')
      return <CheckCircle2 className="h-5 w-5 text-status-positive" />;
    if (state.variant === 'danger' || state.variant === 'warning')
      return <TriangleAlert className="h-5 w-5 text-status-warning" />;
    return <Gauge className="h-5 w-5" />;
  }
  if (lower.includes('tires')) {
    if (state.variant === 'success')
      return <CheckCircle2 className="h-5 w-5 text-status-positive" />;
    if (state.variant === 'danger' || state.variant === 'warning')
      return <TriangleAlert className="h-5 w-5 text-status-warning" />;
    return <CheckCircle2 className="h-5 w-5" />;
  }
  return iconFallback(state);
}

function iconFallback(state: HealthState) {
  if (state.variant === 'success') return <CheckCircle2 className="h-5 w-5" />;
  if (state.variant === 'danger' || state.variant === 'warning')
    return <TriangleAlert className="h-5 w-5" />;
  return <CircleAlert className="h-5 w-5" />;
}

function getHeroLeadingIcon(kind: 'collector' | 'battery' | 'thermal' | 'tires') {
  if (kind === 'collector') return <Radio className="h-5 w-5" />;
  if (kind === 'battery') return <BatteryWarning className="h-5 w-5" />;
  if (kind === 'thermal') return <Gauge className="h-5 w-5" />;
  return <LockKeyhole className="h-5 w-5" />;
}
