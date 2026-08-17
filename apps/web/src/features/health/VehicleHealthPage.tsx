import React from 'react';
import { formatAppDateTime } from '@riviamigo/ui/lib/dateTime';
import { useQuery } from '@tanstack/react-query';
import { TbCarDoor } from 'react-icons/tb';
import {
  Activity,
  AlertTriangle,
  BatteryWarning,
  Bell,
  Cable,
  CheckCircle2,
  CircleAlert,
  Cpu,
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
  useTelemetryLanes,
  useVehicleHealth,
} from '@riviamigo/hooks';
import type { TelemetryLaneFrame, VehicleHealthTires } from '@riviamigo/types';
import { SensorChipSummary } from '@riviamigo/dashboards';
import { CHART_COLORS } from '@riviamigo/ui/charts';
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
import {
  DEFAULT_TARGET_TIRE_PRESSURE_PSI,
  formatTireLabel,
  getTireHealthTone,
} from '@riviamigo/ui/lib/vehicleTires';
import {
  buildAvailabilityTooltip,
  formatAvailabilityLastUpdated,
  presentVehicleStatusDefinition,
  summarizeStatusAvailability,
  type StatusAvailabilitySummary,
  type StatusTone,
} from '@riviamigo/ui/lib/vehicleStatus';
import { AppLayout } from '../../components/layout/AppLayout';
import { NoVehicleState } from '../../components/layout/NoVehicleState';

type BadgeVariant = NonNullable<BadgeProps['variant']>;
const TIRE_HISTORY_DAYS = 30;
type HealthState = { label: string; variant: BadgeVariant };
type DiagnosticState = {
  label: string;
  variant: BadgeVariant;
  isMissing?: boolean;
  tooltip?: string | null;
  lastUpdatedLabel?: string | null;
};

