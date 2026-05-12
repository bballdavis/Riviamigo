import React from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSession } from '@riviamigo/hooks';
import {
  PageLayout, ChartSection, StatCardGrid, StatCard,
} from '@riviamigo/ui/primitives';
import { DashboardChartWidget } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';

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

  return (
    <AppLayout activeKey="charging">
      <PageLayout
        title={title}
        subtitle={session?.location_name ?? undefined}
        titleAction={
          <button
            type="button"
            aria-label="Back to charging"
            className="inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-lg border border-accent bg-bg-surface text-accent transition-colors hover:bg-accent/10 focus:outline-none focus:ring-1 focus:ring-accent"
            onClick={() => navigate({ to: '/charging' })}
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
        }
      >
        {!hasVehicle ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account before opening charging session details."
          />
        ) : (
          <>
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
