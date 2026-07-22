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
use chrono::Utc;
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
    let recovery_state = state.clone();
    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route("/v1/restore-runtime/jobs/{job_id}", get(get_job))
        .route("/internal/jobs/{job_id}/execute", post(execute_job))
        .with_state(state);
    let port = std::env::var("RESTORE_AGENT_PORT").unwrap_or_else(|_| "3002".into());
    let address: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let listener = TcpListener::bind(address).await?;
    tokio::spawn(async move {
        if let Err(error) = retry_interrupted_restore(&recovery_state).await {
            tracing::error!(error = ?error, "interrupted restore retry failed");
        }
    });
    axum::serve(listener, app).await?;
    Ok(())
}

async fn retry_interrupted_restore(state: &AgentState) -> anyhow::Result<()> {
    let directory = restore_jobs::jobs_dir(&state.config);
    if !fs::try_exists(&directory).await.unwrap_or(false) {
        return Ok(());
    }
    let mut entries = fs::read_dir(directory).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let id = match entry
            .path()
            .file_stem()
            .and_then(|value| value.to_str())
            .and_then(|value| value.parse().ok())
        {
            Some(id) => id,
            None => continue,
        };
        let job = match restore_jobs::read(&state.config, id).await {
            Ok(job) => job,
            Err(_) => continue,
        };
        if job.phase != RestorePhase::Failed || job.automatic_retry_count > 0 {
            continue;
        }
        let staging = Path::new(&state.config.backup_artifact_dir)
            .join(".restore-staging")
            .join(job.id.to_string());
        if !fs::try_exists(staging.join("manifest.json"))
            .await
            .unwrap_or(false)
            || !fs::try_exists(staging.join("database.dump"))
                .await
                .unwrap_or(false)
        {
            continue;
        }

        let mut retry = job;
        retry.phase = RestorePhase::StoppingApplication;
        retry.progress_percent = 25;
        retry.message = "Retrying interrupted restore with an isolated database".into();
        retry.error_message = None;
        retry.automatic_retry_count = 1;
        retry.updated_at = Utc::now();
        restore_jobs::write(&state.config, &retry).await?;
        fs::write(restore_marker_path(), retry.id.to_string()).await?;
        if let Err(error) = perform_restore(&state.config, retry.id).await {
            let _ = fs::remove_file(restore_marker_path()).await;
            let _ = restore_jobs::fail(&state.config, retry.id, error).await;
        }
        return Ok(());
    }
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
            let _ = fs::remove_file(restore_marker_path()).await;
            if let Ok(job) = restore_jobs::read(&state.config, job_id).await {
                cleanup_remote_staging(&job.artifact_path).await;
            }
        }
    });
    Ok((StatusCode::ACCEPTED, Json(json!({ "accepted": true }))))
}

async fn perform_restore(config: &Config, job_id: Uuid) -> anyhow::Result<()> {
    let job = restore_jobs::read(config, job_id).await?;
    backups::validate_recovery_package(Path::new(&job.artifact_path)).await?;
    fs::write(restore_marker_path(), job_id.to_string()).await?;

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
    let previous_database = restore_database_atomically(
        config,
        job_id,
        &staging.join("database.dump"),
        &staging.join("manifest.json"),
        &staging.join("backup-settings.json"),
    )
    .await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::RestoringSettings,
        70,
        "Restoring sanitized backup settings",
    )
    .await?;

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
    fs::remove_file(restore_marker_path()).await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::VerifyingHealth,
        92,
        "Waiting for migrations and application health",
    )
    .await?;
    wait_for_api_health(config).await?;
    if let Err(error) = drop_database(config, &previous_database).await {
        tracing::warn!(database = %previous_database, error = ?error, "could not remove the previous database after a successful restore");
    }
    restore_jobs::update(
        config,
        job_id,
        RestorePhase::Completed,
        100,
        "Restore completed successfully",
    )
    .await?;
    cleanup_remote_staging(&job.artifact_path).await;
    Ok(())
}

async fn restore_migration_ledger(config: &Config, manifest_path: &Path) -> anyhow::Result<()> {
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(manifest_path).await?)?;
    let source_version = manifest
        .get("source")
        .and_then(|source| source.get("migration_version"))
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("recovery manifest is missing source.migration_version"))?;
    riviamigo_api::db::migrations::restore_ledger(
        &riviamigo_api::db::pool::create_pool(&config.database_url).await?,
        source_version,
    )
    .await
}

