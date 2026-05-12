//! Per-vehicle ingestion worker: WS + poll + trip/charge detection + DB writes.

use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use sqlx::{pool::PoolConnection, PgPool, Postgres};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::{
    config::Config,
    db::vehicles::get_vehicle_owner_id,
    ingestion::{
        charge_detector::{ChargeDetectorState, ChargeEvent},
        session_store::{decrypt_tokens, RivianTokenBundle},
        trip_detector::{
            compute_distance_odometer_or_gps, compute_trip_energy, TripDetectorState, TripEvent,
        },
        ws_client::{self, WsInboundEvent, WsInboundKind},
    },
    models::{
        cost_profile::compute_cost,
        state_period::VehicleState,
        telemetry::{ChargerState, PowerState, TelemetryEvent},
    },
    services::{cost::resolve_profile, geofences::match_geofence, weather::fetch_ambient_temp_c},
};

const MIN_TRIP_DISTANCE_MILES: f64 = 0.1;
const ADVISORY_LOCK_NAMESPACE: i64 = 0x52_49_56_57; // "RIVW"

/// Shared rate-limit gate for Nominatim reverse geocoding in the ingestion worker.
/// Ensures ≥ 1100 ms between calls across all concurrent trip-close events.
static NOMINATIM_NEXT_CALL: std::sync::OnceLock<tokio::sync::Mutex<std::time::Instant>> =
    std::sync::OnceLock::new();

