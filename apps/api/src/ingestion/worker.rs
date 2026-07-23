//! Per-vehicle ingestion worker: WS + poll + trip/charge detection + DB writes.

use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use sqlx::{pool::PoolConnection, PgPool, Postgres};
use tokio::sync::{broadcast, mpsc, watch};
use uuid::Uuid;

use crate::{
    config::Config,
    db::vehicles::get_vehicle_owner_id,
    ingestion::{
        charge_detector::{ActiveChargeSessionSnapshot, ChargeDetectorState, ChargeEvent},
        rivian_poll,
        session_store::{decrypt_tokens, RivianTokenBundle},
        trip_detector::{
            compute_distance_odometer_or_gps, compute_trip_energy, TripDetectorState, TripEvent,
        },
        ws_client::{self, WsInboundEvent, WsInboundKind},
    },
    models::{
        state_period::VehicleState,
        telemetry::{ChargerState, PowerState, TelemetryEvent},
    },
    services::{
        cost::recompute_charge_session_cost,
        geofences::match_geofence,
        trip_enrichment::{resolve_trip_location, MatchedLocation},
        trip_routes::build_route_preview,
        weather_enrichment,
    },
};

const MIN_TRIP_DISTANCE_MILES: f64 = 0.1;
const ADVISORY_LOCK_NAMESPACE: i64 = 0x52_49_56_57; // "RIVW"
const WS_WATCHDOG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
const CHARGE_DETECTOR_REHYDRATE_LOOKBACK_HOURS: i32 = 12;
const CHARGE_DETECTOR_REHYDRATE_STALENESS_MINUTES: i32 = 120;

#[derive(Debug, sqlx::FromRow)]
struct ActiveChargeDetectorRow {
    session_id: Uuid,
    started_at: DateTime<Utc>,
    last_charge_ts: DateTime<Utc>,
    last_power_ts: Option<DateTime<Utc>>,
    location_lat: Option<f64>,
    location_lng: Option<f64>,
    soc_start: Option<f64>,
    last_soc: Option<f64>,
    charge_limit: Option<f64>,
    battery_capacity_wh: Option<f64>,
    energy_used_wh: Option<f64>,
    peak_charge_kw: Option<f64>,
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
        "SELECT encrypted_tokens FROM riviamigo.vehicle_credentials WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(&pool)
    .await;

    let tokens: RivianTokenBundle = match creds_row {
        Ok(Some(encrypted_tokens)) => match decrypt_tokens(&encrypted_tokens, &identity) {
            Ok(t) => t,
            Err(e) => {
                tracing::error!(vehicle_id=%vehicle_id, err=%e, "decrypt failed");
                upsert_health(
                    &pool,
                    vehicle_id,
                    false,
                    "error",
                    &e.to_string(),
                    Some("needs_reauth"),
                    Some("credentials_invalid"),
                )
                .await;
                return;
            }
        },
        Ok(None) => {
            tracing::error!(
                vehicle_id=%vehicle_id,
                worker_health="error",
                auth_state="needs_reauth",
                reason_code="credentials_missing",
                action="reconnect_vehicle",
                "Rivian telemetry feed unavailable: credentials are missing"
            );
            upsert_health(
                &pool,
                vehicle_id,
                false,
                "error",
                "Rivian credentials are missing; reconnect the vehicle",
                Some("needs_reauth"),
                Some("credentials_missing"),
            )
            .await;
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
            upsert_health(
                &pool,
                vehicle_id,
                false,
                "passive",
                "collector lock held",
                Some("authorized"),
                None,
            )
            .await;
            tracing::info!(vehicle_id = %vehicle_id, "collector lock held; worker staying passive");
            return;
        }
        Err(e) => {
            tracing::error!(vehicle_id=%vehicle_id, err=%e, "collector lock failed");
            return;
        }
    };

    upsert_health(
        &pool,
        vehicle_id,
        true,
        "connected",
        "",
        Some("authorized"),
        None,
    )
    .await;

    let (ev_tx, mut ev_rx) = mpsc::channel::<WsInboundEvent>(256);

    // Get rivian_vehicle_id
    let riv_id: Option<String> =
        sqlx::query_scalar("SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id = $1")
            .bind(vehicle_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();

    let rivian_vehicle_id = match riv_id {
        Some(id) => id,
        None => {
            tracing::error!(vehicle_id=%vehicle_id, "no rivian_vehicle_id");
            let _ = release_collector_lock(&mut lock_conn, vehicle_id).await;
            return;
        }
    };

    // Fetch owner user_id (needed for wallbox enrichment).
    let user_id: Option<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM riviamigo.vehicles WHERE id = $1")
            .bind(vehicle_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();

    let mut worker_shutdown = shutdown.resubscribe();
    let spawn_ws_loop = || {
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
        })
    };
    let mut ws_handle = spawn_ws_loop();

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    // ── Poll tasks ───────────────────────────────────────────────────────────
    // Channel to push PowerState changes from the main event loop to the poll loop.
    let (power_state_tx, power_state_rx) = watch::channel::<Option<PowerState>>(None);
    let (charging_tx, charging_rx) = watch::channel(false);

    // Fire-and-forget startup enrichment (runs once; errors are non-fatal).
    {
        let uid = user_id.unwrap_or(Uuid::nil());
        let pool2 = pool.clone();
        let client2 = http_client.clone();
        let age_key2 = age_key.clone();
        tokio::spawn(async move {
            rivian_poll::run_startup_polls(vehicle_id, uid, pool2, client2, age_key2).await;
        });
    }

    // Adaptive periodic poll loop (live session data while charging, etc.).
    {
        let pool2 = pool.clone();
        let client2 = http_client.clone();
        let redis2 = redis.clone();
        let age_key2 = age_key.clone();
        let poll_shutdown = shutdown.resubscribe();
        tokio::spawn(async move {
            rivian_poll::run_poll_loop(
                vehicle_id,
                pool2,
                client2,
                age_key2,
                power_state_rx,
                charging_rx,
                poll_shutdown,
                redis2,
            )
            .await;
        });
    }
    // ────────────────────────────────────────────────────────────────────────

