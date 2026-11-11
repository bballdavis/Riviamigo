// Response normalizers: map loosely typed API payloads onto the shared wire contracts.
import type {
  ChargeSession,
  PaginatedResponse,
  Trip,
  TripPowerSource,
  TripTag,
  TripTagColorToken,
} from '@riviamigo/types';
import { liveFields } from './chargingSessionFields';

export function normalizePaginated<T>(
  response: PaginatedResponse<T> & { data?: T[]; limit?: number; offset?: number },
  requestedPage: number,
  requestedPerPage: number
): PaginatedResponse<T> {
  const perPage = response.per_page ?? response.limit ?? requestedPerPage;
  const page =
    response.page ??
    (response.offset !== undefined ? Math.floor(response.offset / perPage) + 1 : requestedPage);
  return {
    items: response.items ?? response.data ?? [],
    total: response.total ?? 0,
    page,
    per_page: perPage,
  };
}

export function normalizeTrip(raw: unknown): Trip {
  const row = isRecord(raw) ? raw : {};
  const distance = finiteNumber(row.distance_mi) ?? finiteNumber(row.distance_miles) ?? 0;
  const durationMin =
    finiteNumber(row.duration_min) ??
    (finiteNumber(row.duration_seconds) !== undefined
      ? finiteNumber(row.duration_seconds)! / 60
      : 0);
  const efficiency = finiteNumber(row.efficiency_wh_mi) ?? finiteNumber(row.efficiency_wh_per_mile);
  const energy =
    finiteNumber(row.energy_used_kwh) ??
    (finiteNumber(row.energy_wh) !== undefined ? finiteNumber(row.energy_wh)! / 1000 : undefined) ??
    (efficiency !== undefined && distance > 0 ? (efficiency * distance) / 1000 : undefined);
  const startCoordinate = normalizeCoordinateValue(row.start_lat, row.start_lng);
  const endCoordinate = normalizeCoordinateValue(row.end_lat, row.end_lng);
  const tags = Array.isArray(row.tags)
    ? row.tags.flatMap((tag): TripTag[] => {
      if (!isRecord(tag) || typeof tag.id !== 'string' || typeof tag.name !== 'string') return [];
      const color = tag.color_token;
      const color_token: TripTagColorToken = color === 'neutral' || color === 'info' || color === 'success'
        || color === 'warning' || color === 'danger' ? color : 'accent';
      return [{
        id: tag.id,
        vehicle_id: typeof tag.vehicle_id === 'string' ? tag.vehicle_id : String(row.vehicle_id ?? ''),
        name: tag.name,
        color_token,
        created_by: typeof tag.created_by === 'string' ? tag.created_by : '',
        created_at: typeof tag.created_at === 'string' ? tag.created_at : '',
        updated_at: typeof tag.updated_at === 'string' ? tag.updated_at : '',
      }];
    })
    : [];

  return {
    id: String(row.id ?? ''),
    vehicle_id: String(row.vehicle_id ?? ''),
    started_at: String(row.started_at ?? ''),
    ended_at: row.ended_at == null ? null : String(row.ended_at),
    distance_mi: distance,
    duration_min: durationMin,
    energy_used_kwh: energy ?? null,
    efficiency_wh_mi: efficiency ?? null,
    max_speed_mph: finiteNumber(row.max_speed_mph) ?? null,
    drive_mode: typeof row.drive_mode === 'string' ? (row.drive_mode as Trip['drive_mode']) : null,
    soc_start: finiteNumber(row.soc_start) ?? null,
    soc_end: finiteNumber(row.soc_end) ?? null,
    start_lat: startCoordinate?.lat ?? null,
    start_lng: startCoordinate?.lng ?? null,
    end_lat: endCoordinate?.lat ?? null,
    end_lng: endCoordinate?.lng ?? null,
    start_address: typeof row.start_address === 'string' ? row.start_address : null,
    end_address: typeof row.end_address === 'string' ? row.end_address : null,
    start_place:
      typeof row.start_place === 'string'
        ? row.start_place
        : typeof row.start_place_name === 'string'
          ? row.start_place_name
          : null,
    end_place:
      typeof row.end_place === 'string'
        ? row.end_place
        : typeof row.end_place_name === 'string'
          ? row.end_place_name
          : null,
    tags,
  };
}

const VALID_CHARGER_TYPES = new Set<string>(['AC', 'DC', 'DCFC']);

