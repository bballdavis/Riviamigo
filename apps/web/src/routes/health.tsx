import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  Activity,
  BatteryWarning,
  CheckCircle2,
  CircleAlert,
  Cpu,
  DoorOpen,
  Gauge,
  HeartPulse,
  Radio,
} from 'lucide-react';
import type { BadgeProps } from '@riviamigo/ui/primitives';
import type { VehicleHealthClosures, VehicleHealthTires } from '@riviamigo/types';
import { rootRoute } from './__root';
import { useAuth, useVehicleHealth } from '@riviamigo/hooks';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageLayout,
  Skeleton,
} from '@riviamigo/ui/primitives';
import { formatPressure } from '@riviamigo/ui/lib/utils';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

export const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/health',
  component: VehicleHealthPage,
});

function VehicleHealthPage() {
  return (
    <AuthGuard>
      <VehicleHealthContent />
    </AuthGuard>
  );
}

function VehicleHealthContent() {
  const { defaultVehicleId } = useAuth();
  const { data, isLoading } = useVehicleHealth(defaultVehicleId);
  const vehicleName = data?.vehicle?.name || data?.vehicle?.model || 'Rivian';
  const displayModel = [data?.vehicle?.model, data?.vehicle?.trim].filter(Boolean).join(' ');
  const freshness = getFreshness(data?.runtime?.last_event_at ?? data?.latest?.ts ?? null);
  const collector = getCollectorState(data?.runtime?.worker_health ?? null);
  const twelveVolt = getHealthState(data?.latest?.twelve_volt_health ?? null);
  const thermal = getThermalState(
    data?.latest?.hv_thermal_event ?? null,
    data?.thermal_events_30d ?? 0
  );
  const closures = summarizeClosures(data?.closures ?? null);
  const tireSummary = summarizeTires(data?.tires ?? null);
  const otaStatus = data?.latest?.ota_available_version
    ? `Update ${data.latest.ota_available_version} available`
    : (data?.latest?.ota_status ?? data?.latest?.ota_current_status ?? 'No update flagged');

  return (
    <AppLayout activeKey="health">
      <PageLayout
        title="Vehicle Health"
        subtitle="Mechanical signals, software state, and telemetry freshness for your Rivian."
        className="pt-10 lg:pt-0"
      >
        {!defaultVehicleId ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account to view vehicle health."
          />
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
              <Card className="overflow-hidden border-accent/20 bg-[radial-gradient(circle_at_18%_0%,rgba(253,131,4,0.18),transparent_32%),var(--rm-bg-surface)]">
                <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-lg border border-accent/20 bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent">
                      <HeartPulse className="h-3.5 w-3.5" />
                      Health overview
                    </div>
                    <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-fg">
                      {vehicleName}
                    </h2>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {displayModel || 'Vehicle identity pending telemetry'}
                    </p>
                    {data?.vehicle?.vin ? (
                      <p className="mt-2 font-mono text-xs text-fg-tertiary">
                        VIN {data.vehicle?.vin}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 md:w-[30rem]">
                    <HeroMetric
                      label="Collector"
                      value={collector.label}
                      variant={collector.variant}
                    />
                    <HeroMetric label="12V" value={twelveVolt.label} variant={twelveVolt.variant} />
                    <HeroMetric label="Thermal" value={thermal.label} variant={thermal.variant} />
                    <HeroMetric
                      label="Tires"
                      value={tireSummary.label}
                      variant={tireSummary.variant}
                    />
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
                      data?.runtime?.worker_health_msg ??
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
                title="HV Thermal"
                value={thermal.label}
                detail={`${data?.thermal_events_30d ?? 0} battery thermal events observed in the last 30 days.`}
                variant={thermal.variant}
                isLoading={isLoading}
              />
              <StatusPanel
                icon={<Cpu className="h-4 w-4" />}
                title="Software"
                value={data?.current_software_version ?? 'Unknown'}
                detail={otaStatus}
                variant={data?.latest?.ota_available_version ? 'info' : 'default'}
                isLoading={isLoading}
              />
            </section>

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
                        value={data.tires.tire_fl_psi}
                        status={data.tires.tire_fl_status}
                      />
                      <TireGauge
                        label="Front Right"
                        value={data.tires.tire_fr_psi}
                        status={data.tires.tire_fr_status}
                      />
                      <TireGauge
                        label="Rear Left"
                        value={data.tires.tire_rl_psi}
                        status={data.tires.tire_rl_status}
                      />
                      <TireGauge
                        label="Rear Right"
                        value={data.tires.tire_rr_psi}
                        status={data.tires.tire_rr_status}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Closures</CardTitle>
                  <Badge variant={closures.variant} dot>
                    {closures.label}
                  </Badge>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <HealthGridSkeleton />
                  ) : !data?.closures ? (
                    <EmptyPanel text="No closure telemetry found yet." />
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ClosureRow label="Frunk" value={data.closures.closure_frunk_closed} />
                      <ClosureRow label="Liftgate" value={data.closures.closure_liftgate_closed} />
                      <ClosureRow label="Tailgate" value={data.closures.closure_tailgate_closed} />
                      <ClosureRow
                        label="Front left door"
                        value={data.closures.door_front_left_closed}
                      />
                      <ClosureRow
                        label="Front right door"
                        value={data.closures.door_front_right_closed}
                      />
                      <ClosureRow
                        label="Rear left door"
                        value={data.closures.door_rear_left_closed}
                      />
                      <ClosureRow
                        label="Rear right door"
                        value={data.closures.door_rear_right_closed}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Software History</CardTitle>
                <Badge variant="default">{data?.software_history?.length ?? 0} entries</Badge>
              </CardHeader>
              <CardContent>
                {(data?.software_history?.length ?? 0) === 0 ? (
                  <EmptyPanel text="No software version history yet." />
                ) : (
                  <div className="relative space-y-3 before:absolute before:left-[0.42rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
                    {data?.software_history.map((entry, index) => (
                      <div
                        key={`${entry.version}-${entry.installed_at}`}
                        className="relative grid gap-1 pl-6 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1fr)]"
                      >
                        <span
                          className={`absolute left-0 top-1.5 h-3 w-3 rounded-full border ${index === 0 ? 'border-accent bg-accent' : 'border-border-strong bg-bg-elevated'}`}
                        />
                        <div>
                          <p className="font-mono text-sm text-fg">
                            {entry.version ?? 'Unknown version'}
                          </p>
                          <p className="mt-0.5 text-xs text-fg-tertiary">
                            {index === 0 ? 'Current software' : 'Previous software'}
                          </p>
                        </div>
                        <p className="text-sm text-fg-secondary">
                          {formatDateTime(entry.installed_at)}
                          <span className="text-fg-tertiary"> to </span>
                          {entry.observed_until ? formatDateTime(entry.observed_until) : 'Current'}
                        </p>
                      </div>
                    ))}
                  </div>
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
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: BadgeVariant;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-bg-glass p-3">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
        {label}
      </p>
      <Badge variant={variant} className="mt-2 max-w-full truncate">
        {value}
      </Badge>
    </div>
  );
}

function StatusPanel({
  icon,
  title,
  value,
  detail,
  variant,
  isLoading,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
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
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">{title}</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-7 w-28" />
          ) : (
            <Badge variant={variant} className="mt-2 max-w-full truncate">
              {value}
            </Badge>
          )}
          <p className="mt-3 text-sm leading-5 text-fg-secondary">{detail}</p>
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
}: {
  label: string;
  value: number | null;
  status: string | null;
}) {
  const state = getTireState(status);
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/55 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">{label}</p>
        <Badge variant={state.variant} size="sm">
          {state.label}
        </Badge>
      </div>
      <div className="mt-5 flex items-end gap-2">
        <p className="font-mono text-3xl font-semibold tabular-nums text-fg">
          {formatPressure(value)}
        </p>
      </div>
    </div>
  );
}

function ClosureRow({ label, value }: { label: string; value: boolean | null }) {
  const Icon = value === false ? DoorOpen : value === true ? CheckCircle2 : CircleAlert;
  const variant = value === false ? 'warning' : value === true ? 'success' : 'default';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/55 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-fg-tertiary" />
        <span className="truncate text-sm text-fg-secondary">{label}</span>
      </div>
      <Badge variant={variant}>{asOpenClosed(value)}</Badge>
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

function summarizeTires(tires: VehicleHealthTires | null) {
  if (!tires) return { label: 'Unknown', detail: 'No snapshot', variant: 'default' as const };
  const states = [
    tires.tire_fl_status,
    tires.tire_fr_status,
    tires.tire_rl_status,
    tires.tire_rr_status,
  ].filter(Boolean);
  const hasWarning = states.some((status) => /low|high|warn|critical|fault/i.test(status ?? ''));
  const values = [
    tires.tire_fl_psi,
    tires.tire_fr_psi,
    tires.tire_rl_psi,
    tires.tire_rr_psi,
  ].filter((v): v is number => typeof v === 'number');
  if (hasWarning)
    return { label: 'Check', detail: 'Attention needed', variant: 'warning' as const };
  if (values.length === 4)
    return {
      label: 'Normal',
      detail: `${Math.round(Math.min(...values))}-${Math.round(Math.max(...values))} psi`,
      variant: 'success' as const,
    };
  return { label: 'Partial', detail: `${values.length}/4 wheels`, variant: 'info' as const };
}

function summarizeClosures(closures: VehicleHealthClosures | null) {
  if (!closures) return { label: 'Unknown', variant: 'default' as const };
  const values = [
    closures.closure_frunk_closed,
    closures.closure_liftgate_closed,
    closures.closure_tailgate_closed,
    closures.door_front_left_closed,
    closures.door_front_right_closed,
    closures.door_rear_left_closed,
    closures.door_rear_right_closed,
  ];
  const open = values.filter((value) => value === false).length;
  if (open > 0) return { label: `${open} open`, variant: 'warning' as const };
  const known = values.filter((value) => value !== null).length;
  return known > 0
    ? { label: 'Secured', variant: 'success' as const }
    : { label: 'Unknown', variant: 'default' as const };
}

function getCollectorState(value: string | null) {
  if (!value) return { label: 'Unknown', variant: 'default' as const };
  if (/connected|healthy|ok/i.test(value))
    return { label: titleCase(value), variant: 'success' as const };
  if (/auth|error|failed/i.test(value))
    return { label: titleCase(value), variant: 'danger' as const };
  return { label: titleCase(value), variant: 'warning' as const };
}

function getHealthState(value: string | null) {
  if (!value) return { label: 'Unknown', variant: 'default' as const };
  if (/normal|good|ok/i.test(value))
    return { label: titleCase(value), variant: 'success' as const };
  if (/critical|fault|fail/i.test(value))
    return { label: titleCase(value), variant: 'danger' as const };
  return { label: titleCase(value), variant: 'warning' as const };
}

function getThermalState(value: string | null, count: number) {
  if (value && !/^none$/i.test(value))
    return { label: titleCase(value), variant: 'warning' as const };
  if (count > 0) return { label: `${count} recent`, variant: 'warning' as const };
  return { label: 'Normal', variant: 'success' as const };
}

function getTireState(status: string | null) {
  if (!status) return { label: 'No status', variant: 'default' as const };
  if (/normal|ok/i.test(status)) return { label: titleCase(status), variant: 'success' as const };
  if (/critical|fault/i.test(status))
    return { label: titleCase(status), variant: 'danger' as const };
  return { label: titleCase(status), variant: 'warning' as const };
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
  return new Date(value).toLocaleString();
}

function asOpenClosed(value: boolean | null) {
  if (value === null) return 'Unknown';
  return value ? 'Closed' : 'Open';
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
