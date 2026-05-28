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

function formatSessionDay(session: ChargeSessionRow): string {
  if (session.session_day_local) {
    return format(parseISO(`${session.session_day_local}T00:00:00`), 'MMM d, yyyy');
  }
  return format(parseISO(session.started_at), 'MMM d, yyyy');
}

function ChargeSessionCard({ session, onClick }: { session: ChargeSessionRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-bg-elevated/60 px-3 py-2 transition-colors hover:bg-bg-elevated"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-fg">
            {formatSessionDay(session)}
          </span>
          <span className="text-xs text-fg-tertiary">
            {format(parseISO(session.started_at), 'h:mm a')}
            {session.duration_min != null
              ? ` – ${format(new Date(parseISO(session.started_at).getTime() + session.duration_min * 60000), 'h:mm a')}`
              : null}
          </span>
        </div>
        {session.charger_type && (
          <Badge variant={CHARGER_VARIANT[session.charger_type] ?? 'default'} size="sm">
            {session.charger_type.toUpperCase()}
          </Badge>
        )}
      </div>
      {session.location_name && (
        <p className="mb-1 truncate text-xs text-fg-secondary">{session.location_name}</p>
      )}
      <div className="flex items-center gap-2 text-xs text-fg-secondary flex-wrap">
        {session.energy_added_kwh != null && (
          <span className="font-mono font-medium text-fg text-xs">{formatKwh(session.energy_added_kwh)}</span>
        )}
        {session.duration_min != null && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span className="text-xs">{formatDuration(session.duration_min)}</span>
          </>
        )}
        {session.peak_power_kw != null && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span className="font-mono text-xs">Peak {session.peak_power_kw.toFixed(1)} kW</span>
          </>
        )}
        {session.soc_start != null && session.soc_end != null && (
          <span className="font-mono text-fg-tertiary text-xs">
            {formatPercent(session.soc_start, 0)} → {formatPercent(session.soc_end, 0)}
          </span>
        )}
        {session.cost_usd != null && (
          <span className="ml-auto font-mono text-accent text-xs">{formatCurrency(session.cost_usd)}</span>
        )}
      </div>
    </button>
  );
}

function ChargingTableWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const deferredSearch = React.useDeferredValue(search);
  const isMobile = useIsMobile();
  // Load all sessions (large limit) for client-side filtering
  const { data, isLoading } = useChargeSessions(ctx.vehicleId, ctx.from, ctx.to, 1, 300);
  const allSessions = (data?.items ?? []) as unknown as ChargeSessionRow[];

  // Filter sessions by location name
  const filteredSessions = React.useMemo(() => {
    if (!deferredSearch.trim()) return allSessions;
    const q = deferredSearch.toLowerCase();
    return allSessions.filter((s) =>
      (s.location_name ?? '').toLowerCase().includes(q)
    );
  }, [allSessions, deferredSearch]);

  // Paginate filtered results
  const totalPages = Math.ceil(filteredSessions.length / pageSize);
  const paginatedSessions = React.useMemo(() => {
    const startIdx = (page - 1) * pageSize;
    return filteredSessions.slice(startIdx, startIdx + pageSize);
  }, [filteredSessions, page, pageSize]);

  React.useEffect(() => {
    setPage(1);
  }, [ctx.from, ctx.to, ctx.vehicleId, deferredSearch, pageSize]);

  function handleRowClick(row: Row<ChargeSessionRow>) {
    navigate({ to: '/charging/$sessionId', params: { sessionId: row.original.id } });
  }

  const pagination = filteredSessions.length > 0 ? (
    <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
      <p className="text-xs text-fg-tertiary">
        Page {page} of {Math.max(totalPages, 1)} · {filteredSessions.length} session{filteredSessions.length === 1 ? '' : 's'}
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
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Search and controls header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <label className="relative flex-1 min-w-0 sm:min-w-[14rem] max-w-md">
          <span className="sr-only">Search locations</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search location"
            className="w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-tertiary focus:border-accent"
          />
        </label>
        {!isMobile && (
          <label className="flex items-center gap-2 text-xs text-fg-tertiary shrink-0">
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

      {/* Table content */}
      {isMobile ? (
        <div className="flex flex-col gap-1 min-h-0 flex-1 overflow-y-auto">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-bg-elevated/60" />
              ))
            : paginatedSessions.length === 0
            ? <p className="py-4 text-center text-xs text-fg-tertiary">{search ? 'No sessions match that location.' : 'No charging sessions found'}</p>
            : paginatedSessions.map((session) => (
                <ChargeSessionCard
                  key={session.id}
                  session={session}
                  onClick={() => navigate({ to: '/charging/$sessionId', params: { sessionId: session.id } })}
                />
              ))
          }
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DataTable
            data={paginatedSessions}
            columns={chargingColumns}
            loading={isLoading}
            loadingRows={pageSize}
            onRowClick={handleRowClick}
            emptyTitle="No charging sessions"
            emptyDescription={search ? 'No sessions match that location.' : 'Sessions will appear here after your vehicle has charged.'}
            className="overflow-x-auto overflow-y-auto"
          />
        </div>
      )}

      {/* Pagination */}
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
