//! Per-vehicle ingestion worker: WS + poll + trip/charge detection + DB writes.

use chrono::Utc;
use redis::AsyncCommands;
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::{
    config::Config,
    ingestion::{
        charge_detector::{ChargeDetectorState, ChargeEvent},
        session_store::{decrypt_tokens, RivianTokenBundle},
        trip_detector::{compute_distance_miles, TripDetectorState, TripEvent},
        ws_client,
    },
    models::telemetry::TelemetryEvent,
};

const MIN_TRIP_DISTANCE_MILES: f64 = 0.1;

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

    while let Some(event) = ev_rx.recv().await {
        // Write to timeseries
        let _ = write_telemetry(&pool, &event).await;

        // Publish live snapshot to Redis
        let snapshot = build_snapshot(&event);
        let topic = format!("vehicle:{}:status", vehicle_id);
        let _ = redis_conn.publish::<_, _, ()>(&topic, &snapshot).await;

        // Update runtime state
        upsert_online(&pool, vehicle_id, event.is_online.unwrap_or(true), event.ts).await;

        // Trip detection
        match trip_det.process(&event) {
            TripEvent::TripEnded { trip } => {
                let distance = compute_distance_miles(&trip.points);
                if distance >= MIN_TRIP_DISTANCE_MILES {
                    let _ = persist_trip(&pool, &trip, distance).await;
                }
            }
            _ => {}
        }

        // Charge detection
        if let ChargeEvent::SessionEnded(session) = charge_det.process(&event) {
            let _ = persist_charge_session(&pool, &session).await;
        }
    }
}

async fn write_telemetry(pool: &PgPool, e: &TelemetryEvent) -> anyhow::Result<()> {
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
            hv_thermal_event, twelve_volt_health, is_online)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53)"#,
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
        e.is_online
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
    let max_speed = trip
        .points
        .iter()
        .map(|p| p.speed_mph)
        .fold(0.0_f64, f64::max);
    let efficiency = match (trip.soc_start, trip.soc_end, trip.battery_capacity_wh) {
        (Some(s0), Some(s1), Some(cap)) if distance > 0.0 && s0 > s1 => {
            Some(((s0 - s1) / 100.0) * cap / distance)
        }
        _ => None,
    };
    let start = trip.points.first();
    let end = trip.points.last();

    sqlx::query!(
        r#"INSERT INTO riviamigo.trips
           (vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng,
            distance_miles, duration_seconds, soc_start, soc_end,
            efficiency_wh_per_mile, max_speed_mph, drive_mode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)"#,
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
        efficiency,
        max_speed,
        trip.dominant_drive_mode
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
    sqlx::query!(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, location_lat, location_lng,
            soc_start, soc_end, charge_limit, duration_minutes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"#,
        session.vehicle_id,
        session.started_at,
        session.ended_at,
        session.location_lat,
        session.location_lng,
        session.soc_start,
        session.soc_end,
        session.charge_limit,
        duration_minutes
    )
    .execute(pool)
    .await?;
    Ok(())
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
