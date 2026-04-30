//! Per-vehicle ingestion worker: WS + poll + trip/charge detection + DB writes.

use chrono::Utc;
use redis::AsyncCommands;
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::{
    config::Config,
    db::vehicles::get_vehicle_owner_id,
    ingestion::{
        charge_detector::{ChargeDetectorState, ChargeEvent},
        session_store::{decrypt_tokens, RivianTokenBundle},
        trip_detector::{compute_distance_odometer_or_gps, compute_trip_energy, TripDetectorState, TripEvent},
        ws_client,
    },
    models::{
        cost_profile::compute_cost,
        state_period::VehicleState,
        telemetry::TelemetryEvent,
    },
    services::{cost::resolve_profile, geofences::match_geofence},
};

const MIN_TRIP_DISTANCE_MILES: f64 = 0.1;

struct MatchedLocation {
    geofence_id: Option<Uuid>,
    address_id: Option<Uuid>,
    is_home: Option<bool>,
}

pub async fn run_vehicle_worker(
    vehicle_id: Uuid,
    pool: PgPool,
    redis: redis::Client,
    age_key: String,
    _config: Config,
    shutdown: broadcast::Receiver<()>,
) {
    tracing::info!(vehicle_id = %vehicle_id, "worker starting");

    let identity = match age_key.parse::<age::x25519::Identity>() {
        Ok(k) => k,
        Err(e) => {
            tracing::error!(vehicle_id=%vehicle_id, err=%e, "bad age key");
            return;
        }
    };

    // Load credentials
    let creds_row = sqlx::query!(
        "SELECT encrypted_tokens FROM riviamigo.vehicle_credentials WHERE vehicle_id = $1",
        vehicle_id
    )
    .fetch_optional(&pool)
    .await;

    let tokens: RivianTokenBundle = match creds_row {
        Ok(Some(row)) => match decrypt_tokens(&row.encrypted_tokens, &identity) {
            Ok(t) => t,
            Err(e) => {
                tracing::error!(vehicle_id=%vehicle_id, err=%e, "decrypt failed");
                upsert_health(&pool, vehicle_id, false, "needs_reauth", &e.to_string()).await;
                return;
            }
        },
        Ok(None) => {
            tracing::warn!(vehicle_id=%vehicle_id, "no credentials");
            return;
        }
        Err(e) => {
            tracing::error!(vehicle_id=%vehicle_id, err=%e, "db error");
            return;
        }
    };

    upsert_health(&pool, vehicle_id, true, "connected", "").await;

    let (ev_tx, mut ev_rx) = mpsc::channel::<TelemetryEvent>(256);

    // Get rivian_vehicle_id
    let riv_id: Option<String> = sqlx::query_scalar!(
        "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id = $1",
        vehicle_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let rivian_vehicle_id = match riv_id {
        Some(id) => id,
        None => {
            tracing::error!(vehicle_id=%vehicle_id, "no rivian_vehicle_id");
            return;
        }
    };

    let ws_shutdown = shutdown.resubscribe();
    let ev_tx_ws = ev_tx.clone();
    let tokens_clone = tokens.clone();
    let riv_id_clone = rivian_vehicle_id.clone();
    tokio::spawn(async move {
        ws_client::run_ws_loop(
            vehicle_id,
            riv_id_clone,
            tokens_clone,
            ev_tx_ws,
            ws_shutdown,
        )
        .await;
    });

    let mut trip_det = TripDetectorState::new(vehicle_id);
    let mut charge_det = ChargeDetectorState::new(vehicle_id);
    let mut redis_conn = match redis.get_multiplexed_async_connection().await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(err=%e, "redis connect failed");
            return;
        }
    };

    // State period tracking
    let mut last_vehicle_state: Option<VehicleState> = None;
    let mut state_period_start: Option<chrono::DateTime<Utc>> = None;
    // Software version tracking
    let mut last_software_version: Option<String> = None;
    let mut sw_version_start: Option<chrono::DateTime<Utc>> = None;

    while let Some(event) = ev_rx.recv().await {
        let trip_id = trip_det.active_trip_id();
        let session_id = charge_det.active_session_id();

        // Write to timeseries (with trip_id / charge_session_id stamps)
        let _ = write_telemetry(&pool, &event, trip_id, session_id).await;

        // Publish live snapshot to Redis
        let snapshot = build_snapshot(&event);
        let topic = format!("vehicle:{}:status", vehicle_id);
        let _ = redis_conn.publish::<_, _, ()>(&topic, &snapshot).await;

        // Update runtime state
        upsert_online(&pool, vehicle_id, event.is_online.unwrap_or(true), event.ts).await;

        // ── State period tracking ────────────────────────────────────────────
        let current_state = infer_vehicle_state(&event);
        if Some(&current_state) != last_vehicle_state.as_ref() {
            // Close previous period
            if let (Some(prev_state), Some(started)) = (last_vehicle_state.take(), state_period_start.take()) {
                let _ = close_state_period(&pool, vehicle_id, &prev_state, started, event.ts).await;
            }
            // Open new period
            let _ = open_state_period(&pool, vehicle_id, &current_state, event.ts).await;
            state_period_start = Some(event.ts);
            last_vehicle_state = Some(current_state);
        }

        // ── Software version tracking ────────────────────────────────────────
        if let Some(ver) = &event.ota_current_version {
            if Some(ver) != last_software_version.as_ref() {
                // Close previous version record
                if let (Some(prev_ver), Some(_started)) = (last_software_version.take(), sw_version_start.take()) {
                    let _ = close_software_version(&pool, vehicle_id, &prev_ver, event.ts).await;
                }
                // Open new version record
                let _ = open_software_version(&pool, vehicle_id, ver, event.ts).await;
                sw_version_start = Some(event.ts);
                last_software_version = Some(ver.clone());
            }
        }

        // ── Trip detection ───────────────────────────────────────────────────
        match trip_det.process(&event) {
            TripEvent::TripEnded { trip } => {
                let distance = compute_distance_odometer_or_gps(
                    trip.start_odometer_mi,
                    trip.end_odometer_mi,
                    &trip.points,
                );
                if distance >= MIN_TRIP_DISTANCE_MILES {
                    let _ = persist_trip(&pool, &trip, distance).await;
                }
            }
            _ => {}
        }

        // ── Charge detection ─────────────────────────────────────────────────
        if let ChargeEvent::SessionEnded(session) = charge_det.process(&event) {
            let _ = persist_charge_session(&pool, &session).await;
        }
    }
}

