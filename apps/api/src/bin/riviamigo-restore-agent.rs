use std::{
    fs::File,
    net::SocketAddr,
    path::{Path, PathBuf},
    time::Duration,
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use flate2::read::GzDecoder;
use serde_json::json;
use tar::Archive;
use tokio::{fs, net::TcpListener, process::Command, time::sleep};
use uuid::Uuid;

use riviamigo_api::{
    config::Config,
    services::{
        backups,
        restore_jobs::{self, RestorePhase},
    },
};

#[derive(Clone)]
struct AgentState {
    config: Config,
    agent_key: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let agent_key = fs::read_to_string(restore_jobs::agent_key_path(&config)).await?;
    let state = AgentState {
        config,
        agent_key: agent_key.trim().into(),
    };
    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route("/v1/restore-runtime/jobs/{job_id}", get(get_job))
        .route("/internal/jobs/{job_id}/execute", post(execute_job))
        .with_state(state);
    let address: SocketAddr = "127.0.0.1:3002".parse()?;
    let listener = TcpListener::bind(address).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn get_job(
    State(state): State<AgentState>,
    AxumPath(job_id): AxumPath<Uuid>,
    headers: HeaderMap,
) -> Result<Json<restore_jobs::RestoreJobPublic>, StatusCode> {
    let token = headers
        .get("x-riviamigo-restore-token")
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let job = restore_jobs::read(&state.config, job_id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !restore_jobs::token_matches(&job, token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(job.public()))
}

async fn execute_job(
    State(state): State<AgentState>,
    AxumPath(job_id): AxumPath<Uuid>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    let supplied = headers
        .get("x-riviamigo-agent-key")
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if supplied != state.agent_key {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let job = restore_jobs::read(&state.config, job_id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !matches!(job.phase, RestorePhase::StoppingApplication) {
        return Err(StatusCode::CONFLICT);
    }
    tokio::spawn(async move {
        if let Err(error) = perform_restore(&state.config, job_id).await {
            let _ = restore_jobs::fail(&state.config, job_id, &error).await;
            let _ = fs::remove_file("/tmp/riviamigo-restore-in-progress").await;
        }
    });
    Ok((StatusCode::ACCEPTED, Json(json!({ "accepted": true }))))
}

async fn perform_restore(config: &Config, job_id: Uuid) -> anyhow::Result<()> {
    let job = restore_jobs::read(config, job_id).await?;
    backups::validate_recovery_package(Path::new(&job.artifact_path)).await?;
    fs::write("/tmp/riviamigo-restore-in-progress", job_id.to_string()).await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::StoppingApplication,
        30,
        "Stopping Riviamigo API and ingestion workers",
    )
    .await?;
    stop_api_process().await?;

    let staging = Path::new(&config.backup_artifact_dir)
        .join(".restore-staging")
        .join(job_id.to_string());
    if fs::try_exists(&staging).await.unwrap_or(false) {
        fs::remove_dir_all(&staging).await?;
    }
    fs::create_dir_all(&staging).await?;
    extract_package(Path::new(&job.artifact_path), &staging).await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::RestoringDatabase,
        45,
        "Restoring PostgreSQL and TimescaleDB data",
    )
    .await?;
    terminate_database_sessions(config).await?;
    let _ = run_psql(config, "SELECT timescaledb_pre_restore();").await;
    run_pg_restore(config, &staging.join("database.dump")).await?;
    let _ = run_psql(config, "SELECT timescaledb_post_restore();").await;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::RestoringSettings,
        70,
        "Restoring sanitized backup settings",
    )
    .await?;
    restore_backup_settings(config, &staging.join("backup-settings.json")).await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::RestoringArtwork,
        78,
        "Restoring vehicle artwork",
    )
    .await?;
    restore_artwork(config, &staging.join("vehicle-image-cache"), job_id).await?;
    let _ = fs::remove_dir_all(&staging).await;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::StartingApplication,
        86,
        "Starting Riviamigo with restored data",
    )
    .await?;
    fs::remove_file("/tmp/riviamigo-restore-in-progress").await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::VerifyingHealth,
        92,
        "Waiting for migrations and application health",
    )
    .await?;
    wait_for_api_health().await?;
    restore_jobs::update(
        config,
        job_id,
        RestorePhase::Completed,
        100,
        "Restore completed successfully",
    )
    .await?;
    Ok(())
}

async fn stop_api_process() -> anyhow::Result<()> {
    let pid = fs::read_to_string("/tmp/riviamigo-api.pid").await?;
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.trim())
        .status()
        .await?;
    if !status.success() {
        anyhow::bail!("could not stop the Riviamigo API process");
    }
    for _ in 0..300 {
        if !Path::new(&format!("/proc/{}", pid.trim())).exists() {
            return Ok(());
        }
        sleep(Duration::from_millis(100)).await;
    }
    anyhow::bail!("Riviamigo API did not stop before restore")
}

async fn extract_package(package: &Path, staging: &Path) -> anyhow::Result<()> {
    let package = package.to_path_buf();
    let staging = staging.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = File::open(package)?;
        let decoder = GzDecoder::new(file);
        let mut archive = Archive::new(decoder);
        archive.unpack(staging)?;
        Ok::<(), anyhow::Error>(())
    })
    .await??;
    Ok(())
}

async fn terminate_database_sessions(config: &Config) -> anyhow::Result<()> {
    run_psql(
        config,
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();",
    )
    .await
}

