use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use age::x25519::Identity;
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Utc};
use clap::{Args, Parser, Subcommand};
use futures::{SinkExt, StreamExt};
use riviamigo_api::ingestion::session_store::{decrypt_tokens, RivianTokenBundle};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use uuid::Uuid;

const WS_URL: &str = "wss://api.rivian.com/gql-consumer-subscriptions/graphql";
const SUBSCRIPTION_ID: &str = "graph-exploration-parallax";
const DEFAULT_DATABASE_URL: &str = "postgresql://riviamigo:devpassword@localhost:5432/riviamigo";
const DEFAULT_TOPICS: &[&str] = &[
    "energy.high_voltage.battery_state",
    "energy.high_voltage.battery_characteristics",
    "energy.low_voltage.battery_state",
    "dynamics.vehicle.drive_mode",
    "dynamics.vehicle.gear",
    "dynamics.vehicle.range",
    "dynamics.vehicle.odometer",
    "dynamics.vehicle.gnss",
    "dynamics.vehicle.location",
    "vehicle.power.state",
];

#[derive(Parser)]
#[command(about = "Local-only Rivian GraphQL and Parallax exploration harness")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Confirm that a local encrypted Rivian session can be loaded.
    Auth(AuthArgs),
    /// Capture read-only Parallax envelopes into a local JSONL file.
    Capture(CaptureArgs),
    /// Summarize topics in a capture without displaying payload contents.
    Inventory(FileArgs),
    /// Inspect protobuf wire fields for a single captured event.
    Inspect(InspectArgs),
    /// Add a timestamped note for later payload correlation.
    Observe(ObserveArgs),
}

#[derive(Args)]
struct AuthArgs {
    #[arg(long, default_value = DEFAULT_DATABASE_URL, env = "DATABASE_URL")]
    database_url: String,
    #[arg(long)]
    vehicle: Option<Uuid>,
}

#[derive(Args)]
struct CaptureArgs {
    #[arg(long, default_value = DEFAULT_DATABASE_URL, env = "DATABASE_URL")]
    database_url: String,
    #[arg(long)]
    vehicle: Option<Uuid>,
    /// Subscribe without an RVM allowlist. This is required for topic discovery.
    #[arg(long, conflicts_with = "topic")]
    all_topics: bool,
    /// Explicit RVM topic. Repeat to subscribe to multiple topics.
    #[arg(long)]
    topic: Vec<String>,
    #[arg(long, default_value_t = 900)]
    duration_seconds: u64,
    #[arg(long, default_value_t = 100_000)]
    max_events: usize,
    #[arg(long, default_value_t = 100)]
    max_megabytes: u64,
    #[arg(long)]
    output: Option<PathBuf>,
}

#[derive(Args)]
struct FileArgs {
    file: PathBuf,
}

#[derive(Args)]
struct InspectArgs {
    file: PathBuf,
    #[arg(long, default_value_t = 1)]
    event: usize,
}

#[derive(Args)]
struct ObserveArgs {
    /// Short controlled-state label, for example wifi-connected or cellular-only.
    label: String,
    /// Optional local context. Do not put passwords or tokens here.
    #[arg(long)]
    note: Option<String>,
    #[arg(
        long,
        default_value = "tools/graph-exploration/local/observations/observations.jsonl"
    )]
    output: PathBuf,
}

#[derive(Debug)]
struct Session {
    internal_vehicle_id: Uuid,
    rivian_vehicle_id: String,
    tokens: RivianTokenBundle,
}

#[derive(Debug, Serialize, Deserialize)]
struct CaptureEvent {
    received_at: DateTime<Utc>,
    server_timestamp: Option<Value>,
    rvm: String,
    payload_b64: String,
    payload_bytes: usize,
    payload_sha256: String,
}

#[derive(Serialize)]
struct Observation<'a> {
    observed_at: DateTime<Utc>,
    label: &'a str,
    note: Option<&'a str>,
}

#[derive(Default)]
struct TopicSummary {
    events: usize,
    bytes: usize,
    distinct_hashes: std::collections::BTreeSet<String>,
    first_seen: Option<DateTime<Utc>>,
    last_seen: Option<DateTime<Utc>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Auth(args) => {
            let session = load_session(&args.database_url, args.vehicle).await?;
            println!(
                "Encrypted local session is valid for vehicle {}.",
                short_id(session.internal_vehicle_id)
            );
        }
        Command::Capture(args) => capture(args).await?,
        Command::Inventory(args) => inventory(&args.file)?,
        Command::Inspect(args) => inspect(&args.file, args.event)?,
        Command::Observe(args) => observe(args)?,
    }
    Ok(())
}

