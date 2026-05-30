import * as React from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { Badge } from '../primitives/Badge';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '../lib/utils';

export interface ChargeSessionRow {
  id: string;
  started_at: string;
  session_day_local?: string | null;
  duration_min: number | null;
  energy_added_kwh: number | null;
  soc_start: number | null;
  soc_end: number | null;
  peak_power_kw: number | null;
  cost_usd: number | null;
  charger_type: string | null;
  location_name: string | null;
  // Enrichment fields from Rivian API
  network_vendor: string | null;
  range_added_km: number | null;
  is_free_session: boolean | null;
  is_rivian_network: boolean | null;
  rivian_paid_total: number | null;
  rivian_charger_type?: string | null;
  currency_code?: string | null;
  rivian_city?: string | null;
  is_public?: boolean | null;
  charger_id?: string | null;
  live_current_price?: number | null;
  live_current_currency?: string | null;
  live_total_charged_kwh?: number | null;
  live_range_added_km?: number | null;
  live_power_kw?: number | null;
  live_charge_rate_kph?: number | null;
  source?: string | null;
  telemetry_sample_count?: number;
}

const col = createColumnHelper<ChargeSessionRow>();

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

function formatSessionDayLabel(row: ChargeSessionRow): string {
  if (row.session_day_local) {
    return format(parseISO(`${row.session_day_local}T00:00:00`), 'MMM d, yyyy');
  }
  return format(parseISO(row.started_at), 'MMM d, yyyy');
}

export const chargingColumns = [
  col.accessor('started_at', {
    header: 'Date / Time',
    cell: (info) => {
      const row = info.row.original;
      const acDcType = normalizeAcDcType(row.charger_type);
      const start = parseISO(info.getValue());
      const endDate =
        row.duration_min != null
          ? new Date(start.getTime() + row.duration_min * 60000)
          : null;
      return (
        <div className="flex flex-col gap-px">
          <span className="flex items-center justify-between gap-2 text-sm font-medium text-fg leading-tight">
            <span>{formatSessionDayLabel(row)}</span>
            {acDcType && (
              <Badge variant={acDcType === 'dc' ? 'warning' : 'success'} size="sm">
                {acDcType.toUpperCase()}
              </Badge>
            )}
          </span>
          <span className="text-xs text-fg-tertiary leading-tight">
            {format(start, 'h:mm a')}
            {endDate ? ` – ${format(endDate, 'h:mm a')}` : null}
          </span>
        </div>
      );
    },
  }),
  col.accessor('location_name', {
    header: 'Location',
    enableSorting: false,
    cell: (info) => (
      <span className="text-fg-secondary truncate max-w-[160px] block">
        {info.getValue() ?? '—'}
      </span>
    ),
  }),
  col.accessor('network_vendor', {
    header: 'Network',
    enableSorting: false,
    cell: (info) => {
      const vendor = info.getValue();
      const isFree = info.row.original.is_free_session;
      if (!vendor) return <span className="text-fg-tertiary">—</span>;
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-fg-secondary text-sm">{vendor}</span>
          {isFree && (
            <Badge variant="success" size="sm">Free</Badge>
          )}
        </span>
      );
    },
  }),
  col.accessor('charger_type', {
    header: 'Type',
    enableSorting: false,
    cell: (info) => {
      const t = info.getValue();
      if (!t) return <span className="text-fg-tertiary">—</span>;
      return (
        <Badge variant={CHARGER_VARIANT[t] ?? 'default'} size="sm">
          {t.toUpperCase()}
        </Badge>
      );
    },
  }),
  col.accessor('energy_added_kwh', {
    header: 'Energy Added',
    cell: (info) => {
      const v = info.getValue();
      return v !== null ? (
        <span className="font-mono">{formatKwh(v)}</span>
      ) : <span className="text-fg-tertiary">—</span>;
    },
  }),
  col.accessor('soc_start', {
    header: 'SoC',
    enableSorting: false,
    cell: (info) => {
      const row = info.row.original;
      const start = row.soc_start;
      const end = row.soc_end;
      if (start === null || end === null) return <span className="text-fg-tertiary">—</span>;
      return (
        <span className="font-mono text-fg">
          {formatPercent(start, 0)} → {formatPercent(end, 0)}
        </span>
      );
    },
  }),
  col.accessor('peak_power_kw', {
    header: 'Peak',
    cell: (info) => {
      const v = info.getValue();
      return v !== null ? (
        <span className="font-mono">{v.toFixed(1)} kW</span>
      ) : <span className="text-fg-tertiary">—</span>;
    },
  }),
  col.accessor('duration_min', {
    header: 'Duration',
    cell: (info) => {
      const v = info.getValue();
      return v !== null ? formatDuration(v) : <span className="text-fg-tertiary">—</span>;
    },
  }),
  col.accessor('cost_usd', {
    header: 'Cost',
    cell: (info) => {
      const v = info.getValue();
      return v !== null ? (
        <span className="font-mono text-accent">{formatCurrency(v)}</span>
      ) : <span className="text-fg-tertiary">—</span>;
    },
  }),
];