export function VehicleHealthContent() {
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
  const tireHistoryFrom = React.useMemo(
    () => new Date(Date.now() - TIRE_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    []
  );
  const { data: tireHistory, isLoading: isTireHistoryLoading } = useTelemetryLanes(
    effectiveVehicleId,
    { from: tireHistoryFrom, lanes: ['health'], resolution: 'auto', max_points: 512 }
  );
  const { data: images } = useQuery({
    queryKey: ['vehicles', 'images', effectiveVehicleId],
    queryFn: () => api.vehicleImages(effectiveVehicleId!),
    enabled: authReady && Boolean(effectiveVehicleId) && !!accessToken,
  });

  const diagnostics = summarizeDiagnostics(status);
  const extended = data?.extended_telemetry;
  const vehicleName = data?.vehicle?.name || data?.vehicle?.model || 'Rivian';
  const displayModel = [data?.vehicle?.model, data?.vehicle?.trim].filter(Boolean).join(' ');
  const freshness = getFreshness(data?.runtime?.last_event_at ?? data?.latest?.ts ?? null);
  const collector = getCollectorState(data?.runtime?.worker_health ?? null);
  const twelveVolt = getHealthState(data?.latest?.twelve_volt_health ?? null);
  const thermal = getThermalState(
    data?.latest?.hv_thermal_event ?? null,
    data?.thermal_events_30d ?? 0
  );
  const closureModel = data?.vehicle?.model ?? activeVehicle?.model ?? null;
  const targetTirePressurePsi = Math.round(
    activeVehicle?.target_tire_pressure_psi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI
  );
  const tireHistories = {
    frontLeft: buildTireHistory(tireHistory, 'tire_fl_psi'),
    frontRight: buildTireHistory(tireHistory, 'tire_fr_psi'),
    rearLeft: buildTireHistory(tireHistory, 'tire_rl_psi'),
    rearRight: buildTireHistory(tireHistory, 'tire_rr_psi'),
  };
  const tirePressureDomain = buildTirePressureDomain(
    Object.values(tireHistories).flat(),
    targetTirePressurePsi
  );
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
    'health'
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
  const closureRows = getHealthClosureRows(closureModel, closureStatusFallback, status);
  const closures = summarizeClosures(closureRows);

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
                description:
                  vehicle.display_name && vehicle.model !== vehicle.display_name
                    ? vehicle.model
                    : undefined,
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
                <div className="flex flex-col gap-4">
                  <div className="grid min-w-0 gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)] min-[1200px]:items-end">
                    <div className="flex min-w-0 flex-col gap-3 pb-1">
                      <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-accent/20 bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
                        <HeartPulse className="h-3.5 w-3.5" />
                        Health Overview
                      </div>
                      <div className="min-w-0">
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
                      <div className="relative aspect-[16/9] w-full min-w-0 max-w-[42rem] justify-self-center overflow-hidden min-[1200px]:aspect-auto min-[1200px]:h-64 min-[1200px]:max-w-none">
                        <AuthenticatedVehicleArtwork
                          source={heroImageUrl}
                          fallbackSource={fallbackHeroImageUrl}
                          fallbackProps={{
                            className:
                              'absolute inset-0 h-full w-full object-contain object-center min-[1200px]:object-right-bottom',
                          }}
                          alt="Vehicle three-quarter view"
                          className="absolute inset-0 h-full w-full object-contain object-center min-[1200px]:object-right-bottom"
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 min-[1200px]:grid-cols-4">
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

            <Card data-testid="extended-vehicle-telemetry">
              <CardHeader>
                <div>
                  <CardTitle>Extended Vehicle Telemetry</CardTitle>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    Privacy-filtered readings from the independent Parallax collector.
                  </p>
                </div>
                <Badge
                  variant={extended?.collector?.status === 'connected' ? 'success' : 'default'}
                  dot
                >
                  {extended?.collector?.status === 'connected'
                    ? 'Collector connected'
                    : 'Collector optional'}
                </Badge>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <HealthGridSkeleton />
                ) : !extended?.network && !extended?.efficiency && !extended?.mass ? (
                  <EmptyPanel text="Start the optional Parallax collector to populate connectivity, Rivian efficiency, and mass estimates." />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <ExtendedReading
                      icon={<Radio className="h-4 w-4" />}
                      label="Connectivity"
                      value={
                        extended.network?.wifi_connected
                          ? `Wi-Fi ${formatSignal(extended.network.wifi_rssi_dbm)}`
                          : (extended.network?.cellular_access_technology ?? 'Disconnected')
                      }
                      detail={[
                        extended.network?.wifi_link_speed_mbps == null
                          ? null
                          : `${extended.network.wifi_link_speed_mbps} Mbps`,
                        extended.network?.wifi_frequency_mhz == null
                          ? null
                          : `${extended.network.wifi_frequency_mhz} MHz`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                    <ExtendedReading
                      icon={<Gauge className="h-4 w-4" />}
                      label="Rivian learned estimate"
                      value={formatEfficiency(extended.efficiency?.learned_wh_per_km)}
                      detail={
                        extended.efficiency?.reference_wh_per_km == null
                          ? ''
                          : `${formatEfficiency(extended.efficiency.reference_wh_per_km)} reference`
                      }
                    />
                    <ExtendedReading
                      icon={<Activity className="h-4 w-4" />}
                      label="Estimated vehicle mass"
                      value={
                        extended.mass
                          ? `${Math.round(extended.mass.estimated_mass_kg * 2.20462).toLocaleString()} lb`
                          : '—'
                      }
                      detail={
                        extended.mass
                          ? `${extended.mass.estimated_mass_kg.toLocaleString()} kg · Rivian estimate`
                          : ''
                      }
                    />
                    {extended.cold_weather ? (
                      <ExtendedReading
                        icon={<Snowflake className="h-4 w-4" />}
                        label="Cold-weather impact"
                        value={
                          extended.cold_weather.cold_range_impact_km == null
                            ? 'Observed'
                            : `${(extended.cold_weather.cold_range_impact_km * 0.621371).toFixed(1)} mi`
                        }
                        detail="Shown only when the vehicle reports a cold-limited value."
                      />
                    ) : null}
                  </div>
                )}
                {extended?.collector?.last_event_at ? (
                  <p className="mt-3 text-xs text-fg-tertiary">
                    Collector last received data{' '}
                    {formatAppDateTime(extended.collector.last_event_at)}
                  </p>
                ) : null}
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
                        targetPressurePsi={targetTirePressurePsi}
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
                        history={tireHistories.frontLeft}
                        historyColor={CHART_COLORS.accent}
                        historyDomain={tirePressureDomain}
                        historyLoading={isTireHistoryLoading}
                      />
                      <TireGauge
                        label="Front Right"
                        targetPressurePsi={targetTirePressurePsi}
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
                        history={tireHistories.frontRight}
                        historyColor={CHART_COLORS.sky}
                        historyDomain={tirePressureDomain}
                        historyLoading={isTireHistoryLoading}
                      />
                      <TireGauge
                        label="Rear Left"
                        targetPressurePsi={targetTirePressurePsi}
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
                        history={tireHistories.rearLeft}
                        historyColor={CHART_COLORS.success}
                        historyDomain={tirePressureDomain}
                        historyLoading={isTireHistoryLoading}
                      />
                      <TireGauge
                        label="Rear Right"
                        targetPressurePsi={targetTirePressurePsi}
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
                        history={tireHistories.rearRight}
                        historyColor={CHART_COLORS.warning}
                        historyDomain={tirePressureDomain}
                        historyLoading={isTireHistoryLoading}
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
                      {closureRows.map((row) => (
                        <ClosureRow
                          key={row.field}
                          field={row.field}
                          label={row.label}
                          value={row.value}
                          availability={row.availability}
                        />
                      ))}
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
  targetPressurePsi,
  status,
  valid,
  availability,
  history,
  historyColor,
  historyLoading,
  historyDomain,
}: {
  label: string;
  value: number | null;
  targetPressurePsi: number;
  status: string | null;
  valid: boolean | null;
  availability: StatusAvailabilitySummary | null;
  history: Array<{ ts?: string; value: number | null | undefined }>;
  historyColor: string;
  historyLoading: boolean;
  historyDomain: { min: number; max: number };
}) {
  const state = getTireState(status, valid, availability);
  const displayValue =
    valid === false
      ? 'Invalid Sensor'
      : availability?.availability === 'never_seen' && value === null
        ? 'Unavailable'
        : formatTireLabel(value, status);
  const tone = getTireHealthTone({ psi: value, status, targetPsi: targetPressurePsi });
  const valueTone =
    valid === false || availability?.availability === 'never_seen'
      ? 'info'
      : tone === 'danger'
        ? 'danger'
        : tone === 'warning'
          ? 'warning'
          : tone === 'success'
            ? 'success'
            : 'neutral';
  const sensor = (
    <SensorChipSummary
      title={label}
      value={displayValue}
      icon="lucide:gauge"
      valueTone={valueTone}
      valueSize="lg"
      secondary={[
        state.label,
        state.lastUpdatedLabel,
        getTireHistoryLabel(history, historyLoading),
      ]
        .filter(Boolean)
        .join(' · ')}
      history={history}
      historyColor={historyColor}
      historyDomain={historyDomain}
      historyTimeFilter="raw"
    />
  );
  return state.tooltip ? <Tooltip content={state.tooltip}>{sensor}</Tooltip> : sensor;
}