async fn load_session(database_url: &str, selected_vehicle: Option<Uuid>) -> Result<Session> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .context("connect to the local Riviamigo database")?;

    let rows = sqlx::query_as::<_, (Uuid, String, Vec<u8>, String)>(
        r#"
        SELECT v.id, v.rivian_vehicle_id, c.encrypted_tokens,
               (SELECT value FROM riviamigo.system_config WHERE key = 'age_key')
        FROM riviamigo.vehicles v
        JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id
        WHERE ($1::uuid IS NULL OR v.id = $1)
        ORDER BY v.display_priority, v.created_at
        "#,
    )
    .bind(selected_vehicle)
    .fetch_all(&pool)
    .await
    .context("load encrypted local Rivian credentials")?;

    let (internal_vehicle_id, rivian_vehicle_id, encrypted_tokens, age_key) = match rows.as_slice()
    {
        [] => bail!("no enrolled vehicle credentials were found in the local database"),
        [row] => row.clone(),
        many => {
            let choices = many
                .iter()
                .map(|row| short_id(row.0))
                .collect::<Vec<_>>()
                .join(", ");
            bail!("multiple vehicles are enrolled; rerun with --vehicle <uuid>. Available short IDs: {choices}")
        }
    };

    let identity = age_key
        .parse::<Identity>()
        .map_err(|_| anyhow::anyhow!("the local database Age identity is invalid"))?;
    let tokens =
        decrypt_tokens(&encrypted_tokens, &identity).context("decrypt local Rivian credentials")?;
    tokens
        .validate()
        .context("validate local Rivian credentials")?;

    Ok(Session {
        internal_vehicle_id,
        rivian_vehicle_id,
        tokens,
    })
}

async fn capture(args: CaptureArgs) -> Result<()> {
    if args.duration_seconds == 0 || args.duration_seconds > 86_400 {
        bail!("--duration-seconds must be between 1 and 86400");
    }
    if args.max_events == 0 || args.max_megabytes == 0 {
        bail!("capture limits must be greater than zero");
    }

    let session = load_session(&args.database_url, args.vehicle).await?;
    let topics = if args.all_topics {
        None
    } else if args.topic.is_empty() {
        Some(
            DEFAULT_TOPICS
                .iter()
                .map(|value| value.to_string())
                .collect(),
        )
    } else {
        Some(args.topic)
    };
    let output = args.output.unwrap_or_else(default_capture_path);
    ensure_local_output(&output)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut writer = BufWriter::new(File::create(&output)?);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(args.duration_seconds);
    let max_bytes = args.max_megabytes.saturating_mul(1024 * 1024);
    let mut event_count = 0usize;
    let mut written_bytes = 0u64;
    let mut topics_seen = std::collections::BTreeSet::new();
    let mut connection_count = 0usize;

    'capture: loop {
        if event_count >= args.max_events || written_bytes >= max_bytes {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }

        let mut request = WS_URL.into_client_request()?;
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", "graphql-transport-ws".parse()?);
        let connection = tokio::time::timeout(
            Duration::from_secs(20),
            tokio_tungstenite::connect_async(request),
        )
        .await;
        let (mut websocket, _) = match connection {
            Ok(Ok(connection)) => connection,
            Ok(Err(error)) => {
                eprintln!("Subscription connection failed; retrying: {error}");
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
            Err(_) => {
                eprintln!("Subscription connection timed out; retrying");
                continue;
            }
        };
        connection_count += 1;

        websocket
            .send(Message::Text(
                json!({
                    "type": "connection_init",
                    "payload": {
                        "client-name": "com.rivian.ios.consumer-apollo-ios",
                        "client-version": "1.13.0-1494",
                        "dc-cid": format!("m-ios-{}", Uuid::new_v4()),
                        "u-sess": &session.tokens.user_session_token,
                    }
                })
                .to_string()
                .into(),
            ))
            .await?;

        if let Err(error) = wait_for_ack(&mut websocket).await {
            eprintln!("Subscription acknowledgement failed; retrying: {error}");
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }
        websocket
            .send(Message::Text(
                subscription_message(&session.rivian_vehicle_id, topics.as_deref())
                    .to_string()
                    .into(),
            ))
            .await?;

        loop {
            if event_count >= args.max_events || written_bytes >= max_bytes {
                break 'capture;
            }
            let next = tokio::time::timeout_at(deadline, websocket.next()).await;
            let message = match next {
                Err(_) => break 'capture,
                Ok(Some(Ok(message))) => message,
                Ok(Some(Err(error))) => {
                    eprintln!("Subscription connection ended; retrying: {error}");
                    break;
                }
                Ok(None) => break,
            };

            match message {
                Message::Ping(payload) => websocket.send(Message::Pong(payload)).await?,
                Message::Text(text) => {
                    let value: Value = serde_json::from_str(&text).unwrap_or_default();
                    if value.get("id").and_then(Value::as_str) != Some(SUBSCRIPTION_ID) {
                        continue;
                    }
                    match value.get("type").and_then(Value::as_str) {
                        Some("next") => {
                            let Some(payload) = value.pointer("/payload/data/parallaxMessages")
                            else {
                                continue;
                            };
                            let Some(rvm) = payload.get("rvm").and_then(Value::as_str) else {
                                continue;
                            };
                            let Some(payload_b64) = payload.get("payload").and_then(Value::as_str)
                            else {
                                continue;
                            };
                            let decoded = BASE64
                                .decode(payload_b64)
                                .context("decode Parallax payload")?;
                            let event = CaptureEvent {
                                received_at: Utc::now(),
                                server_timestamp: payload.get("timestamp").cloned(),
                                rvm: rvm.to_string(),
                                payload_b64: payload_b64.to_string(),
                                payload_bytes: decoded.len(),
                                payload_sha256: hex::encode(Sha256::digest(&decoded)),
                            };
                            let line = serde_json::to_string(&event)?;
                            writer.write_all(line.as_bytes())?;
                            writer.write_all(b"\n")?;
                            written_bytes += line.len() as u64 + 1;
                            event_count += 1;
                            topics_seen.insert(event.rvm);
                            if event_count % 100 == 0 {
                                writer.flush()?;
                            }
                        }
                        Some("error") => bail!(
                            "Parallax subscription was rejected: {}",
                            redacted_error(&value)
                        ),
                        Some("complete") => break,
                        _ => {}
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        writer.flush()?;
        if tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_secs(2)).await;
        } else {
            break;
        }
    }

    writer.flush()?;
    println!(
        "Capture complete: {event_count} events, {} topics, {connection_count} connections, {written_bytes} bytes -> {}",
        topics_seen.len(),
        output.display()
    );
    Ok(())
}

async fn wait_for_ack<S>(websocket: &mut S) -> Result<()>
where
    S: StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
        + Unpin,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let message = tokio::time::timeout_at(deadline, websocket.next())
            .await
            .context("timed out waiting for GraphQL WebSocket acknowledgement")?
            .context("subscription endpoint closed before acknowledgement")??;
        match message {
            Message::Text(text) => {
                let value: Value = serde_json::from_str(&text).unwrap_or_default();
                if value.get("type").and_then(Value::as_str) == Some("connection_ack") {
                    return Ok(());
                }
            }
            Message::Ping(payload) => websocket.send(Message::Pong(payload)).await?,
            _ => {}
        }
    }
}