    let mut trip_det = TripDetectorState::new(vehicle_id);
    let mut charge_det =
        if let Some(snapshot) = load_active_charge_snapshot(&pool, vehicle_id).await {
            tracing::info!(
                vehicle_id=%vehicle_id,
                charge_session_id=%snapshot.session_id,
                started_at=%snapshot.started_at,
                "rehydrated active charge detector state from stamped telemetry"
            );
            ChargeDetectorState::from_snapshot(vehicle_id, snapshot)
        } else {
            ChargeDetectorState::new(vehicle_id)
        };
    let mut redis_conn = match redis.get_multiplexed_async_connection().await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(err=%e, "redis connect failed");
            let _ = release_collector_lock(&mut lock_conn, vehicle_id).await;
            return;
        }
    };

    // State period tracking
    let mut last_vehicle_state: Option<VehicleState> = None;
    let mut state_period_start: Option<chrono::DateTime<Utc>> = None;
    // Software version tracking
    let mut last_software_version: Option<String> = None;
    let mut sw_version_start: Option<chrono::DateTime<Utc>> = None;
    // OTA available version tracking (triggers release notes fetch on change).
    let mut last_ota_available_version: Option<String> = None;
    let mut persistence_gate = TelemetryPersistenceGate::new(vehicle_id);
    let mut raw_cleanup_tick: u64 = 0;
    // Shared counter batch — flushed every 50 events to amortize DB upserts.
    let mut counter_batch = CounterBatch::new(vehicle_id);
    let mut counter_flush_tick: u64 = 0;

    // Track the most recent inbound WS/control event so we can restart a
    // connection that stays silently wedged while still holding the worker lock.
    let mut last_ws_inbound_at = tokio::time::Instant::now();
    loop {
        let inbound = tokio::select! {
            _ = worker_shutdown.recv() => {
                break;
            }
            _ = tokio::time::sleep_until(last_ws_inbound_at + WS_WATCHDOG_TIMEOUT) => {
                tracing::warn!(
                    vehicle_id=%vehicle_id,
                    timeout_seconds=WS_WATCHDOG_TIMEOUT.as_secs(),
                    "worker watchdog detected a silent Rivian WS stream; restarting websocket collector"
                );
                upsert_health(
                    &pool,
                    vehicle_id,
                    false,
                    "stale",
                    "No Rivian WS messages received within the watchdog window; restarting websocket collector",
                    None,
                    Some("rivian_ws_silent"),
                )
                .await;
                ws_handle.abort();
                let _ = (&mut ws_handle).await;
                ws_handle = spawn_ws_loop();
                last_ws_inbound_at = tokio::time::Instant::now();
                continue;
            }
            // Normal event path.
            msg = ev_rx.recv() => match msg {
                Some(ev) => ev,
                None => break,
            },
            // Monitor the WS task; log if it exits unexpectedly.
            result = &mut ws_handle => {
                match result {
                    Ok(()) => tracing::warn!(vehicle_id=%vehicle_id, "WS task exited cleanly; restarting websocket collector"),
                    Err(e) if e.is_panic() => tracing::error!(vehicle_id=%vehicle_id, "WS task panicked; restarting websocket collector"),
                    Err(e) => tracing::warn!(vehicle_id=%vehicle_id, err=%e, "WS task exited with error; restarting websocket collector"),
                }
                upsert_health(
                    &pool,
                    vehicle_id,
                    false,
                    "degraded",
                    "Rivian websocket collector exited unexpectedly; restarting",
                    None,
                    Some("rivian_ws_restarting"),
                )
                .await;
                ws_handle = spawn_ws_loop();
                last_ws_inbound_at = tokio::time::Instant::now();
                continue;
            }
        };
        last_ws_inbound_at = tokio::time::Instant::now();
        handle_inbound_accounting(&pool, vehicle_id, &config, &inbound, &mut counter_batch).await;
        raw_cleanup_tick += 1;
        counter_flush_tick += 1;
        if raw_cleanup_tick.is_multiple_of(500) {
            cleanup_raw_events(&pool, config.rivian_raw_event_retention_days).await;
        }
        if counter_flush_tick.is_multiple_of(50) {
            counter_batch.flush(&pool).await;
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
                inbound.received_at,
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
        let topic = format!("vehicle:{vehicle_id}:status");
        if let Err(e) = redis_conn.publish::<_, _, ()>(&topic, &snapshot).await {
            tracing::debug!(vehicle_id=%vehicle_id, err=%e, "redis publish failed");
        }

        // Update runtime state
        upsert_seen(
            &pool,
            vehicle_id,
            event.is_online.unwrap_or(true),
            event.ts,
            inbound.received_at,
            SeenKind::Payload,
        )
        .await;

        if let Err(error) = upsert_latest_status(&pool, &event).await {
            tracing::warn!(vehicle_id=%vehicle_id, err=%error, "latest-status upsert failed");
        }

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
                counter_batch.increment("telemetry_writes_persisted");
                mark_persisted(&pool, vehicle_id, event.ts).await;
            }
        } else if let PersistenceDecision::Suppress(reason) = persistence_decision {
            counter_batch.increment("telemetry_writes_suppressed");
            counter_batch.increment(reason.counter_column());
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

        // Keep the poll loop informed of the latest power state so it can
        // adapt its cadence (e.g. switch to 30-second live-session polling
        // while Charging).
        let _ = power_state_tx.send(event.power_state.clone());
        let _ = charging_tx.send(event.is_actively_charging());

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

        // ── OTA available version change ─────────────────────────────────────
        // OTA version arrives via WS telemetry; the getOTAUpdateDetails query
        // does not exist in Rivian's schema so we only track version changes
        // for logging purposes.
        if let Some(avail_ver) = &event.ota_available_version {
            if Some(avail_ver) != last_ota_available_version.as_ref() {
                tracing::info!(vehicle_id=%vehicle_id, version=%avail_ver, "OTA available version changed");
                last_ota_available_version = Some(avail_ver.clone());
            }
        }

        // ── Trip detection ───────────────────────────────────────────────────
        if let TripEvent::TripEnded { trip } = trip_det.process(&event) {
            let distance = compute_distance_odometer_or_gps(
                trip.start_odometer_mi,
                trip.end_odometer_mi,
                &trip.points,
            );
            if distance >= MIN_TRIP_DISTANCE_MILES {
                let _ = persist_trip(&pool, &http_client, &trip, distance).await;
            }
        }

        // ── Charge detection ─────────────────────────────────────────────────
        if let ChargeEvent::SessionEnded(session) = charge_event {
            let _ = persist_charge_session(&pool, &session).await;
            // Trigger incremental charge history sync to enrich the new session
            // with Rivian API fields (network vendor, range added, etc.).
            let pool2 = pool.clone();
            let client2 = http_client.clone();
            let age_key2 = age_key.clone();
            tokio::spawn(async move {
                if let Err(e) = rivian_poll::fetch_live_session_history_for_vehicle(
                    vehicle_id,
                    Some(session.session_id),
                    &pool2,
                    &client2,
                    &age_key2,
                )
                .await
                {
                    tracing::debug!(vehicle_id=%vehicle_id, err=%e, "live charge history sync failed");
                }
                if let Err(e) = rivian_poll::fetch_charge_history_for_vehicle(
                    vehicle_id, &pool2, &client2, &age_key2,
                )
                .await
                {
                    tracing::warn!(vehicle_id=%vehicle_id, err=%e, "post-session charge history sync failed");
                }
            });
        }
    }

    // Flush any remaining accumulated counters before the worker exits.
    counter_batch.flush(&pool).await;
    ws_handle.abort();
    let _ = (&mut ws_handle).await;
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
    TelemetryEvent::empty(vehicle_id, ts)
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
    patch_opt!(target, source, location_ts);
    patch_opt!(target, source, speed_mph_ts);
    patch_opt!(target, source, battery_level);
    patch_opt!(target, source, battery_capacity_wh);
    patch_opt!(target, source, distance_to_empty_mi);
    patch_opt!(target, source, battery_limit);
    patch_opt!(target, source, battery_level_ts);
    patch_opt!(target, source, distance_to_empty_mi_ts);
    patch_opt!(target, source, battery_limit_ts);
    patch_opt!(target, source, power_state);
    patch_opt!(target, source, charger_state);
    patch_opt!(target, source, charger_status);
    patch_opt!(target, source, time_to_end_of_charge_min);
    patch_opt!(target, source, power_state_ts);
    patch_opt!(target, source, charger_state_ts);
    patch_opt!(target, source, charger_status_ts);
    patch_opt!(target, source, time_to_end_of_charge_min_ts);
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
    patch_opt!(target, source, odometer_miles_ts);
    patch_opt!(target, source, tire_fl_psi);
    patch_opt!(target, source, tire_fr_psi);
    patch_opt!(target, source, tire_rl_psi);
    patch_opt!(target, source, tire_rr_psi);
    patch_opt!(target, source, tire_fl_status);
    patch_opt!(target, source, tire_fr_status);
    patch_opt!(target, source, tire_rl_status);
    patch_opt!(target, source, tire_rr_status);
    patch_opt!(target, source, tire_fl_valid);
    patch_opt!(target, source, tire_fr_valid);
    patch_opt!(target, source, tire_rl_valid);
    patch_opt!(target, source, tire_rr_valid);
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
    // Extended vehicle state fields
    patch_opt!(target, source, charge_port_open);
    patch_opt!(target, source, charger_derate_active);
    patch_opt!(target, source, cabin_precon_status);
    patch_opt!(target, source, cabin_precon_type);
    patch_opt!(target, source, pet_mode_active);
    patch_opt!(target, source, pet_mode_temp_ok);
    patch_opt!(target, source, defrost_active);
    patch_opt!(target, source, steering_wheel_heat);
    patch_opt!(target, source, seat_fl_heat);
    patch_opt!(target, source, seat_fr_heat);
    patch_opt!(target, source, seat_rl_heat);
    patch_opt!(target, source, seat_rr_heat);
    patch_opt!(target, source, seat_fl_vent);
    patch_opt!(target, source, seat_fr_vent);
    patch_opt!(target, source, tonneau_locked);
    patch_opt!(target, source, tonneau_closed);
    patch_opt!(target, source, side_bin_left_locked);
    patch_opt!(target, source, side_bin_right_locked);
    patch_opt!(target, source, side_bin_left_closed);
    patch_opt!(target, source, side_bin_right_closed);
    patch_opt!(target, source, window_fl_closed);
    patch_opt!(target, source, window_fr_closed);
    patch_opt!(target, source, window_rl_closed);
    patch_opt!(target, source, window_rr_closed);
    patch_opt!(target, source, gear_guard_locked);
    patch_opt!(target, source, gear_guard_video_status);
    patch_opt!(target, source, wiper_fluid_low);
    patch_opt!(target, source, brake_fluid_low);
    patch_opt!(target, source, alarm_active);
    patch_opt!(target, source, service_mode);
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
        && duplicate_field!(event, state, tire_fl_valid)
        && duplicate_field!(event, state, tire_fr_valid)
        && duplicate_field!(event, state, tire_rl_valid)
        && duplicate_field!(event, state, tire_rr_valid)
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
        && duplicate_field!(event, state, charge_port_open)
        && duplicate_field!(event, state, charger_derate_active)
        && duplicate_field!(event, state, cabin_precon_status)
        && duplicate_field!(event, state, cabin_precon_type)
        && duplicate_field!(event, state, pet_mode_active)
        && duplicate_field!(event, state, pet_mode_temp_ok)
        && duplicate_field!(event, state, defrost_active)
        && duplicate_field!(event, state, steering_wheel_heat)
        && duplicate_field!(event, state, seat_fl_heat)
        && duplicate_field!(event, state, seat_fr_heat)
        && duplicate_field!(event, state, seat_rl_heat)
        && duplicate_field!(event, state, seat_rr_heat)
        && duplicate_field!(event, state, seat_fl_vent)
        && duplicate_field!(event, state, seat_fr_vent)
        && duplicate_field!(event, state, tonneau_locked)
        && duplicate_field!(event, state, tonneau_closed)
        && duplicate_field!(event, state, side_bin_left_locked)
        && duplicate_field!(event, state, side_bin_right_locked)
        && duplicate_field!(event, state, side_bin_left_closed)
        && duplicate_field!(event, state, side_bin_right_closed)
        && duplicate_field!(event, state, window_fl_closed)
        && duplicate_field!(event, state, window_fr_closed)
        && duplicate_field!(event, state, window_rl_closed)
        && duplicate_field!(event, state, window_rr_closed)
        && duplicate_field!(event, state, gear_guard_locked)
        && duplicate_field!(event, state, gear_guard_video_status)
        && duplicate_field!(event, state, wiper_fluid_low)
        && duplicate_field!(event, state, brake_fluid_low)
        && duplicate_field!(event, state, alarm_active)
        && duplicate_field!(event, state, service_mode)
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
        || changed_bool(event.tonneau_locked, prev.tonneau_locked)
        || changed_bool(event.tonneau_closed, prev.tonneau_closed)
        || changed_bool(event.side_bin_left_locked, prev.side_bin_left_locked)
        || changed_bool(event.side_bin_right_locked, prev.side_bin_right_locked)
        || changed_bool(event.side_bin_left_closed, prev.side_bin_left_closed)
        || changed_bool(event.side_bin_right_closed, prev.side_bin_right_closed)
        || changed_bool(event.window_fl_closed, prev.window_fl_closed)
        || changed_bool(event.window_fr_closed, prev.window_fr_closed)
        || changed_bool(event.window_rl_closed, prev.window_rl_closed)
        || changed_bool(event.window_rr_closed, prev.window_rr_closed)
        || changed_bool(event.gear_guard_locked, prev.gear_guard_locked)
        || changed_bool(event.charge_port_open, prev.charge_port_open)
        || changed_bool(event.charger_derate_active, prev.charger_derate_active)
        || changed_bool(event.pet_mode_active, prev.pet_mode_active)
        || changed_bool(event.pet_mode_temp_ok, prev.pet_mode_temp_ok)
        || changed_bool(event.defrost_active, prev.defrost_active)
        || changed_bool(event.wiper_fluid_low, prev.wiper_fluid_low)
        || changed_bool(event.brake_fluid_low, prev.brake_fluid_low)
        || changed_bool(event.alarm_active, prev.alarm_active)
        || changed_bool(event.service_mode, prev.service_mode)
        || changed_string(
            event.cabin_precon_status.as_deref(),
            prev.cabin_precon_status.as_deref(),
        )
        || changed_string(
            event.cabin_precon_type.as_deref(),
            prev.cabin_precon_type.as_deref(),
        )
        || changed_string(
            event.gear_guard_video_status.as_deref(),
            prev.gear_guard_video_status.as_deref(),
        )
        || changed_i32(event.steering_wheel_heat, prev.steering_wheel_heat)
        || changed_i32(event.seat_fl_heat, prev.seat_fl_heat)
        || changed_i32(event.seat_fr_heat, prev.seat_fr_heat)
        || changed_i32(event.seat_rl_heat, prev.seat_rl_heat)
        || changed_i32(event.seat_rr_heat, prev.seat_rr_heat)
        || changed_i32(event.seat_fl_vent, prev.seat_fl_vent)
        || changed_i32(event.seat_fr_vent, prev.seat_fr_vent)
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
    current.is_some() && current != previous
}