fn nominatim_gate() -> &'static tokio::sync::Mutex<std::time::Instant> {
    NOMINATIM_NEXT_CALL.get_or_init(|| tokio::sync::Mutex::new(std::time::Instant::now()))
}

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
    config: Config,
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
    let creds_row = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT encrypted_tokens FROM riviamigo.vehicle_credentials WHERE vehicle_id = $1"
    )
    .bind(vehicle_id)
    .fetch_optional(&pool)
    .await;

    let tokens: RivianTokenBundle = match creds_row {
        Ok(Some(encrypted_tokens)) => match decrypt_tokens(&encrypted_tokens, &identity) {
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

    let mut lock_conn = match acquire_collector_lock(&pool, vehicle_id).await {
        Ok(Some(conn)) => conn,
        Ok(None) => {
            increment_counter(&pool, vehicle_id, "collector_lock_skips").await;
            upsert_health(&pool, vehicle_id, false, "passive", "collector lock held").await;
            tracing::info!(vehicle_id = %vehicle_id, "collector lock held; worker staying passive");
            return;
        }
        Err(e) => {
            tracing::error!(vehicle_id=%vehicle_id, err=%e, "collector lock failed");
            return;
        }
    };

    upsert_health(&pool, vehicle_id, true, "connected", "").await;

    let (ev_tx, mut ev_rx) = mpsc::channel::<WsInboundEvent>(256);

    // Get rivian_vehicle_id
    let riv_id: Option<String> = sqlx::query_scalar(
        "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id = $1"
    )
    .bind(vehicle_id)
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
    let ws_config = config.clone();
    tokio::spawn(async move {
        ws_client::run_ws_loop(
            vehicle_id,
            riv_id_clone,
            tokens_clone,
            ev_tx_ws,
            ws_shutdown,
            ws_config,
        )
        .await;
    });

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

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
    let mut persistence_gate = TelemetryPersistenceGate::new(vehicle_id);
    let mut raw_cleanup_tick: u64 = 0;

    while let Some(inbound) = ev_rx.recv().await {
        handle_inbound_accounting(&pool, vehicle_id, &config, &inbound).await;
        raw_cleanup_tick += 1;
        if raw_cleanup_tick % 500 == 0 {
            cleanup_raw_events(&pool, config.rivian_raw_event_retention_days).await;
        }

        let Some(event) = inbound.telemetry else {
            continue;
        };

        if inbound.kind == WsInboundKind::Heartbeat {
            upsert_seen(
                &pool,
                vehicle_id,
                event.is_online.unwrap_or(true),
                event.ts,
                SeenKind::Heartbeat,
            )
            .await;
            continue;
        }

        let trip_id = trip_det.active_trip_id();
        let charge_event = charge_det.process(&event);
        let session_id = match &charge_event {
            ChargeEvent::SessionEnded(session) => Some(session.session_id),
            _ => charge_det.active_session_id(),
        };

        // Publish live snapshot to Redis
        let snapshot = build_snapshot(&event);
        let topic = format!("vehicle:{}:status", vehicle_id);
        let _ = redis_conn.publish::<_, _, ()>(&topic, &snapshot).await;

        // Update runtime state
        upsert_seen(
            &pool,
            vehicle_id,
            event.is_online.unwrap_or(true),
            event.ts,
            SeenKind::Payload,
        )
        .await;

        let persistence_decision = if config.rivian_suppress_duplicate_telemetry {
            persistence_gate.decide(&event)
        } else {
            PersistenceDecision::Persist
        };

        if matches!(persistence_decision, PersistenceDecision::Persist) {
            if write_telemetry(&pool, &event, trip_id, session_id)
                .await
                .is_ok()
            {
                increment_counter(&pool, vehicle_id, "telemetry_writes_persisted").await;
                mark_persisted(&pool, vehicle_id, event.ts).await;
            }
        } else if let PersistenceDecision::Suppress(reason) = persistence_decision {
            increment_counter(&pool, vehicle_id, "telemetry_writes_suppressed").await;
            increment_counter(&pool, vehicle_id, reason.counter_column()).await;
        }

        // ── State period tracking ────────────────────────────────────────────
        let current_state = infer_vehicle_state(&event);
        if Some(&current_state) != last_vehicle_state.as_ref() {
            // Close previous period
            if let (Some(prev_state), Some(started)) =
                (last_vehicle_state.take(), state_period_start.take())
            {
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
                if let (Some(prev_ver), Some(_started)) =
                    (last_software_version.take(), sw_version_start.take())
                {
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
                    let _ = persist_trip(&pool, &http_client, &trip, distance).await;
                }
            }
            _ => {}
        }

        // ── Charge detection ─────────────────────────────────────────────────
        if let ChargeEvent::SessionEnded(session) = charge_event {
            let _ = persist_charge_session(&pool, &session).await;
        }
    }

    let _ = release_collector_lock(&mut lock_conn, vehicle_id).await;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SeenKind {
    Payload,
    Heartbeat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PersistenceDecision {
    Persist,
    Suppress(SuppressionReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SuppressionReason {
    Empty,
    Duplicate,
    Threshold,
}

impl SuppressionReason {
    fn counter_column(self) -> &'static str {
        match self {
            Self::Empty => "telemetry_suppressed_empty",
            Self::Duplicate => "telemetry_suppressed_duplicate",
            Self::Threshold => "telemetry_suppressed_threshold",
        }
    }
}

#[derive(Debug)]
struct TelemetryPersistenceGate {
    vehicle_id: Uuid,
    latest: Option<TelemetryEvent>,
    last_persisted: Option<TelemetryEvent>,
    last_persisted_at: Option<DateTime<Utc>>,
    last_persisted_location: Option<(f64, f64)>,
}

impl TelemetryPersistenceGate {
    fn new(vehicle_id: Uuid) -> Self {
        Self {
            vehicle_id,
            latest: None,
            last_persisted: None,
            last_persisted_at: None,
            last_persisted_location: None,
        }
    }

    fn decide(&mut self, event: &TelemetryEvent) -> PersistenceDecision {
        if !event_has_meaningful_payload(event) {
            return PersistenceDecision::Suppress(SuppressionReason::Empty);
        }

        let previous = self.latest.clone();
        if previous
            .as_ref()
            .is_some_and(|state| event_is_duplicate_patch(event, state))
        {
            return PersistenceDecision::Suppress(SuppressionReason::Duplicate);
        }

        let mut next = previous
            .clone()
            .unwrap_or_else(|| blank_event(self.vehicle_id, event.ts));
        patch_event(&mut next, event);
        self.latest = Some(next.clone());

        let should_persist = match previous.as_ref() {
            None => true,
            Some(prev) => {
                immediate_change(event, prev)
                    || self.active_threshold_change(event, &next)
                    || self.parked_threshold_change(event, &next)
            }
        };

        if should_persist {
            self.last_persisted_at = Some(event.ts);
            self.last_persisted_location = next.latitude.zip(next.longitude);
            self.last_persisted = Some(next);
            PersistenceDecision::Persist
        } else {
            PersistenceDecision::Suppress(SuppressionReason::Threshold)
        }
    }

    fn active_threshold_change(&self, event: &TelemetryEvent, next: &TelemetryEvent) -> bool {
        let mode = inferred_activity(next);
        let elapsed = self
            .last_persisted_at
            .map(|ts| event.ts.signed_duration_since(ts).num_seconds())
            .unwrap_or(i64::MAX);

        match mode {
            ActivityMode::Driving => {
                elapsed >= 5
                    && (location_moved_m(
                        self.last_persisted_location,
                        next.latitude,
                        next.longitude,
                    )
                    .is_some_and(|meters| meters >= 25.0)
                        || changed_f64(
                            event.speed_mph,
                            latest_f64(&self.last_persisted, |e| e.speed_mph),
                            1.0,
                        )
                        || changed_f64(
                            event.battery_level,
                            latest_f64(&self.last_persisted, |e| e.battery_level),
                            0.1,
                        ))
            }
            ActivityMode::Charging => {
                elapsed >= 15
                    && (changed_f64(
                        event.battery_level,
                        latest_f64(&self.last_persisted, |e| e.battery_level),
                        0.1,
                    ) || changed_f64(
                        event.power_kw,
                        latest_f64(&self.last_persisted, |e| e.power_kw),
                        0.5,
                    ))
            }
            ActivityMode::Parked => false,
        }
    }

    fn parked_threshold_change(&self, event: &TelemetryEvent, next: &TelemetryEvent) -> bool {
        if inferred_activity(next) != ActivityMode::Parked {
            return false;
        }

        changed_f64(
            event.battery_level,
            latest_f64(&self.last_persisted, |e| e.battery_level),
            0.5,
        ) || location_moved_m(self.last_persisted_location, next.latitude, next.longitude)
            .is_some_and(|meters| meters >= 100.0)
            || tire_material_change(event, &self.last_persisted)
            || changed_f64(
                event.cabin_temp_c,
                latest_f64(&self.last_persisted, |e| e.cabin_temp_c),
                2.0,
            )
            || changed_f64(
                event.driver_temp_c,
                latest_f64(&self.last_persisted, |e| e.driver_temp_c),
                2.0,
            )
            || changed_f64(
                event.outside_temp_c,
                latest_f64(&self.last_persisted, |e| e.outside_temp_c),
                2.0,
            )
            || changed_bool(
                event.hvac_active,
                latest_bool(&self.last_persisted, |e| e.hvac_active),
            )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActivityMode {
    Driving,
    Charging,
    Parked,
}

fn inferred_activity(event: &TelemetryEvent) -> ActivityMode {
    if matches!(event.charger_state, Some(ChargerState::Charging))
        || matches!(event.power_state, Some(PowerState::Charging))
    {
        return ActivityMode::Charging;
    }
    if matches!(event.power_state, Some(PowerState::Drive | PowerState::Go)) {
        return ActivityMode::Driving;
    }
    ActivityMode::Parked
}

fn blank_event(vehicle_id: Uuid, ts: DateTime<Utc>) -> TelemetryEvent {
    TelemetryEvent {
        vehicle_id,
        ts,
        latitude: None,
        longitude: None,
        altitude_m: None,
        speed_mph: None,
        battery_level: None,
        battery_capacity_wh: None,
        distance_to_empty_mi: None,
        battery_limit: None,
        power_state: None,
        charger_state: None,
        charger_status: None,
        time_to_end_of_charge_min: None,
        drive_mode: None,
        gear_status: None,
        cabin_temp_c: None,
        driver_temp_c: None,
        outside_temp_c: None,
        hvac_active: None,
        power_kw: None,
        regen_power_kw: None,
        heading_deg: None,
        odometer_miles: None,
        tire_fl_psi: None,
        tire_fr_psi: None,
        tire_rl_psi: None,
        tire_rr_psi: None,
        tire_fl_status: None,
        tire_fr_status: None,
        tire_rl_status: None,
        tire_rr_status: None,
        door_front_left_locked: None,
        door_front_right_locked: None,
        door_rear_left_locked: None,
        door_rear_right_locked: None,
        closure_frunk_locked: None,
        closure_frunk_closed: None,
        closure_liftgate_locked: None,
        closure_liftgate_closed: None,
        closure_tailgate_locked: None,
        closure_tailgate_closed: None,
        door_front_left_closed: None,
        door_front_right_closed: None,
        door_rear_left_closed: None,
        door_rear_right_closed: None,
        ota_current_version: None,
        ota_available_version: None,
        ota_status: None,
        ota_current_status: None,
        hv_thermal_event: None,
        twelve_volt_health: None,
        is_online: None,
    }
}

macro_rules! patch_opt {
    ($target:expr, $source:expr, $field:ident) => {
        if $source.$field.is_some() {
            $target.$field = $source.$field.clone();
        }
    };
}

fn patch_event(target: &mut TelemetryEvent, source: &TelemetryEvent) {
    target.ts = source.ts;
    patch_opt!(target, source, latitude);
    patch_opt!(target, source, longitude);
    patch_opt!(target, source, altitude_m);
    patch_opt!(target, source, speed_mph);
    patch_opt!(target, source, battery_level);
    patch_opt!(target, source, battery_capacity_wh);
    patch_opt!(target, source, distance_to_empty_mi);
    patch_opt!(target, source, battery_limit);
    patch_opt!(target, source, power_state);
    patch_opt!(target, source, charger_state);
    patch_opt!(target, source, charger_status);
    patch_opt!(target, source, time_to_end_of_charge_min);
    patch_opt!(target, source, drive_mode);
    patch_opt!(target, source, gear_status);
    patch_opt!(target, source, cabin_temp_c);
    patch_opt!(target, source, driver_temp_c);
    patch_opt!(target, source, outside_temp_c);
    patch_opt!(target, source, hvac_active);
    patch_opt!(target, source, power_kw);
    patch_opt!(target, source, regen_power_kw);
    patch_opt!(target, source, heading_deg);
    patch_opt!(target, source, odometer_miles);
    patch_opt!(target, source, tire_fl_psi);
    patch_opt!(target, source, tire_fr_psi);
    patch_opt!(target, source, tire_rl_psi);
    patch_opt!(target, source, tire_rr_psi);
    patch_opt!(target, source, tire_fl_status);
    patch_opt!(target, source, tire_fr_status);
    patch_opt!(target, source, tire_rl_status);
    patch_opt!(target, source, tire_rr_status);
    patch_opt!(target, source, door_front_left_locked);
    patch_opt!(target, source, door_front_right_locked);
    patch_opt!(target, source, door_rear_left_locked);
    patch_opt!(target, source, door_rear_right_locked);
    patch_opt!(target, source, door_front_left_closed);
    patch_opt!(target, source, door_front_right_closed);
    patch_opt!(target, source, door_rear_left_closed);
    patch_opt!(target, source, door_rear_right_closed);
    patch_opt!(target, source, closure_frunk_locked);
    patch_opt!(target, source, closure_frunk_closed);
    patch_opt!(target, source, closure_liftgate_locked);
    patch_opt!(target, source, closure_liftgate_closed);
    patch_opt!(target, source, closure_tailgate_locked);
    patch_opt!(target, source, closure_tailgate_closed);
    patch_opt!(target, source, ota_current_version);
    patch_opt!(target, source, ota_available_version);
    patch_opt!(target, source, ota_status);
    patch_opt!(target, source, ota_current_status);
    patch_opt!(target, source, hv_thermal_event);
    patch_opt!(target, source, twelve_volt_health);
    patch_opt!(target, source, is_online);
}

macro_rules! duplicate_field {
    ($event:expr, $state:expr, $field:ident) => {
        $event.$field.is_none() || $event.$field == $state.$field
    };
}

fn event_is_duplicate_patch(event: &TelemetryEvent, state: &TelemetryEvent) -> bool {
    duplicate_field!(event, state, latitude)
        && duplicate_field!(event, state, longitude)
        && duplicate_field!(event, state, altitude_m)
        && duplicate_field!(event, state, speed_mph)
        && duplicate_field!(event, state, battery_level)
        && duplicate_field!(event, state, battery_capacity_wh)
        && duplicate_field!(event, state, distance_to_empty_mi)
        && duplicate_field!(event, state, battery_limit)
        && duplicate_field!(event, state, power_state)
        && duplicate_field!(event, state, charger_state)
        && duplicate_field!(event, state, charger_status)
        && duplicate_field!(event, state, time_to_end_of_charge_min)
        && duplicate_field!(event, state, drive_mode)
        && duplicate_field!(event, state, gear_status)
        && duplicate_field!(event, state, cabin_temp_c)
        && duplicate_field!(event, state, driver_temp_c)
        && duplicate_field!(event, state, outside_temp_c)
        && duplicate_field!(event, state, hvac_active)
        && duplicate_field!(event, state, power_kw)
        && duplicate_field!(event, state, regen_power_kw)
        && duplicate_field!(event, state, heading_deg)
        && duplicate_field!(event, state, odometer_miles)
        && duplicate_field!(event, state, tire_fl_psi)
        && duplicate_field!(event, state, tire_fr_psi)
        && duplicate_field!(event, state, tire_rl_psi)
        && duplicate_field!(event, state, tire_rr_psi)
        && duplicate_field!(event, state, tire_fl_status)
        && duplicate_field!(event, state, tire_fr_status)
        && duplicate_field!(event, state, tire_rl_status)
        && duplicate_field!(event, state, tire_rr_status)
        && duplicate_field!(event, state, door_front_left_locked)
        && duplicate_field!(event, state, door_front_right_locked)
        && duplicate_field!(event, state, door_rear_left_locked)
        && duplicate_field!(event, state, door_rear_right_locked)
        && duplicate_field!(event, state, door_front_left_closed)
        && duplicate_field!(event, state, door_front_right_closed)
        && duplicate_field!(event, state, door_rear_left_closed)
        && duplicate_field!(event, state, door_rear_right_closed)
        && duplicate_field!(event, state, closure_frunk_locked)
        && duplicate_field!(event, state, closure_frunk_closed)
        && duplicate_field!(event, state, closure_liftgate_locked)
        && duplicate_field!(event, state, closure_liftgate_closed)
        && duplicate_field!(event, state, closure_tailgate_locked)
        && duplicate_field!(event, state, closure_tailgate_closed)
        && duplicate_field!(event, state, ota_current_version)
        && duplicate_field!(event, state, ota_available_version)
        && duplicate_field!(event, state, ota_status)
        && duplicate_field!(event, state, ota_current_status)
        && duplicate_field!(event, state, hv_thermal_event)
        && duplicate_field!(event, state, twelve_volt_health)
        && duplicate_field!(event, state, is_online)
}

fn event_has_meaningful_payload(event: &TelemetryEvent) -> bool {
    !event_is_duplicate_patch(event, &blank_event(event.vehicle_id, event.ts))
}

fn immediate_change(event: &TelemetryEvent, prev: &TelemetryEvent) -> bool {
    changed_enum(&event.power_state, &prev.power_state)
        || changed_enum(&event.charger_state, &prev.charger_state)
        || changed_string(
            event.charger_status.as_deref(),
            prev.charger_status.as_deref(),
        )
        || changed_string(
            event
                .drive_mode
                .as_ref()
                .map(|d| format!("{d:?}").to_lowercase())
                .as_deref(),
            prev.drive_mode
                .as_ref()
                .map(|d| format!("{d:?}").to_lowercase())
                .as_deref(),
        )
        || changed_string(event.gear_status.as_deref(), prev.gear_status.as_deref())
        || changed_f64(event.odometer_miles, prev.odometer_miles, 0.01)
        || changed_bool(event.is_online, prev.is_online)
        || closure_or_lock_change(event, prev)
        || software_change(event, prev)
        || tire_status_change(event, prev)
}

fn closure_or_lock_change(event: &TelemetryEvent, prev: &TelemetryEvent) -> bool {
    changed_bool(event.door_front_left_locked, prev.door_front_left_locked)
        || changed_bool(event.door_front_right_locked, prev.door_front_right_locked)
        || changed_bool(event.door_rear_left_locked, prev.door_rear_left_locked)
        || changed_bool(event.door_rear_right_locked, prev.door_rear_right_locked)
        || changed_bool(event.door_front_left_closed, prev.door_front_left_closed)
        || changed_bool(event.door_front_right_closed, prev.door_front_right_closed)
        || changed_bool(event.door_rear_left_closed, prev.door_rear_left_closed)
        || changed_bool(event.door_rear_right_closed, prev.door_rear_right_closed)
        || changed_bool(event.closure_frunk_locked, prev.closure_frunk_locked)
        || changed_bool(event.closure_frunk_closed, prev.closure_frunk_closed)
        || changed_bool(event.closure_liftgate_locked, prev.closure_liftgate_locked)
        || changed_bool(event.closure_liftgate_closed, prev.closure_liftgate_closed)
        || changed_bool(event.closure_tailgate_locked, prev.closure_tailgate_locked)
        || changed_bool(event.closure_tailgate_closed, prev.closure_tailgate_closed)
}

fn software_change(event: &TelemetryEvent, prev: &TelemetryEvent) -> bool {
    changed_string(
        event.ota_current_version.as_deref(),
        prev.ota_current_version.as_deref(),
    ) || changed_string(
        event.ota_available_version.as_deref(),
        prev.ota_available_version.as_deref(),
    ) || changed_string(event.ota_status.as_deref(), prev.ota_status.as_deref())
        || changed_string(
            event.ota_current_status.as_deref(),
            prev.ota_current_status.as_deref(),
        )
}

fn tire_status_change(event: &TelemetryEvent, prev: &TelemetryEvent) -> bool {
    changed_string(
        event.tire_fl_status.as_deref(),
        prev.tire_fl_status.as_deref(),
    ) || changed_string(
        event.tire_fr_status.as_deref(),
        prev.tire_fr_status.as_deref(),
    ) || changed_string(
        event.tire_rl_status.as_deref(),
        prev.tire_rl_status.as_deref(),
    ) || changed_string(
        event.tire_rr_status.as_deref(),
        prev.tire_rr_status.as_deref(),
    )
}

fn tire_material_change(event: &TelemetryEvent, last: &Option<TelemetryEvent>) -> bool {
    changed_f64(event.tire_fl_psi, latest_f64(last, |e| e.tire_fl_psi), 0.5)
        || changed_f64(event.tire_fr_psi, latest_f64(last, |e| e.tire_fr_psi), 0.5)
        || changed_f64(event.tire_rl_psi, latest_f64(last, |e| e.tire_rl_psi), 0.5)
        || changed_f64(event.tire_rr_psi, latest_f64(last, |e| e.tire_rr_psi), 0.5)
}

fn changed_f64(current: Option<f64>, previous: Option<f64>, threshold: f64) -> bool {
    match (current, previous) {
        (Some(c), Some(p)) => (c - p).abs() >= threshold,
        (Some(_), None) => true,
        _ => false,
    }
}

fn changed_bool(current: Option<bool>, previous: Option<bool>) -> bool {
    matches!(current, Some(_)) && current != previous
}

fn changed_string(current: Option<&str>, previous: Option<&str>) -> bool {
    current.is_some() && current != previous
}

fn changed_enum<T: PartialEq>(current: &Option<T>, previous: &Option<T>) -> bool {
    current.is_some() && current != previous
}

fn latest_f64(
    event: &Option<TelemetryEvent>,
    getter: impl Fn(&TelemetryEvent) -> Option<f64>,
) -> Option<f64> {
    event.as_ref().and_then(getter)
}

fn latest_bool(
    event: &Option<TelemetryEvent>,
    getter: impl Fn(&TelemetryEvent) -> Option<bool>,
) -> Option<bool> {
    event.as_ref().and_then(getter)
}

fn location_moved_m(
    previous: Option<(f64, f64)>,
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> Option<f64> {
    let (prev_lat, prev_lon) = previous?;
    let (lat, lon) = latitude.zip(longitude)?;
    Some(haversine_m(prev_lat, prev_lon, lat, lon))
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let radius_m = 6_371_000.0_f64;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let lat1 = lat1.to_radians();
    let lat2 = lat2.to_radians();
    let a = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * radius_m * a.sqrt().asin()
}

async fn handle_inbound_accounting(
    pool: &PgPool,
    vehicle_id: Uuid,
    config: &Config,
    inbound: &WsInboundEvent,
) {
    if !is_synthetic_control(inbound.message_type.as_deref()) {
        increment_counter(pool, vehicle_id, "ws_messages_received").await;
        match inbound.kind {
            WsInboundKind::Control => {
                increment_counter(pool, vehicle_id, "ws_control_messages_received").await
            }
            WsInboundKind::Heartbeat => {
                increment_counter(pool, vehicle_id, "ws_heartbeats_received").await
            }
            WsInboundKind::Telemetry => {
                increment_counter(pool, vehicle_id, "ws_payload_messages_received").await
            }
        }
    }
    match inbound.message_type.as_deref() {
        Some("connection_open") => {
            increment_counter(pool, vehicle_id, "ws_connections_opened").await
        }
        Some("reconnect") => increment_counter(pool, vehicle_id, "ws_reconnects").await,
        Some("connection_init" | "subscribe") => {
            increment_counter(pool, vehicle_id, "outbound_messages_sent").await
        }
        _ => {}
    }
    if config.rivian_persist_raw_events {
        persist_raw_event(pool, vehicle_id, inbound).await;
    }
}

fn is_synthetic_control(message_type: Option<&str>) -> bool {
    matches!(
        message_type,
        Some("connection_open" | "connection_init" | "subscribe" | "reconnect")
    )
}

async fn persist_raw_event(pool: &PgPool, vehicle_id: Uuid, inbound: &WsInboundEvent) {
    let payload_json = serde_json::from_str::<serde_json::Value>(&inbound.raw).ok();
    let result = sqlx::query(
        r#"
        INSERT INTO riviamigo.rivian_ws_raw_events
          (vehicle_id, received_at, event_type, message_type, payload_json, payload_text)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(vehicle_id)
    .bind(inbound.received_at)
    .bind(inbound.kind.as_str())
    .bind(inbound.message_type.as_deref())
    .bind(payload_json)
    .bind(&inbound.raw)
    .execute(pool)
    .await;

    if result.is_ok() {
        increment_counter(pool, vehicle_id, "raw_events_persisted").await;
    }
}

async fn cleanup_raw_events(pool: &PgPool, retention_days: i64) {
    let _ = sqlx::query(
        "DELETE FROM riviamigo.rivian_ws_raw_events WHERE received_at < now() - ($1::int * INTERVAL '1 day')",
    )
    .bind(retention_days.max(1) as i32)
    .execute(pool)
    .await;
}

async fn increment_counter(pool: &PgPool, vehicle_id: Uuid, column: &str) {
    let Some(column) = stewardship_counter_column(column) else {
        return;
    };
    let sql = format!(
        "INSERT INTO riviamigo.rivian_stewardship_counters (vehicle_id, day, {column}) \
         VALUES ($1, CURRENT_DATE, 1) \
         ON CONFLICT (vehicle_id, day) DO UPDATE \
         SET {column} = riviamigo.rivian_stewardship_counters.{column} + 1, updated_at = now()"
    );
    let _ = sqlx::query(&sql).bind(vehicle_id).execute(pool).await;
}

fn stewardship_counter_column(column: &str) -> Option<&'static str> {
    match column {
        "ws_messages_received" => Some("ws_messages_received"),
        "ws_heartbeats_received" => Some("ws_heartbeats_received"),
        "ws_payload_messages_received" => Some("ws_payload_messages_received"),
        "ws_control_messages_received" => Some("ws_control_messages_received"),
        "ws_connections_opened" => Some("ws_connections_opened"),
        "ws_reconnects" => Some("ws_reconnects"),
        "outbound_messages_sent" => Some("outbound_messages_sent"),
        "outbound_graphql_requests" => Some("outbound_graphql_requests"),
        "telemetry_writes_persisted" => Some("telemetry_writes_persisted"),
        "telemetry_writes_suppressed" => Some("telemetry_writes_suppressed"),
        "telemetry_suppressed_duplicate" => Some("telemetry_suppressed_duplicate"),
        "telemetry_suppressed_empty" => Some("telemetry_suppressed_empty"),
        "telemetry_suppressed_threshold" => Some("telemetry_suppressed_threshold"),
        "collector_lock_skips" => Some("collector_lock_skips"),
        "raw_events_persisted" => Some("raw_events_persisted"),
        _ => None,
    }
}

fn collector_lock_key(vehicle_id: Uuid) -> i64 {
    let bytes = vehicle_id.as_bytes();
    let mut first = [0u8; 8];
    let mut second = [0u8; 8];
    first.copy_from_slice(&bytes[0..8]);
    second.copy_from_slice(&bytes[8..16]);
    i64::from_be_bytes(first) ^ i64::from_be_bytes(second) ^ ADVISORY_LOCK_NAMESPACE
}

async fn acquire_collector_lock(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> anyhow::Result<Option<PoolConnection<Postgres>>> {
    let mut conn = pool.acquire().await?;
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(collector_lock_key(vehicle_id))
        .fetch_one(&mut *conn)
        .await?;
    Ok(acquired.then_some(conn))
}

async fn release_collector_lock(
    conn: &mut PoolConnection<Postgres>,
    vehicle_id: Uuid,
) -> anyhow::Result<()> {
    let _: bool = sqlx::query_scalar("SELECT pg_advisory_unlock($1)")
        .bind(collector_lock_key(vehicle_id))
        .fetch_one(&mut **conn)
        .await?;
    Ok(())
}

async fn write_telemetry(
    pool: &PgPool,
    e: &TelemetryEvent,
    trip_id: Option<Uuid>,
    charge_session_id: Option<Uuid>,
) -> anyhow::Result<()> {
    sqlx::query(
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
    )
        .bind(e.ts)
        .bind(e.vehicle_id)
        .bind(e.latitude)
        .bind(e.longitude)
        .bind(e.altitude_m)
        .bind(e.speed_mph)
        .bind(e.battery_level)
        .bind(e.battery_capacity_wh)
        .bind(e.distance_to_empty_mi)
        .bind(e.battery_limit)
        .bind(e.power_state.as_ref().map(|p| format!("{p:?}").to_lowercase()))
        .bind(e.charger_state.as_ref().map(|c| format!("{c:?}").to_lowercase()))
        .bind(&e.charger_status)
        .bind(e.time_to_end_of_charge_min)
        .bind(e.drive_mode.as_ref().map(|d| format!("{d:?}").to_lowercase()))
        .bind(&e.gear_status)
        .bind(e.cabin_temp_c)
        .bind(e.driver_temp_c)
        .bind(e.outside_temp_c)
        .bind(e.hvac_active)
        .bind(e.power_kw)
        .bind(e.regen_power_kw)
        .bind(e.heading_deg)
        .bind(e.odometer_miles)
        .bind(e.tire_fl_psi)
        .bind(e.tire_fr_psi)
        .bind(e.tire_rl_psi)
        .bind(e.tire_rr_psi)
        .bind(&e.tire_fl_status)
        .bind(&e.tire_fr_status)
        .bind(&e.tire_rl_status)
        .bind(&e.tire_rr_status)
        .bind(e.door_front_left_locked)
        .bind(e.door_front_right_locked)
        .bind(e.door_rear_left_locked)
        .bind(e.door_rear_right_locked)
        .bind(e.door_front_left_closed)
        .bind(e.door_front_right_closed)
        .bind(e.door_rear_left_closed)
        .bind(e.door_rear_right_closed)
        .bind(e.closure_frunk_locked)
        .bind(e.closure_frunk_closed)
        .bind(e.closure_liftgate_locked)
        .bind(e.closure_liftgate_closed)
        .bind(e.closure_tailgate_locked)
        .bind(e.closure_tailgate_closed)
        .bind(&e.ota_current_version)
        .bind(&e.ota_available_version)
        .bind(&e.ota_status)
        .bind(&e.ota_current_status)
        .bind(&e.hv_thermal_event)
        .bind(&e.twelve_volt_health)
        .bind(e.is_online)
        .bind(trip_id)
        .bind(charge_session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Build a sparse JSON snapshot for the frontend WebSocket clients.
///
/// Only fields present in this telemetry event are included — None fields are
/// omitted entirely rather than serialised as `null`.  This prevents the
/// frontend from receiving a null for a field it hasn't heard about yet and
/// mistakenly overwriting a previously-good sensor reading with a blank value.
fn build_snapshot(e: &TelemetryEvent) -> String {
    use serde_json::{json, Map, Value};

    let mut data: Map<String, Value> = Map::new();

    // Helper macro: insert only when the Option is Some.
    macro_rules! set_opt {
        ($key:literal, $expr:expr) => {
            if let Some(v) = $expr {
                data.insert($key.into(), json!(v));
            }
        };
    }

    set_opt!("battery_level", e.battery_level);
    set_opt!(
        "battery_capacity_kwh",
        e.battery_capacity_wh.map(|wh| wh / 1000.0)
    );
    set_opt!("distance_to_empty_mi", e.distance_to_empty_mi);
    set_opt!("battery_limit", e.battery_limit);
    set_opt!(
        "power_state",
        e.power_state
            .as_ref()
            .map(|p| format!("{p:?}").to_lowercase())
    );
    set_opt!(
        "charger_state",
        e.charger_state
            .as_ref()
            .map(|c| format!("{c:?}").to_lowercase())
    );
    set_opt!("charger_status", e.charger_status.as_deref());
    set_opt!("time_to_end_of_charge_min", e.time_to_end_of_charge_min);
    set_opt!("speed_mph", e.speed_mph);
    set_opt!("altitude_m", e.altitude_m);
    set_opt!("heading_deg", e.heading_deg);
    set_opt!("odometer_miles", e.odometer_miles);
    set_opt!(
        "drive_mode",
        e.drive_mode
            .as_ref()
            .map(|dm| format!("{dm:?}").to_lowercase())
    );
    set_opt!("gear_status", e.gear_status.as_deref());
    set_opt!("cabin_temp_c", e.cabin_temp_c);
    set_opt!("driver_temp_c", e.driver_temp_c);
    set_opt!("outside_temp_c", e.outside_temp_c);
    set_opt!("hvac_active", e.hvac_active);
    set_opt!("power_kw", e.power_kw);
    set_opt!("regen_power_kw", e.regen_power_kw);
    set_opt!("tire_fl_psi", e.tire_fl_psi);
    set_opt!("tire_fr_psi", e.tire_fr_psi);
    set_opt!("tire_rl_psi", e.tire_rl_psi);
    set_opt!("tire_rr_psi", e.tire_rr_psi);
    set_opt!("tire_fl_status", e.tire_fl_status.as_deref());
    set_opt!("tire_fr_status", e.tire_fr_status.as_deref());
    set_opt!("tire_rl_status", e.tire_rl_status.as_deref());
    set_opt!("tire_rr_status", e.tire_rr_status.as_deref());
    set_opt!("door_front_left_locked", e.door_front_left_locked);
    set_opt!("door_front_right_locked", e.door_front_right_locked);
    set_opt!("door_rear_left_locked", e.door_rear_left_locked);
    set_opt!("door_rear_right_locked", e.door_rear_right_locked);
    set_opt!("door_front_left_closed", e.door_front_left_closed);
    set_opt!("door_front_right_closed", e.door_front_right_closed);
    set_opt!("door_rear_left_closed", e.door_rear_left_closed);
    set_opt!("door_rear_right_closed", e.door_rear_right_closed);
    set_opt!("closure_frunk_locked", e.closure_frunk_locked);
    set_opt!("closure_frunk_closed", e.closure_frunk_closed);
    set_opt!("closure_liftgate_locked", e.closure_liftgate_locked);
    set_opt!("closure_liftgate_closed", e.closure_liftgate_closed);
    set_opt!("closure_tailgate_locked", e.closure_tailgate_locked);
    set_opt!("closure_tailgate_closed", e.closure_tailgate_closed);
    set_opt!("ota_status", e.ota_status.as_deref());
    set_opt!("ota_current_status", e.ota_current_status.as_deref());
    set_opt!("ota_available_version", e.ota_available_version.as_deref());
    set_opt!("ota_current_version", e.ota_current_version.as_deref());
    set_opt!("hv_thermal_event", e.hv_thermal_event.as_deref());
    set_opt!("twelve_volt_health", e.twelve_volt_health.as_deref());
    // Derived convenience field for the frontend software-update display.
    set_opt!(
        "software_update_status",
        e.ota_status.as_deref().or(e.ota_current_status.as_deref())
    );

    // Location composite — only when both coordinates are present.
    if let Some((lat, lng)) = e.latitude.zip(e.longitude) {
        data.insert("location".into(), json!({ "lat": lat, "lng": lng }));
    }

    // is_online is always emitted; it defaults to true when Rivian hasn't
    // included a cloudConnection field in this particular event.
    data.insert("is_online".into(), json!(e.is_online.unwrap_or(true)));

    json!({ "type": "status", "ts": e.ts, "data": Value::Object(data) }).to_string()
}

#[cfg(test)]
mod snapshot_tests {
    use super::build_snapshot;
    use crate::models::telemetry::{ChargerState, TelemetryEvent};
    use chrono::Utc;
    use serde_json::Value;
    use uuid::Uuid;

    fn event_with_partial_fields() -> TelemetryEvent {
        TelemetryEvent {
            vehicle_id: Uuid::new_v4(),
            ts: Utc::now(),
            latitude: None,
            longitude: None,
            altitude_m: None,
            speed_mph: None,
            battery_level: Some(79.0),
            battery_capacity_wh: Some(135_000.0),
            distance_to_empty_mi: None,
            battery_limit: Some(70.0),
            power_state: None,
            charger_state: Some(ChargerState::Disconnected),
            charger_status: None,
            time_to_end_of_charge_min: None,
            drive_mode: None,
            gear_status: None,
            cabin_temp_c: None,
            driver_temp_c: None,
            outside_temp_c: None,
            hvac_active: None,
            power_kw: None,
            regen_power_kw: None,
            heading_deg: None,
            odometer_miles: None,
            tire_fl_psi: Some(36.5),
            tire_fr_psi: None,
            tire_rl_psi: None,
            tire_rr_psi: None,
            tire_fl_status: None,
            tire_fr_status: None,
            tire_rl_status: None,
            tire_rr_status: None,
            door_front_left_locked: None,
            door_front_right_locked: None,
            door_rear_left_locked: None,
            door_rear_right_locked: None,
            door_front_left_closed: None,
            door_front_right_closed: None,
            door_rear_left_closed: None,
            door_rear_right_closed: None,
            closure_frunk_locked: None,
            closure_frunk_closed: None,
            closure_liftgate_locked: None,
            closure_liftgate_closed: None,
            closure_tailgate_locked: None,
            closure_tailgate_closed: None,
            ota_current_version: None,
            ota_available_version: None,
            ota_status: None,
            ota_current_status: None,
            hv_thermal_event: None,
            twelve_volt_health: None,
            is_online: None,
        }
    }

    #[test]
    fn build_snapshot_omits_absent_partial_fields_instead_of_emitting_nulls() {
        let payload: Value =
            serde_json::from_str(&build_snapshot(&event_with_partial_fields())).unwrap();
        let data = payload["data"].as_object().unwrap();

        assert_eq!(data.get("battery_level").unwrap(), 79.0);
        assert_eq!(data.get("battery_capacity_kwh").unwrap(), 135.0);
        assert_eq!(data.get("battery_limit").unwrap(), 70.0);
        assert_eq!(data.get("charger_state").unwrap(), "disconnected");
        assert_eq!(data.get("tire_fl_psi").unwrap(), 36.5);
        assert_eq!(data.get("is_online").unwrap(), true);
        assert!(!data.contains_key("cabin_temp_c"));
        assert!(!data.contains_key("tire_fr_psi"));
        assert!(!data.contains_key("location"));
    }

    #[test]
    fn build_snapshot_includes_location_only_when_both_coordinates_exist() {
        let mut event = event_with_partial_fields();
        event.latitude = Some(30.25);

        let payload: Value = serde_json::from_str(&build_snapshot(&event)).unwrap();
        assert!(!payload["data"]
            .as_object()
            .unwrap()
            .contains_key("location"));

        event.longitude = Some(-97.75);
        let payload: Value = serde_json::from_str(&build_snapshot(&event)).unwrap();
        assert_eq!(payload["data"]["location"]["lat"], 30.25);
        assert_eq!(payload["data"]["location"]["lng"], -97.75);
    }
}

async fn persist_trip(
    pool: &PgPool,
    http_client: &reqwest::Client,
    trip: &crate::ingestion::trip_detector::CompletedTripData,
    distance: f64,
) -> anyhow::Result<()> {
    let duration = (trip.ended_at - trip.started_at).num_seconds() as i32;
    let max_speed = trip
        .points
        .iter()
        .map(|p| p.speed_mph)
        .fold(0.0_f64, f64::max);
    let avg_speed = if duration > 0 {
        Some(distance / (duration as f64 / 3600.0))
    } else {
        None
    };

    // Energy ensemble
    let (energy_wh, energy_strategy, efficiency_wh_per_mi) = match compute_trip_energy(
        trip.soc_start,
        trip.soc_end,
        trip.battery_capacity_wh,
        trip.range_start_mi,
        trip.range_end_mi,
        distance,
        None,
    ) {
        Some((wh, strat)) => {
            let eff = if distance > 0.0 {
                Some(wh / distance)
            } else {
                None
            };
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

    // Fetch ambient temperature from Open-Meteo using trip start location/time.
    // Falls back to None gracefully if the request fails.
    let outside_temp_c = match start {
        Some(pt) => {
            fetch_ambient_temp_c(http_client, pt.lat, pt.lng, trip.started_at).await
        }
        None => None,
    };

    let owner_id = get_vehicle_owner_id(pool, trip.vehicle_id).await?;
    let start_match = match (owner_id, start) {
        (Some(user_id), Some(point)) => match_point(pool, user_id, point.lat, point.lng).await?,
        _ => MatchedLocation::none(),
    };
    let end_match = match (owner_id, end) {
        (Some(user_id), Some(point)) => match_point(pool, user_id, point.lat, point.lng).await?,
        _ => MatchedLocation::none(),
    };

    sqlx::query(
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
            inside_temp_avg_c, outside_temp_c, regen_wh, energy_wh, energy_strategy)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)"#,
    )
        .bind(trip.trip_id)
        .bind(trip.vehicle_id)
        .bind(trip.started_at)
        .bind(trip.ended_at)
        .bind(start.map(|p| p.lat))
        .bind(start.map(|p| p.lng))
        .bind(end.map(|p| p.lat))
        .bind(end.map(|p| p.lng))
        .bind(distance)
        .bind(duration)
        .bind(trip.soc_start)
        .bind(trip.soc_end)
        .bind(efficiency_wh_per_mi)
        .bind(max_speed)
        .bind(avg_speed)
        .bind(trip.dominant_drive_mode.as_deref())
        .bind(trip.start_odometer_mi)
        .bind(trip.end_odometer_mi)
        .bind(start.map(|p| p.ts))
        .bind(end.map(|p| p.ts))
        .bind(start_match.geofence_id)
        .bind(end_match.geofence_id)
        .bind(start_match.address_id)
        .bind(end_match.address_id)
        .bind(trip.range_start_mi)
        .bind(trip.range_end_mi)
        .bind(trip.power_max_kw)
        .bind(trip.power_min_kw)
        .bind(trip.elevation_gain_m)
        .bind(trip.elevation_loss_m)
        .bind(trip.inside_temp_avg_c)
        .bind(outside_temp_c)
        .bind(trip.regen_wh)
        .bind(energy_wh)
        .bind(energy_strategy.as_deref())
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
    let profile =
        resolve_profile(pool, None, location_match.geofence_id, session.vehicle_id).await?;
    let energy_added_kwh = session.energy_added_wh.map(|wh| wh / 1000.0);
    let energy_used_kwh = session.energy_used_wh.map(|wh| wh / 1000.0);
    let cost_usd = profile.as_ref().and_then(|p| {
        compute_cost(
            p,
            energy_added_kwh,
            energy_used_kwh,
            duration_minutes,
            session.started_at,
            Some(session.ended_at),
        )
    });
    let cost_profile_id = profile.as_ref().map(|p| p.id);
    let cost_method = if cost_profile_id.is_some() {
        Some("profile")
    } else {
        Some("unknown")
    };

    sqlx::query(
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
    )
    .bind(session.session_id)
    .bind(session.vehicle_id)
    .bind(session.started_at)
    .bind(session.ended_at)
    .bind(session.location_lat)
    .bind(session.location_lng)
    .bind(location_match.is_home)
    .bind(session.soc_start)
    .bind(session.soc_end)
    .bind(session.charge_limit)
    .bind(duration_minutes)
    .bind(energy_added_kwh)
    .bind(session.peak_charge_kw)
    .bind(cost_usd)
    .bind(session.energy_added_wh)
    .bind(session.energy_used_wh)
    .bind(session.avg_charge_rate_kw)
    .bind(session.peak_charge_kw)
    .bind(location_match.geofence_id)
    .bind(location_match.address_id)
    .bind(cost_profile_id)
    .bind(cost_method)
    .bind(session.charger_type.as_deref())
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
        None => {
            // No named geofence — reverse-geocode so trips get road/city labels.
            let address_id = reverse_geocode_and_store(pool, lat, lon).await;
            MatchedLocation {
                geofence_id: None,
                address_id,
                is_home: None,
            }
        }
    })
}

/// Call Nominatim reverse geocoding, store the result in `riviamigo.addresses`,
/// and return the row's UUID.  Returns `None` on any network / DB error so
/// callers can degrade gracefully.
async fn reverse_geocode_and_store(pool: &PgPool, lat: f64, lon: f64) -> Option<Uuid> {
    // ── rate limit ────────────────────────────────────────────────────────
    let sleep_for = {
        let mut next = nominatim_gate().lock().await;
        let now = std::time::Instant::now();
        let wait = next.saturating_duration_since(now);
        *next = now + wait + std::time::Duration::from_millis(1100);
        wait
    };
    if !sleep_for.is_zero() {
        tokio::time::sleep(sleep_for).await;
    }

    // ── HTTP request ──────────────────────────────────────────────────────
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error=%e, "worker.reverse_geocode_client_build_failed");
            return None;
        }
    };

    let lat_s = lat.to_string();
    let lon_s = lon.to_string();
    let resp = match client
        .get("https://nominatim.openstreetmap.org/reverse")
        .header(
            reqwest::header::USER_AGENT,
            "riviamigo-api/0.1 (contact: support@riviamigo.com)",
        )
        .query(&[
            ("format", "jsonv2"),
            ("addressdetails", "1"),
            ("lat", lat_s.as_str()),
            ("lon", lon_s.as_str()),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error=%e, lat=%lat, lon=%lon, "worker.reverse_geocode_request_failed");
            return None;
        }
    };

    if !resp.status().is_success() {
        tracing::warn!(status=%resp.status(), lat=%lat, lon=%lon, "worker.reverse_geocode_http_error");
        return None;
    }

    let raw: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error=%e, "worker.reverse_geocode_decode_failed");
            return None;
        }
    };

    // ── parse ─────────────────────────────────────────────────────────────
    let display_name = raw.get("display_name")?.as_str()?.to_string();
    let osm_id = raw.get("osm_id").and_then(|v| v.as_i64());
    let addr = raw.get("address").and_then(|v| v.as_object());

    let road: Option<String> = addr
        .and_then(|a| {
            a.get("road")
                .or_else(|| a.get("pedestrian"))
                .or_else(|| a.get("footway"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let city: Option<String> = addr
        .and_then(|a| {
            a.get("city")
                .or_else(|| a.get("town"))
                .or_else(|| a.get("village"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let state: Option<String> = addr
        .and_then(|a| a.get("state"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let postcode: Option<String> = addr
        .and_then(|a| a.get("postcode"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let country: Option<String> = addr
        .and_then(|a| a.get("country"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    // ── persist ───────────────────────────────────────────────────────────
    let result: Result<Uuid, sqlx::Error> = if let Some(oid) = osm_id {
        sqlx::query_scalar(
            r#"INSERT INTO riviamigo.addresses
               (display_name, osm_id, latitude, longitude, road, city, state, postcode, country, raw)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (osm_id) DO UPDATE SET
                 display_name = EXCLUDED.display_name,
                 road = EXCLUDED.road,
                 city = EXCLUDED.city,
                 state = EXCLUDED.state,
                 postcode = EXCLUDED.postcode,
                 country = EXCLUDED.country,
                 raw = EXCLUDED.raw
               RETURNING id"#,
        )
        .bind(display_name)
        .bind(oid)
        .bind(lat)
        .bind(lon)
        .bind(road)
        .bind(city)
        .bind(state)
        .bind(postcode)
        .bind(country)
        .bind(raw)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query_scalar(
            r#"INSERT INTO riviamigo.addresses
               (display_name, latitude, longitude, road, city, state, postcode, country, raw)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id"#,
        )
        .bind(display_name)
        .bind(lat)
        .bind(lon)
        .bind(road)
        .bind(city)
        .bind(state)
        .bind(postcode)
        .bind(country)
        .bind(raw)
        .fetch_one(pool)
        .await
    };

    match result {
        Ok(id) => Some(id),
        Err(e) => {
            tracing::warn!(error=%e, "worker.reverse_geocode_db_insert_failed");
            None
        }
    }
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
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_state_periods (vehicle_id, state, started_at)
           VALUES ($1, $2, $3)"#,
    )
    .bind(vehicle_id)
    .bind(state.to_string())
    .bind(started_at)
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
    let _ = sqlx::query(
        r#"UPDATE riviamigo.vehicle_state_periods
           SET ended_at = $1
           WHERE vehicle_id = $2 AND state = $3 AND started_at = $4 AND ended_at IS NULL"#,
    )
    .bind(ended_at)
    .bind(vehicle_id)
    .bind(state.to_string())
    .bind(started_at)
    .execute(pool)
    .await;
}

async fn open_software_version(
    pool: &PgPool,
    vehicle_id: Uuid,
    version: &str,
    installed_at: chrono::DateTime<Utc>,
) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.software_versions (vehicle_id, version, installed_at)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(vehicle_id)
    .bind(version)
    .bind(installed_at)
    .execute(pool)
    .await;
}

async fn close_software_version(
    pool: &PgPool,
    vehicle_id: Uuid,
    version: &str,
    observed_until: chrono::DateTime<Utc>,
) {
    let _ = sqlx::query(
        r#"UPDATE riviamigo.software_versions
           SET observed_until = $1
           WHERE vehicle_id = $2 AND version = $3 AND observed_until IS NULL"#,
    )
    .bind(observed_until)
    .bind(vehicle_id)
    .bind(version)
    .execute(pool)
    .await;
}

async fn upsert_health(pool: &PgPool, vehicle_id: Uuid, online: bool, health: &str, msg: &str) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, is_online, worker_health, worker_health_msg, updated_at)
           VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET is_online=$2, worker_health=$3, worker_health_msg=$4, updated_at=now()"#,
    )
    .bind(vehicle_id)
    .bind(online)
    .bind(health)
    .bind(msg)
    .execute(pool)
    .await;
}

async fn upsert_seen(
    pool: &PgPool,
    vehicle_id: Uuid,
    online: bool,
    ts: DateTime<Utc>,
    kind: SeenKind,
) {
    let (payload_at, heartbeat_at) = match kind {
        SeenKind::Payload => (Some(ts), None),
        SeenKind::Heartbeat => (None, Some(ts)),
    };
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, is_online, last_event_at, last_seen_at, last_payload_at, last_heartbeat_at, updated_at)
           VALUES ($1,$2,$3,$3,$4,$5,now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET is_online=$2,
               last_event_at=$3,
               last_seen_at=$3,
               last_payload_at=COALESCE($4, riviamigo.vehicle_runtime_state.last_payload_at),
               last_heartbeat_at=COALESCE($5, riviamigo.vehicle_runtime_state.last_heartbeat_at),
               updated_at=now()"#,
    )
    .bind(vehicle_id)
    .bind(online)
    .bind(ts)
    .bind(payload_at)
    .bind(heartbeat_at)
    .execute(pool)
    .await;
}

async fn mark_persisted(pool: &PgPool, vehicle_id: Uuid, ts: DateTime<Utc>) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, last_persisted_at, updated_at)
           VALUES ($1,$2,now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET last_persisted_at=$2, updated_at=now()"#,
    )
    .bind(vehicle_id)
    .bind(ts)
    .execute(pool)
    .await;
}

#[cfg(test)]
mod stewardship_tests {
    use super::*;
    use chrono::Duration;

    fn event(vehicle_id: Uuid, offset_seconds: i64) -> TelemetryEvent {
        blank_event(vehicle_id, Utc::now() + Duration::seconds(offset_seconds))
    }

    #[test]
    fn empty_event_is_suppressed() {
        let vehicle_id = Uuid::new_v4();
        let mut gate = TelemetryPersistenceGate::new(vehicle_id);

        assert_eq!(
            gate.decide(&event(vehicle_id, 0)),
            PersistenceDecision::Suppress(SuppressionReason::Empty)
        );
    }

    #[test]
    fn duplicate_sparse_payload_is_suppressed_after_first_persist() {
        let vehicle_id = Uuid::new_v4();
        let mut gate = TelemetryPersistenceGate::new(vehicle_id);
        let mut first = event(vehicle_id, 0);
        first.battery_level = Some(72.0);

        assert_eq!(gate.decide(&first), PersistenceDecision::Persist);

        let mut duplicate = event(vehicle_id, 30);
        duplicate.battery_level = Some(72.0);
        assert_eq!(
            gate.decide(&duplicate),
            PersistenceDecision::Suppress(SuppressionReason::Duplicate)
        );
    }

    #[test]
    fn material_soc_change_persists_when_parked() {
        let vehicle_id = Uuid::new_v4();
        let mut gate = TelemetryPersistenceGate::new(vehicle_id);
        let mut first = event(vehicle_id, 0);
        first.power_state = Some(PowerState::Ready);
        first.battery_level = Some(72.0);
        assert_eq!(gate.decide(&first), PersistenceDecision::Persist);

        let mut changed = event(vehicle_id, 300);
        changed.battery_level = Some(71.4);
        assert_eq!(gate.decide(&changed), PersistenceDecision::Persist);
    }

    #[test]
    fn small_parked_soc_change_is_threshold_suppressed() {
        let vehicle_id = Uuid::new_v4();
        let mut gate = TelemetryPersistenceGate::new(vehicle_id);
        let mut first = event(vehicle_id, 0);
        first.power_state = Some(PowerState::Ready);
        first.battery_level = Some(72.0);
        assert_eq!(gate.decide(&first), PersistenceDecision::Persist);

        let mut changed = event(vehicle_id, 300);
        changed.battery_level = Some(71.8);
        assert_eq!(
            gate.decide(&changed),
            PersistenceDecision::Suppress(SuppressionReason::Threshold)
        );
    }

    #[test]
    fn driving_location_threshold_persists() {
        let vehicle_id = Uuid::new_v4();
        let mut gate = TelemetryPersistenceGate::new(vehicle_id);
        let mut first = event(vehicle_id, 0);
        first.power_state = Some(PowerState::Drive);
        first.latitude = Some(30.0);
        first.longitude = Some(-97.0);
        assert_eq!(gate.decide(&first), PersistenceDecision::Persist);

        let mut moved = event(vehicle_id, 6);
        moved.latitude = Some(30.0003);
        moved.longitude = Some(-97.0);
        assert_eq!(gate.decide(&moved), PersistenceDecision::Persist);
    }
}
