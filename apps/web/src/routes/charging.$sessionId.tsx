import React from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSession, useChargeCurve } from '@riviamigo/hooks';
import {
  PageLayout, ChartSection, StatCardGrid, StatCard, Button,
} from '@riviamigo/ui/primitives';
import { ChargeCurveChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
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

function ChargeSessionContent() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();
  const { sessionId } = useParams({ from: '/charging/$sessionId' });

  const { data: session }                         = useChargeSession(sessionId, defaultVehicleId);
  const { data: curve, isLoading: curveLoading }  = useChargeCurve(sessionId, defaultVehicleId);

  const title = session
    ? format(parseISO(session.started_at), 'MMMM d, yyyy · h:mm a')
    : 'Charge Session';

  return (
    <AppLayout activeKey="charging">
      <PageLayout
        title={title}
        subtitle={session?.location_name ?? undefined}
        actions={
          <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate({ to: '/charging' })}>
            Back
          </Button>
        }
      >
        <StatCardGrid>
          <StatCard label="Energy Added" value={session ? formatKwh(session.energy_added_kwh ?? 0) : '—'} accent />
          <StatCard
            label="SoC"
            value={
              session?.soc_start !== undefined && session?.soc_end !== undefined
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
          <ChargeCurveChart
            data={(curve ?? []).map((p) => ({ soc: p.soc_pct, power_kw: p.power_kw }))}
            loading={curveLoading}
            height={240}
          />
        </ChartSection>
      </PageLayout>
    </AppLayout>
  );
}
