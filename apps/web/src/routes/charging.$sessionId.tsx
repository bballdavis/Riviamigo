import React from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSession } from '@riviamigo/hooks';
import {
  PageLayout, ChartSection, StatCardGrid, StatCard, Badge, Card,
} from '@riviamigo/ui/primitives';
import { DashboardChartWidget } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Database, RadioTower, Zap } from 'lucide-react';

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
    ? format(parseISO(session.started_at), 'MMMM d, yyyy · h:mm a')
    : 'Charge Session';

  const isApiBackfill = session?.source === 'rivian_api';
  const noTelemetry = isApiBackfill && (session.telemetry_sample_count ?? 0) === 0;

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
        actions={session ? <SessionSourceBadges isApiBackfill={isApiBackfill} noTelemetry={noTelemetry} /> : undefined}
      >
        {!hasVehicle ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account before opening charging session details."
          />
        ) : (
          <>
        {session && (isApiBackfill || noTelemetry || session.network_vendor || session.range_added_km != null) && (
          <SessionSourcePanel session={session} />
        )}

        <StatCardGrid>
          <StatCard label="Energy Added" value={session ? formatKwh(session.energy_added_kwh ?? 0) : '—'} accent />
          <StatCard
            label="SoC"
            value={
              session?.soc_start != null && session?.soc_end != null
                ? `${formatPercent(session.soc_start, 0)} → ${formatPercent(session.soc_end, 0)}`
                : '—'
            }
          />
          <StatCard
            label="Duration"
            value={session ? formatDuration((session as unknown as { duration_min?: number }).duration_min ?? 0) : '—'}
          />
          <StatCard
            label="Cost"
            value={session?.cost_usd !== undefined ? formatCurrency(session.cost_usd ?? 0) : '—'}
          />
        </StatCardGrid>

        <ChartSection title="Charge Curve" subtitle="Power vs state of charge">
          <DashboardChartWidget
            instance={chargeCurveInstance}
            ctx={{
              vehicleId: defaultVehicleId,
              from: session?.started_at ?? '',
              to: session?.ended_at ?? session?.started_at ?? '',
              chargeSessionId: sessionId,
            }}
          />
        </ChartSection>
          </>
        )}
      </PageLayout>
    </AppLayout>
  );
}

type ChargeSessionDetail = NonNullable<ReturnType<typeof useChargeSession>['data']>;

function SessionSourceBadges({ isApiBackfill, noTelemetry }: { isApiBackfill: boolean; noTelemetry: boolean }) {
  if (!isApiBackfill && !noTelemetry) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {isApiBackfill && <Badge variant="info" dot>Rivian API</Badge>}
      {noTelemetry && <Badge variant="warning" dot>No telemetry</Badge>}
    </div>
  );
}

function SessionSourcePanel({ session }: { session: ChargeSessionDetail }) {
  const telemetryCount = session.telemetry_sample_count ?? 0;
  const sourceLabel = session.source === 'rivian_api' ? 'Rivian API backfill' : 'Live telemetry';
  const telemetryLabel = telemetryCount > 0 ? `${telemetryCount.toLocaleString()} samples matched` : 'No telemetry samples matched';

  return (
    <Card padding="md" className="grid gap-3 md:grid-cols-3">
      <SourceFact icon={<Database className="h-4 w-4" />} label="Source" value={sourceLabel} />
      <SourceFact icon={<RadioTower className="h-4 w-4" />} label="Telemetry" value={telemetryLabel} />
      <SourceFact icon={<Zap className="h-4 w-4" />} label="Network" value={session.network_vendor ?? (session.charger_type ? session.charger_type.toUpperCase() : 'Unknown')} />
    </Card>
  );
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