fn subscription_message(vehicle_id: &str, topics: Option<&[String]>) -> Value {
    let mut variables = json!({ "vehicleId": vehicle_id });
    if let Some(topics) = topics {
        variables["rvms"] = json!(topics);
    }
    json!({
        "id": SUBSCRIPTION_ID,
        "type": "subscribe",
        "payload": {
            "operationName": "ParallaxMessages",
            "variables": variables,
            "query": "subscription ParallaxMessages($vehicleId: String!, $rvms: [String!]) { parallaxMessages(vehicleId: $vehicleId, rvms: $rvms) { payload timestamp rvm } }"
        }
    })
}

fn inventory(path: &Path) -> Result<()> {
    let mut summaries: BTreeMap<String, TopicSummary> = BTreeMap::new();
    for line in BufReader::new(File::open(path)?).lines() {
        let event: CaptureEvent = serde_json::from_str(&line?)?;
        let summary = summaries.entry(event.rvm).or_default();
        summary.events += 1;
        summary.bytes += event.payload_bytes;
        summary.distinct_hashes.insert(event.payload_sha256);
        summary.first_seen = Some(
            summary
                .first_seen
                .map_or(event.received_at, |old| old.min(event.received_at)),
        );
        summary.last_seen = Some(
            summary
                .last_seen
                .map_or(event.received_at, |old| old.max(event.received_at)),
        );
    }

    println!("events\tdistinct\tbytes\ttopic");
    for (topic, summary) in summaries {
        println!(
            "{}\t{}\t{}\t{}",
            summary.events,
            summary.distinct_hashes.len(),
            summary.bytes,
            topic
        );
    }
    Ok(())
}