fn changed_i32(current: Option<i32>, previous: Option<i32>) -> bool {
    current.is_some() && current != previous
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

/// Batches stewardship counter increments and flushes them in a single upsert.
struct CounterBatch {
    vehicle_id: Uuid,
    counts: std::collections::HashMap<&'static str, i64>,
}

impl CounterBatch {
    fn new(vehicle_id: Uuid) -> Self {
        Self {
            vehicle_id,
            counts: std::collections::HashMap::new(),
        }
    }

    fn increment(&mut self, column: &str) {
        if let Some(col) = stewardship_counter_column(column) {
            *self.counts.entry(col).or_insert(0) += 1;
        }
    }

    /// Flush accumulated counts to the DB and reset the batch for reuse.
    async fn flush(&mut self, pool: &PgPool) {
        if self.counts.is_empty() {
            return;
        }
        let cols: Vec<&'static str> = self.counts.keys().copied().collect();
        let set_clause = cols
            .iter()
            .map(|c| format!("{c} = riviamigo.rivian_stewardship_counters.{c} + EXCLUDED.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let col_list = cols.join(", ");
        let placeholders: Vec<String> = cols
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", i + 3))
            .collect();
        let sql = format!(
            "INSERT INTO riviamigo.rivian_stewardship_counters (vehicle_id, day, {col_list}) \
             VALUES ($1, CURRENT_DATE, {vals}) \
             ON CONFLICT (vehicle_id, day) DO UPDATE SET {set_clause}, updated_at = now()",
            vals = placeholders.join(", "),
        );
        let mut q = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
            .bind(self.vehicle_id)
            .bind(chrono::Utc::now().date_naive());
        for col in &cols {
            q = q.bind(*self.counts.get(col).unwrap_or(&0));
        }
        let _ = q.execute(pool).await;
        self.counts.clear();
    }
}

/// Accumulate per-event counters into `batch`. The caller is responsible for
/// flushing `batch` to the DB periodically (every N events) to amortize the
/// cost of the upsert across many messages.
async fn handle_inbound_accounting(
    pool: &PgPool,
    vehicle_id: Uuid,
    config: &Config,
    inbound: &WsInboundEvent,
    batch: &mut CounterBatch,
) {
    if !is_synthetic_control(inbound.message_type.as_deref()) {
        batch.increment("ws_messages_received");
        match inbound.kind {
            WsInboundKind::Control => {
                batch.increment("ws_control_messages_received");
            }
            WsInboundKind::Heartbeat => {
                batch.increment("ws_heartbeats_received");
            }
            WsInboundKind::Telemetry => {
                batch.increment("ws_payload_messages_received");
            }
        }
    }
    match inbound.message_type.as_deref() {
        Some("connection_open") => {
            batch.increment("ws_connections_opened");
            // The account card reflects a successful authenticated Rivian
            // session, rather than only the time credentials were saved.
            crate::services::external_connections::record_attempt(
                pool,
                crate::services::external_connections::RIVIAN_ACCOUNT,
            )
            .await;
            crate::services::external_connections::record_success(
                pool,
                crate::services::external_connections::RIVIAN_ACCOUNT,
            )
            .await;
        }
        Some("reconnect") => batch.increment("ws_reconnects"),
        Some("connection_init" | "subscribe") => {
            batch.increment("outbound_messages_sent");
        }
        _ => {}
    }
    if let Some(update) = runtime_health_update_for_ws_control(inbound) {
        if matches!(
            inbound.message_type.as_deref(),
            Some("ws_handshake_rejected" | "ws_schema_rejected")
        ) {
            crate::services::external_connections::record_failure(
                pool,
                crate::services::external_connections::RIVIAN_ACCOUNT,
                &update.worker_health_msg,
            )
            .await;
        }
        upsert_health(
            pool,
            vehicle_id,
            update.online,
            update.worker_health,
            &update.worker_health_msg,
            Some(update.auth_state),
            update.auth_reason_code,
        )
        .await;
    }
    if config.rivian_persist_raw_events {
        persist_raw_event(pool, batch, vehicle_id, inbound).await;
    }
}

fn is_synthetic_control(message_type: Option<&str>) -> bool {
    matches!(
        message_type,
        Some(
            "connection_open"
                | "connection_init"
                | "subscribe"
                | "reconnect"
                | "ws_handshake_rejected"
                | "ws_schema_rejected"
                | "ws_schema_degraded"
                | "ws_no_active_subscriptions"
        )
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeHealthUpdate {
    online: bool,
    worker_health: &'static str,
    worker_health_msg: String,
    auth_state: &'static str,
    auth_reason_code: Option<&'static str>,
}

fn runtime_health_update_for_ws_control(inbound: &WsInboundEvent) -> Option<RuntimeHealthUpdate> {
    match inbound.message_type.as_deref() {
        Some("connection_open") => Some(RuntimeHealthUpdate {
            online: true,
            worker_health: "connected",
            worker_health_msg: String::new(),
            auth_state: "authorized",
            auth_reason_code: None,
        }),
        Some("ws_handshake_rejected") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "error",
            worker_health_msg: read_ws_detail_message(&inbound.raw)
                .unwrap_or_else(|| "Rivian WS handshake rejected".into()),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_handshake_rejected"),
        }),
        Some("ws_schema_rejected") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "degraded",
            worker_health_msg: read_ws_detail_message(&inbound.raw)
                .unwrap_or_else(|| "Rivian WS VehicleState schema rejected".into()),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_schema_rejected"),
        }),
        Some("ws_schema_degraded") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "degraded",
            worker_health_msg: "Rivian WS subscription degraded to recover from schema drift"
                .into(),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_schema_rejected"),
        }),
        Some("ws_no_active_subscriptions") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "degraded",
            worker_health_msg: read_ws_detail_message(&inbound.raw).unwrap_or_else(|| {
                "Rivian WS reported no active subscriptions; reconnecting".into()
            }),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_no_active_subscriptions"),
        }),
        _ => None,
    }
}

fn read_ws_detail_message(raw: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    value
        .get("reason")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

async fn persist_raw_event(
    pool: &PgPool,
    batch: &mut CounterBatch,
    vehicle_id: Uuid,
    inbound: &WsInboundEvent,
) {
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
        batch.increment("raw_events_persisted");
    }
}

