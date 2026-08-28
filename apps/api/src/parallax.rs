//! Default, isolated in-process Parallax telemetry companion.
//!
//! This module deliberately does not call or modify the canonical
//! `ingestion::ws_client` flow. It opens its own allowlisted subscription and
//! persists only typed, privacy-filtered values.

use std::{collections::BTreeMap, time::Duration};

use age::x25519::Identity;
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, TimeZone, Utc};
use futures::{SinkExt, StreamExt};
use prost::Message as ProstMessage;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::{
    sync::{broadcast, watch},
    task::JoinHandle,
};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use uuid::Uuid;

use crate::ingestion::session_store::{decrypt_tokens, RivianTokenBundle};

const WS_URL: &str = "wss://api.rivian.com/gql-consumer-subscriptions/graphql";
const SUBSCRIPTION_ID: &str = "riviamigo-parallax-collector";
const SCHEMA_VERSION: i32 = 1;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const TOPICS: &[&str] = &[
    "vehicle.network.state",
    "dynamics.vehicle.efficiency",
    "dynamics.vehicle.mass_estimate",
    "dynamics.vehicle.drive_mode",
    "energy_edge_compute.graphs.parked_energy_distributions",
    "energy_edge_compute.graphs.charge_session_breakdown",
    "energy.high_voltage.battery_state",
    "energy_edge_compute.graphs.charging_graph_global",
    "charging.session.time_estimation",
    "charging.session.status",
    "energy_edge_compute.graphs.cold_weather_soc",
];

/// The subscription allowlist is public for contract/fixture tests.  Keeping
/// it in one place prevents a newly enabled topic from bypassing decoder
/// review and accidentally becoming a raw-payload write path.
pub fn charging_topics() -> &'static [&'static str] {
    TOPICS
}

/// Start the isolated Parallax companion for one vehicle.  The returned task
/// owns its socket and reconnect loop; it never receives the canonical
/// telemetry channel, so backpressure or schema failures cannot delay it.
/// `active_sessions` is deliberately a watch channel: only the latest
/// canonical lifecycle context is relevant to enrichment consumers.
pub fn spawn_in_process(
    pool: PgPool,
    vehicle_id: Uuid,
    rivian_vehicle_id: String,
    age_key: String,
    mut active_sessions: watch::Receiver<crate::ingestion::worker::ActiveSessionContext>,
    mut shutdown: broadcast::Receiver<()>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let owner_id = Uuid::new_v4();
        loop {
            match acquire_in_process_lease(&pool, vehicle_id, owner_id).await {
                Ok(true) => break,
                Ok(false) => {
                    tracing::warn!(vehicle_id=%vehicle_id, "fresh standalone Parallax owner detected; waiting for upgrade overlap to clear");
                }
                Err(error) => {
                    tracing::warn!(vehicle_id=%vehicle_id, err=%error, "Parallax lease acquisition failed")
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(30)) => {}
                _ = shutdown.recv() => { return; }
            }
        }
        let mut backoff = 2u64;
        loop {
            let tokens = match crate::ingestion::rivian_poll::load_vehicle_tokens(
                vehicle_id, &pool, &age_key,
            )
            .await
            {
                Ok((_, tokens)) => tokens,
                Err(error) => {
                    let _ =
                        set_collector_state(&pool, vehicle_id, "error", Some(&error.to_string()))
                            .await;
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
                        _ = shutdown.recv() => { break; }
                    }
                    backoff = (backoff * 2).min(120);
                    continue;
                }
            };
            let session = CollectorSession {
                vehicle_id,
                rivian_vehicle_id: rivian_vehicle_id.clone(),
                tokens,
            };
            let result = tokio::select! {
                _ = shutdown.recv() => {
                    let _ = set_collector_state(&pool, vehicle_id, "disconnected", Some("shutdown")).await;
                    break;
                }
                result = collect_connection_with_context(&pool, &session, &mut active_sessions) => result
            };
            if result.is_ok() {
                backoff = 2;
            } else if shutdown.try_recv().is_ok() {
                break;
            } else {
                let _ = sqlx::query("UPDATE riviamigo.parallax_collector_state SET reconnect_count=reconnect_count+1 WHERE vehicle_id=$1")
                    .bind(vehicle_id).execute(&pool).await;
                let message = result.err().map(|e| e.to_string());
                let _ = set_collector_state(&pool, vehicle_id, "error", message.as_deref()).await;
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
                    _ = shutdown.recv() => { break; }
                }
                backoff = (backoff * 2).min(120);
            }
        }
        let _ = release_in_process_lease(&pool, vehicle_id, owner_id).await;
    })
}

