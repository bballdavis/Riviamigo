import React from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSession } from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard, Card,
} from '@riviamigo/ui/primitives';
import { DashboardChartWidget } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Database, MapPin, RadioTower, Receipt, Route, Zap } from 'lucide-react';

export const chargingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charging/$sessionId',
  component: ChargeSessionDetailPage,
});

function ChargeSessionDetailPage() {
  return <AuthGuard><ChargeSessionContent /></AuthGuard>;
}

export function ChargeSessionContent() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();
  const { sessionId } = useParams({ from: '/charging/$sessionId' });

  const { data: session } = useChargeSession(sessionId, defaultVehicleId);
  const hasVehicle = !!defaultVehicleId;
  const chargeCurveInstance = {
    id: `charge-session-curve-${sessionId}`,
    componentType: 'chart' as const,
    definitionId: 'catalog',
    title: 'Charge Rate Curve',
    layout: { x: 0, y: 0, w: 12, h: 8 },
    options: {
      page: 'charging',
      chartId: 'charge-session-curve',
      chartIds: ['charge-session-curve'],
      showPicker: false,
      curveSmoothing: 0.2,
    },
  };

  const title = session
    ? (() => {
        const start = parseISO(session.started_at);
        const dateStr = format(start, 'MMMM d, yyyy');
        const startTime = format(start, 'h:mm a');
        const endTime = session.ended_at ? format(parseISO(session.ended_at), 'h:mm a') : null;
        return endTime ? `${dateStr} · ${startTime} – ${endTime}` : `${dateStr} · ${startTime}`;
      })()
    : 'Charge Session';

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
        subtitle={session?.location_name ?? undefined}
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
                Explicit container height so the widget fills it properly
                without a settings-button gap above the chart area. */}
            <div className="bg-bg-surface border border-border rounded-xl p-5">
              <div className="mb-3">
                <h2 className="text-sm font-medium text-fg-secondary uppercase tracking-wider">Charge Curve</h2>
                <p className="mt-0.5 text-xs text-fg-tertiary">Charge rate (kW) and cumulative energy (kWh) over time</p>
              </div>
              <div style={{ height: 360 }}>
                <DashboardChartWidget
                  instance={chargeCurveInstance}
                  ctx={{
                    vehicleId: defaultVehicleId,
                    from: session?.started_at ?? '',
                    to: session?.ended_at ?? session?.started_at ?? '',
                    chargeSessionId: sessionId,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </PageLayout>
    </AppLayout>
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
      <SourceFact icon={<Database className="h-4 w-4" />} label="Source" value={formatSourceLabel(session.source)} />
      <SourceFact icon={<RadioTower className="h-4 w-4" />} label="Telemetry" value={telemetryLabel} />
      <SourceFact icon={<Zap className="h-4 w-4" />} label="Network" value={networkLabel} />
      {evidence.map((fact) => (
        <SourceFact key={`${fact.label}-${fact.value}`} icon={fact.icon} label={fact.label} value={fact.value} />
      ))}
    </Card>
  );
}

function formatSourceLabel(source: string | null | undefined) {
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