async fn cleanup_raw_events(pool: &PgPool, retention_days: i64) {
    // Use a non-blocking advisory lock (id 0x726d_5241 = "rmRA") so that
    // concurrent workers skip the DELETE rather than pile up on the same rows.
    let got_lock: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(0x726d5241::bigint)")
        .fetch_one(pool)
        .await
        .unwrap_or(false);
    if !got_lock {
        return;
    }

    let _ = sqlx::query(
        "DELETE FROM riviamigo.rivian_ws_raw_events WHERE received_at < now() - ($1::int * INTERVAL '1 day')",
    )
    .bind(retention_days.max(1) as i32)
    .execute(pool)
    .await;

    let _ = sqlx::query(
        "DELETE FROM riviamigo.rivian_parallax_events WHERE received_at < now() - ($1::int * INTERVAL '1 day')",
    )
    .bind(retention_days.max(1) as i32)
    .execute(pool)
    .await;

    // Release the session-level lock immediately so other workers can take it next cycle.
    let _ = sqlx::query("SELECT pg_advisory_unlock(0x726d5241::bigint)")
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
    let _ = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(vehicle_id)
        .execute(pool)
        .await;
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

async fn load_active_charge_snapshot(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Option<ActiveChargeSessionSnapshot> {
    let row = sqlx::query_as::<_, ActiveChargeDetectorRow>(
        r#"
        WITH active_samples AS (
            SELECT
                t.charge_session_id,
                t.ts,
                t.latitude,
                t.longitude,
                t.battery_level,
                t.battery_capacity_wh,
                t.battery_limit,
                t.power_kw,
                LAG(t.ts) OVER (PARTITION BY t.charge_session_id ORDER BY t.ts) AS prev_ts,
                LAG(ABS(t.power_kw)) OVER (PARTITION BY t.charge_session_id ORDER BY t.ts) AS prev_power_kw
            FROM timeseries.telemetry t
            LEFT JOIN riviamigo.charge_sessions cs
              ON cs.id = t.charge_session_id
            WHERE t.vehicle_id = $1
              AND t.charge_session_id IS NOT NULL
              AND cs.id IS NULL
              AND t.ts >= now() - ($2::int * interval '1 hour')
        ),
        candidate_sessions AS (
            SELECT
                charge_session_id AS session_id,
                MIN(ts) AS started_at,
                MAX(ts) AS last_charge_ts,
                MAX(ts) FILTER (WHERE power_kw IS NOT NULL) AS last_power_ts,
                (ARRAY_AGG(latitude ORDER BY ts) FILTER (
                    WHERE latitude IS NOT NULL
                      AND longitude IS NOT NULL
                      AND NOT (latitude = 0 AND longitude = 0)
                ))[1] AS location_lat,
                (ARRAY_AGG(longitude ORDER BY ts) FILTER (
                    WHERE latitude IS NOT NULL
                      AND longitude IS NOT NULL
                      AND NOT (latitude = 0 AND longitude = 0)
                ))[1] AS location_lng,
                (ARRAY_AGG(battery_level ORDER BY ts) FILTER (WHERE battery_level IS NOT NULL))[1] AS soc_start,
                (ARRAY_AGG(battery_level ORDER BY ts DESC) FILTER (WHERE battery_level IS NOT NULL))[1] AS last_soc,
                MAX(battery_limit) AS charge_limit,
                (ARRAY_AGG(battery_capacity_wh ORDER BY ts DESC) FILTER (WHERE battery_capacity_wh IS NOT NULL))[1] AS battery_capacity_wh,
                SUM(
                    CASE
                        WHEN prev_ts IS NULL OR prev_power_kw IS NULL THEN 0
                        WHEN prev_power_kw <= 0 OR prev_power_kw > 300 THEN 0
                        ELSE prev_power_kw * 1000.0 * (EXTRACT(EPOCH FROM (ts - prev_ts)) / 3600.0)
                    END
                ) AS energy_used_wh,
                MAX(ABS(power_kw)) FILTER (WHERE power_kw IS NOT NULL AND ABS(power_kw) <= 300) AS peak_charge_kw
            FROM active_samples
            GROUP BY charge_session_id
        )
        SELECT
            session_id,
            started_at,
            last_charge_ts,
            last_power_ts,
            location_lat,
            location_lng,
            soc_start,
            last_soc,
            charge_limit,
            battery_capacity_wh,
            energy_used_wh,
            peak_charge_kw
        FROM candidate_sessions
        WHERE last_charge_ts >= now() - ($3::int * interval '1 minute')
        ORDER BY last_charge_ts DESC
        LIMIT 1
        "#,
    )
    .bind(vehicle_id)
    .bind(CHARGE_DETECTOR_REHYDRATE_LOOKBACK_HOURS)
    .bind(CHARGE_DETECTOR_REHYDRATE_STALENESS_MINUTES)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;

    Some(ActiveChargeSessionSnapshot {
        session_id: row.session_id,
        started_at: row.started_at,
        location_lat: row.location_lat,
        location_lng: row.location_lng,
        soc_start: row.soc_start,
        last_soc: row.last_soc,
        charge_limit: row.charge_limit,
        battery_capacity_wh: row.battery_capacity_wh,
        last_charge_ts: row.last_charge_ts,
        last_power_ts: row.last_power_ts,
        energy_used_wh: row.energy_used_wh.unwrap_or(0.0),
        peak_charge_kw: row.peak_charge_kw.unwrap_or(0.0),
    })
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
            tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
            door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
            door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
            closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
            closure_tailgate_locked, closure_tailgate_closed,
            ota_current_version, ota_available_version, ota_status, ota_current_status,
            hv_thermal_event, twelve_volt_health, is_online,
            trip_id, charge_session_id,
            charge_port_open, charger_derate_active, cabin_precon_status, cabin_precon_type,
            pet_mode_active, pet_mode_temp_ok, defrost_active, steering_wheel_heat,
            seat_fl_heat, seat_fr_heat, seat_rl_heat, seat_rr_heat,
            seat_fl_vent, seat_fr_vent,
            tonneau_locked, tonneau_closed, side_bin_left_locked, side_bin_right_locked,
            side_bin_left_closed, side_bin_right_closed,
            window_fl_closed, window_fr_closed, window_rl_closed, window_rr_closed,
            gear_guard_locked, gear_guard_video_status,
            wiper_fluid_low, brake_fluid_low, alarm_active, service_mode)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                    $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
                    $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,
                    $61,$62,$63,$64,$65,$66,$67,$68,$69,$70,$71,$72,$73,$74,$75,$76,$77,$78,$79,$80,
                    $81,$82,$83,$84,$85,$86,$87,$88,$89)
            ON CONFLICT (vehicle_id, ts) DO UPDATE
            SET
              latitude                  = COALESCE(EXCLUDED.latitude, timeseries.telemetry.latitude),
              longitude                 = COALESCE(EXCLUDED.longitude, timeseries.telemetry.longitude),
              altitude_m                = COALESCE(EXCLUDED.altitude_m, timeseries.telemetry.altitude_m),
              speed_mph                 = COALESCE(EXCLUDED.speed_mph, timeseries.telemetry.speed_mph),
              battery_level             = COALESCE(EXCLUDED.battery_level, timeseries.telemetry.battery_level),
              battery_capacity_wh       = COALESCE(EXCLUDED.battery_capacity_wh, timeseries.telemetry.battery_capacity_wh),
              distance_to_empty_mi      = COALESCE(EXCLUDED.distance_to_empty_mi, timeseries.telemetry.distance_to_empty_mi),
              battery_limit             = COALESCE(EXCLUDED.battery_limit, timeseries.telemetry.battery_limit),
              power_state               = COALESCE(EXCLUDED.power_state, timeseries.telemetry.power_state),
              charger_state             = COALESCE(EXCLUDED.charger_state, timeseries.telemetry.charger_state),
              charger_status            = COALESCE(EXCLUDED.charger_status, timeseries.telemetry.charger_status),
              time_to_end_of_charge_min = COALESCE(EXCLUDED.time_to_end_of_charge_min, timeseries.telemetry.time_to_end_of_charge_min),
              drive_mode                = CASE
                                           WHEN EXCLUDED.drive_mode IS NOT NULL AND EXCLUDED.drive_mode <> 'unknown' THEN EXCLUDED.drive_mode
                                           ELSE COALESCE(timeseries.telemetry.drive_mode, EXCLUDED.drive_mode)
                                         END,
              gear_status               = COALESCE(EXCLUDED.gear_status, timeseries.telemetry.gear_status),
              cabin_temp_c              = COALESCE(EXCLUDED.cabin_temp_c, timeseries.telemetry.cabin_temp_c),
              driver_temp_c             = COALESCE(EXCLUDED.driver_temp_c, timeseries.telemetry.driver_temp_c),
              outside_temp_c            = COALESCE(EXCLUDED.outside_temp_c, timeseries.telemetry.outside_temp_c),
              hvac_active               = COALESCE(EXCLUDED.hvac_active, timeseries.telemetry.hvac_active),
              power_kw                  = COALESCE(EXCLUDED.power_kw, timeseries.telemetry.power_kw),
              regen_power_kw            = COALESCE(EXCLUDED.regen_power_kw, timeseries.telemetry.regen_power_kw),
              heading_deg               = COALESCE(EXCLUDED.heading_deg, timeseries.telemetry.heading_deg),
              odometer_miles            = COALESCE(EXCLUDED.odometer_miles, timeseries.telemetry.odometer_miles),
              is_online                 = COALESCE(EXCLUDED.is_online, timeseries.telemetry.is_online)"#,
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
        .bind(e.drive_mode.as_ref().map(|d| d.as_str()))
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
        .bind(e.tire_fl_valid)
        .bind(e.tire_fr_valid)
        .bind(e.tire_rl_valid)
        .bind(e.tire_rr_valid)
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
        // Extended fields
        .bind(e.charge_port_open)
        .bind(e.charger_derate_active)
        .bind(&e.cabin_precon_status)
        .bind(&e.cabin_precon_type)
        .bind(e.pet_mode_active)
        .bind(e.pet_mode_temp_ok)
        .bind(e.defrost_active)
        .bind(e.steering_wheel_heat)
        .bind(e.seat_fl_heat)
        .bind(e.seat_fr_heat)
        .bind(e.seat_rl_heat)
        .bind(e.seat_rr_heat)
        .bind(e.seat_fl_vent)
        .bind(e.seat_fr_vent)
        .bind(e.tonneau_locked)
        .bind(e.tonneau_closed)
        .bind(e.side_bin_left_locked)
        .bind(e.side_bin_right_locked)
        .bind(e.side_bin_left_closed)
        .bind(e.side_bin_right_closed)
        .bind(e.window_fl_closed)
        .bind(e.window_fr_closed)
        .bind(e.window_rl_closed)
        .bind(e.window_rr_closed)
        .bind(e.gear_guard_locked)
        .bind(&e.gear_guard_video_status)
        .bind(e.wiper_fluid_low)
        .bind(e.brake_fluid_low)
        .bind(e.alarm_active)
        .bind(e.service_mode)
    .execute(pool)
    .await?;
    Ok(())
}

