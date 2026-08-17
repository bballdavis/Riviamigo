//! Optional, independent Parallax telemetry collector.
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
    "energy_edge_compute.graphs.cold_weather_soc",
];

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
    #[prost(float, optional, tag = "2")]
    pack_kwh: Option<f32>,
    #[prost(float, optional, tag = "5")]
    thermal_kwh: Option<f32>,
    #[prost(int32, optional, tag = "6")]
    duration_minutes: Option<i32>,
    // Tag 11 (cost display text) is intentionally omitted.
    #[prost(int32, optional, tag = "12")]
    charging_state: Option<i32>,
    #[prost(int32, optional, tag = "13")]
    completion_state: Option<i32>,
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
    let mut request = WS_URL.into_client_request()?;
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", "graphql-transport-ws".parse()?);
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
                                persist_envelope(pool, session.vehicle_id, envelope).await?;
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

async fn persist_envelope(pool: &PgPool, vehicle_id: Uuid, envelope: &Value) -> Result<()> {
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
            sqlx::query(
                r#"INSERT INTO timeseries.parallax_charge_breakdown_samples
                   (vehicle_id, source_at, received_at, payload_hash, total_kwh, pack_kwh,
                    thermal_kwh, duration_minutes, charging_state, completion_state, schema_version)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING"#,
            )
            .bind(vehicle_id)
            .bind(source_at)
            .bind(received_at)
            .bind(hash)
            .bind(f64_opt(value.total_kwh))
            .bind(f64_opt(value.pack_kwh))
            .bind(f64_opt(value.thermal_kwh))
            .bind(value.duration_minutes)
            .bind(value.charging_state)
            .bind(value.completion_state)
            .bind(SCHEMA_VERSION)
            .execute(pool)
            .await?;
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
        }
        _ => {}
    }

    sqlx::query(
        r#"UPDATE riviamigo.parallax_collector_state
           SET last_event_at = $2, status = 'connected', last_error = NULL, updated_at = now()
           WHERE vehicle_id = $1"#,
    )
    .bind(vehicle_id)
    .bind(received_at)
    .execute(pool)
    .await?;
    Ok(())
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
        assert!((charge.pack_kwh.unwrap() - 21.8).abs() < 0.01);
        assert_eq!(charge.duration_minutes, Some(171));

        let cold = ColdWeatherSoc::decode(BASE64.decode("CEI=").unwrap().as_slice()).unwrap();
        assert_eq!(cold.available_soc_pct, Some(66));
    }
}
