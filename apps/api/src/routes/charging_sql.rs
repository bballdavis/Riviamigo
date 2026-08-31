pub(super) const LIST: &str = r#"
                cs.live_current_price, cs.live_current_currency, cs.live_total_charged_kwh,
                cs.live_range_added_km, COALESCE(latest.power_kw, cs.live_power_kw) AS live_power_kw, cs.live_charge_rate_kph,
                CASE WHEN cs.ended_at IS NULL THEN GREATEST(COALESCE(cs.live_time_elapsed_seconds, 0), EXTRACT(EPOCH FROM (now() - COALESCE(cs.live_session_started_at, cs.started_at)))::int) ELSE cs.live_time_elapsed_seconds END AS live_time_elapsed_seconds,
                CASE WHEN cs.ended_at IS NULL THEN COALESCE(latest.time_to_end_of_charge_min, cs.live_time_remaining_minutes) ELSE cs.live_time_remaining_minutes END AS live_time_remaining_min, cs.live_session_started_at AS live_started_at,
                latest.battery_level AS live_soc_pct, latest.charger_state AS live_charger_state, latest.charger_status AS live_charger_status,
                (SELECT COUNT(*)::int8 FROM timeseries.telemetry t WHERE t.vehicle_id=cs.vehicle_id AND t.charge_session_id=cs.id AND t.ts >= cs.started_at AND t.ts <= COALESCE(cs.ended_at, now())) AS telemetry_sample_count"#;

pub(super) const COST: &str =
    "CASE WHEN cs.ended_at IS NULL THEN NULL ELSE cs.cost_usd END AS cost_usd";

pub(super) const DETAIL: &str = r#"
                cs.live_current_price, cs.live_current_currency, cs.live_total_charged_kwh,
                cs.live_range_added_km, COALESCE(latest.power_kw, cs.live_power_kw) AS live_power_kw, cs.live_charge_rate_kph,
                CASE WHEN cs.ended_at IS NULL THEN GREATEST(COALESCE(cs.live_time_elapsed_seconds, 0), EXTRACT(EPOCH FROM (now() - COALESCE(cs.live_session_started_at, cs.started_at)))::int) ELSE cs.live_time_elapsed_seconds END AS live_time_elapsed_seconds,
                CASE WHEN cs.ended_at IS NULL THEN COALESCE(latest.time_to_end_of_charge_min, cs.live_time_remaining_minutes) ELSE cs.live_time_remaining_minutes END AS live_time_remaining_min, cs.live_session_started_at AS live_started_at,
                latest.battery_level AS live_soc_pct, latest.charger_state AS live_charger_state, latest.charger_status AS live_charger_status,
                COALESCE(telem.sample_count, 0)::int8 AS telemetry_sample_count"#;

pub(super) const LATEST: &str = r#"
         LEFT JOIN LATERAL (SELECT t.battery_level, t.power_kw, t.charger_state, t.charger_status, t.time_to_end_of_charge_min FROM timeseries.telemetry t WHERE t.vehicle_id=cs.vehicle_id AND t.charge_session_id=cs.id AND t.ts >= cs.started_at AND t.ts <= COALESCE(cs.ended_at, now()) ORDER BY t.ts DESC LIMIT 1) latest ON true"#;

pub(super) const TELEM: &str = r#"
         LEFT JOIN LATERAL (
             SELECT t.battery_level, t.power_kw, t.charger_state, t.charger_status, t.time_to_end_of_charge_min
             FROM timeseries.telemetry t
             WHERE t.vehicle_id = cs.vehicle_id
               AND t.charge_session_id = cs.id
               AND t.ts BETWEEN cs.started_at AND COALESCE(cs.ended_at, now())
             ORDER BY t.ts DESC LIMIT 1
         ) latest ON true"#;