async fn upsert_latest_status(pool: &PgPool, e: &TelemetryEvent) -> anyhow::Result<()> {
    sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_latest_status (
             vehicle_id, ts, latitude, longitude, altitude_m, speed_mph, location_ts, speed_mph_ts,
             battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
             battery_level_ts, distance_to_empty_mi_ts, battery_limit_ts,
             power_state, power_state_ts,
             charger_state, charger_state_ts, charger_status, charger_status_ts,
             time_to_end_of_charge_min, time_to_end_of_charge_min_ts,
             drive_mode, gear_status, cabin_temp_c, driver_temp_c, outside_temp_c,
             heading_deg, odometer_miles, odometer_miles_ts,
             tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
             tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
             tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
             door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
             door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
             closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
             closure_tailgate_locked, closure_tailgate_closed,
             ota_current_version, ota_available_version, ota_status, ota_current_status,
             hv_thermal_event, twelve_volt_health,
             charge_port_open, charger_derate_active, cabin_precon_status, cabin_precon_type,
             pet_mode_active, pet_mode_temp_ok, defrost_active, steering_wheel_heat,
             seat_fl_heat, seat_fr_heat, seat_rl_heat, seat_rr_heat, seat_fl_vent, seat_fr_vent,
             tonneau_locked, tonneau_closed, side_bin_left_locked, side_bin_right_locked,
             side_bin_left_closed, side_bin_right_closed,
             window_fl_closed, window_fr_closed, window_rl_closed, window_rr_closed,
             gear_guard_locked, gear_guard_video_status, wiper_fluid_low, brake_fluid_low,
             alarm_active, service_mode, updated_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
              $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
              $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
              $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
              $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,
              $51,$52,$53,$54,$55,$56,$57,$58,$59,$60,
              $61,$62,$63,$64,$65,$66,$67,$68,$69,$70,
              $71,$72,$73,$74,$75,$76,$77,$78,$79,$80,
              $81,$82,$83,$84,$85,$86,$87,$88,$89,$90,
              $91,$92,$93,now()
            )
           ON CONFLICT (vehicle_id) DO UPDATE SET
             ts = GREATEST(EXCLUDED.ts, riviamigo.vehicle_latest_status.ts),
             latitude = CASE
                 WHEN EXCLUDED.location_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.location_ts IS NULL OR EXCLUDED.location_ts >= riviamigo.vehicle_latest_status.location_ts)
                 THEN COALESCE(EXCLUDED.latitude, riviamigo.vehicle_latest_status.latitude)
                 ELSE riviamigo.vehicle_latest_status.latitude
             END,
             longitude = CASE
                 WHEN EXCLUDED.location_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.location_ts IS NULL OR EXCLUDED.location_ts >= riviamigo.vehicle_latest_status.location_ts)
                 THEN COALESCE(EXCLUDED.longitude, riviamigo.vehicle_latest_status.longitude)
                 ELSE riviamigo.vehicle_latest_status.longitude
             END,
             altitude_m = COALESCE(EXCLUDED.altitude_m, riviamigo.vehicle_latest_status.altitude_m),
             speed_mph = CASE
                 WHEN EXCLUDED.speed_mph_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.speed_mph_ts IS NULL OR EXCLUDED.speed_mph_ts >= riviamigo.vehicle_latest_status.speed_mph_ts)
                 THEN COALESCE(EXCLUDED.speed_mph, riviamigo.vehicle_latest_status.speed_mph)
                 ELSE riviamigo.vehicle_latest_status.speed_mph
             END,
             location_ts = CASE
                 WHEN EXCLUDED.location_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.location_ts IS NULL OR EXCLUDED.location_ts >= riviamigo.vehicle_latest_status.location_ts)
                 THEN EXCLUDED.location_ts
                 ELSE riviamigo.vehicle_latest_status.location_ts
             END,
             speed_mph_ts = CASE
                 WHEN EXCLUDED.speed_mph_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.speed_mph_ts IS NULL OR EXCLUDED.speed_mph_ts >= riviamigo.vehicle_latest_status.speed_mph_ts)
                 THEN EXCLUDED.speed_mph_ts
                 ELSE riviamigo.vehicle_latest_status.speed_mph_ts
             END,
             battery_level = CASE
                 WHEN EXCLUDED.battery_level_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.battery_level_ts IS NULL OR EXCLUDED.battery_level_ts >= riviamigo.vehicle_latest_status.battery_level_ts)
                 THEN COALESCE(EXCLUDED.battery_level, riviamigo.vehicle_latest_status.battery_level)
                 ELSE riviamigo.vehicle_latest_status.battery_level
             END,
             battery_capacity_wh = COALESCE(EXCLUDED.battery_capacity_wh, riviamigo.vehicle_latest_status.battery_capacity_wh),
             distance_to_empty_mi = CASE
                 WHEN EXCLUDED.distance_to_empty_mi_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.distance_to_empty_mi_ts IS NULL OR EXCLUDED.distance_to_empty_mi_ts >= riviamigo.vehicle_latest_status.distance_to_empty_mi_ts)
                 THEN COALESCE(EXCLUDED.distance_to_empty_mi, riviamigo.vehicle_latest_status.distance_to_empty_mi)
                 ELSE riviamigo.vehicle_latest_status.distance_to_empty_mi
             END,
             battery_limit = CASE
                 WHEN EXCLUDED.battery_limit_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.battery_limit_ts IS NULL OR EXCLUDED.battery_limit_ts >= riviamigo.vehicle_latest_status.battery_limit_ts)
                 THEN COALESCE(EXCLUDED.battery_limit, riviamigo.vehicle_latest_status.battery_limit)
                 ELSE riviamigo.vehicle_latest_status.battery_limit
             END,
             battery_level_ts = CASE
                 WHEN EXCLUDED.battery_level_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.battery_level_ts IS NULL OR EXCLUDED.battery_level_ts >= riviamigo.vehicle_latest_status.battery_level_ts)
                 THEN EXCLUDED.battery_level_ts
                 ELSE riviamigo.vehicle_latest_status.battery_level_ts
             END,
             distance_to_empty_mi_ts = CASE
                 WHEN EXCLUDED.distance_to_empty_mi_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.distance_to_empty_mi_ts IS NULL OR EXCLUDED.distance_to_empty_mi_ts >= riviamigo.vehicle_latest_status.distance_to_empty_mi_ts)
                 THEN EXCLUDED.distance_to_empty_mi_ts
                 ELSE riviamigo.vehicle_latest_status.distance_to_empty_mi_ts
             END,
             battery_limit_ts = CASE
                 WHEN EXCLUDED.battery_limit_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.battery_limit_ts IS NULL OR EXCLUDED.battery_limit_ts >= riviamigo.vehicle_latest_status.battery_limit_ts)
                 THEN EXCLUDED.battery_limit_ts
                 ELSE riviamigo.vehicle_latest_status.battery_limit_ts
             END,
             power_state = CASE
                 WHEN EXCLUDED.power_state_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.power_state_ts IS NULL OR EXCLUDED.power_state_ts >= riviamigo.vehicle_latest_status.power_state_ts)
                 THEN COALESCE(EXCLUDED.power_state, riviamigo.vehicle_latest_status.power_state)
                 ELSE riviamigo.vehicle_latest_status.power_state
             END,
             power_state_ts = CASE
                 WHEN EXCLUDED.power_state_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.power_state_ts IS NULL OR EXCLUDED.power_state_ts >= riviamigo.vehicle_latest_status.power_state_ts)
                 THEN EXCLUDED.power_state_ts
                 ELSE riviamigo.vehicle_latest_status.power_state_ts
             END,
             charger_state = CASE
                 WHEN EXCLUDED.charger_state_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.charger_state_ts IS NULL OR EXCLUDED.charger_state_ts >= riviamigo.vehicle_latest_status.charger_state_ts)
                 THEN COALESCE(EXCLUDED.charger_state, riviamigo.vehicle_latest_status.charger_state)
                 ELSE riviamigo.vehicle_latest_status.charger_state
             END,
             charger_state_ts = CASE
                 WHEN EXCLUDED.charger_state_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.charger_state_ts IS NULL OR EXCLUDED.charger_state_ts >= riviamigo.vehicle_latest_status.charger_state_ts)
                 THEN EXCLUDED.charger_state_ts
                 ELSE riviamigo.vehicle_latest_status.charger_state_ts
             END,
             charger_status = CASE
                 WHEN EXCLUDED.charger_status_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.charger_status_ts IS NULL OR EXCLUDED.charger_status_ts >= riviamigo.vehicle_latest_status.charger_status_ts)
                 THEN COALESCE(EXCLUDED.charger_status, riviamigo.vehicle_latest_status.charger_status)
                 ELSE riviamigo.vehicle_latest_status.charger_status
             END,
             charger_status_ts = CASE
                 WHEN EXCLUDED.charger_status_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.charger_status_ts IS NULL OR EXCLUDED.charger_status_ts >= riviamigo.vehicle_latest_status.charger_status_ts)
                 THEN EXCLUDED.charger_status_ts
                 ELSE riviamigo.vehicle_latest_status.charger_status_ts
             END,
             time_to_end_of_charge_min = CASE
                 WHEN EXCLUDED.time_to_end_of_charge_min_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.time_to_end_of_charge_min_ts IS NULL OR EXCLUDED.time_to_end_of_charge_min_ts >= riviamigo.vehicle_latest_status.time_to_end_of_charge_min_ts)
                 THEN COALESCE(EXCLUDED.time_to_end_of_charge_min, riviamigo.vehicle_latest_status.time_to_end_of_charge_min)
                 ELSE riviamigo.vehicle_latest_status.time_to_end_of_charge_min
             END,
             time_to_end_of_charge_min_ts = CASE
                 WHEN EXCLUDED.time_to_end_of_charge_min_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.time_to_end_of_charge_min_ts IS NULL OR EXCLUDED.time_to_end_of_charge_min_ts >= riviamigo.vehicle_latest_status.time_to_end_of_charge_min_ts)
                 THEN EXCLUDED.time_to_end_of_charge_min_ts
                 ELSE riviamigo.vehicle_latest_status.time_to_end_of_charge_min_ts
             END,
             drive_mode = COALESCE(NULLIF(EXCLUDED.drive_mode, 'unknown'), riviamigo.vehicle_latest_status.drive_mode),
             gear_status = COALESCE(EXCLUDED.gear_status, riviamigo.vehicle_latest_status.gear_status),
             cabin_temp_c = COALESCE(EXCLUDED.cabin_temp_c, riviamigo.vehicle_latest_status.cabin_temp_c),
             driver_temp_c = COALESCE(EXCLUDED.driver_temp_c, riviamigo.vehicle_latest_status.driver_temp_c),
             outside_temp_c = COALESCE(EXCLUDED.outside_temp_c, riviamigo.vehicle_latest_status.outside_temp_c),
             heading_deg = COALESCE(EXCLUDED.heading_deg, riviamigo.vehicle_latest_status.heading_deg),
             odometer_miles = CASE
                 WHEN EXCLUDED.odometer_miles_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.odometer_miles_ts IS NULL OR EXCLUDED.odometer_miles_ts >= riviamigo.vehicle_latest_status.odometer_miles_ts)
                 THEN COALESCE(EXCLUDED.odometer_miles, riviamigo.vehicle_latest_status.odometer_miles)
                 ELSE riviamigo.vehicle_latest_status.odometer_miles
             END,
             odometer_miles_ts = CASE
                 WHEN EXCLUDED.odometer_miles_ts IS NOT NULL
                  AND (riviamigo.vehicle_latest_status.odometer_miles_ts IS NULL OR EXCLUDED.odometer_miles_ts >= riviamigo.vehicle_latest_status.odometer_miles_ts)
                 THEN EXCLUDED.odometer_miles_ts
                 ELSE riviamigo.vehicle_latest_status.odometer_miles_ts
             END,
             tire_fl_psi = COALESCE(EXCLUDED.tire_fl_psi, riviamigo.vehicle_latest_status.tire_fl_psi),
             tire_fr_psi = COALESCE(EXCLUDED.tire_fr_psi, riviamigo.vehicle_latest_status.tire_fr_psi),
             tire_rl_psi = COALESCE(EXCLUDED.tire_rl_psi, riviamigo.vehicle_latest_status.tire_rl_psi),
             tire_rr_psi = COALESCE(EXCLUDED.tire_rr_psi, riviamigo.vehicle_latest_status.tire_rr_psi),
             tire_fl_status = COALESCE(EXCLUDED.tire_fl_status, riviamigo.vehicle_latest_status.tire_fl_status),
             tire_fr_status = COALESCE(EXCLUDED.tire_fr_status, riviamigo.vehicle_latest_status.tire_fr_status),
             tire_rl_status = COALESCE(EXCLUDED.tire_rl_status, riviamigo.vehicle_latest_status.tire_rl_status),
             tire_rr_status = COALESCE(EXCLUDED.tire_rr_status, riviamigo.vehicle_latest_status.tire_rr_status),
             tire_fl_valid = COALESCE(EXCLUDED.tire_fl_valid, riviamigo.vehicle_latest_status.tire_fl_valid),
             tire_fr_valid = COALESCE(EXCLUDED.tire_fr_valid, riviamigo.vehicle_latest_status.tire_fr_valid),
             tire_rl_valid = COALESCE(EXCLUDED.tire_rl_valid, riviamigo.vehicle_latest_status.tire_rl_valid),
             tire_rr_valid = COALESCE(EXCLUDED.tire_rr_valid, riviamigo.vehicle_latest_status.tire_rr_valid),
             door_front_left_locked = COALESCE(EXCLUDED.door_front_left_locked, riviamigo.vehicle_latest_status.door_front_left_locked),
             door_front_right_locked = COALESCE(EXCLUDED.door_front_right_locked, riviamigo.vehicle_latest_status.door_front_right_locked),
             door_rear_left_locked = COALESCE(EXCLUDED.door_rear_left_locked, riviamigo.vehicle_latest_status.door_rear_left_locked),
             door_rear_right_locked = COALESCE(EXCLUDED.door_rear_right_locked, riviamigo.vehicle_latest_status.door_rear_right_locked),
             door_front_left_closed = COALESCE(EXCLUDED.door_front_left_closed, riviamigo.vehicle_latest_status.door_front_left_closed),
             door_front_right_closed = COALESCE(EXCLUDED.door_front_right_closed, riviamigo.vehicle_latest_status.door_front_right_closed),
             door_rear_left_closed = COALESCE(EXCLUDED.door_rear_left_closed, riviamigo.vehicle_latest_status.door_rear_left_closed),
             door_rear_right_closed = COALESCE(EXCLUDED.door_rear_right_closed, riviamigo.vehicle_latest_status.door_rear_right_closed),
             closure_frunk_locked = COALESCE(EXCLUDED.closure_frunk_locked, riviamigo.vehicle_latest_status.closure_frunk_locked),
             closure_frunk_closed = COALESCE(EXCLUDED.closure_frunk_closed, riviamigo.vehicle_latest_status.closure_frunk_closed),
             closure_liftgate_locked = COALESCE(EXCLUDED.closure_liftgate_locked, riviamigo.vehicle_latest_status.closure_liftgate_locked),
             closure_liftgate_closed = COALESCE(EXCLUDED.closure_liftgate_closed, riviamigo.vehicle_latest_status.closure_liftgate_closed),
             closure_tailgate_locked = COALESCE(EXCLUDED.closure_tailgate_locked, riviamigo.vehicle_latest_status.closure_tailgate_locked),
             closure_tailgate_closed = COALESCE(EXCLUDED.closure_tailgate_closed, riviamigo.vehicle_latest_status.closure_tailgate_closed),
             ota_current_version = COALESCE(EXCLUDED.ota_current_version, riviamigo.vehicle_latest_status.ota_current_version),
             ota_available_version = COALESCE(EXCLUDED.ota_available_version, riviamigo.vehicle_latest_status.ota_available_version),
             ota_status = COALESCE(EXCLUDED.ota_status, riviamigo.vehicle_latest_status.ota_status),
             ota_current_status = COALESCE(EXCLUDED.ota_current_status, riviamigo.vehicle_latest_status.ota_current_status),
             hv_thermal_event = COALESCE(EXCLUDED.hv_thermal_event, riviamigo.vehicle_latest_status.hv_thermal_event),
             twelve_volt_health = COALESCE(EXCLUDED.twelve_volt_health, riviamigo.vehicle_latest_status.twelve_volt_health),
             charge_port_open = COALESCE(EXCLUDED.charge_port_open, riviamigo.vehicle_latest_status.charge_port_open),
             charger_derate_active = COALESCE(EXCLUDED.charger_derate_active, riviamigo.vehicle_latest_status.charger_derate_active),
             cabin_precon_status = COALESCE(EXCLUDED.cabin_precon_status, riviamigo.vehicle_latest_status.cabin_precon_status),
             cabin_precon_type = COALESCE(EXCLUDED.cabin_precon_type, riviamigo.vehicle_latest_status.cabin_precon_type),
             pet_mode_active = COALESCE(EXCLUDED.pet_mode_active, riviamigo.vehicle_latest_status.pet_mode_active),
             pet_mode_temp_ok = COALESCE(EXCLUDED.pet_mode_temp_ok, riviamigo.vehicle_latest_status.pet_mode_temp_ok),
             defrost_active = COALESCE(EXCLUDED.defrost_active, riviamigo.vehicle_latest_status.defrost_active),
             steering_wheel_heat = COALESCE(EXCLUDED.steering_wheel_heat, riviamigo.vehicle_latest_status.steering_wheel_heat),
             seat_fl_heat = COALESCE(EXCLUDED.seat_fl_heat, riviamigo.vehicle_latest_status.seat_fl_heat),
             seat_fr_heat = COALESCE(EXCLUDED.seat_fr_heat, riviamigo.vehicle_latest_status.seat_fr_heat),
             seat_rl_heat = COALESCE(EXCLUDED.seat_rl_heat, riviamigo.vehicle_latest_status.seat_rl_heat),
             seat_rr_heat = COALESCE(EXCLUDED.seat_rr_heat, riviamigo.vehicle_latest_status.seat_rr_heat),
             seat_fl_vent = COALESCE(EXCLUDED.seat_fl_vent, riviamigo.vehicle_latest_status.seat_fl_vent),
             seat_fr_vent = COALESCE(EXCLUDED.seat_fr_vent, riviamigo.vehicle_latest_status.seat_fr_vent),
             tonneau_locked = COALESCE(EXCLUDED.tonneau_locked, riviamigo.vehicle_latest_status.tonneau_locked),
             tonneau_closed = COALESCE(EXCLUDED.tonneau_closed, riviamigo.vehicle_latest_status.tonneau_closed),
             side_bin_left_locked = COALESCE(EXCLUDED.side_bin_left_locked, riviamigo.vehicle_latest_status.side_bin_left_locked),
             side_bin_right_locked = COALESCE(EXCLUDED.side_bin_right_locked, riviamigo.vehicle_latest_status.side_bin_right_locked),
             side_bin_left_closed = COALESCE(EXCLUDED.side_bin_left_closed, riviamigo.vehicle_latest_status.side_bin_left_closed),
             side_bin_right_closed = COALESCE(EXCLUDED.side_bin_right_closed, riviamigo.vehicle_latest_status.side_bin_right_closed),
             window_fl_closed = COALESCE(EXCLUDED.window_fl_closed, riviamigo.vehicle_latest_status.window_fl_closed),
             window_fr_closed = COALESCE(EXCLUDED.window_fr_closed, riviamigo.vehicle_latest_status.window_fr_closed),
             window_rl_closed = COALESCE(EXCLUDED.window_rl_closed, riviamigo.vehicle_latest_status.window_rl_closed),
             window_rr_closed = COALESCE(EXCLUDED.window_rr_closed, riviamigo.vehicle_latest_status.window_rr_closed),
             gear_guard_locked = COALESCE(EXCLUDED.gear_guard_locked, riviamigo.vehicle_latest_status.gear_guard_locked),
             gear_guard_video_status = COALESCE(EXCLUDED.gear_guard_video_status, riviamigo.vehicle_latest_status.gear_guard_video_status),
             wiper_fluid_low = COALESCE(EXCLUDED.wiper_fluid_low, riviamigo.vehicle_latest_status.wiper_fluid_low),
             brake_fluid_low = COALESCE(EXCLUDED.brake_fluid_low, riviamigo.vehicle_latest_status.brake_fluid_low),
             alarm_active = COALESCE(EXCLUDED.alarm_active, riviamigo.vehicle_latest_status.alarm_active),
             service_mode = COALESCE(EXCLUDED.service_mode, riviamigo.vehicle_latest_status.service_mode),
             updated_at = now()"#,
    )
    .bind(e.vehicle_id)
    .bind(e.ts)
    .bind(e.latitude)
    .bind(e.longitude)
    .bind(e.altitude_m)
    .bind(e.speed_mph)
    .bind(e.location_ts)
    .bind(e.speed_mph_ts)
    .bind(e.battery_level)
    .bind(e.battery_capacity_wh)
    .bind(e.distance_to_empty_mi)
    .bind(e.battery_limit)
    .bind(e.battery_level_ts)
    .bind(e.distance_to_empty_mi_ts)
    .bind(e.battery_limit_ts)
    .bind(e.power_state.as_ref().map(|p| format!("{p:?}").to_lowercase()))
    .bind(e.power_state_ts)
    .bind(e.charger_state.as_ref().map(|c| format!("{c:?}").to_lowercase()))
    .bind(e.charger_state_ts)
    .bind(&e.charger_status)
    .bind(e.charger_status_ts)
    .bind(e.time_to_end_of_charge_min)
    .bind(e.time_to_end_of_charge_min_ts)
    .bind(e.drive_mode.as_ref().map(|d| d.as_str()))
    .bind(&e.gear_status)
    .bind(e.cabin_temp_c)
    .bind(e.driver_temp_c)
    .bind(e.outside_temp_c)
    .bind(e.heading_deg)
    .bind(e.odometer_miles)
    .bind(e.odometer_miles_ts)
    .bind(e.tire_fl_psi)
    .bind(e.tire_fr_psi)
    .bind(e.tire_rl_psi)
    .bind(e.tire_rr_psi)
    .bind(&e.tire_fl_status)
    .bind(&e.tire_fr_status)
    .bind(&e.tire_rl_status)
    .bind(&e.tire_rr_status)
    .bind(e.tire_fl_valid)
    .bind(e.tire_fr_valid)
    .bind(e.tire_rl_valid)
    .bind(e.tire_rr_valid)
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
    .bind(e.charge_port_open)
    .bind(e.charger_derate_active)
    .bind(&e.cabin_precon_status)
    .bind(&e.cabin_precon_type)
    .bind(e.pet_mode_active)
    .bind(e.pet_mode_temp_ok)
    .bind(e.defrost_active)
    .bind(e.steering_wheel_heat)
    .bind(e.seat_fl_heat)
    .bind(e.seat_fr_heat)
    .bind(e.seat_rl_heat)
    .bind(e.seat_rr_heat)
    .bind(e.seat_fl_vent)
    .bind(e.seat_fr_vent)
    .bind(e.tonneau_locked)
    .bind(e.tonneau_closed)
    .bind(e.side_bin_left_locked)
    .bind(e.side_bin_right_locked)
    .bind(e.side_bin_left_closed)
    .bind(e.side_bin_right_closed)
    .bind(e.window_fl_closed)
    .bind(e.window_fr_closed)
    .bind(e.window_rl_closed)
    .bind(e.window_rr_closed)
    .bind(e.gear_guard_locked)
    .bind(&e.gear_guard_video_status)
    .bind(e.wiper_fluid_low)
    .bind(e.brake_fluid_low)
    .bind(e.alarm_active)
    .bind(e.service_mode)
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
    set_opt!("battery_level_ts", e.battery_level_ts);
    set_opt!(
        "battery_capacity_kwh",
        e.battery_capacity_wh.map(|wh| wh / 1000.0)
    );
    set_opt!("distance_to_empty_mi", e.distance_to_empty_mi);
    set_opt!("range_miles_ts", e.distance_to_empty_mi_ts);
    set_opt!("battery_limit", e.battery_limit);
    set_opt!("battery_limit_ts", e.battery_limit_ts);
    set_opt!(
        "power_state",
        e.power_state
            .as_ref()
            .map(|p| format!("{p:?}").to_lowercase())
    );
    set_opt!("power_state_ts", e.power_state_ts);
    set_opt!(
        "charger_state",
        e.charger_state
            .as_ref()
            .map(|c| format!("{c:?}").to_lowercase())
    );
    set_opt!("charger_state_ts", e.charger_state_ts);
    set_opt!("charger_status", e.charger_status.as_deref());
    set_opt!("charger_status_ts", e.charger_status_ts);
    set_opt!("time_to_end_of_charge_min", e.time_to_end_of_charge_min);
    set_opt!(
        "time_to_end_of_charge_min_ts",
        e.time_to_end_of_charge_min_ts
    );
    set_opt!("speed_mph", e.speed_mph);
    set_opt!("speed_mph_ts", e.speed_mph_ts);
    set_opt!("altitude_m", e.altitude_m);
    set_opt!("heading_deg", e.heading_deg);
    set_opt!("odometer_miles", e.odometer_miles);
    set_opt!("odometer_miles_ts", e.odometer_miles_ts);
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
    set_opt!("tire_fl_valid", e.tire_fl_valid);
    set_opt!("tire_fr_valid", e.tire_fr_valid);
    set_opt!("tire_rl_valid", e.tire_rl_valid);
    set_opt!("tire_rr_valid", e.tire_rr_valid);
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

    // Extended vehicle state fields
    set_opt!("charge_port_open", e.charge_port_open);
    set_opt!("charger_derate_active", e.charger_derate_active);
    set_opt!("cabin_precon_status", e.cabin_precon_status.as_deref());
    set_opt!("cabin_precon_type", e.cabin_precon_type.as_deref());
    set_opt!("pet_mode_active", e.pet_mode_active);
    set_opt!("pet_mode_temp_ok", e.pet_mode_temp_ok);
    set_opt!("defrost_active", e.defrost_active);
    set_opt!("steering_wheel_heat", e.steering_wheel_heat);
    set_opt!("seat_fl_heat", e.seat_fl_heat);
    set_opt!("seat_fr_heat", e.seat_fr_heat);
    set_opt!("seat_rl_heat", e.seat_rl_heat);
    set_opt!("seat_rr_heat", e.seat_rr_heat);
    set_opt!("seat_fl_vent", e.seat_fl_vent);
    set_opt!("seat_fr_vent", e.seat_fr_vent);
    set_opt!("tonneau_locked", e.tonneau_locked);
    set_opt!("tonneau_closed", e.tonneau_closed);
    set_opt!("side_bin_left_locked", e.side_bin_left_locked);
    set_opt!("side_bin_right_locked", e.side_bin_right_locked);
    set_opt!("side_bin_left_closed", e.side_bin_left_closed);
    set_opt!("side_bin_right_closed", e.side_bin_right_closed);
    set_opt!("window_fl_closed", e.window_fl_closed);
    set_opt!("window_fr_closed", e.window_fr_closed);
    set_opt!("window_rl_closed", e.window_rl_closed);
    set_opt!("window_rr_closed", e.window_rr_closed);
    set_opt!("gear_guard_locked", e.gear_guard_locked);
    set_opt!(
        "gear_guard_video_status",
        e.gear_guard_video_status.as_deref()
    );
    set_opt!("wiper_fluid_low", e.wiper_fluid_low);
    set_opt!("brake_fluid_low", e.brake_fluid_low);
    set_opt!("alarm_active", e.alarm_active);
    set_opt!("service_mode", e.service_mode);

    // Location composite — only when both coordinates are present.
    if let Some((lat, lng)) = e.latitude.zip(e.longitude) {
        data.insert("location".into(), json!({ "lat": lat, "lng": lng }));
    }
    set_opt!("location_ts", e.location_ts);

    // is_online is always emitted; it defaults to true when Rivian hasn't
    // included a cloudConnection field in this particular event.
    data.insert("is_online".into(), json!(e.is_online.unwrap_or(true)));

    json!({ "type": "status", "ts": e.ts, "data": Value::Object(data) }).to_string()
}

