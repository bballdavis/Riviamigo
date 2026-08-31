import * as React from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Badge } from '../primitives/Badge';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '../lib/utils';
import { formatAppCalendarDate, formatAppDate, formatAppTime } from '../lib/dateTime';

export interface ChargeSessionRow {
  id: string;
  started_at: string;
  ended_at?: string | null;
  session_day_local?: string | null;
  duration_min: number | null;
  energy_added_kwh: number | null;
  soc_start: number | null;
  soc_end: number | null;
  peak_power_kw: number | null;
  cost_usd: number | null;
  cost_method?: string | null;
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
  live_soc_pct?: number | null;
  live_time_elapsed_seconds?: number | null;
  live_time_remaining_min?: number | null;
  live_charger_state?: string | null;
  live_charger_status?: string | null;
  live_started_at?: string | null;
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

function deriveAcDcType(row: ChargeSessionRow): 'ac' | 'dc' | null {
  const explicit = normalizeAcDcType(row.charger_type);
  if (explicit) return explicit;

  const vendor = (row.network_vendor ?? '').trim().toLowerCase();
  if (vendor && ['tesla', 'rivian', 'electrify america', 'evgo'].includes(vendor)) {
    return 'dc';
  }

  const observedPower = row.ended_at == null ? row.live_power_kw ?? row.peak_power_kw : row.peak_power_kw;
  if (observedPower != null && Number.isFinite(observedPower)) {
    return observedPower < 20 ? 'ac' : 'dc';
  }

  return null;
}

function formatSessionDayLabel(row: ChargeSessionRow): string {
  if (row.session_day_local) {
    return formatAppCalendarDate(row.session_day_local);
  }
  return formatAppDate(row.started_at);
}

export const chargingColumns = [
  col.accessor('started_at', {
    header: 'Date / Time',
    cell: (info) => {
      const row = info.row.original;
      const start = new Date(info.getValue());
      const duration = row.ended_at == null && row.live_time_elapsed_seconds != null
        ? row.live_time_elapsed_seconds / 60 : row.duration_min;
      const endDate =
        duration != null
          ? new Date(start.getTime() + duration * 60000)
          : null;
      return (
        <div className="flex flex-col gap-px">
          <span className="text-sm font-medium text-fg leading-tight">{formatSessionDayLabel(row)}</span>
          <span className="text-xs text-fg-tertiary leading-tight">
            {formatAppTime(start)}
            {endDate ? ` – ${formatAppTime(endDate)}` : null}
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
      const row = info.row.original;
      const inferred = deriveAcDcType(row);
      if (!inferred) return <span className="text-fg-tertiary">—</span>;
      return (
        <Badge variant={CHARGER_VARIANT[inferred] ?? 'default'} size="sm">
          {inferred.toUpperCase()}
        </Badge>
      );
    },
  }),
  col.accessor('energy_added_kwh', {
    header: 'Energy Added',
    cell: (info) => {
      const row = info.row.original;
      const v = row.ended_at == null ? row.live_total_charged_kwh ?? info.getValue() : info.getValue();
      return v !== null ? (
        <span className="font-mono">{formatKwh(v)}{row.ended_at == null && row.live_total_charged_kwh != null ? ' · Live' : ''}</span>
      ) : <span className="text-fg-tertiary">—</span>;
    },
  }),
  col.accessor('soc_start', {
    header: 'SoC',
    enableSorting: false,
    cell: (info) => {
      const row = info.row.original;
      const start = row.soc_start;
      const end = row.ended_at == null ? row.live_soc_pct ?? row.soc_end : row.soc_end;
      if (start === null || end === null) return <span className="text-fg-tertiary">—</span>;
      return (
        <span className="font-mono text-fg">
          {formatPercent(start, 0)} → {formatPercent(end, 0)}{row.ended_at == null && row.live_soc_pct != null ? ' · Live' : ''}
        </span>
      );
    },
  }),
  col.accessor('peak_power_kw', {
    header: 'Peak',
    cell: (info) => {
      const row = info.row.original;
      const v = row.ended_at == null ? row.live_power_kw ?? info.getValue() : info.getValue();
      return v !== null ? (
        <span className="font-mono">{v.toFixed(1)} kW</span>
      ) : <span className="text-fg-tertiary">—</span>;
    },
  }),
  col.accessor('duration_min', {
    header: 'Duration',
    cell: (info) => {
      const row = info.row.original;
      const v = row.ended_at == null && row.live_time_elapsed_seconds != null ? row.live_time_elapsed_seconds / 60 : info.getValue();
      return v !== null ? <>{formatDuration(v)}{row.ended_at == null && row.live_time_elapsed_seconds != null ? ' · Live' : ''}</> : <span className="text-fg-tertiary">—</span>;
    },
  }),
  col.accessor('cost_usd', {
    header: 'Cost',
    cell: (info) => {
      const row = info.row.original;
      const v = info.getValue();
      return v !== null ? (
        <span className="font-mono text-accent">{formatCurrency(v)}</span>
      ) : row.ended_at == null ? <span className="text-fg-tertiary">Pending</span> : <span className="text-fg-tertiary">—</span>;
    },
  }),
];
