import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useChargeSessions } from '@riviamigo/hooks';
import { DataTable, chargingColumns, type ChargeSessionRow } from '@riviamigo/ui/tables';
import { Badge } from '@riviamigo/ui/primitives';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import type { Row } from '@tanstack/react-table';

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

const CHARGER_VARIANT: Record<string, 'accent' | 'info' | 'success'> = {
  dcfc: 'accent', dc: 'info', ac: 'success',
};

function ChargeSessionCard({ session, onClick }: { session: ChargeSessionRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-bg-elevated/60 px-3 py-2.5 transition-colors hover:bg-bg-elevated"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-medium text-fg">
          {format(parseISO(session.started_at), 'MMM d, yyyy')}
        </span>
        {session.charger_type && (
          <Badge variant={CHARGER_VARIANT[session.charger_type] ?? 'default'} size="sm">
            {session.charger_type.toUpperCase()}
          </Badge>
        )}
      </div>
      {session.location_name && (
        <p className="mb-2 truncate text-sm text-fg-secondary">{session.location_name}</p>
      )}
      <div className="flex items-center gap-3 text-xs text-fg-secondary flex-wrap">
        {session.energy_added_kwh != null && (
          <span className="font-mono font-medium text-fg">{formatKwh(session.energy_added_kwh)}</span>
        )}
        {session.duration_min != null && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span>{formatDuration(session.duration_min)}</span>
          </>
        )}
        {session.peak_power_kw != null && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span className="font-mono">Peak {session.peak_power_kw.toFixed(1)} kW</span>
          </>
        )}
        {session.soc_start != null && session.soc_end != null && (
          <span className="font-mono text-fg-tertiary">
            {formatPercent(session.soc_start, 0)} → {formatPercent(session.soc_end, 0)}
          </span>
        )}
        {session.cost_usd != null && (
          <span className="ml-auto font-mono text-accent">{formatCurrency(session.cost_usd)}</span>
        )}
      </div>
    </button>
  );
}

function ChargingTableWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const isMobile = useIsMobile();
  const { data, isLoading } = useChargeSessions(ctx.vehicleId, ctx.from, ctx.to, page, pageSize);
  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;
  const sessions = (data?.items ?? []) as unknown as ChargeSessionRow[];

  React.useEffect(() => {
    setPage(1);
  }, [ctx.from, ctx.to, ctx.vehicleId, pageSize]);

  function handleRowClick(row: Row<ChargeSessionRow>) {
    navigate({ to: '/charging/$sessionId', params: { sessionId: row.original.id } });
  }

  const pagination = data ? (
    <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
      <p className="text-xs text-fg-tertiary">
        Page {page} of {Math.max(totalPages, 1)} &middot; {data.total} session{data.total === 1 ? '' : 's'}
      </p>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
        >
          Prev
        </button>
        <button
          disabled={page >= totalPages || totalPages <= 1}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex !h-auto min-h-full flex-col gap-3">
      <div className="flex shrink-0 justify-end">
        {!isMobile && (
          <label className="flex items-center gap-2 text-xs text-fg-tertiary">
            Rows
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
            >
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        )}
      </div>
      {isMobile ? (
        <div className="flex flex-col gap-2">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-bg-elevated/60" />
              ))
            : sessions.length === 0
            ? <p className="py-8 text-center text-sm text-fg-tertiary">No charging sessions found</p>
            : sessions.map((session) => (
                <ChargeSessionCard
                  key={session.id}
                  session={session}
                  onClick={() => navigate({ to: '/charging/$sessionId', params: { sessionId: session.id } })}
                />
              ))
          }
        </div>
      ) : (
        <DataTable
          data={sessions}
          columns={chargingColumns}
          loading={isLoading}
          loadingRows={pageSize}
          onRowClick={handleRowClick}
          emptyTitle="No charging sessions"
          emptyDescription="Sessions will appear here after your vehicle has charged."
          className="overflow-x-auto"
        />
      )}
      {pagination}
    </div>
  );
}

registerWidget({
  componentType: 'custom',
  definitionId: 'charging.sessions.table',
  title: 'Charging Sessions',
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 6, h: 6 },
  defaultOptions: {},
  component: ChargingTableWidget,
});