#[cfg(test)]
mod snapshot_tests {
    use super::build_snapshot;
    use crate::models::telemetry::{ChargerState, TelemetryEvent};
    use chrono::{TimeZone, Utc};
    use serde_json::Value;
    use uuid::Uuid;

    fn event_with_partial_fields() -> TelemetryEvent {
        TelemetryEvent {
            battery_level: Some(79.0),
            battery_level_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap()),
            battery_capacity_wh: Some(135_000.0),
            battery_limit: Some(70.0),
            battery_limit_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 12, 1, 0).unwrap()),
            charger_state: Some(ChargerState::Disconnected),
            charger_state_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 12, 2, 0).unwrap()),
            tire_fl_psi: Some(36.5),
            ..TelemetryEvent::empty(Uuid::new_v4(), Utc::now())
        }
    }

    #[test]
    fn build_snapshot_omits_absent_partial_fields_instead_of_emitting_nulls() {
        let payload: Value =
            serde_json::from_str(&build_snapshot(&event_with_partial_fields())).unwrap();
        let data = payload["data"].as_object().unwrap();

        assert_eq!(data.get("battery_level").unwrap(), 79.0);
        assert_eq!(
            data.get("battery_level_ts").and_then(Value::as_str),
            Some("2026-06-19T12:00:00Z")
        );
        assert_eq!(data.get("battery_capacity_kwh").unwrap(), 135.0);
        assert_eq!(data.get("battery_limit").unwrap(), 70.0);
        assert_eq!(
            data.get("battery_limit_ts").and_then(Value::as_str),
            Some("2026-06-19T12:01:00Z")
        );
        assert_eq!(data.get("charger_state").unwrap(), "disconnected");
        assert_eq!(
            data.get("charger_state_ts").and_then(Value::as_str),
            Some("2026-06-19T12:02:00Z")
        );
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

    let owner_id = get_vehicle_owner_id(pool, trip.vehicle_id).await?;
    let start_match = match (owner_id, start) {
        (Some(user_id), Some(point)) => {
            resolve_trip_location(pool, http_client, user_id, point.lat, point.lng).await?
        }
        _ => MatchedLocation::none(),
    };
    let end_match = match (owner_id, end) {
        (Some(user_id), Some(point)) => {
            resolve_trip_location(pool, http_client, user_id, point.lat, point.lng).await?
        }
        _ => MatchedLocation::none(),
    };

    let route_points = trip
        .points
        .iter()
        .map(|point| (point.lat, point.lng))
        .collect::<Vec<_>>();
    let route_preview = serde_json::to_value(build_route_preview(&route_points))?;

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
            inside_temp_avg_c, outside_temp_c, regen_wh, energy_wh, energy_strategy,
            route_preview, route_preview_version)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,1)"#,
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
        .bind(Option::<f64>::None)
        .bind(trip.regen_wh)
        .bind(energy_wh)
        .bind(energy_strategy.as_deref())
        .bind(route_preview)
        .execute(pool)
        .await?;

    weather_enrichment::enqueue(pool, trip.trip_id).await?;

    if let Some(user_id) = owner_id {
        sqlx::query(
            r#"INSERT INTO riviamigo.trip_user_annotations
               (trip_id, user_id, start_geofence_id, end_geofence_id, start_address_id, end_address_id, matched_at)
               VALUES ($1, $2, $3, $4, $5, $6, now())
               ON CONFLICT (trip_id, user_id) DO UPDATE
               SET start_geofence_id = EXCLUDED.start_geofence_id,
                   end_geofence_id = EXCLUDED.end_geofence_id,
                   start_address_id = EXCLUDED.start_address_id,
                   end_address_id = EXCLUDED.end_address_id,
                   matched_at = now(),
                   updated_at = now()"#,
        )
        .bind(trip.trip_id)
        .bind(user_id)
        .bind(start_match.geofence_id)
        .bind(end_match.geofence_id)
        .bind(start_match.address_id)
        .bind(end_match.address_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn persist_charge_session(
    pool: &PgPool,
    session: &crate::ingestion::charge_detector::CompletedChargeSession,
) -> anyhow::Result<()> {
    let duration_minutes = ((session.ended_at - session.started_at).num_seconds() / 60) as i32;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    let owner_id = get_vehicle_owner_id(pool, session.vehicle_id).await?;
    let location_match = match (owner_id, session.location_lat, session.location_lng) {
        (Some(user_id), Some(lat), Some(lon)) => {
            resolve_trip_location(pool, &http_client, user_id, lat, lon).await?
        }
        _ => MatchedLocation::none(),
    };
    let energy_added_kwh = session.energy_added_wh.map(|wh| wh / 1000.0);

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
            charger_type, source, data_confidence)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'telemetry','telemetry')"#,
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
    .bind(Option::<f64>::None)
    .bind(session.energy_added_wh)
    .bind(session.energy_used_wh)
    .bind(session.avg_charge_rate_kw)
    .bind(session.peak_charge_kw)
    .bind(location_match.geofence_id)
    .bind(location_match.address_id)
    .bind(Option::<Uuid>::None)
    .bind(Option::<&str>::None)
    .bind(session.charger_type.as_deref())
    .execute(pool)
    .await?;

    if let Some(user_id) = owner_id {
        sqlx::query(
            r#"INSERT INTO riviamigo.charge_session_user_annotations
               (charge_session_id, user_id, geofence_id, address_id, is_home, computed_at)
               VALUES ($1, $2, $3, $4, $5, now())
               ON CONFLICT (charge_session_id, user_id) DO UPDATE
               SET geofence_id = EXCLUDED.geofence_id,
                   address_id = EXCLUDED.address_id,
                   is_home = EXCLUDED.is_home,
                   computed_at = now(),
                   updated_at = now()"#,
        )
        .bind(session.session_id)
        .bind(user_id)
        .bind(location_match.geofence_id)
        .bind(location_match.address_id)
        .bind(location_match.is_home)
        .execute(pool)
        .await?;
    }

    let _ = recompute_charge_session_cost(pool, session.session_id).await?;
    Ok(())
}

