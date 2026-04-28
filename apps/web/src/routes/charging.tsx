import React, { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSessions, useChargingSummary } from '@riviamigo/hooks';
import {
  PageLayout, StatCardGrid, StatCard, MetricTabs, DateRangePicker,
} from '@riviamigo/ui/primitives';
import { EnergyBarChart } from '@riviamigo/ui/charts';
import { DataTable, chargingColumns, type ChargeSessionRow } from '@riviamigo/ui/tables';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';
import { formatKwh, formatCurrency } from '@riviamigo/ui/lib/utils';
import type { Row } from '@tanstack/react-table';
import { List, BarChart2 } from 'lucide-react';

export const chargingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charging',
  component: ChargingPage,
});

const TABS = [
  { key: 'sessions', label: 'Sessions', icon: <List /> },
  { key: 'energy',   label: 'Energy',   icon: <BarChart2 /> },
];

function ChargingPage() {
  return <AuthGuard><ChargingContent /></AuthGuard>;
}

export function ChargingContent() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState('sessions');
  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const [page, setPage] = useState(1);
  const { from, to } = rangeToIso(range);

  const { data, isLoading } = useChargeSessions(defaultVehicleId, from, to, page);
  const { data: summary }   = useChargingSummary(defaultVehicleId, from, to);

  const energyData = [...(data?.items ?? [])].reverse().map((s) => ({
    ts: s.started_at,
    energy_added_kwh: s.energy_added_kwh ?? 0,
  }));

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;

  function handleRowClick(row: Row<ChargeSessionRow>) {
    navigate({ to: '/charging/$sessionId', params: { sessionId: row.original.id } });
  }

  return (
    <AppLayout activeKey="charging">
      <PageLayout
        title="Charging"
        subtitle={data ? `${data.total} sessions` : undefined}
        actions={
          <DateRangePicker
            value={range}
            preset={preset}
            onChange={(r, p) => { setRange(r); if (p) setPreset(p); setPage(1); }}
          />
        }
      >
        <StatCardGrid>
          <StatCard label="Total Energy"  value={formatKwh(summary?.total_energy_kwh ?? 0)} accent />
          <StatCard label="Sessions"      value={summary?.session_count ?? 0} />
          <StatCard label="Total Cost"    value={formatCurrency(summary?.total_cost_usd ?? 0)} />
          <StatCard
            label="Avg Session"
            value={formatKwh(
              summary && summary.session_count > 0
                ? summary.total_energy_kwh / summary.session_count
                : 0
            )}
          />
        </StatCardGrid>

        <MetricTabs
          tabs={TABS}
          active={tab}
          onChange={setTab}
          title="Charging History"
          subtitle={`${preset}`}
        >
          {tab === 'sessions' && (
            <>
              <DataTable
                data={(data?.items ?? []) as unknown as ChargeSessionRow[]}
                columns={chargingColumns}
                loading={isLoading}
                onRowClick={handleRowClick}
                emptyTitle="No charging sessions"
                emptyDescription="Sessions will appear here after your vehicle has charged."
              />
              {data && data.total > data.per_page && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-fg-tertiary">Page {page} of {totalPages}</p>
                  <div className="flex gap-2">
                    <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors">
                      Previous
                    </button>
                    <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors">
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === 'energy' && (
            <EnergyBarChart data={energyData} loading={isLoading} height={280} />
          )}
        </MetricTabs>
      </PageLayout>
    </AppLayout>
  );
}