function getTireHistoryLabel(
  history: Array<{ ts?: string; value: number | null | undefined }>,
  historyLoading: boolean
) {
  if (historyLoading) return 'Loading history';
  const sampleCount = countTireHistorySamples(history);
  if (sampleCount >= 2) return '30-day history';
  if (sampleCount === 1) return '1 observation · 30-day window';
  return 'No history';
}

function countTireHistorySamples(
  history: Array<{ ts?: string; value: number | null | undefined }>
) {
  return history.filter(
    (point) => typeof point.value === 'number' && Number.isFinite(point.value)
  ).length;
}

function buildTirePressureDomain(
  history: Array<{ ts?: string; value: number | null | undefined }>,
  targetPressurePsi: number
) {
  const maxDeviation = Math.max(
    6,
    ...history
      .map((point) => point.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .map((value) => Math.abs(value - targetPressurePsi) + 2)
  );
  return {
    min: targetPressurePsi - maxDeviation,
    max: targetPressurePsi + maxDeviation,
  };
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
  field,
  label,
  value,
  availability,
}: {
  field: HealthClosureField;
  label: string;
  value: boolean | null;
  availability: StatusAvailabilitySummary | null;
}) {
  const isUnavailable = availability?.availability === 'never_seen' && value === null;
  const isGate = field.startsWith('closure_');
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
          <ClosureIcon field={field} isGate={isGate} isUnavailable={isUnavailable} />
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

function ClosureIcon({
  field,
  isGate,
  isUnavailable,
}: {
  field: HealthClosureField;
  isGate: boolean;
  isUnavailable: boolean;
}) {
  const className = 'h-4 w-4 shrink-0 text-fg-tertiary';
  const isRightDoor = !isGate && field.endsWith('_right_closed');
  const testId = `closure-icon-${field}`;

  return (
    <span
      className="inline-flex shrink-0"
      data-testid={testId}
      data-closure-kind={isGate ? 'gate' : 'door'}
      aria-hidden="true"
    >
      {isUnavailable ? (
        <CircleAlert className={className} />
      ) : !isGate ? (
        <TbCarDoor
          className={className}
          style={isRightDoor ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : field === 'closure_frunk_closed' ? (
        <FrunkIcon className={className} />
      ) : (
        <LiftgateIcon className={className} />
      )}
    </span>
  );
}

function FrunkIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 20v-1.6c0-2.1 1.4-3.8 3.5-4.2l9.5-1.9" />
      <path d="m8.5 5.5 2.7-1.4 8.9 8.8-3.2.8-8.4-8.2Z" />
      <path d="M5 14v-4m0 0h4m-4 0 6 6" />
    </svg>
  );
}

function LiftgateIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h7.2c1.5 0 2.8.6 3.8 1.7l2.4 2.8H12" />
      <path d="M5 20c2.1-.2 3.5-1.6 3.5-4V8.5C8.5 6 7.2 4.5 5 4" />
      <path d="M12 15h7" />
      <path d="m16 12 3 3-3 3" />
    </svg>
  );
}