async fn cleanup_remote_staging(path: &str) {
    let path = Path::new(path);
    if path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        == Some(".remote-staging")
    {
        let _ = fs::remove_file(path).await;
    }
}

fn api_pid_path() -> PathBuf {
    std::env::var("RIVIAMIGO_API_PID_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/riviamigo-api.pid"))
}

fn restore_marker_path() -> PathBuf {
    std::env::var("RIVIAMIGO_RESTORE_MARKER_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/riviamigo-restore-in-progress"))
}

#[cfg(not(windows))]
async fn stop_api_process() -> anyhow::Result<()> {
    let pid = match fs::read_to_string(api_pid_path()).await {
        Ok(pid) => pid,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !Path::new(&format!("/proc/{}", pid.trim())).exists() {
        return Ok(());
    }
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

#[cfg(windows)]
async fn stop_api_process() -> anyhow::Result<()> {
    let pid = fs::read_to_string(api_pid_path()).await?;
    let status = Command::new("taskkill")
        .args(["/PID", pid.trim(), "/T", "/F"])
        .status()
        .await?;
    if !status.success() {
        anyhow::bail!("could not stop the Riviamigo API process");
    }
    for _ in 0..300 {
        let still_running = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid.trim()), "/NH"])
            .output()
            .await
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(pid.trim()))
            .unwrap_or(false);
        if !still_running {
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

async fn build_restore_toc(dump: &Path, toc_path: &Path) -> anyhow::Result<()> {
    let output = Command::new("pg_restore")
        .arg("--list")
        .arg(dump)
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!(
            "pg_restore could not inspect the recovery dump: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let list = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.contains(" TABLE DATA riviamigo external_connection_activity "))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(toc_path, format!("{list}\n")).await?;
    Ok(())
}

async fn run_pg_restore(config: &Config, dump: &Path, toc_path: &Path) -> anyhow::Result<()> {
    let mut command = postgres_command("pg_restore", config)?;
    let output = command
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--clean")
        .arg("--if-exists")
        .arg("--exit-on-error")
        .arg("--single-transaction")
        .arg(format!("--use-list={}", toc_path.display()))
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

async fn restore_database_atomically(
    config: &Config,
    job_id: Uuid,
    dump: &Path,
    manifest: &Path,
    settings: &Path,
) -> anyhow::Result<String> {
    let restore_database = format!("riviamigo_restore_{}", job_id.simple());
    let previous_database = format!("riviamigo_previous_{}", job_id.simple());
    let restore_config = config_with_database(config, &restore_database)?;
    let toc_path = dump.with_extension("restore-toc");

    create_database(config, &restore_database).await?;
    let restore_result = async {
        build_restore_toc(dump, &toc_path).await?;
        run_pg_restore(&restore_config, dump, &toc_path).await?;
        restore_migration_ledger(&restore_config, manifest).await?;
        let _ = run_psql(&restore_config, "SELECT timescaledb_post_restore();").await;
        restore_backup_settings(&restore_config, settings).await?;
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(error) = restore_result {
        let _ = drop_database(config, &restore_database).await;
        let _ = fs::remove_file(&toc_path).await;
        return Err(error);
    }

    if let Err(error) = swap_databases(config, &restore_database, &previous_database).await {
        let _ = drop_database(config, &restore_database).await;
        let _ = fs::remove_file(&toc_path).await;
        return Err(error);
    }
    let _ = fs::remove_file(&toc_path).await;
    Ok(previous_database)
}

fn config_with_database(config: &Config, database: &str) -> anyhow::Result<Config> {
    let mut cloned = config.clone();
    let mut url = url::Url::parse(&config.database_url)?;
    url.set_path(&format!("/{database}"));
    cloned.database_url = url.to_string();
    Ok(cloned)
}

async fn create_database(config: &Config, database: &str) -> anyhow::Result<()> {
    let sql = format!(
        "CREATE DATABASE {database} TEMPLATE template0;",
        database = quote_identifier(database)
    );
    run_psql_on_database(config, "postgres", &sql).await
}

async fn swap_databases(
    config: &Config,
    restore_database: &str,
    previous_database: &str,
) -> anyhow::Result<()> {
    let sql = format!(
        r#"
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname IN ('riviamigo', {restore_database_literal})
          AND pid <> pg_backend_pid();
        ALTER DATABASE riviamigo RENAME TO {previous_database};
        ALTER DATABASE {restore_database} RENAME TO riviamigo;
        "#,
        restore_database_literal = quote_literal(restore_database),
        previous_database = quote_identifier(previous_database),
        restore_database = quote_identifier(restore_database),
    );
    run_psql_on_database(config, "postgres", &sql).await
}

async fn drop_database(config: &Config, database: &str) -> anyhow::Result<()> {
    let sql = format!(
        "DROP DATABASE IF EXISTS {database} WITH (FORCE);",
        database = quote_identifier(database)
    );
    run_psql_on_database(config, "postgres", &sql).await
}

async fn run_psql_on_database(config: &Config, database: &str, sql: &str) -> anyhow::Result<()> {
    let mut command = postgres_command_for_database("psql", config, database)?;
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

async fn run_psql(config: &Config, sql: &str) -> anyhow::Result<()> {
    let database = url::Url::parse(&config.database_url)?
        .path()
        .trim_start_matches('/')
        .to_string();
    run_psql_on_database(config, &database, sql).await
}

fn postgres_command(program: &str, config: &Config) -> anyhow::Result<Command> {
    let database = url::Url::parse(&config.database_url)?
        .path()
        .trim_start_matches('/')
        .to_string();
    postgres_command_for_database(program, config, &database)
}

fn postgres_command_for_database(
    program: &str,
    config: &Config,
    database: &str,
) -> anyhow::Result<Command> {
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
    if !database.is_empty() {
        command.arg(format!("--dbname={database}"));
    }
    if let Some(password) = url.password() {
        command.env("PGPASSWORD", password);
    }
    Ok(command)
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

async fn restore_backup_settings(config: &Config, path: &Path) -> anyhow::Result<()> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).await?)?;
    if value.get("present").and_then(|value| value.as_bool()) != Some(true) {
        return Ok(());
    }
    let json_literal = serde_json::to_string(&value)?.replace('\'', "''");
    let sql = format!(
        r#"
        ALTER TABLE riviamigo.backup_settings
          ADD COLUMN IF NOT EXISTS local_enabled boolean NOT NULL DEFAULT true,
          ADD COLUMN IF NOT EXISTS s3_enabled boolean NOT NULL DEFAULT false;
        INSERT INTO riviamigo.backup_settings (
          id, enabled, frequency, run_at, timezone, day_of_week, day_of_month,
          retention_count, local_enabled, s3_enabled, target_type, endpoint, region, bucket, prefix, access_key,
          secret_key_encrypted, updated_at, updated_by
        )
        SELECT TRUE, enabled, frequency, run_at::time, timezone, day_of_week, day_of_month,
          retention_count, COALESCE(local_enabled, TRUE), COALESCE(s3_enabled, FALSE), target_type, endpoint, region, bucket, prefix, access_key,
          NULL, now(), NULL
        FROM jsonb_to_record('{json_literal}'::jsonb) AS settings(
          present boolean, enabled boolean, frequency text, run_at text, timezone text,
          day_of_week smallint, day_of_month smallint, retention_count integer, local_enabled boolean, s3_enabled boolean,
          target_type text, endpoint text, region text, bucket text, prefix text, access_key text
        )
        ON CONFLICT (id) DO UPDATE SET
          enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency, run_at = EXCLUDED.run_at,
          timezone = EXCLUDED.timezone, day_of_week = EXCLUDED.day_of_week,
          day_of_month = EXCLUDED.day_of_month, retention_count = EXCLUDED.retention_count,
          local_enabled = EXCLUDED.local_enabled, s3_enabled = EXCLUDED.s3_enabled,
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
    #[cfg(not(windows))]
    {
        let ownership = Command::new("chown")
            .arg("-R")
            .arg("1001:1001")
            .arg(&incoming)
            .status()
            .await?;
        if !ownership.success() {
            anyhow::bail!("could not assign restored artwork to the Riviamigo service user");
        }
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

async fn wait_for_api_health(config: &Config) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/health", config.port);
    for _ in 0..180 {
        if client
            .get(&health_url)
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
