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
        backups, restore_compatibility,
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
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(command) = arguments.first().map(String::as_str) {
        match command {
            "host-restore" => {
                let package = arguments
                    .get(1)
                    .ok_or_else(|| anyhow::anyhow!("host-restore requires a package path"))?;
                host_restore(
                    &config,
                    Path::new(package),
                    arguments.iter().any(|arg| arg == "--force"),
                )
                .await?;
                return Ok(());
            }
            "host-finalize" => {
                finalize_host_restore(&config).await?;
                return Ok(());
            }
            "host-activate" => {
                activate_host_restore(&config).await?;
                return Ok(());
            }
            "host-rollback" => {
                rollback_host_restore(&config).await?;
                return Ok(());
            }
            _ => {}
        }
    }
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

#[derive(serde::Serialize, serde::Deserialize)]
struct HostRestoreState {
    job_id: Uuid,
    artifact_id: Uuid,
    request_id: Uuid,
    candidate_database: String,
    previous_database: String,
    #[serde(default)]
    artwork_destination: Option<PathBuf>,
    #[serde(default)]
    artwork_previous: Option<PathBuf>,
    #[serde(default)]
    activated: bool,
    #[serde(default)]
    activation_started: bool,
    staging: PathBuf,
    plan: restore_compatibility::RestorePlan,
    validation_report: restore_compatibility::CandidatePreparationReport,
}

fn host_restore_state_path(config: &Config) -> PathBuf {
    Path::new(&config.backup_artifact_dir).join(".host-restore-state.json")
}