function ExtendedReading({
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
    <div className="min-w-0 rounded-xl border border-border bg-bg-elevated/35 p-3">
      <div className="flex items-center gap-2 text-fg-secondary">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 truncate text-lg font-semibold text-fg">{value}</p>
      {detail ? <p className="mt-1 text-xs text-fg-tertiary">{detail}</p> : null}
    </div>
  );
}

function formatSignal(value: number | null | undefined) {
  return value == null ? '' : `(${value} dBm)`;
}

function formatEfficiency(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value * 1.60934)} Wh/mi`;
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

type HealthClosureField =
  | 'closure_frunk_closed'
  | 'closure_liftgate_closed'
  | 'closure_tailgate_closed'
  | 'door_front_left_closed'
  | 'door_front_right_closed'
  | 'door_rear_left_closed'
  | 'door_rear_right_closed';

type HealthClosureRow = {
  field: HealthClosureField;
  label: string;
  value: boolean | null;
  availability: StatusAvailabilitySummary | null;
};

function buildTireHistory(
  frame: TelemetryLaneFrame | undefined,
  field: 'tire_fl_psi' | 'tire_fr_psi' | 'tire_rl_psi' | 'tire_rr_psi'
) {
  const values = frame?.lanes.health?.numeric[field] ?? [];
  const series = (frame?.spine ?? []).map((ts, index) => ({
    ts,
    value: values[index] ?? null,
  }));
  return series.some((point) => typeof point.value === 'number' && Number.isFinite(point.value))
    ? series
    : [];
}

const HEALTH_CLOSURE_DEFINITIONS: Array<Pick<HealthClosureRow, 'field' | 'label'>> = [
  { field: 'closure_frunk_closed', label: 'Frunk' },
  { field: 'closure_liftgate_closed', label: 'Liftgate' },
  { field: 'closure_tailgate_closed', label: 'Tailgate' },
  { field: 'door_front_left_closed', label: 'Front left door' },
  { field: 'door_front_right_closed', label: 'Front right door' },
  { field: 'door_rear_left_closed', label: 'Rear left door' },
  { field: 'door_rear_right_closed', label: 'Rear right door' },
];

function getHealthClosureRows(
  model: string | null | undefined,
  values: Record<HealthClosureField, boolean | null>,
  status: import('@riviamigo/types').VehicleStatus | null | undefined
): HealthClosureRow[] {
  const normalizedModel = model?.trim().toUpperCase() ?? '';
  const knownModel =
    normalizedModel.includes('R1T') ||
    normalizedModel.includes('R1S') ||
    normalizedModel.includes('R2S');
  const supportedGate: HealthClosureField | null = normalizedModel.includes('R1T')
    ? 'closure_tailgate_closed'
    : normalizedModel.includes('R1S') || normalizedModel.includes('R2S')
      ? 'closure_liftgate_closed'
      : null;
  const definitions = HEALTH_CLOSURE_DEFINITIONS.filter(({ field }) => {
    if (field === 'closure_liftgate_closed' || field === 'closure_tailgate_closed') {
      if (knownModel) return field === supportedGate;
      return values[field] !== null || status?.field_availability?.[field]?.ever_seen === true;
    }
    if (!knownModel) {
      return values[field] !== null || status?.field_availability?.[field]?.ever_seen === true;
    }
    return true;
  });

  return definitions.map(({ field, label }) => ({
    field,
    label,
    value: values[field],
    availability: status ? summarizeStatusAvailability(status, [field]) : null,
  }));
}

function summarizeClosures(rows: HealthClosureRow[]) {
  const values = rows.map((row) => row.value);
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
  return formatAppDateTime(value, { second: '2-digit', timeZoneName: 'short' });
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
