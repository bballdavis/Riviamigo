import type { ChargeSession } from '@riviamigo/types';

type LiveChargeFields = Pick<
  ChargeSession,
  | 'live_soc_pct'
  | 'live_time_elapsed_seconds'
  | 'live_time_remaining_min'
  | 'live_charger_state'
  | 'live_charger_status'
  | 'live_started_at'
>;

export function liveFields(row: Record<string, unknown>): LiveChargeFields {
  return {
    live_soc_pct: finiteNumber(row.live_soc_pct) ?? finiteNumber(row.current_soc) ?? finiteNumber(row.soc_pct) ?? null,
    live_time_elapsed_seconds: finiteNumber(row.live_time_elapsed_seconds) ?? finiteNumber(row.time_elapsed_seconds) ?? null,
    live_time_remaining_min: finiteNumber(row.live_time_remaining_min) ?? finiteNumber(row.live_time_remaining_minutes) ?? finiteNumber(row.time_remaining_min) ?? null,
    live_charger_state: typeof row.live_charger_state === 'string'
      ? row.live_charger_state
      : typeof row.current_charger_state === 'string'
        ? row.current_charger_state
        : typeof row.vehicle_charger_state === 'string' ? row.vehicle_charger_state : null,
    live_charger_status: typeof row.live_charger_status === 'string'
      ? row.live_charger_status
      : typeof row.parallax_charger_status === 'string' ? row.parallax_charger_status : null,
    live_started_at: row.live_started_at == null ? row.live_session_started_at == null ? null : String(row.live_session_started_at) : String(row.live_started_at),
  };
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
