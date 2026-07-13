import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useChargeSessions } from '@riviamigo/hooks';
import { DataTable, chargingColumns, type ChargeSessionRow } from '@riviamigo/ui/tables';
import { Badge, SelectPicker } from '@riviamigo/ui/primitives';
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

const CHARGER_VARIANT: Record<string, 'accent' | 'info' | 'success' | 'warning'> = {
  dcfc: 'warning', dc: 'warning', ac: 'success', ac_l2: 'success',
};

function normalizeAcDcType(chargerType: string | null | undefined): 'ac' | 'dc' | null {
  if (!chargerType) return null;
  const normalized = chargerType.toLowerCase();
  if (normalized === 'dc' || normalized === 'dcfc') return 'dc';
  if (normalized === 'ac' || normalized === 'ac_l2') return 'ac';
  return null;
}

function deriveAcDcType(session: ChargeSessionRow): 'ac' | 'dc' | null {
  const explicit = normalizeAcDcType(session.charger_type);
  if (explicit) return explicit;

  const vendor = (session.network_vendor ?? '').trim().toLowerCase();
  if (vendor && ['tesla', 'rivian', 'electrify america', 'evgo'].includes(vendor)) {
    return 'dc';
  }

  if (session.peak_power_kw != null && Number.isFinite(session.peak_power_kw)) {
    return session.peak_power_kw < 20 ? 'ac' : 'dc';
  }

  return null;
}

function formatSessionDay(session: ChargeSessionRow): string {
  if (session.session_day_local) {
    return format(parseISO(`${session.session_day_local}T00:00:00`), 'MMM d, yyyy');
  }
  return format(parseISO(session.started_at), 'MMM d, yyyy');
}

function ChargeSessionCard({ session, onClick }: { session: ChargeSessionRow; onClick: () => void }) {
  const type = deriveAcDcType(session);

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
        {type && (
          <Badge variant={CHARGER_VARIANT[type] ?? 'default'} size="sm">
            {type.toUpperCase()}
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
  const normalizedSearch = deferredSearch.trim();
  const isMobile = useIsMobile();
  const { data, isLoading } = useChargeSessions(
    ctx.vehicleId,
    ctx.from,
    ctx.to,
    page,
    pageSize,
    normalizedSearch,
    ctx.chargeSessionDayLocal ?? null,
  );
  const sessions = (data?.items ?? []) as unknown as ChargeSessionRow[];
  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;
  const totalSessions = data?.total ?? 0;

  React.useEffect(() => {
    setPage(1);
  }, [ctx.from, ctx.to, ctx.vehicleId, normalizedSearch, pageSize, ctx.chargeSessionDayLocal]);

  function handleRowClick(row: Row<ChargeSessionRow>) {
    navigate({ to: '/charging/$sessionId', params: { sessionId: row.original.id } });
  }

  const pagination = totalSessions > 0 ? (
    <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
      <p className="text-xs text-fg-tertiary">
        Page {page} of {Math.max(totalPages, 1)} · {totalSessions} session{totalSessions === 1 ? '' : 's'}
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
            <SelectPicker
              className="min-w-[4.5rem]"
              value={String(pageSize)}
              onChange={(value) => setPageSize(Number(value))}
              aria-label="Charging sessions per page"
              size="sm"
              options={[15, 25, 50, 100].map((option) => ({ value: String(option), label: String(option) }))}
            />
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
            : sessions.length === 0
            ? <p className="py-4 text-center text-xs text-fg-tertiary">{search ? 'No sessions match that location.' : 'No charging sessions found'}</p>
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
        <div className="min-h-0 flex-1 overflow-hidden">
          <DataTable
            data={sessions}
            columns={chargingColumns}
            loading={isLoading}
            loadingRows={pageSize}
            onRowClick={handleRowClick}
            emptyTitle="No charging sessions"
            emptyDescription={search ? 'No sessions match that location.' : 'Sessions will appear here after your vehicle has charged.'}
            columnVisibilityMenu
            defaultHiddenColumns={['network_vendor']}
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