fn inspect(path: &Path, event_number: usize) -> Result<()> {
    if event_number == 0 {
        bail!("--event is one-based and must be greater than zero");
    }
    let line = BufReader::new(File::open(path)?)
        .lines()
        .nth(event_number - 1)
        .context("capture does not contain the requested event")??;
    let event: CaptureEvent = serde_json::from_str(&line)?;
    let bytes = BASE64.decode(&event.payload_b64)?;
    println!("topic: {}", event.rvm);
    println!("payload bytes: {}", bytes.len());
    inspect_wire(&bytes, 0)?;
    Ok(())
}

fn observe(args: ObserveArgs) -> Result<()> {
    ensure_local_output(&args.output)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.output)?;
    let observation = Observation {
        observed_at: Utc::now(),
        label: &args.label,
        note: args.note.as_deref(),
    };
    serde_json::to_writer(&mut file, &observation)?;
    file.write_all(b"\n")?;
    println!("Observation recorded locally: {}", args.label);
    Ok(())
}

fn inspect_wire(bytes: &[u8], depth: usize) -> Result<()> {
    let mut offset = 0usize;
    while offset < bytes.len() {
        let key = read_varint(bytes, &mut offset)?;
        let field = key >> 3;
        let wire = key & 0x07;
        let indent = "  ".repeat(depth);
        match wire {
            0 => println!(
                "{indent}field {field}: varint {}",
                read_varint(bytes, &mut offset)?
            ),
            1 => {
                take(bytes, &mut offset, 8)?;
                println!("{indent}field {field}: fixed64");
            }
            2 => {
                let length = read_varint(bytes, &mut offset)? as usize;
                let value = take(bytes, &mut offset, length)?;
                let digest = hex::encode(Sha256::digest(value));
                println!(
                    "{indent}field {field}: length-delimited {length} bytes sha256={}",
                    &digest[..12]
                );
            }
            5 => {
                take(bytes, &mut offset, 4)?;
                println!("{indent}field {field}: fixed32");
            }
            other => bail!("unsupported protobuf wire type {other} at offset {offset}"),
        }
    }
    Ok(())
}

fn read_varint(bytes: &[u8], offset: &mut usize) -> Result<u64> {
    let mut value = 0u64;
    for shift in (0..70).step_by(7) {
        let byte = *bytes.get(*offset).context("truncated protobuf varint")?;
        *offset += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    bail!("protobuf varint exceeds 64 bits")
}

fn take<'a>(bytes: &'a [u8], offset: &mut usize, length: usize) -> Result<&'a [u8]> {
    let end = offset
        .checked_add(length)
        .context("protobuf length overflow")?;
    let value = bytes
        .get(*offset..end)
        .context("truncated protobuf field")?;
    *offset = end;
    Ok(value)
}

fn default_capture_path() -> PathBuf {
    PathBuf::from("tools/graph-exploration/local/captures").join(format!(
        "capture-{}.jsonl",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    ))
}

fn ensure_local_output(path: &Path) -> Result<()> {
    if path.components().any(|part| part == Component::ParentDir) {
        bail!("local output paths may not contain '..'");
    }
    let local_root = std::env::current_dir()?.join("tools/graph-exploration/local");
    fs::create_dir_all(&local_root)?;
    let canonical_root = local_root.canonicalize()?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let parent = absolute
        .parent()
        .context("local output path has no parent")?;
    fs::create_dir_all(parent)?;
    let canonical_parent = parent.canonicalize()?;
    if !canonical_parent.starts_with(&canonical_root) {
        bail!(
            "capture output must stay beneath {}",
            canonical_root.display()
        );
    }
    if fs::symlink_metadata(&absolute).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        bail!("local output may not be a symbolic link");
    }
    Ok(())
}

fn redacted_error(value: &Value) -> String {
    value
        .pointer("/payload/errors/0/message")
        .and_then(Value::as_str)
        .unwrap_or("server returned a subscription error")
        .chars()
        .take(240)
        .collect()
}

fn short_id(id: Uuid) -> String {
    id.to_string()[..8].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_topics_omits_rvms_variable() {
        let value = subscription_message("vehicle", None);
        assert!(value.pointer("/payload/variables/rvms").is_none());
    }

    #[test]
    fn explicit_topics_are_included() {
        let topics = vec!["network.test".to_string()];
        let value = subscription_message("vehicle", Some(&topics));
        assert_eq!(value["payload"]["variables"]["rvms"][0], "network.test");
    }

    #[test]
    fn wire_inspector_accepts_common_wire_types() {
        inspect_wire(&[0x08, 0x96, 0x01, 0x12, 0x02, 0xaa, 0xbb], 0).unwrap();
    }
}