async fn acquire_in_process_lease(pool: &PgPool, vehicle_id: Uuid, owner_id: Uuid) -> Result<bool> {
    let acquired = sqlx::query_scalar::<_, bool>(
        r#"INSERT INTO riviamigo.parallax_collector_state
               (vehicle_id,status,schema_version,owner_kind,owner_instance_id,last_error)
           VALUES ($1,'starting',$2,'in_process',$3,NULL)
           ON CONFLICT (vehicle_id) DO UPDATE SET
               status='starting', owner_kind='in_process', owner_instance_id=$3,
               last_error=NULL, updated_at=now()
           WHERE riviamigo.parallax_collector_state.owner_instance_id=$3
              OR riviamigo.parallax_collector_state.updated_at < now()-interval '2 minutes'
              OR riviamigo.parallax_collector_state.status='disconnected'
           RETURNING true"#,
    )
    .bind(vehicle_id)
    .bind(SCHEMA_VERSION)
    .bind(owner_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(false);
    Ok(acquired)
}

pub(crate) async fn release_in_process_lease(
    pool: &PgPool,
    vehicle_id: Uuid,
    owner_id: Uuid,
) -> Result<()> {
    sqlx::query(
        r#"UPDATE riviamigo.parallax_collector_state
           SET status='disconnected',owner_instance_id=NULL,last_error='shutdown',updated_at=now()
           WHERE vehicle_id=$1 AND owner_kind='in_process' AND owner_instance_id=$2"#,
    )
    .bind(vehicle_id)
    .bind(owner_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub(crate) async fn update_parallax_power(
    pool: &PgPool,
    vehicle_id: Uuid,
    session_id: Uuid,
    power_kw: f64,
    observed_at: DateTime<Utc>,
) -> Result<u64> {
    Ok(sqlx::query("UPDATE riviamigo.charge_sessions SET parallax_live_power_kw=$1,parallax_power_observed_at=$4 WHERE id=$2 AND vehicle_id=$3 AND ended_at IS NULL AND (parallax_power_observed_at IS NULL OR $4>=parallax_power_observed_at)")
        .bind(power_kw).bind(session_id).bind(vehicle_id).bind(observed_at).execute(pool).await?.rows_affected())
}

#[derive(Debug)]
struct CollectorSession {
    vehicle_id: Uuid,
    rivian_vehicle_id: String,
    tokens: RivianTokenBundle,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct NetworkState {
    #[prost(int32, optional, tag = "1")]
    overall_state: Option<i32>,
    #[prost(int32, optional, tag = "3")]
    active_transport: Option<i32>,
    #[prost(message, optional, tag = "4")]
    wifi: Option<WifiState>,
    #[prost(message, optional, tag = "5")]
    cellular: Option<CellularState>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct WifiState {
    #[prost(int32, optional, tag = "1")]
    status: Option<i32>,
    // Tags 2 and 3 intentionally omitted: they can contain network identity.
    #[prost(int32, optional, tag = "7")]
    connection_state: Option<i32>,
    #[prost(int32, optional, tag = "8")]
    rssi_dbm: Option<i32>,
    #[prost(int32, optional, tag = "9")]
    link_speed_mbps: Option<i32>,
    #[prost(int32, optional, tag = "10")]
    frequency_mhz: Option<i32>,
    #[prost(int32, optional, tag = "11")]
    channel_width_mhz: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct CellularState {
    // Tag 1 (carrier name) is intentionally omitted.
    #[prost(string, optional, tag = "2")]
    access_technology: Option<String>,
    #[prost(int32, optional, tag = "4")]
    signal_dbm: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct EfficiencyState {
    #[prost(int32, optional, tag = "1")]
    reference_wh_per_km: Option<i32>,
    #[prost(int32, optional, tag = "2")]
    learned_wh_per_km: Option<i32>,
    #[prost(message, repeated, tag = "3")]
    mode_ranges: Vec<ModeRange>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ModeRange {
    #[prost(int32, optional, tag = "1")]
    mode: Option<i32>,
    #[prost(int32, optional, tag = "2")]
    full_charge_range_km: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct MassEstimate {
    #[prost(int32, optional, tag = "1")]
    estimated_mass_kg: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ParkedEnergyDistributions {
    #[prost(message, optional, tag = "1")]
    hours_24: Option<ParkedEnergyWindow>,
    #[prost(message, optional, tag = "2")]
    hours_8: Option<ParkedEnergyWindow>,
    #[prost(message, optional, tag = "3")]
    since_parked: Option<ParkedEnergyWindow>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ParkedEnergyWindow {
    #[prost(float, optional, tag = "1")]
    total_kwh: Option<f32>,
    #[prost(float, optional, tag = "2")]
    vehicle_systems_kwh: Option<f32>,
    #[prost(float, optional, tag = "3")]
    outlets_kwh: Option<f32>,
    #[prost(float, optional, tag = "4")]
    climate_kwh: Option<f32>,
    #[prost(float, optional, tag = "5")]
    gear_guard_kwh: Option<f32>,
    #[prost(float, optional, tag = "6")]
    total_range_impact_km: Option<f32>,
    #[prost(float, optional, tag = "7")]
    vehicle_systems_range_impact_km: Option<f32>,
    #[prost(float, optional, tag = "8")]
    outlets_range_impact_km: Option<f32>,
    #[prost(float, optional, tag = "9")]
    climate_range_impact_km: Option<f32>,
    #[prost(float, optional, tag = "10")]
    gear_guard_range_impact_km: Option<f32>,
    #[prost(int32, optional, tag = "11")]
    duration_minutes: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ChargeBreakdown {
    #[prost(float, optional, tag = "1")]
    total_kwh: Option<f32>,
    // Tag 11 (cost display text) is intentionally omitted.
    #[prost(float, optional, tag = "9")]
    current_power_kw: Option<f32>,
    #[prost(int32, optional, tag = "10")]
    fallback_power_kw: Option<i32>,
    #[prost(int32, optional, tag = "13")]
    charging_state: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct HvBatteryState {
    #[prost(message, optional, tag = "1")]
    charge_state: Option<HvChargeState>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct HvChargeState {
    #[prost(double, optional, tag = "1")]
    soc: Option<f64>,
    #[prost(double, optional, tag = "2")]
    pack_energy_kwh: Option<f64>,
    #[prost(float, optional, tag = "3")]
    range_km: Option<f32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ChargingGraphGlobal {
    #[prost(message, repeated, tag = "1")]
    segments: Vec<ChargingGraphSegment>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ChargingGraphSegment {
    #[prost(int32, optional, tag = "1")]
    soc: Option<i32>,
    #[prost(float, optional, tag = "2")]
    power_kw: Option<f32>,
    #[prost(int64, optional, tag = "3")]
    start_unix_ms: Option<i64>,
    #[prost(int64, optional, tag = "4")]
    end_unix_ms: Option<i64>,
    #[prost(int32, optional, tag = "6")]
    state: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ChargingTimeEstimation {
    #[prost(int32, optional, tag = "1")]
    remaining_seconds: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ChargingStatus {
    #[prost(int32, optional, tag = "1")]
    plug_connection_status: Option<i32>,
    #[prost(int32, optional, tag = "2")]
    display_status: Option<i32>,
    #[prost(int32, optional, tag = "3")]
    evse_type: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct ColdWeatherSoc {
    #[prost(int32, optional, tag = "1")]
    available_soc_pct: Option<i32>,
    #[prost(int32, optional, tag = "2")]
    cold_limited_soc_pct: Option<i32>,
    #[prost(float, optional, tag = "3")]
    cold_range_impact_km: Option<f32>,
}

pub async fn run(database_url: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(database_url)
        .await
        .context("connect Parallax collector to Riviamigo database")?;
    crate::db::migrations::MIGRATOR
        .run(&pool)
        .await
        .context("apply Parallax telemetry migrations")?;

    let sessions = load_sessions(&pool).await?;
    if sessions.is_empty() {
        anyhow::bail!("no enrolled vehicle credentials were found");
    }

    let mut tasks = tokio::task::JoinSet::new();
    for session in sessions {
        let pool = pool.clone();
        tasks.spawn(async move { run_vehicle(pool, session).await });
    }

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("Parallax collector shutdown requested");
            tasks.abort_all();
        }
        result = tasks.join_next() => {
            match result {
                Some(Ok(Err(error))) => return Err(error),
                Some(Err(error)) => return Err(error.into()),
                _ => {}
            }
        }
    }
    Ok(())
}

async fn load_sessions(pool: &PgPool) -> Result<Vec<CollectorSession>> {
    let rows = sqlx::query_as::<_, (Uuid, String, Vec<u8>, String)>(
        r#"SELECT v.id, v.rivian_vehicle_id, c.encrypted_tokens,
                  (SELECT value FROM riviamigo.system_config WHERE key = 'age_key')
           FROM riviamigo.vehicles v
           JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id
           WHERE v.rivian_vehicle_id IS NOT NULL
           ORDER BY v.display_priority, v.created_at"#,
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|(vehicle_id, rivian_vehicle_id, encrypted, age_key)| {
            let identity = age_key
                .parse::<Identity>()
                .map_err(|_| anyhow::anyhow!("database Age identity is invalid"))?;
            let tokens = decrypt_tokens(&encrypted, &identity)?;
            tokens.validate()?;
            Ok(CollectorSession {
                vehicle_id,
                rivian_vehicle_id,
                tokens,
            })
        })
        .collect()
}

async fn run_vehicle(pool: PgPool, session: CollectorSession) -> Result<()> {
    let mut backoff = 2u64;
    loop {
        match collect_connection(&pool, &session).await {
            Ok(()) => backoff = 2,
            Err(error) => {
                set_collector_state(&pool, session.vehicle_id, "error", Some(&error.to_string()))
                    .await?;
                tracing::warn!(
                    vehicle_id = %session.vehicle_id,
                    error = %error,
                    retry_seconds = backoff,
                    "Parallax collector disconnected"
                );
                tokio::time::sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(120);
            }
        }
    }
}

async fn collect_connection(pool: &PgPool, session: &CollectorSession) -> Result<()> {
    let (_tx, mut context) =
        watch::channel(crate::ingestion::worker::ActiveSessionContext::default());
    collect_connection_with_context(pool, session, &mut context).await
}

async fn collect_connection_with_context(
    pool: &PgPool,
    session: &CollectorSession,
    active_sessions: &mut watch::Receiver<crate::ingestion::worker::ActiveSessionContext>,
) -> Result<()> {
    let mut request = WS_URL.into_client_request()?;
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", "graphql-transport-ws".parse()?);
    request.headers_mut().insert(
        "A-Sess",
        session
            .tokens
            .app_session_token
            .parse()
            .context("invalid Rivian app session header")?,
    );
    request.headers_mut().insert(
        "U-Sess",
        session
            .tokens
            .user_session_token
            .parse()
            .context("invalid Rivian user session header")?,
    );
    if !session.tokens.csrf_token.is_empty() {
        request.headers_mut().insert(
            "Csrf-Token",
            session
                .tokens
                .csrf_token
                .parse()
                .context("invalid Rivian CSRF header")?,
        );
    }
    let (mut websocket, _) = tokio_tungstenite::connect_async(request).await?;
    websocket
        .send(Message::Text(
            json!({
                "type": "connection_init",
                "payload": {
                    "client-name": "com.rivian.ios.consumer-apollo-ios",
                    "client-version": "1.13.0-1494",
                    "dc-cid": format!("m-ios-{}", Uuid::new_v4()),
                    "u-sess": session.tokens.user_session_token,
                }
            })
            .to_string()
            .into(),
        ))
        .await?;

    wait_for_ack(&mut websocket).await?;
    websocket
        .send(Message::Text(
            subscription_message(&session.rivian_vehicle_id)
                .to_string()
                .into(),
        ))
        .await?;
    set_collector_state(pool, session.vehicle_id, "connected", None).await?;

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await;
    loop {
        tokio::select! {
            message = websocket.next() => {
                let Some(message) = message else {
                    anyhow::bail!("Parallax socket ended");
                };
                match message? {
                    Message::Ping(payload) => websocket.send(Message::Pong(payload)).await?,
                    Message::Text(text) => {
                        let value: Value = serde_json::from_str(&text).unwrap_or_default();
                        if value.get("id").and_then(Value::as_str) != Some(SUBSCRIPTION_ID) {
                            continue;
                        }
                        match value.get("type").and_then(Value::as_str) {
                            Some("next") => {
                                let Some(envelope) =
                                    value.pointer("/payload/data/parallaxMessages")
                                else {
                                    continue;
                                };
                                let context = active_sessions.borrow_and_update().clone();
                                if let Err(error) = persist_envelope(pool, session.vehicle_id, envelope, &context).await {
                                    tracing::debug!(vehicle_id=%session.vehicle_id, err=%error, "Parallax frame rejected by typed decoder");
                                    let _ = sqlx::query("UPDATE riviamigo.parallax_collector_state SET decode_error_count=decode_error_count+1,last_frame_at=now(),updated_at=now() WHERE vehicle_id=$1")
                                        .bind(session.vehicle_id).execute(pool).await;
                                }
                            }
                            Some("error") => anyhow::bail!("Parallax subscription rejected"),
                            Some("complete") => {
                                anyhow::bail!("Parallax subscription completed")
                            }
                            _ => {}
                        }
                    }
                    Message::Close(frame) => {
                        set_collector_state(pool, session.vehicle_id, "disconnected", None)
                            .await?;
                        anyhow::bail!("Parallax socket closed: {frame:?}");
                    }
                    _ => {}
                }
            }
            _ = heartbeat.tick() => {
                touch_collector_heartbeat(pool, session.vehicle_id).await?;
            }
        }
    }
}

async fn touch_collector_heartbeat(pool: &PgPool, vehicle_id: Uuid) -> Result<()> {
    let result = sqlx::query(
        r#"UPDATE riviamigo.parallax_collector_state
           SET updated_at = now()
           WHERE vehicle_id = $1 AND status = 'connected'"#,
    )
    .bind(vehicle_id)
    .execute(pool)
    .await?;
    if result.rows_affected() != 1 {
        anyhow::bail!("Parallax collector heartbeat state is missing or disconnected");
    }
    Ok(())
}

async fn wait_for_ack<S>(websocket: &mut S) -> Result<()>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
        + Unpin,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let message = tokio::time::timeout_at(deadline, websocket.next())
            .await
            .context("timed out waiting for Parallax acknowledgement")?
            .context("socket ended before Parallax acknowledgement")??;
        match message {
            Message::Text(text)
                if serde_json::from_str::<Value>(&text)?
                    .get("type")
                    .and_then(Value::as_str)
                    == Some("connection_ack") =>
            {
                return Ok(());
            }
            Message::Ping(payload) => websocket.send(Message::Pong(payload)).await?,
            _ => {}
        }
    }
}

fn subscription_message(vehicle_id: &str) -> Value {
    json!({
        "id": SUBSCRIPTION_ID,
        "type": "subscribe",
        "payload": {
            "operationName": "ParallaxMessages",
            "variables": { "vehicleId": vehicle_id, "rvms": TOPICS },
            "query": "subscription ParallaxMessages($vehicleId: String!, $rvms: [String!]) { parallaxMessages(vehicleId: $vehicleId, rvms: $rvms) { payload timestamp rvm } }"
        }
    })
}

async fn persist_envelope(
    pool: &PgPool,
    vehicle_id: Uuid,
    envelope: &Value,
    active_session: &crate::ingestion::worker::ActiveSessionContext,
) -> Result<()> {
    let topic = envelope
        .get("rvm")
        .and_then(Value::as_str)
        .context("missing RVM topic")?;
    let encoded = envelope
        .get("payload")
        .and_then(Value::as_str)
        .context("missing Parallax payload")?;
    let payload = BASE64.decode(encoded)?;
    let hash = Sha256::digest(&payload).to_vec();
    let received_at = Utc::now();
    let source_at = parse_source_at(envelope.get("timestamp")).unwrap_or(received_at);
    let associated_session = matching_active_session(active_session, source_at);

    match topic {
        "vehicle.network.state" => {
            let value = NetworkState::decode(payload.as_slice())?;
            let wifi = value.wifi.unwrap_or_default();
            let cellular = value.cellular.unwrap_or_default();
            let rssi = without_signal_sentinel(wifi.rssi_dbm);
            let cellular_signal = without_signal_sentinel(cellular.signal_dbm);
            sqlx::query(
                r#"INSERT INTO timeseries.parallax_network_samples
                   (vehicle_id, source_at, received_at, payload_hash, overall_state,
                    active_transport, wifi_status, wifi_connected, wifi_rssi_dbm,
                    wifi_link_speed_mbps, wifi_frequency_mhz, wifi_channel_width_mhz,
                    cellular_access_technology, cellular_signal_dbm, schema_version)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                   ON CONFLICT DO NOTHING"#,
            )
            .bind(vehicle_id)
            .bind(source_at)
            .bind(received_at)
            .bind(hash)
            .bind(value.overall_state)
            .bind(value.active_transport)
            .bind(wifi.status)
            .bind(wifi.status == Some(2) && rssi.is_some())
            .bind(rssi)
            .bind(wifi.link_speed_mbps)
            .bind(wifi.frequency_mhz)
            .bind(wifi.channel_width_mhz)
            .bind(cellular.access_technology.filter(|v| v.len() <= 16))
            .bind(cellular_signal)
            .bind(SCHEMA_VERSION)
            .execute(pool)
            .await?;
        }
        "dynamics.vehicle.efficiency" => {
            let value = EfficiencyState::decode(payload.as_slice())?;
            let ranges: BTreeMap<String, i32> = value
                .mode_ranges
                .into_iter()
                .filter_map(|item| Some((item.mode?.to_string(), item.full_charge_range_km?)))
                .collect();
            sqlx::query(
                r#"INSERT INTO timeseries.parallax_efficiency_samples
                   (vehicle_id, source_at, received_at, payload_hash, reference_wh_per_km,
                    learned_wh_per_km, mode_ranges_km, schema_version)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING"#,
            )
            .bind(vehicle_id)
            .bind(source_at)
            .bind(received_at)
            .bind(hash)
            .bind(value.reference_wh_per_km)
            .bind(value.learned_wh_per_km)
            .bind(sqlx::types::Json(ranges))
            .bind(SCHEMA_VERSION)
            .execute(pool)
            .await?;
        }
        "dynamics.vehicle.mass_estimate" => {
            let value = MassEstimate::decode(payload.as_slice())?;
            if let Some(mass) = value
                .estimated_mass_kg
                .filter(|mass| (1000..=10_000).contains(mass))
            {
                sqlx::query(
                    r#"INSERT INTO timeseries.parallax_mass_samples
                       (vehicle_id, source_at, received_at, payload_hash, estimated_mass_kg, schema_version)
                       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING"#,
                )
                .bind(vehicle_id).bind(source_at).bind(received_at).bind(hash)
                .bind(mass).bind(SCHEMA_VERSION).execute(pool).await?;
            }
        }
        "energy_edge_compute.graphs.parked_energy_distributions" => {
            let value = ParkedEnergyDistributions::decode(payload.as_slice())?;
            for (window, sample) in [
                ("24h", value.hours_24),
                ("8h", value.hours_8),
                ("since_parked", value.since_parked),
            ] {
                if let Some(sample) = sample {
                    persist_parked_window(
                        pool,
                        vehicle_id,
                        source_at,
                        received_at,
                        &hash,
                        window,
                        sample,
                    )
                    .await?;
                }
            }
        }
        "energy_edge_compute.graphs.charge_session_breakdown" => {
            let value = ChargeBreakdown::decode(payload.as_slice())?;
            let total_kwh = f64_opt(value.total_kwh).filter(|v| v.is_finite() && *v >= 0.0);
            let current_power_kw = value
                .current_power_kw
                .map(f64::from)
                .or_else(|| value.fallback_power_kw.map(f64::from))
                .filter(|v| v.is_finite() && (0.0..=500.0).contains(v));
            if total_kwh.is_none() && current_power_kw.is_none() && value.charging_state.is_none() {
                record_empty_frame(pool, vehicle_id).await?;
                return Ok(());
            }
            sqlx::query(
                r#"INSERT INTO timeseries.parallax_charge_breakdown_samples
                   (vehicle_id, source_at, received_at, payload_hash, charge_session_id, total_kwh, pack_kwh,
                    thermal_kwh, duration_minutes, charging_state, completion_state, schema_version)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING"#,
            )
            .bind(vehicle_id)
            .bind(source_at)
            .bind(received_at)
            .bind(hash)
            .bind(associated_session)
            .bind(total_kwh)
            .bind(None::<f64>)
            .bind(None::<f64>)
            .bind(None::<i32>)
            .bind(value.charging_state)
            .bind(None::<i32>)
            .bind(SCHEMA_VERSION)
            .execute(pool)
            .await?;
            if let Some(session_id) = associated_session {
                if let Some(total_kwh) = total_kwh {
                    sqlx::query("UPDATE riviamigo.charge_sessions SET parallax_total_charged_kwh=$1,parallax_total_energy_observed_at=$4 WHERE id=$2 AND vehicle_id=$3 AND ended_at IS NULL AND (parallax_total_energy_observed_at IS NULL OR $4>=parallax_total_energy_observed_at)")
                        .bind(total_kwh).bind(session_id).bind(vehicle_id).bind(source_at).execute(pool).await?;
                }
                if let Some(power_kw) = current_power_kw {
                    update_parallax_power(pool, vehicle_id, session_id, power_kw, source_at)
                        .await?;
                }
            }
        }
        "energy.high_voltage.battery_state" => {
            let value = match HvBatteryState::decode(payload.as_slice()) {
                Ok(v) => v,
                Err(_) => {
                    record_decode_error(pool, vehicle_id).await?;
                    return Ok(());
                }
            };
            let Some(pack) = value
                .charge_state
                .and_then(|state| state.pack_energy_kwh)
                .filter(|v| v.is_finite() && (0.0..=500.0).contains(v))
            else {
                record_empty_frame(pool, vehicle_id).await?;
                return Ok(());
            };
            if let Some(session_id) = associated_session {
                sqlx::query("UPDATE riviamigo.charge_sessions SET parallax_pack_energy_kwh=$1,parallax_pack_energy_observed_at=$4 WHERE id=$2 AND vehicle_id=$3 AND ended_at IS NULL AND (parallax_pack_energy_observed_at IS NULL OR $4>=parallax_pack_energy_observed_at)")
                    .bind(pack).bind(session_id).bind(vehicle_id).bind(source_at).execute(pool).await?;
            }
        }
        "energy_edge_compute.graphs.charging_graph_global" => {
            let value = match ChargingGraphGlobal::decode(payload.as_slice()) {
                Ok(v) => v,
                Err(_) => {
                    record_decode_error(pool, vehicle_id).await?;
                    return Ok(());
                }
            };
            let mut persisted = 0usize;
            let mut latest_power: Option<(DateTime<Utc>, f64)> = None;
            for (index, segment) in value.segments.into_iter().enumerate() {
                let Some(ms) = segment.start_unix_ms else {
                    continue;
                };
                let Some(ts) = Utc.timestamp_millis_opt(ms).single() else {
                    continue;
                };
                let power_kw = segment
                    .power_kw
                    .filter(|v| v.is_finite() && (0.0..=500.0).contains(v));
                let soc = segment.soc.filter(|v| (0..=100).contains(v));
                if power_kw.is_none() && soc.is_none() {
                    continue;
                }
                if let Some(power) = power_kw {
                    if latest_power.is_none_or(|(latest_ts, _)| ts >= latest_ts) {
                        latest_power = Some((ts, f64::from(power)));
                    }
                }
                let session_id = matching_active_session(active_session, ts);
                sqlx::query("INSERT INTO timeseries.parallax_charge_curve_points (vehicle_id,source_at,segment_index,charge_session_id,power_kw,soc,delivered_energy_kwh,received_at,schema_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING")
                        .bind(vehicle_id).bind(ts).bind(index as i32).bind(session_id)
                        .bind(power_kw.map(f64::from)).bind(soc.map(f64::from))
                        .bind(None::<f64>).bind(received_at).bind(SCHEMA_VERSION)
                        .execute(pool).await?;
                persisted += 1;
            }
            if persisted == 0 {
                record_empty_frame(pool, vehicle_id).await?;
                return Ok(());
            }
            if let Some((observed_at, power)) = latest_power {
                if let Some(session_id) = matching_active_session(active_session, observed_at) {
                    update_parallax_power(pool, vehicle_id, session_id, power, observed_at).await?;
                }
            }
        }
        "charging.session.time_estimation" => {
            let value = match ChargingTimeEstimation::decode(payload.as_slice()) {
                Ok(v) => v,
                Err(_) => {
                    record_decode_error(pool, vehicle_id).await?;
                    return Ok(());
                }
            };
            let Some(seconds) = value
                .remaining_seconds
                .filter(|v| (0..=172_800).contains(v))
            else {
                record_empty_frame(pool, vehicle_id).await?;
                return Ok(());
            };
            let minutes = (seconds + 59) / 60;
            if let Some(session_id) = associated_session {
                sqlx::query("UPDATE riviamigo.charge_sessions SET parallax_time_remaining_minutes=$1,parallax_time_observed_at=$4 WHERE id=$2 AND vehicle_id=$3 AND ended_at IS NULL AND (parallax_time_observed_at IS NULL OR $4>=parallax_time_observed_at)")
                    .bind(minutes).bind(session_id).bind(vehicle_id).bind(source_at).execute(pool).await?;
            }
        }
        "charging.session.status" => {
            let value = match ChargingStatus::decode(payload.as_slice()) {
                Ok(v) => v,
                Err(_) => {
                    record_decode_error(pool, vehicle_id).await?;
                    return Ok(());
                }
            };
            if value.plug_connection_status.is_none()
                && value.display_status.is_none()
                && value.evse_type.is_none()
            {
                record_empty_frame(pool, vehicle_id).await?;
                return Ok(());
            }
            if let Some(session_id) = associated_session {
                let state = format!(
                    "plug={};display={};evse={}",
                    value
                        .plug_connection_status
                        .map_or_else(|| "unknown".into(), |v| v.to_string()),
                    value
                        .display_status
                        .map_or_else(|| "unknown".into(), |v| v.to_string()),
                    value
                        .evse_type
                        .map_or_else(|| "unknown".into(), |v| v.to_string()),
                );
                sqlx::query("UPDATE riviamigo.charge_sessions SET parallax_charger_status=$1,parallax_status_observed_at=$4 WHERE id=$2 AND vehicle_id=$3 AND ended_at IS NULL AND (parallax_status_observed_at IS NULL OR $4>=parallax_status_observed_at)")
                    .bind(state).bind(session_id).bind(vehicle_id).bind(source_at).execute(pool).await?;
            }
        }
        "energy_edge_compute.graphs.cold_weather_soc" => {
            let value = ColdWeatherSoc::decode(payload.as_slice())?;
            sqlx::query(
                r#"INSERT INTO timeseries.parallax_cold_weather_samples
                   (vehicle_id, source_at, received_at, payload_hash, available_soc_pct,
                    cold_limited_soc_pct, cold_range_impact_km, schema_version)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING"#,
            )
            .bind(vehicle_id)
            .bind(source_at)
            .bind(received_at)
            .bind(hash)
            .bind(value.available_soc_pct)
            .bind(value.cold_limited_soc_pct)
            .bind(f64_opt(value.cold_range_impact_km))
            .bind(SCHEMA_VERSION)
            .execute(pool)
            .await?;
        }
        "dynamics.vehicle.drive_mode" => {
            // Retained in the allowlist for continued schema observation. No
            // stable enum labels are exposed until more modes are observed.
            record_empty_frame(pool, vehicle_id).await?;
            return Ok(());
        }
        _ => {
            record_empty_frame(pool, vehicle_id).await?;
            return Ok(());
        }
    }

    sqlx::query(
        r#"UPDATE riviamigo.parallax_collector_state
           SET last_event_at = $2, last_frame_at=$2, last_meaningful_frame_at=$2,
               status = 'connected', last_error = NULL, updated_at = now()
           WHERE vehicle_id = $1"#,
    )
    .bind(vehicle_id)
    .bind(received_at)
    .execute(pool)
    .await?;
    Ok(())
}

async fn record_decode_error(pool: &PgPool, vehicle_id: Uuid) -> Result<()> {
    sqlx::query("UPDATE riviamigo.parallax_collector_state SET decode_error_count=decode_error_count+1, last_error='unsupported or malformed charging schema', updated_at=now() WHERE vehicle_id=$1")
        .bind(vehicle_id).execute(pool).await?;
    Ok(())
}

async fn record_empty_frame(pool: &PgPool, vehicle_id: Uuid) -> Result<()> {
    sqlx::query("UPDATE riviamigo.parallax_collector_state SET empty_frame_count=empty_frame_count+1,last_frame_at=now(),updated_at=now() WHERE vehicle_id=$1")
        .bind(vehicle_id).execute(pool).await?;
    Ok(())
}

fn matching_active_session(
    context: &crate::ingestion::worker::ActiveSessionContext,
    source_at: DateTime<Utc>,
) -> Option<Uuid> {
    let id = context.session_id?;
    if context
        .started_at
        .is_some_and(|started| source_at < started)
        || context.ended_at.is_some_and(|ended| source_at > ended)
    {
        None
    } else {
        Some(id)
    }
}

#[allow(clippy::too_many_arguments)]
async fn persist_parked_window(
    pool: &PgPool,
    vehicle_id: Uuid,
    source_at: DateTime<Utc>,
    received_at: DateTime<Utc>,
    hash: &[u8],
    window: &str,
    value: ParkedEnergyWindow,
) -> Result<()> {
    let parked_started_at = value
        .duration_minutes
        .map(|minutes| source_at - chrono::Duration::minutes(i64::from(minutes)));
    sqlx::query(
        r#"INSERT INTO timeseries.parallax_parked_energy_samples
           (vehicle_id, source_at, received_at, payload_hash, period_window, parked_started_at,
            duration_minutes, total_kwh, vehicle_systems_kwh, outlets_kwh, climate_kwh,
            gear_guard_kwh, total_range_impact_km, vehicle_systems_range_impact_km,
            outlets_range_impact_km, climate_range_impact_km, gear_guard_range_impact_km,
            schema_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(vehicle_id)
    .bind(source_at)
    .bind(received_at)
    .bind(hash)
    .bind(window)
    .bind(parked_started_at)
    .bind(value.duration_minutes)
    .bind(f64_opt(value.total_kwh))
    .bind(f64_opt(value.vehicle_systems_kwh))
    .bind(f64_opt(value.outlets_kwh))
    .bind(f64_opt(value.climate_kwh))
    .bind(f64_opt(value.gear_guard_kwh))
    .bind(f64_opt(value.total_range_impact_km))
    .bind(f64_opt(value.vehicle_systems_range_impact_km))
    .bind(f64_opt(value.outlets_range_impact_km))
    .bind(f64_opt(value.climate_range_impact_km))
    .bind(f64_opt(value.gear_guard_range_impact_km))
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await?;
    Ok(())
}

async fn set_collector_state(
    pool: &PgPool,
    vehicle_id: Uuid,
    status: &str,
    error: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO riviamigo.parallax_collector_state
           (vehicle_id, status, connected_at, last_error, schema_version)
           VALUES ($1,$2,CASE WHEN $2 = 'connected' THEN now() END,$3,$4)
           ON CONFLICT (vehicle_id) DO UPDATE SET
             status = EXCLUDED.status,
             connected_at = CASE WHEN EXCLUDED.status = 'connected'
                THEN COALESCE(riviamigo.parallax_collector_state.connected_at, now())
                ELSE riviamigo.parallax_collector_state.connected_at END,
             last_error = EXCLUDED.last_error,
             schema_version = EXCLUDED.schema_version,
             updated_at = now()"#,
    )
    .bind(vehicle_id)
    .bind(status)
    .bind(error.map(|value| value.chars().take(500).collect::<String>()))
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await?;
    Ok(())
}

fn parse_source_at(value: Option<&Value>) -> Option<DateTime<Utc>> {
    let value = value?;
    if let Some(text) = value.as_str() {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(text) {
            return Some(parsed.with_timezone(&Utc));
        }
        if let Ok(millis) = text.parse::<i64>() {
            return Utc.timestamp_millis_opt(millis).single();
        }
    }
    value
        .as_i64()
        .and_then(|millis| Utc.timestamp_millis_opt(millis).single())
}

fn without_signal_sentinel(value: Option<i32>) -> Option<i32> {
    value.filter(|value| (-150..=0).contains(value))
}

fn f64_opt(value: Option<f32>) -> Option<f64> {
    value.map(f64::from).filter(|value| value.is_finite())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parked_energy_wire_contract_decodes_units() {
        let window = ParkedEnergyWindow {
            total_kwh: Some(1.25),
            vehicle_systems_kwh: Some(0.75),
            climate_kwh: Some(0.5),
            total_range_impact_km: Some(4.2),
            duration_minutes: Some(480),
            ..Default::default()
        };
        let payload = ParkedEnergyDistributions {
            hours_8: Some(window),
            ..Default::default()
        }
        .encode_to_vec();
        let decoded = ParkedEnergyDistributions::decode(payload.as_slice()).unwrap();
        let decoded = decoded.hours_8.unwrap();
        assert_eq!(decoded.duration_minutes, Some(480));
        assert_eq!(decoded.total_kwh, Some(1.25));
        assert_eq!(decoded.total_range_impact_km, Some(4.2));
    }

    #[test]
    fn network_decoder_does_not_model_identifiers() {
        let payload = NetworkState {
            overall_state: Some(1),
            active_transport: Some(4),
            wifi: Some(WifiState {
                status: Some(2),
                rssi_dbm: Some(-56),
                link_speed_mbps: Some(117),
                frequency_mhz: Some(2437),
                channel_width_mhz: Some(20),
                ..Default::default()
            }),
            cellular: Some(CellularState {
                access_technology: Some("LTE".into()),
                signal_dbm: Some(-255),
            }),
        }
        .encode_to_vec();
        let decoded = NetworkState::decode(payload.as_slice()).unwrap();
        assert_eq!(decoded.wifi.unwrap().rssi_dbm, Some(-56));
        assert_eq!(
            without_signal_sentinel(decoded.cellular.unwrap().signal_dbm),
            None
        );
    }

    #[test]
    fn subscription_is_strictly_allowlisted() {
        let message = subscription_message("vehicle");
        assert_eq!(
            message["payload"]["variables"]["rvms"]
                .as_array()
                .unwrap()
                .len(),
            TOPICS.len()
        );
        assert!(message.to_string().contains("parked_energy_distributions"));
    }

    #[test]
    fn captured_vehicle_payloads_decode_with_verified_units() {
        let efficiency = EfficiencyState::decode(
            BASE64
                .decode("CM8BEPgBGgUIARCTBBoFCAIQkwQaBQgDENcDGgUIBBDhAxoFCAUQrQMaBQgGEOQDGgUIBxCtAxoFCAgQ5AMaBQgJEK0DGgUIChDkAw==")
                .unwrap()
                .as_slice(),
        )
        .unwrap();
        assert_eq!(efficiency.reference_wh_per_km, Some(207));
        assert_eq!(efficiency.learned_wh_per_km, Some(248));
        assert_eq!(efficiency.mode_ranges[0].full_charge_range_km, Some(531));

        let mass = MassEstimate::decode(BASE64.decode("CNgY").unwrap().as_slice()).unwrap();
        assert_eq!(mass.estimated_mass_kg, Some(3160));

        let network = NetworkState::decode(
            BASE64
                .decode("CAESBAgBEAISBAgCEAISBAgDEAISBAgEEAIYBCIoCAIQAhoIRGF2aXNJb1Q4BEDI//////////8BSBpQ7BJYFGAEaAJwAioYCgRBVCZUEgNMVEUYAyCB/v////////8B")
                .unwrap()
                .as_slice(),
        )
        .unwrap();
        let wifi = network.wifi.unwrap();
        assert_eq!(wifi.rssi_dbm, Some(-56));
        assert_eq!(wifi.link_speed_mbps, Some(26));
        assert_eq!(wifi.frequency_mhz, Some(2412));

        let charge = ChargeBreakdown::decode(
            BASE64
                .decode("DWdmtkEVZ2auQS0AAIA/MKsBWgBgAWgB")
                .unwrap()
                .as_slice(),
        )
        .unwrap();
        assert!((charge.total_kwh.unwrap() - 22.8).abs() < 0.01);

        let cold = ColdWeatherSoc::decode(BASE64.decode("CEI=").unwrap().as_slice()).unwrap();
        assert_eq!(cold.available_soc_pct, Some(66));
    }

    #[test]
    fn charging_topic_fixtures_decode_only_proven_fields() {
        let battery = HvBatteryState::decode(
            [
                0x0a, 0x12, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x49, 0x40, 0x11, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x39, 0x40,
            ]
            .as_slice(),
        )
        .unwrap();
        assert_eq!(battery.charge_state.unwrap().pack_energy_kwh, Some(25.0));

        let time = ChargingTimeEstimation::decode([0x08, 0xd8, 0x13].as_slice()).unwrap();
        assert_eq!(time.remaining_seconds, Some(2520));

        let status =
            ChargingStatus::decode([0x08, 0x01, 0x10, 0x02, 0x18, 0x03].as_slice()).unwrap();
        assert_eq!(status.plug_connection_status, Some(1));
        assert_eq!(status.display_status, Some(2));
        assert_eq!(status.evse_type, Some(3));

        let graph = ChargingGraphGlobal::decode(
            [
                0x0a, 0x0f, 0x08, 0x32, 0x15, 0x00, 0x00, 0x30, 0x41, 0x18, 0xe8, 0x07, 0x20, 0xd0,
                0x0f, 0x30, 0x03,
            ]
            .as_slice(),
        )
        .unwrap();
        assert_eq!(graph.segments.len(), 1);
        assert_eq!(graph.segments[0].start_unix_ms, Some(1000));
        assert_eq!(graph.segments[0].power_kw, Some(11.0));
        assert_eq!(graph.segments[0].soc, Some(50));
    }

    #[test]
    fn unknown_charging_schema_decodes_to_no_authoritative_fields() {
        let unknown = [0xa0, 0x06, 0x01];
        assert_eq!(
            HvBatteryState::decode(unknown.as_slice())
                .unwrap()
                .charge_state,
            None
        );
        assert!(ChargingGraphGlobal::decode(unknown.as_slice())
            .unwrap()
            .segments
            .is_empty());
        assert_eq!(
            ChargingTimeEstimation::decode(unknown.as_slice())
                .unwrap()
                .remaining_seconds,
            None
        );
        let status = ChargingStatus::decode(unknown.as_slice()).unwrap();
        assert!(
            status.plug_connection_status.is_none()
                && status.display_status.is_none()
                && status.evse_type.is_none()
        );
    }

    #[test]
    fn session_association_enforces_canonical_window() {
        let started = Utc::now();
        let id = Uuid::new_v4();
        let context = crate::ingestion::worker::ActiveSessionContext {
            session_id: Some(id),
            started_at: Some(started),
            ended_at: None,
        };
        assert_eq!(matching_active_session(&context, started), Some(id));
        assert_eq!(
            matching_active_session(&context, started - chrono::Duration::seconds(1)),
            None
        );
        let terminal = crate::ingestion::worker::ActiveSessionContext {
            ended_at: Some(started + chrono::Duration::minutes(1)),
            ..context
        };
        assert_eq!(
            matching_active_session(&terminal, started + chrono::Duration::minutes(2)),
            None
        );
    }
}