#[allow(dead_code)]
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
#[allow(dead_code)]
async fn reverse_geocode_and_store(pool: &PgPool, lat: f64, lon: f64) -> Option<Uuid> {
    let slot = crate::services::nominatim::acquire_slot(
        crate::services::nominatim::NominatimLane::BackgroundReverseGeocode,
    )
    .await;

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
            crate::services::nominatim::report_outcome(None, None).await;
            tracing::warn!(error=%e, lat=%lat, lon=%lon, "worker.reverse_geocode_request_failed");
            return None;
        }
    };

    let status = resp.status();
    let retry_after = crate::services::nominatim::retry_after_from_headers(resp.headers());
    crate::services::nominatim::report_outcome(Some(status.as_u16()), retry_after).await;

    if !status.is_success() {
        tracing::warn!(
            status=%status,
            lat=%lat,
            lon=%lon,
            lane=?slot.lane,
            queued_ms=slot.queued_ms,
            gate_wait_ms=slot.gate_wait_ms,
            scheduled_interval_ms=slot.effective_interval_ms,
            retry_after_s = retry_after.map(|duration| duration.as_secs()),
            "worker.reverse_geocode_http_error"
        );
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
    if let Some(ChargerState::Charging) = &e.charger_state {
        return VehicleState::Charging;
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
    let current_open = sqlx::query_scalar::<_, Option<String>>(
        r#"SELECT version
           FROM riviamigo.software_versions
           WHERE vehicle_id = $1 AND observed_until IS NULL
           ORDER BY installed_at DESC
           LIMIT 1"#,
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if current_open.as_ref().and_then(|v| v.as_deref()) == Some(version) {
        return;
    }

    if current_open.is_some() {
        let _ = sqlx::query(
            r#"UPDATE riviamigo.software_versions
               SET observed_until = $1
               WHERE vehicle_id = $2 AND observed_until IS NULL"#,
        )
        .bind(installed_at)
        .bind(vehicle_id)
        .execute(pool)
        .await;
    }

    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.software_versions (vehicle_id, version, installed_at)
           VALUES ($1, $2, $3)"#,
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

async fn upsert_health(
    pool: &PgPool,
    vehicle_id: Uuid,
    online: bool,
    health: &str,
    msg: &str,
    auth_state: Option<&str>,
    auth_reason_code: Option<&str>,
) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, is_online, worker_health, worker_health_msg, auth_state, auth_reason_code, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET is_online=$2,
               worker_health=$3,
               worker_health_msg=$4,
               auth_state=COALESCE($5, riviamigo.vehicle_runtime_state.auth_state),
               auth_reason_code=CASE
                   WHEN $5 IS NULL AND $6 IS NULL THEN riviamigo.vehicle_runtime_state.auth_reason_code
                   ELSE $6
               END,
               updated_at=now()"#,
    )
    .bind(vehicle_id)
    .bind(online)
    .bind(health)
    .bind(msg)
    .bind(auth_state)
    .bind(auth_reason_code)
    .execute(pool)
    .await;
}

async fn upsert_seen(
    pool: &PgPool,
    vehicle_id: Uuid,
    online: bool,
    ts: DateTime<Utc>,
    received_at: DateTime<Utc>,
    kind: SeenKind,
) {
    let (payload_at, heartbeat_at, payload_received_at, heartbeat_received_at) = match kind {
        SeenKind::Payload => (Some(ts), None, Some(received_at), None),
        SeenKind::Heartbeat => (None, Some(ts), None, Some(received_at)),
    };
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, is_online, last_event_at, last_seen_at, last_payload_at, last_heartbeat_at,
            last_ws_received_at, last_ws_payload_received_at, last_ws_heartbeat_received_at, updated_at)
           VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET is_online=$2,
               last_event_at=$3,
               last_seen_at=$3,
               last_payload_at=COALESCE($4, riviamigo.vehicle_runtime_state.last_payload_at),
               last_heartbeat_at=COALESCE($5, riviamigo.vehicle_runtime_state.last_heartbeat_at),
               last_ws_received_at=$6,
               last_ws_payload_received_at=COALESCE($7, riviamigo.vehicle_runtime_state.last_ws_payload_received_at),
               last_ws_heartbeat_received_at=COALESCE($8, riviamigo.vehicle_runtime_state.last_ws_heartbeat_received_at),
               updated_at=now()"#,
    )
    .bind(vehicle_id)
    .bind(online)
    .bind(ts)
    .bind(payload_at)
    .bind(heartbeat_at)
    .bind(received_at)
    .bind(payload_received_at)
    .bind(heartbeat_received_at)
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

    #[test]
    fn ws_schema_rejection_keeps_auth_state_authorized() {
        let inbound = WsInboundEvent {
            kind: WsInboundKind::Control,
            received_at: Utc::now(),
            raw: serde_json::json!({
                "type": "ws_schema_rejected",
                "reason": "Cannot query field \"vehiclePowerOutput\" on type \"VehicleState\".",
            })
            .to_string(),
            message_type: Some("ws_schema_rejected".into()),
            telemetry: None,
        };

        let update = runtime_health_update_for_ws_control(&inbound).expect("update");
        assert_eq!(update.worker_health, "degraded");
        assert_eq!(update.auth_state, "authorized");
        assert_eq!(update.auth_reason_code, Some("rivian_ws_schema_rejected"));
        assert!(update.worker_health_msg.contains("vehiclePowerOutput"));
    }

    #[test]
    fn ws_no_active_subscriptions_is_degraded_not_auth_failure() {
        let inbound = WsInboundEvent {
            kind: WsInboundKind::Control,
            received_at: Utc::now(),
            raw: serde_json::json!({
                "type": "ws_no_active_subscriptions",
                "reason": "Socket with no active subscriptions, disconnecting",
            })
            .to_string(),
            message_type: Some("ws_no_active_subscriptions".into()),
            telemetry: None,
        };

        let update = runtime_health_update_for_ws_control(&inbound).expect("update");
        assert_eq!(update.worker_health, "degraded");
        assert_eq!(update.auth_state, "authorized");
        assert_eq!(
            update.auth_reason_code,
            Some("rivian_ws_no_active_subscriptions")
        );
    }
}