async fn write_telemetry(
    pool: &PgPool,
    e: &TelemetryEvent,
    trip_id: Option<Uuid>,
    charge_session_id: Option<Uuid>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO timeseries.telemetry
           (ts, vehicle_id, latitude, longitude, altitude_m, speed_mph,
            battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
            power_state, charger_state, charger_status, time_to_end_of_charge_min,
            drive_mode, gear_status, cabin_temp_c, driver_temp_c, outside_temp_c, hvac_active,
            power_kw, regen_power_kw, heading_deg, odometer_miles,
            tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
            tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
            door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
            door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
            closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
            closure_tailgate_locked, closure_tailgate_closed,
            ota_current_version, ota_available_version, ota_status, ota_current_status,
            hv_thermal_event, twelve_volt_health, is_online,
            trip_id, charge_session_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55)
           ON CONFLICT (vehicle_id, ts) DO NOTHING"#,
        e.ts, e.vehicle_id,
        e.latitude, e.longitude, e.altitude_m, e.speed_mph,
        e.battery_level, e.battery_capacity_wh, e.distance_to_empty_mi, e.battery_limit,
        e.power_state.as_ref().map(|p| format!("{p:?}").to_lowercase()),
        e.charger_state.as_ref().map(|c| format!("{c:?}").to_lowercase()),
        e.charger_status, e.time_to_end_of_charge_min,
        e.drive_mode.as_ref().map(|d| format!("{d:?}").to_lowercase()),
        e.gear_status, e.cabin_temp_c, e.driver_temp_c, e.outside_temp_c, e.hvac_active,
        e.power_kw, e.regen_power_kw, e.heading_deg, e.odometer_miles,
        e.tire_fl_psi, e.tire_fr_psi, e.tire_rl_psi, e.tire_rr_psi,
        e.tire_fl_status, e.tire_fr_status, e.tire_rl_status, e.tire_rr_status,
        e.door_front_left_locked, e.door_front_right_locked, e.door_rear_left_locked, e.door_rear_right_locked,
        e.door_front_left_closed, e.door_front_right_closed, e.door_rear_left_closed, e.door_rear_right_closed,
        e.closure_frunk_locked, e.closure_frunk_closed, e.closure_liftgate_locked, e.closure_liftgate_closed,
        e.closure_tailgate_locked, e.closure_tailgate_closed,
        e.ota_current_version, e.ota_available_version, e.ota_status, e.ota_current_status,
        e.hv_thermal_event, e.twelve_volt_health,
        e.is_online,
        trip_id,
        charge_session_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn build_snapshot(e: &TelemetryEvent) -> String {
    serde_json::json!({
        "type": "status",
        "ts": e.ts,
        "data": {
            "battery_level":      e.battery_level,
            "distance_to_empty_mi": e.distance_to_empty_mi,
            "power_state":        e.power_state.as_ref().map(|p| format!("{p:?}").to_lowercase()),
            "charger_state":      e.charger_state.as_ref().map(|c| format!("{c:?}").to_lowercase()),
            "charger_status":     e.charger_status,
            "time_to_end_of_charge_min": e.time_to_end_of_charge_min,
            "speed_mph":          e.speed_mph,
            "altitude_m":         e.altitude_m,
            "heading_deg":        e.heading_deg,
            "odometer_miles":     e.odometer_miles,
            "drive_mode":         e.drive_mode.as_ref().map(|d| format!("{d:?}").to_lowercase()),
            "gear_status":        e.gear_status,
            "cabin_temp_c":       e.cabin_temp_c,
            "driver_temp_c":      e.driver_temp_c,
            "outside_temp_c":     e.outside_temp_c,
            "power_kw":           e.power_kw,
            "regen_power_kw":     e.regen_power_kw,
            "tire_fl_psi":        e.tire_fl_psi,
            "tire_fr_psi":        e.tire_fr_psi,
            "tire_rl_psi":        e.tire_rl_psi,
            "tire_rr_psi":        e.tire_rr_psi,
            "tire_fl_status":     e.tire_fl_status,
            "tire_fr_status":     e.tire_fr_status,
            "tire_rl_status":     e.tire_rl_status,
            "tire_rr_status":     e.tire_rr_status,
            "door_front_left_locked": e.door_front_left_locked,
            "door_front_right_locked": e.door_front_right_locked,
            "door_rear_left_locked": e.door_rear_left_locked,
            "door_rear_right_locked": e.door_rear_right_locked,
            "door_front_left_closed": e.door_front_left_closed,
            "door_front_right_closed": e.door_front_right_closed,
            "door_rear_left_closed": e.door_rear_left_closed,
            "door_rear_right_closed": e.door_rear_right_closed,
            "closure_frunk_closed": e.closure_frunk_closed,
            "closure_liftgate_closed": e.closure_liftgate_closed,
            "closure_tailgate_closed": e.closure_tailgate_closed,
            "software_update_status": e.ota_status.as_deref().or(e.ota_current_status.as_deref()),
            "location":           e.latitude.zip(e.longitude).map(|(lat,lng)| serde_json::json!({"lat":lat,"lng":lng})),
            "is_online":          e.is_online.unwrap_or(true)
        }
    }).to_string()
}

async fn persist_trip(
    pool: &PgPool,
    trip: &crate::ingestion::trip_detector::CompletedTripData,
    distance: f64,
) -> anyhow::Result<()> {
    let duration = (trip.ended_at - trip.started_at).num_seconds() as i32;
    let max_speed = trip.points.iter().map(|p| p.speed_mph).fold(0.0_f64, f64::max);
    let avg_speed = if duration > 0 { Some(distance / (duration as f64 / 3600.0)) } else { None };

    // Energy ensemble
    let (energy_wh, energy_strategy, efficiency_wh_per_mi) = match compute_trip_energy(
        trip.soc_start, trip.soc_end, trip.battery_capacity_wh,
        trip.range_start_mi, trip.range_end_mi, distance, None,
    ) {
        Some((wh, strat)) => {
            let eff = if distance > 0.0 { Some(wh / distance) } else { None };
            (Some(wh), Some(strat.to_string()), eff)
        }
        None => {
            // Fallback: use SOC-based efficiency
            let eff = match (trip.soc_start, trip.soc_end, trip.battery_capacity_wh) {
                (Some(s0), Some(s1), Some(cap)) if distance > 0.0 && s0 > s1 => {
                    Some(((s0 - s1) / 100.0) * cap / distance)
                }
                _ => None,
            };
            (None, None, eff)
        }
    };

    let start = trip.points.first();
    let end = trip.points.last();
    let owner_id = get_vehicle_owner_id(pool, trip.vehicle_id).await?;
    let start_match = match (owner_id, start) {
        (Some(user_id), Some(point)) => match_point(pool, user_id, point.lat, point.lng).await?,
        _ => MatchedLocation::none(),
    };
    let end_match = match (owner_id, end) {
        (Some(user_id), Some(point)) => match_point(pool, user_id, point.lat, point.lng).await?,
        _ => MatchedLocation::none(),
    };

    sqlx::query!(
        r#"INSERT INTO riviamigo.trips
           (id, vehicle_id, started_at, ended_at,
            start_lat, start_lng, end_lat, end_lng,
            distance_miles, duration_seconds,
            soc_start, soc_end,
            efficiency_wh_per_mile, max_speed_mph, avg_speed_mph, drive_mode,
            start_odometer_mi, end_odometer_mi,
            start_position_ts, end_position_ts,
            start_geofence_id, end_geofence_id,
            start_address_id, end_address_id,
            range_start_mi, range_end_mi,
            power_max_kw, power_min_kw,
            elevation_gain_m, elevation_loss_m,
            inside_temp_avg_c, regen_wh, energy_wh, energy_strategy)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)"#,
        trip.trip_id,
        trip.vehicle_id,
        trip.started_at,
        trip.ended_at,
        start.map(|p| p.lat),
        start.map(|p| p.lng),
        end.map(|p| p.lat),
        end.map(|p| p.lng),
        distance,
        duration,
        trip.soc_start,
        trip.soc_end,
        efficiency_wh_per_mi,
        max_speed,
        avg_speed,
        trip.dominant_drive_mode.as_deref(),
        trip.start_odometer_mi,
        trip.end_odometer_mi,
        start.map(|p| p.ts),
        end.map(|p| p.ts),
        start_match.geofence_id,
        end_match.geofence_id,
        start_match.address_id,
        end_match.address_id,
        trip.range_start_mi,
        trip.range_end_mi,
        trip.power_max_kw,
        trip.power_min_kw,
        trip.elevation_gain_m,
        trip.elevation_loss_m,
        trip.inside_temp_avg_c,
        trip.regen_wh,
        energy_wh,
        energy_strategy.as_deref()
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn persist_charge_session(
    pool: &PgPool,
    session: &crate::ingestion::charge_detector::CompletedChargeSession,
) -> anyhow::Result<()> {
    let duration_minutes = ((session.ended_at - session.started_at).num_seconds() / 60) as i32;
    let owner_id = get_vehicle_owner_id(pool, session.vehicle_id).await?;
    let location_match = match (owner_id, session.location_lat, session.location_lng) {
        (Some(user_id), Some(lat), Some(lon)) => match_point(pool, user_id, lat, lon).await?,
        _ => MatchedLocation::none(),
    };
    let profile = resolve_profile(pool, None, location_match.geofence_id, session.vehicle_id).await?;
    let energy_added_kwh = session.energy_added_wh.map(|wh| wh / 1000.0);
    let energy_used_kwh = session.energy_used_wh.map(|wh| wh / 1000.0);
    let cost_usd = profile
        .as_ref()
        .and_then(|p| compute_cost(p, energy_added_kwh, energy_used_kwh, duration_minutes));
    let cost_profile_id = profile.as_ref().map(|p| p.id);
    let cost_method = if cost_profile_id.is_some() {
        Some("profile")
    } else {
        Some("unknown")
    };

    sqlx::query!(
        r#"INSERT INTO riviamigo.charge_sessions
           (id, vehicle_id, started_at, ended_at,
            location_lat, location_lng,
            is_home,
            soc_start, soc_end, charge_limit, duration_minutes,
            kwh_added, max_charge_rate_kw, cost_usd,
            energy_added_wh, energy_used_wh,
            avg_charge_rate_kw, peak_voltage,
            geofence_id, address_id, cost_profile_id, cost_method,
            charger_type)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)"#,
        session.session_id,
        session.vehicle_id,
        session.started_at,
        session.ended_at,
        session.location_lat,
        session.location_lng,
        location_match.is_home,
        session.soc_start,
        session.soc_end,
        session.charge_limit,
        duration_minutes,
        energy_added_kwh,
        session.peak_charge_kw,
        cost_usd,
        session.energy_added_wh,
        session.energy_used_wh,
        session.avg_charge_rate_kw,
        session.peak_charge_kw,    // peak_voltage column stores peak power for now
        location_match.geofence_id,
        location_match.address_id,
        cost_profile_id,
        cost_method,
        session.charger_type.as_deref()
    )
    .execute(pool)
    .await?;
    Ok(())
}

impl MatchedLocation {
    fn none() -> Self {
        Self {
            geofence_id: None,
            address_id: None,
            is_home: None,
        }
    }
}

async fn match_point(
    pool: &PgPool,
    user_id: Uuid,
    lat: f64,
    lon: f64,
) -> anyhow::Result<MatchedLocation> {
    let matched = match_geofence(pool, user_id, lat, lon).await?;

    Ok(match matched {
        Some(geofence) => MatchedLocation {
            geofence_id: Some(geofence.id),
            address_id: geofence.address_id,
            is_home: Some(geofence.is_home),
        },
        None => MatchedLocation::none(),
    })
}

/// Infer a coarse VehicleState from the latest telemetry event.
fn infer_vehicle_state(e: &TelemetryEvent) -> VehicleState {
    use crate::models::telemetry::{ChargerState, PowerState};
    match &e.charger_state {
        Some(ChargerState::Charging) => return VehicleState::Charging,
        _ => {}
    }
    if e.ota_status.as_deref() == Some("installing")
        || e.ota_current_status.as_deref() == Some("installing")
    {
        return VehicleState::Updating;
    }
    match &e.power_state {
        Some(PowerState::Drive | PowerState::Go) => VehicleState::Drive,
        Some(PowerState::Sleep) => VehicleState::Sleep,
        Some(PowerState::Charging) => VehicleState::Charging,
        Some(PowerState::Ready) => {
            if e.is_online == Some(false) {
                VehicleState::Offline
            } else {
                VehicleState::Ready
            }
        }
        _ => {
            if e.is_online == Some(false) {
                VehicleState::Offline
            } else {
                VehicleState::Unknown
            }
        }
    }
}

async fn open_state_period(
    pool: &PgPool,
    vehicle_id: Uuid,
    state: &VehicleState,
    started_at: chrono::DateTime<Utc>,
) {
    let _ = sqlx::query!(
        r#"INSERT INTO riviamigo.vehicle_state_periods (vehicle_id, state, started_at)
           VALUES ($1, $2, $3)"#,
        vehicle_id,
        state.to_string(),
        started_at
    )
    .execute(pool)
    .await;
}

async fn close_state_period(
    pool: &PgPool,
    vehicle_id: Uuid,
    state: &VehicleState,
    started_at: chrono::DateTime<Utc>,
    ended_at: chrono::DateTime<Utc>,
) {
    let _ = sqlx::query!(
        r#"UPDATE riviamigo.vehicle_state_periods
           SET ended_at = $1
           WHERE vehicle_id = $2 AND state = $3 AND started_at = $4 AND ended_at IS NULL"#,
        ended_at,
        vehicle_id,
        state.to_string(),
        started_at
    )
    .execute(pool)
    .await;
}

async fn open_software_version(
    pool: &PgPool,
    vehicle_id: Uuid,
    version: &str,
    installed_at: chrono::DateTime<Utc>,
) {
    let _ = sqlx::query!(
        r#"INSERT INTO riviamigo.software_versions (vehicle_id, version, installed_at)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING"#,
        vehicle_id,
        version,
        installed_at
    )
    .execute(pool)
    .await;
}

async fn close_software_version(
    pool: &PgPool,
    vehicle_id: Uuid,
    version: &str,
    observed_until: chrono::DateTime<Utc>,
) {
    let _ = sqlx::query!(
        r#"UPDATE riviamigo.software_versions
           SET observed_until = $1
           WHERE vehicle_id = $2 AND version = $3 AND observed_until IS NULL"#,
        observed_until,
        vehicle_id,
        version
    )
    .execute(pool)
    .await;
}

async fn upsert_health(pool: &PgPool, vehicle_id: Uuid, online: bool, health: &str, msg: &str) {
    let _ = sqlx::query!(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, is_online, worker_health, worker_health_msg, updated_at)
           VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET is_online=$2, worker_health=$3, worker_health_msg=$4, updated_at=now()"#,
        vehicle_id,
        online,
        health,
        msg
    )
    .execute(pool)
    .await;
}

async fn upsert_online(pool: &PgPool, vehicle_id: Uuid, online: bool, ts: chrono::DateTime<Utc>) {
    let _ = sqlx::query!(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, is_online, last_event_at, updated_at)
           VALUES ($1,$2,$3,now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET is_online=$2, last_event_at=$3, updated_at=now()"#,
        vehicle_id,
        online,
        ts
    )
    .execute(pool)
    .await;
}