async fn host_restore(config: &Config, package: &Path, force: bool) -> anyhow::Result<()> {
    let state_path = host_restore_state_path(config);
    if fs::try_exists(&state_path).await.unwrap_or(false) {
        anyhow::bail!("a host restore is already awaiting finalize or rollback");
    }
    let validated = backups::validate_recovery_package(package).await?;
    let dump_inspection = restore_compatibility::inspect_recovery_dump(package).await?;
    let current_pool = riviamigo_api::db::pool::create_pool(&config.database_url).await?;
    let mut users_table: bool =
        sqlx::query_scalar("SELECT to_regclass('riviamigo.users') IS NOT NULL")
            .fetch_one(&current_pool)
            .await?;
    if !users_table {
        let mut migration_connection = current_pool.acquire().await?;
        sqlx::query("SET search_path = public")
            .execute(&mut *migration_connection)
            .await?;
        riviamigo_api::db::migrations::MIGRATOR
            .run_direct(None, &mut *migration_connection, false)
            .await?;
        drop(migration_connection);
        users_table = true;
    }
    if users_table {
        let has_users: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM riviamigo.users)")
            .fetch_one(&current_pool)
            .await?;
        if has_users && !force {
            anyhow::bail!(
                "target database contains users; pass --force to replace this installation"
            );
        }
    }
    backups::reconcile_local_catalog(&current_pool, config).await?;
    let plan = restore_compatibility::plan_restore(
        &validated.manifest,
        &validated.checksum_sha256,
        &current_pool,
        Some(&dump_inspection),
    )
    .await?;
    if !plan.compatible {
        anyhow::bail!(
            "host restore compatibility preflight failed: {}",
            plan.blocking_errors
                .iter()
                .map(|error| error.message.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    let target_history = restore_jobs::snapshot_catalog(&current_pool).await.ok();

    let job_id = Uuid::new_v4();
    let staging = Path::new(&config.backup_artifact_dir)
        .join(".restore-staging")
        .join(format!("host-{job_id}"));
    fs::create_dir_all(&staging).await?;
    let staged_package = staging.join("recovery-package.rma.tar.gz");
    fs::copy(package, &staged_package).await?;
    let staged_validation = backups::validate_recovery_package(&staged_package).await?;
    if staged_validation.checksum_sha256 != validated.checksum_sha256 {
        let _ = fs::remove_dir_all(&staging).await;
        anyhow::bail!("recovery package changed while it was being staged");
    }
    extract_package(&staged_package, &staging).await?;
    let prepared = prepare_restore_database(
        config,
        job_id,
        &staging.join("database.dump"),
        &validated.manifest,
        &staging.join("backup-settings.json"),
        Some(&staging.join("operational-history.json")),
        target_history.as_ref(),
    )
    .await?;
    let planned_transforms = plan
        .transforms
        .iter()
        .map(|transform| transform.id.as_str())
        .collect::<Vec<_>>();
    let applied_transforms = prepared
        .validation_report
        .applied_transforms
        .iter()
        .map(|transform| transform.id.as_str())
        .collect::<Vec<_>>();
    if planned_transforms != applied_transforms {
        let _ = drop_database(config, &prepared.candidate_database).await;
        current_pool.close().await;
        anyhow::bail!(
            "candidate compatibility transforms changed after preflight: planned={planned_transforms:?}, actual={applied_transforms:?}"
        );
    }
    if prepared.validation_report.target_schema.schema_fingerprint
        != plan.target.schema_fingerprint.clone().unwrap_or_default()
    {
        let _ = drop_database(config, &prepared.candidate_database).await;
        current_pool.close().await;
        anyhow::bail!("candidate final schema contract differs from the preflight target contract");
    }
    let safety_and_merge = async {
        backups::run_backup_now(
            &current_pool,
            config,
            None,
            backups::BackupRunTrigger::PreRestore,
        )
        .await?;
        backups::reconcile_local_catalog(&current_pool, config).await?;
        let final_target_history = restore_jobs::snapshot_catalog(&current_pool).await?;
        let candidate_config = config_with_database(config, &prepared.candidate_database)?;
        let candidate_pool =
            riviamigo_api::db::pool::create_pool(&candidate_config.database_url).await?;
        restore_jobs::merge_catalog_snapshot(&candidate_pool, &final_target_history).await?;
        candidate_pool.close().await;
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(error) = safety_and_merge {
        let _ = drop_database(config, &prepared.candidate_database).await;
        current_pool.close().await;
        return Err(error);
    }
    current_pool.close().await;
    let state = HostRestoreState {
        job_id,
        artifact_id: Uuid::new_v4(),
        request_id: Uuid::new_v4(),
        candidate_database: prepared.candidate_database,
        previous_database: prepared.previous_database,
        artwork_destination: None,
        artwork_previous: None,
        activated: false,
        activation_started: false,
        staging,
        plan,
        validation_report: prepared.validation_report,
    };
    if let Err(error) = async {
        fs::write(&state_path, serde_json::to_vec_pretty(&state)?).await?;
        Ok::<(), anyhow::Error>(())
    }
    .await
    {
        let _ = drop_database(config, &state.candidate_database).await;
        let _ = fs::remove_dir_all(&state.staging).await;
        return Err(error);
    }
    println!(
        "host restore candidate prepared and validated; state={}",
        state_path.display()
    );
    Ok(())
}

async fn read_host_restore_state(config: &Config) -> anyhow::Result<HostRestoreState> {
    Ok(serde_json::from_slice(
        &fs::read(host_restore_state_path(config)).await?,
    )?)
}

async fn activate_host_restore(config: &Config) -> anyhow::Result<()> {
    let mut state = read_host_restore_state(config).await?;
    if state.activated {
        return Ok(());
    }
    if state.activation_started {
        anyhow::bail!("host restore activation was interrupted; run host-rollback before retrying");
    }
    state.activation_started = true;
    fs::write(
        host_restore_state_path(config),
        serde_json::to_vec_pretty(&state)?,
    )
    .await?;
    terminate_database_sessions(config).await?;
    swap_databases(config, &state.candidate_database, &state.previous_database).await?;
    let artwork = match activate_artwork(
        config,
        &state.staging.join("vehicle-image-cache"),
        state.job_id,
    )
    .await
    {
        Ok(artwork) => artwork,
        Err(error) => {
            rollback_databases(config, &state.previous_database, &state.candidate_database).await?;
            return Err(error);
        }
    };
    state.artwork_destination = Some(artwork.destination);
    state.artwork_previous = Some(artwork.previous);
    state.activated = true;
    if let Err(error) = fs::write(
        host_restore_state_path(config),
        serde_json::to_vec_pretty(&state)?,
    )
    .await
    {
        rollback_databases(config, &state.previous_database, &state.candidate_database).await?;
        rollback_artwork(&artwork_activation_from_state(&state)?).await?;
        return Err(error.into());
    }
    println!("host restore candidate activated");
    Ok(())
}

fn artwork_activation_from_state(state: &HostRestoreState) -> anyhow::Result<ArtworkActivation> {
    Ok(ArtworkActivation {
        destination: state
            .artwork_destination
            .clone()
            .ok_or_else(|| anyhow::anyhow!("host restore artwork destination is unavailable"))?,
        previous: state
            .artwork_previous
            .clone()
            .ok_or_else(|| anyhow::anyhow!("host restore previous artwork path is unavailable"))?,
    })
}

async fn finalize_host_restore(config: &Config) -> anyhow::Result<()> {
    let state = read_host_restore_state(config).await?;
    if !state.activated {
        anyhow::bail!("host restore candidate has not been activated");
    }
    record_host_restore_history(config, &state, "completed", None).await?;
    drop_database(config, &state.previous_database).await?;
    finalize_artwork(&artwork_activation_from_state(&state)?).await;
    let _ = fs::remove_dir_all(&state.staging).await;
    write_host_restore_report(config, &state, "completed", None).await?;
    fs::remove_file(host_restore_state_path(config)).await?;
    Ok(())
}

async fn rollback_host_restore(config: &Config) -> anyhow::Result<()> {
    let state = read_host_restore_state(config).await?;
    if state.activated
        || (state.activation_started
            && database_exists(config, &state.previous_database)
                .await
                .unwrap_or(false))
    {
        rollback_databases(config, &state.previous_database, &state.candidate_database).await?;
        if state.artwork_destination.is_some() && state.artwork_previous.is_some() {
            rollback_artwork(&artwork_activation_from_state(&state)?).await?;
        }
    } else {
        drop_database(config, &state.candidate_database).await?;
    }
    record_host_restore_history(
        config,
        &state,
        "failed",
        Some("Application verification failed after candidate activation; rollback succeeded"),
    )
    .await?;
    let _ = fs::remove_dir_all(&state.staging).await;
    write_host_restore_report(
        config,
        &state,
        "rolled_back",
        Some("Application verification failed after candidate activation"),
    )
    .await?;
    fs::remove_file(host_restore_state_path(config)).await?;
    Ok(())
}

async fn record_host_restore_history(
    config: &Config,
    state: &HostRestoreState,
    status: &str,
    error: Option<&str>,
) -> anyhow::Result<()> {
    let pool = riviamigo_api::db::pool::create_pool(&config.database_url).await?;
    sqlx::query(
        r#"
        INSERT INTO riviamigo.backup_runs
          (id, trigger, status, requested_by, artifact_key, started_at, completed_at, error_message, created_at, updated_at)
        VALUES ($1, 'restore', $2, NULL, $3, now(), now(), $4, now(), now())
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at, error_message = EXCLUDED.error_message, updated_at = now()
        "#,
    )
    .bind(state.job_id)
    .bind(if status == "completed" { "succeeded" } else { "failed" })
    .bind(format!("restore:{}", state.plan.package_checksum_sha256))
    .bind(error)
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO riviamigo.backup_artifacts
          (id, run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest, created_at)
        VALUES ($1, $2, 'uploaded', 'host-restore-package.rma.tar.gz', $3, 0, $4, $5, now())
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(state.artifact_id)
    .bind(state.job_id)
    .bind(format!("host-restore:{}", state.plan.package_checksum_sha256))
    .bind(&state.plan.package_checksum_sha256)
    .bind(json!({
        "artifact_kind": "recovery_package",
        "format": state.plan.package_format,
        "restore_availability": "unavailable",
        "plan_id": state.plan.plan_id,
    }))
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO riviamigo.backup_restore_requests
          (id, artifact_id, requested_by, status, confirmation_phrase, notes, error_message, requested_at, updated_at)
        VALUES ($1, $2, NULL, $3, 'RESTORE', 'Host restore command', $4, now(), now())
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
          error_message = EXCLUDED.error_message, updated_at = now()
        "#,
    )
    .bind(state.request_id)
    .bind(state.artifact_id)
    .bind(status)
    .bind(error)
    .execute(&pool)
    .await?;
    pool.close().await;
    Ok(())
}

async fn write_host_restore_report(
    config: &Config,
    state: &HostRestoreState,
    status: &str,
    error: Option<&str>,
) -> anyhow::Result<()> {
    let directory = Path::new(&config.backup_artifact_dir).join(".restore-reports");
    fs::create_dir_all(&directory).await?;
    fs::write(
        directory.join(format!("{}.json", state.job_id)),
        serde_json::to_vec_pretty(&json!({
            "job_id": state.job_id,
            "status": status,
            "completed_at": Utc::now(),
            "plan": state.plan,
            "validation_report": state.validation_report,
            "error": error,
        }))?,
    )
    .await?;
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
        if matches!(job.phase, RestorePhase::Completed | RestorePhase::Queued)
            || !job.retryable
            || job.automatic_retry_count >= 2
        {
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

        if let Some(previous) = job.previous_database.as_deref() {
            if database_exists(&state.config, previous)
                .await
                .unwrap_or(false)
            {
                let candidate = job
                    .candidate_database
                    .clone()
                    .unwrap_or_else(|| format!("riviamigo_restore_{}", job.id.simple()));
                let _ = fs::write(restore_marker_path(), job.id.to_string()).await;
                let _ = stop_api_process().await;
                rollback_databases(&state.config, previous, &candidate).await?;
                let _ = drop_database(&state.config, &candidate).await;
                let _ = fs::remove_file(restore_marker_path()).await;
            }
        }

        let next_retry_count = job.automatic_retry_count.saturating_add(1);
        let mut retry = job;
        retry.phase = RestorePhase::PreparingCandidate;
        retry.progress_percent = 25;
        retry.message = "Retrying interrupted restore with an isolated database".into();
        retry.error_message = None;
        retry.automatic_retry_count = next_retry_count;
        retry.updated_at = Utc::now();
        restore_jobs::write(&state.config, &retry).await?;
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
    if !matches!(job.phase, RestorePhase::PreparingCandidate) {
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
    let staging = Path::new(&config.backup_artifact_dir)
        .join(".restore-staging")
        .join(job_id.to_string());
    if fs::try_exists(&staging).await.unwrap_or(false) {
        fs::remove_dir_all(&staging).await?;
    }
    fs::create_dir_all(&staging).await?;
    let staged_package = staging.join("recovery-package.rma.tar.gz");
    fs::copy(Path::new(&job.artifact_path), &staged_package).await?;
    let validated = backups::validate_recovery_package(&staged_package).await?;
    if job
        .plan
        .as_ref()
        .map(|plan| plan.package_checksum_sha256.as_str())
        != Some(validated.checksum_sha256.as_str())
    {
        let mut terminal = job;
        terminal.retryable = false;
        terminal.updated_at = Utc::now();
        restore_jobs::write(config, &terminal).await?;
        anyhow::bail!("recovery package checksum changed after restore preflight");
    }
    inject_restore_fault("package_validated")?;
    extract_package(&staged_package, &staging).await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::PreparingCandidate,
        32,
        "Restoring and validating an isolated database candidate",
    )
    .await?;
    let prepared = match prepare_restore_database(
        config,
        job_id,
        &staging.join("database.dump"),
        &validated.manifest,
        &staging.join("backup-settings.json"),
        Some(&staging.join("operational-history.json")),
        job.catalog_snapshot.as_ref(),
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(error) => {
            let mut terminal = restore_jobs::read(config, job_id).await?;
            terminal.retryable = false;
            terminal.updated_at = Utc::now();
            restore_jobs::write(config, &terminal).await?;
            return Err(error);
        }
    };
    let planned_transforms = job
        .plan
        .as_ref()
        .map(|plan| {
            plan.transforms
                .iter()
                .map(|transform| transform.id.as_str())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let applied_transforms = prepared
        .validation_report
        .applied_transforms
        .iter()
        .map(|transform| transform.id.as_str())
        .collect::<Vec<_>>();
    if planned_transforms != applied_transforms {
        let _ = drop_database(config, &prepared.candidate_database).await;
        let mut terminal = restore_jobs::read(config, job_id).await?;
        terminal.retryable = false;
        terminal.updated_at = Utc::now();
        restore_jobs::write(config, &terminal).await?;
        anyhow::bail!(
            "candidate compatibility transforms changed after preflight: planned={planned_transforms:?}, actual={applied_transforms:?}"
        );
    }
    let expected_target_contract = job
        .plan
        .as_ref()
        .and_then(|plan| plan.target.schema_fingerprint.as_deref())
        .unwrap_or_default();
    if prepared.validation_report.target_schema.schema_fingerprint != expected_target_contract {
        let _ = drop_database(config, &prepared.candidate_database).await;
        let mut terminal = restore_jobs::read(config, job_id).await?;
        terminal.retryable = false;
        terminal.updated_at = Utc::now();
        restore_jobs::write(config, &terminal).await?;
        anyhow::bail!("candidate final schema contract differs from the preflight target contract");
    }
    inject_restore_fault("candidate_validated")?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::SafetyBackup,
        58,
        "Candidate validated; creating the required safety package",
    )
    .await?;
    let live_pool = riviamigo_api::db::pool::create_pool(&config.database_url).await?;
    let safety = backups::run_backup_now(
        &live_pool,
        config,
        None,
        backups::BackupRunTrigger::PreRestore,
    )
    .await?;
    inject_restore_fault("safety_backup")?;
    backups::reconcile_local_catalog(&live_pool, config).await?;
    let (safety_artifact_id, safety_path): (Uuid, String) = sqlx::query_as(
        "SELECT id, storage_path FROM riviamigo.backup_artifacts WHERE run_id = $1 AND storage_type = 'safety' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(safety.run_id)
    .fetch_one(&live_pool)
    .await?;
    let final_target_history = restore_jobs::snapshot_catalog(&live_pool).await?;
    live_pool.close().await;
    let candidate_config = config_with_database(config, &prepared.candidate_database)?;
    let candidate_pool =
        riviamigo_api::db::pool::create_pool(&candidate_config.database_url).await?;
    restore_jobs::merge_catalog_snapshot(&candidate_pool, &final_target_history).await?;
    candidate_pool.close().await;
    inject_restore_fault("history_merged")?;

    let mut checkpoint = restore_jobs::read(config, job_id).await?;
    checkpoint.safety_artifact_path = Some(safety_path);
    checkpoint.safety_run_id = Some(safety.run_id);
    checkpoint.safety_artifact_id = Some(safety_artifact_id);
    checkpoint.catalog_snapshot = Some(final_target_history);
    checkpoint.validation_report = Some(prepared.validation_report.clone());
    checkpoint.candidate_database = Some(prepared.candidate_database.clone());
    checkpoint.previous_database = Some(prepared.previous_database.clone());
    checkpoint.rollback_state = restore_jobs::RollbackState::Available;
    checkpoint.updated_at = Utc::now();
    restore_jobs::write(config, &checkpoint).await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::StoppingApplication,
        68,
        "Candidate is ready; stopping Riviamigo API and ingestion workers",
    )
    .await?;
    fs::write(restore_marker_path(), job_id.to_string()).await?;
    stop_api_process().await?;
    terminate_database_sessions(config).await?;

    restore_jobs::update(
        config,
        job_id,
        RestorePhase::SwappingDatabase,
        74,
        "Atomically activating the validated database candidate",
    )
    .await?;
    swap_databases(
        config,
        &prepared.candidate_database,
        &prepared.previous_database,
    )
    .await?;
    if let Err(error) = inject_restore_fault("database_swapped") {
        return Err(rollback_activated_candidate(config, job_id, &prepared, None, error).await);
    }

    if let Err(error) = restore_jobs::update(
        config,
        job_id,
        RestorePhase::RestoringSettings,
        70,
        "Restoring sanitized backup settings",
    )
    .await
    {
        return Err(
            rollback_activated_candidate(config, job_id, &prepared, None, error.into()).await,
        );
    }

    if let Err(error) = restore_jobs::update(
        config,
        job_id,
        RestorePhase::RestoringArtwork,
        78,
        "Restoring vehicle artwork",
    )
    .await
    {
        return Err(
            rollback_activated_candidate(config, job_id, &prepared, None, error.into()).await,
        );
    }
    let artwork = match activate_artwork(config, &staging.join("vehicle-image-cache"), job_id).await
    {
        Ok(artwork) => artwork,
        Err(error) => {
            return Err(rollback_activated_candidate(config, job_id, &prepared, None, error).await);
        }
    };

    if let Err(error) = restore_jobs::update(
        config,
        job_id,
        RestorePhase::StartingApplication,
        86,
        "Starting Riviamigo with restored data",
    )
    .await
    {
        return Err(rollback_activated_candidate(
            config,
            job_id,
            &prepared,
            Some(&artwork),
            error.into(),
        )
        .await);
    }
    if let Err(error) = fs::remove_file(restore_marker_path()).await {
        return Err(rollback_activated_candidate(
            config,
            job_id,
            &prepared,
            Some(&artwork),
            error.into(),
        )
        .await);
    }

    if let Err(error) = restore_jobs::update(
        config,
        job_id,
        RestorePhase::VerifyingHealth,
        92,
        "Waiting for migrations and application health",
    )
    .await
    {
        return Err(rollback_activated_candidate(
            config,
            job_id,
            &prepared,
            Some(&artwork),
            error.into(),
        )
        .await);
    }
    let verification = inject_restore_fault("artwork_activated")
        .and_then(|_| inject_restore_fault("health_verification"));
    let verification = match verification {
        Ok(()) => verify_api_state(config).await,
        Err(error) => Err(error),
    };
    if let Err(error) = verification {
        return Err(
            rollback_activated_candidate(config, job_id, &prepared, Some(&artwork), error).await,
        );
    }
    finalize_artwork(&artwork).await;
    let _ = fs::remove_dir_all(&staging).await;
    if let Err(error) = drop_database(config, &prepared.previous_database).await {
        tracing::warn!(database = %prepared.previous_database, error = ?error, "could not remove the previous database after a successful restore");
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

async fn rollback_activated_candidate(
    config: &Config,
    job_id: Uuid,
    prepared: &PreparedDatabase,
    artwork: Option<&ArtworkActivation>,
    cause: anyhow::Error,
) -> anyhow::Error {
    let rollback_result = async {
        if let Ok(mut rollback_job) = restore_jobs::read(config, job_id).await {
            rollback_job.phase = RestorePhase::RollingBack;
            rollback_job.message =
                "Activation failed; restoring the previous database and artwork".into();
            rollback_job.rollback_state = restore_jobs::RollbackState::InProgress;
            rollback_job.updated_at = Utc::now();
            restore_jobs::write(config, &rollback_job).await?;
        }
        fs::write(restore_marker_path(), job_id.to_string()).await?;
        let _ = stop_api_process().await;
        rollback_databases(
            config,
            &prepared.previous_database,
            &prepared.candidate_database,
        )
        .await?;
        if let Some(artwork) = artwork {
            rollback_artwork(artwork).await?;
        }
        let _ = fs::remove_file(restore_marker_path()).await;
        wait_for_api_health(config).await?;
        if let Ok(mut rollback_job) = restore_jobs::read(config, job_id).await {
            rollback_job.rollback_state = restore_jobs::RollbackState::Succeeded;
            rollback_job.retryable = true;
            rollback_job.updated_at = Utc::now();
            restore_jobs::write(config, &rollback_job).await?;
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;
    match rollback_result {
        Ok(()) => anyhow::anyhow!(
            "restored candidate activation failed and was rolled back: {cause}"
        ),
        Err(rollback_error) => anyhow::anyhow!(
            "restored candidate activation failed ({cause}); automatic rollback also failed: {rollback_error}"
        ),
    }
}

fn inject_restore_fault(phase: &str) -> anyhow::Result<()> {
    if std::env::var("RIVIAMIGO_RESTORE_FAULT_PHASE").as_deref() == Ok(phase) {
        anyhow::bail!("restore fault injection triggered at {phase}");
    }
    Ok(())
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

struct PreparedDatabase {
    candidate_database: String,
    previous_database: String,
    validation_report: restore_compatibility::CandidatePreparationReport,
}

async fn prepare_restore_database(
    config: &Config,
    job_id: Uuid,
    dump: &Path,
    manifest: &serde_json::Value,
    settings: &Path,
    history: Option<&Path>,
    target_history: Option<&restore_jobs::BackupCatalogSnapshot>,
) -> anyhow::Result<PreparedDatabase> {
    let restore_database = format!("riviamigo_restore_{}", job_id.simple());
    let previous_database = format!("riviamigo_previous_{}", job_id.simple());
    let restore_config = config_with_database(config, &restore_database)?;
    let toc_path = dump.with_extension("restore-toc");

    if database_exists(config, &restore_database).await? {
        drop_database(config, &restore_database).await?;
    }
    create_database(config, &restore_database).await?;
    let restore_result = async {
        inject_restore_fault("timescale_pre_restore")?;
        run_psql_with_retry(
            &restore_config,
            "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();",
            30,
        )
        .await?;
        build_restore_toc(dump, &toc_path).await?;
        run_pg_restore(&restore_config, dump, &toc_path).await?;
        inject_restore_fault("dump_restored")?;
        let pool = riviamigo_api::db::pool::create_pool(&restore_config.database_url).await?;
        let validation_report =
            restore_compatibility::prepare_candidate_schema(&pool, manifest).await?;
        if let Some(history) = history {
            if fs::try_exists(history).await.unwrap_or(false) {
                let mut source_history: restore_jobs::BackupCatalogSnapshot =
                    serde_json::from_slice(&fs::read(history).await?)?;
                restore_jobs::mark_source_artifact_availability(
                    &mut source_history,
                    target_history,
                );
                restore_jobs::merge_catalog_snapshot(&pool, &source_history).await?;
            }
        }
        if let Some(target_history) = target_history {
            restore_jobs::merge_catalog_snapshot(&pool, target_history).await?;
        }
        pool.close().await;
        run_psql(&restore_config, "SELECT timescaledb_post_restore();").await?;
        restore_backup_settings(&restore_config, settings).await?;
        Ok::<_, anyhow::Error>(validation_report)
    }
    .await;
    let validation_report = match restore_result {
        Ok(report) => report,
        Err(error) => {
            let _ = drop_database(config, &restore_database).await;
            let _ = fs::remove_file(&toc_path).await;
            return Err(error);
        }
    };
    let _ = fs::remove_file(&toc_path).await;
    Ok(PreparedDatabase {
        candidate_database: restore_database,
        previous_database,
        validation_report,
    })
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

async fn rollback_databases(
    config: &Config,
    previous_database: &str,
    failed_database: &str,
) -> anyhow::Result<()> {
    let sql = format!(
        r#"
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname IN ('riviamigo', {previous_literal})
          AND pid <> pg_backend_pid();
        ALTER DATABASE riviamigo RENAME TO {failed};
        ALTER DATABASE {previous} RENAME TO riviamigo;
        "#,
        previous_literal = quote_literal(previous_database),
        failed = quote_identifier(failed_database),
        previous = quote_identifier(previous_database),
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

async fn database_exists(config: &Config, database: &str) -> anyhow::Result<bool> {
    let mut command = postgres_command_for_database("psql", config, "postgres")?;
    let output = command
        .arg("-At")
        .arg("-v")
        .arg("ON_ERROR_STOP=1")
        .arg("-c")
        .arg(format!(
            "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = {});",
            quote_literal(database)
        ))
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!(
            "could not inspect database state: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() == "t")
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

async fn run_psql_with_retry(config: &Config, sql: &str, attempts: u32) -> anyhow::Result<()> {
    let mut last_error = None;
    for _ in 0..attempts.max(1) {
        match run_psql(config, sql).await {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        sleep(Duration::from_secs(1)).await;
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("PostgreSQL readiness retry failed")))
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
        INSERT INTO riviamigo.system_config (key, value)
        SELECT 'app_timezone', timezone
        FROM jsonb_to_record('{json_literal}'::jsonb) AS settings(timezone text)
        WHERE timezone IS NOT NULL AND btrim(timezone) <> ''
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    "#
    );
    run_psql(config, &sql).await
}

struct ArtworkActivation {
    destination: PathBuf,
    previous: PathBuf,
}

async fn activate_artwork(
    config: &Config,
    source: &Path,
    job_id: Uuid,
) -> anyhow::Result<ArtworkActivation> {
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
    Ok(ArtworkActivation {
        destination,
        previous,
    })
}

async fn rollback_artwork(activation: &ArtworkActivation) -> anyhow::Result<()> {
    if fs::try_exists(&activation.destination)
        .await
        .unwrap_or(false)
    {
        fs::remove_dir_all(&activation.destination).await?;
    }
    if fs::try_exists(&activation.previous).await.unwrap_or(false) {
        fs::rename(&activation.previous, &activation.destination).await?;
    }
    Ok(())
}

async fn finalize_artwork(activation: &ArtworkActivation) {
    if fs::try_exists(&activation.previous).await.unwrap_or(false) {
        let _ = fs::remove_dir_all(&activation.previous).await;
    }
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

async fn verify_api_state(config: &Config) -> anyhow::Result<()> {
    wait_for_api_health(config).await?;
    let setup_url = format!("http://127.0.0.1:{}/v1/auth/setup", config.port);
    let response = reqwest::Client::new().get(setup_url).send().await?;
    if !response.status().is_success() {
        anyhow::bail!(
            "restored application setup-state check failed with {}",
            response.status()
        );
    }
    let payload: serde_json::Value = response.json().await?;
    if payload
        .get("setup_required")
        .and_then(serde_json::Value::as_bool)
        != Some(false)
    {
        anyhow::bail!("restored application unexpectedly requires owner setup");
    }
    Ok(())
}