async fn run_pg_restore(config: &Config, dump: &Path) -> anyhow::Result<()> {
    let mut command = postgres_command("pg_restore", config)?;
    let output = command
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--clean")
        .arg("--if-exists")
        .arg("--exit-on-error")
        .arg(dump)
        .output()
        .await?;
    if output.status.success() {
        return Ok(());
    }
    anyhow::bail!(
        "pg_restore failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )
}

async fn run_psql(config: &Config, sql: &str) -> anyhow::Result<()> {
    let mut command = postgres_command("psql", config)?;
    let output = command
        .arg("-v")
        .arg("ON_ERROR_STOP=1")
        .arg("-c")
        .arg(sql)
        .output()
        .await?;
    if output.status.success() {
        return Ok(());
    }
    anyhow::bail!(
        "psql failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )
}

fn postgres_command(program: &str, config: &Config) -> anyhow::Result<Command> {
    let url = url::Url::parse(&config.database_url)?;
    let mut command = Command::new(program);
    if let Some(host) = url.host_str() {
        command.arg(format!("--host={host}"));
    }
    if let Some(port) = url.port() {
        command.arg(format!("--port={port}"));
    }
    if !url.username().is_empty() {
        command.arg(format!("--username={}", url.username()));
    }
    let database = url.path().trim_start_matches('/');
    if !database.is_empty() {
        command.arg(format!("--dbname={database}"));
    }
    if let Some(password) = url.password() {
        command.env("PGPASSWORD", password);
    }
    Ok(command)
}

async fn restore_backup_settings(config: &Config, path: &Path) -> anyhow::Result<()> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).await?)?;
    if value.get("present").and_then(|value| value.as_bool()) != Some(true) {
        return Ok(());
    }
    let json_literal = serde_json::to_string(&value)?.replace('\'', "''");
    let sql = format!(
        r#"
        INSERT INTO riviamigo.backup_settings (
          id, enabled, frequency, run_at, timezone, day_of_week, day_of_month,
          retention_count, target_type, endpoint, region, bucket, prefix, access_key,
          secret_key_encrypted, updated_at, updated_by
        )
        SELECT TRUE, enabled, frequency, run_at::time, timezone, day_of_week, day_of_month,
          retention_count, target_type, endpoint, region, bucket, prefix, access_key,
          NULL, now(), NULL
        FROM jsonb_to_record('{json_literal}'::jsonb) AS settings(
          present boolean, enabled boolean, frequency text, run_at text, timezone text,
          day_of_week smallint, day_of_month smallint, retention_count integer,
          target_type text, endpoint text, region text, bucket text, prefix text, access_key text
        )
        ON CONFLICT (id) DO UPDATE SET
          enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency, run_at = EXCLUDED.run_at,
          timezone = EXCLUDED.timezone, day_of_week = EXCLUDED.day_of_week,
          day_of_month = EXCLUDED.day_of_month, retention_count = EXCLUDED.retention_count,
          target_type = EXCLUDED.target_type, endpoint = EXCLUDED.endpoint,
          region = EXCLUDED.region, bucket = EXCLUDED.bucket, prefix = EXCLUDED.prefix,
          access_key = EXCLUDED.access_key, secret_key_encrypted = NULL,
          updated_at = now(), updated_by = NULL;
    "#
    );
    run_psql(config, &sql).await
}

async fn restore_artwork(config: &Config, source: &Path, job_id: Uuid) -> anyhow::Result<()> {
    let destination = PathBuf::from(&config.vehicle_image_cache_dir);
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow::anyhow!("invalid artwork path"))?;
    fs::create_dir_all(parent).await?;
    let incoming = parent.join(format!(".vehicle-images-restore-{job_id}"));
    if fs::try_exists(&incoming).await.unwrap_or(false) {
        fs::remove_dir_all(&incoming).await?;
    }
    copy_directory(source, &incoming).await?;
    let ownership = Command::new("chown")
        .arg("-R")
        .arg("1001:1001")
        .arg(&incoming)
        .status()
        .await?;
    if !ownership.success() {
        anyhow::bail!("could not assign restored artwork to the Riviamigo service user");
    }
    let previous = parent.join(format!(".vehicle-images-before-{job_id}"));
    if fs::try_exists(&destination).await.unwrap_or(false) {
        fs::rename(&destination, &previous).await?;
    }
    fs::rename(&incoming, &destination).await?;
    let _ = fs::remove_dir_all(previous).await;
    Ok(())
}

async fn copy_directory(source: &Path, destination: &Path) -> anyhow::Result<()> {
    let source = source.to_path_buf();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&destination)?;
        for entry in walkdir::WalkDir::new(&source) {
            let entry = entry?;
            let relative = entry.path().strip_prefix(&source)?;
            let target = destination.join(relative);
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(target)?;
            } else if entry.file_type().is_file() {
                std::fs::copy(entry.path(), target)?;
            }
        }
        Ok::<(), anyhow::Error>(())
    })
    .await??;
    Ok(())
}

async fn wait_for_api_health() -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    for _ in 0..180 {
        if client
            .get("http://127.0.0.1:3001/health")
            .send()
            .await
            .is_ok_and(|response| response.status().is_success())
        {
            return Ok(());
        }
        sleep(Duration::from_secs(1)).await;
    }
    anyhow::bail!("restored application did not become healthy within 180 seconds")
}