export function normalizeChargeSession(raw: unknown): ChargeSession {
  const row = isRecord(raw) ? raw : {};
  const id = String(row.id ?? '');
  if (!id) throw new Error('normalizeChargeSession: missing id in response');
  const coordinateLocation = formatCoordinateLabel(
    normalizeCoordinateValue(row.location_lat, row.location_lng)
  );
  const locationName = normalizeCoordinateLabel(row.location_name);
  return {
    id,
    vehicle_id: String(row.vehicle_id ?? ''),
    started_at: String(row.started_at ?? ''),
    session_day_local: typeof row.session_day_local === 'string' ? row.session_day_local : null,
    ended_at: row.ended_at == null ? null : String(row.ended_at),
    location_name: locationName ?? (row.is_home === true ? 'Home' : coordinateLocation),
    charger_type:
      typeof row.charger_type === 'string' && VALID_CHARGER_TYPES.has(row.charger_type)
        ? (row.charger_type as ChargeSession['charger_type'])
        : null,
    energy_added_kwh:
      finiteNumber(row.energy_added_kwh) ??
      finiteNumber(row.kwh_added) ??
      (finiteNumber(row.energy_added_wh) !== undefined
        ? finiteNumber(row.energy_added_wh)! / 1000
        : null),
    soc_start: finiteNumber(row.soc_start) ?? null,
    soc_end: finiteNumber(row.soc_end) ?? null,
    peak_power_kw:
      finiteNumber(row.peak_power_kw) ??
      finiteNumber(row.max_charge_rate_kw) ??
      finiteNumber(row.avg_charge_rate_kw) ??
      null,
    cost_usd: finiteNumber(row.cost_usd) ?? null,
    cost_method: typeof row.cost_method === 'string' ? row.cost_method : null,
    duration_min: finiteNumber(row.duration_min) ?? finiteNumber(row.duration_minutes) ?? null,
    source: typeof row.source === 'string' ? row.source : null,
    api_started_at: row.api_started_at == null ? null : String(row.api_started_at),
    api_ended_at: row.api_ended_at == null ? null : String(row.api_ended_at),
    data_confidence: typeof row.data_confidence === 'string' ? row.data_confidence : null,
    telemetry_sample_count: finiteNumber(row.telemetry_sample_count) ?? 0,
    network_vendor: typeof row.network_vendor === 'string' ? row.network_vendor : null,
    range_added_km: finiteNumber(row.range_added_km) ?? null,
    is_free_session: typeof row.is_free_session === 'boolean' ? row.is_free_session : null,
    is_rivian_network: typeof row.is_rivian_network === 'boolean' ? row.is_rivian_network : null,
    rivian_paid_total: finiteNumber(row.rivian_paid_total) ?? null,
    rivian_charger_type:
      typeof row.rivian_charger_type === 'string' ? row.rivian_charger_type : null,
    currency_code: typeof row.currency_code === 'string' ? row.currency_code : null,
    rivian_city: typeof row.rivian_city === 'string' ? row.rivian_city : null,
    is_public: typeof row.is_public === 'boolean' ? row.is_public : null,
    charger_id: typeof row.charger_id === 'string' ? row.charger_id : null,
    live_current_price: finiteNumber(row.live_current_price) ?? null,
    live_current_currency:
      typeof row.live_current_currency === 'string' ? row.live_current_currency : null,
    live_total_charged_kwh: finiteNumber(row.live_total_charged_kwh) ?? null,
    live_range_added_km: finiteNumber(row.live_range_added_km) ?? null,
    live_power_kw: finiteNumber(row.live_power_kw) ?? null,
    live_charge_rate_kph: finiteNumber(row.live_charge_rate_kph) ?? null,
    ...liveFields(row),
    location_lat: finiteNumber(row.location_lat) ?? null,
    location_lng: finiteNumber(row.location_lng) ?? null,
    source_location_lat: finiteNumber(row.source_location_lat) ?? null,
    source_location_lng: finiteNumber(row.source_location_lng) ?? null,
    location_override_mode:
      row.location_override_mode === 'automatic' || row.location_override_mode === 'saved_place' || row.location_override_mode === 'none'
        ? row.location_override_mode
        : null,
    cost_override_mode:
      row.cost_override_mode === 'automatic' || row.cost_override_mode === 'free' || row.cost_override_mode === 'manual'
        ? row.cost_override_mode
        : null,
    cost_override_usd: finiteNumber(row.cost_override_usd) ?? null,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeCoordinateValue(latRaw: unknown, lngRaw: unknown) {
  const lat = finiteNumber(latRaw);
  const lng = finiteNumber(lngRaw);
  if (lat === undefined || lng === undefined) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function formatCoordinateLabel(value: { lat: number; lng: number } | null) {
  return value ? `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}` : null;
}

function normalizeCoordinateLabel(value: unknown) {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  if (!label) return null;
  if (/^0+(?:\.0+)?\s*,\s*0+(?:\.0+)?$/.test(label)) return null;
  return label;
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function tripPowerSource(value: unknown): TripPowerSource | undefined {
  return value === 'direct' || value === 'estimated_soc' || value === 'unavailable'
    ? value
    : undefined;
}
