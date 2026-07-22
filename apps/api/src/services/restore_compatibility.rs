use chrono::Utc;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    fs::File,
    path::{Path, PathBuf},
};
use tar::Archive;
use tokio::{fs, process::Command};
use uuid::Uuid;

use crate::{db::migrations::MIGRATOR, errors::AppError};

pub const RECOVERY_FORMAT_V1: &str = "riviamigo-recovery-v1";
pub const RECOVERY_FORMAT_V2: &str = "riviamigo-recovery-v2";
pub const RESTORE_ENGINE_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationIdentity {
    pub version: i64,
    pub description: String,
    pub checksum_sha384: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatabaseProfile {
    pub postgres_major: Option<i32>,
    pub timescale_version: Option<String>,
    pub migration_version: i64,
    #[serde(default)]
    pub migration_ledger: Vec<MigrationIdentity>,
    pub schema_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RestoreBlockingCode {
    UnsupportedPackageFormat,
    InvalidSourceMigration,
    NewerSourceSchema,
    UnsupportedPostgresVersion,
    UnsupportedTimescaleVersion,
    MigrationChecksumMismatch,
    UnknownLegacySchema,
    SchemaContractMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoreBlockingError {
    pub code: RestoreBlockingCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoreTransform {
    pub id: String,
    pub from_migration: i64,
    pub to_migration: i64,
    pub transactional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestorePlan {
    pub plan_id: String,
    pub engine_version: u32,
    pub package_checksum_sha256: String,
    pub package_format: String,
    pub compatible: bool,
    pub source: DatabaseProfile,
    pub target: DatabaseProfile,
    pub pending_migrations: Vec<i64>,
    pub transforms: Vec<RestoreTransform>,
    pub validation_checks: Vec<String>,
    pub warnings: Vec<String>,
    pub blocking_errors: Vec<RestoreBlockingError>,
    pub planned_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SchemaContractReport {
    pub schema_fingerprint: String,
    pub required_relations_present: bool,
    pub missing_relations: Vec<String>,
    pub telemetry_hypertable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CandidatePreparationReport {
    pub source_schema: SchemaContractReport,
    pub target_schema: SchemaContractReport,
    pub legacy_profile: Option<String>,
    pub applied_transforms: Vec<RestoreTransform>,
    pub migrations_applied: Vec<i64>,
    pub foreign_keys_validated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LiveMigrationRepairReport {
    pub ledger_version_before: i64,
    pub schema_version: i64,
    pub ledger_versions_added: Vec<i64>,
    pub applied_transform: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DumpInspection {
    pub has_riviamigo_schema: bool,
    pub has_timeseries_schema: bool,
    pub has_s3_v5_columns: bool,
    pub partial_s3_v5: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacyProfileInspection {
    baseline_revision: bool,
    hourly_telemetry_refresh: bool,
    upload_restore_constraints: bool,
    s3_settings_columns: bool,
    artifact_run_id_not_null: bool,
    s3_locator_index: bool,
}

fn registered_legacy_profile_version(actual: &LegacyProfileInspection) -> Option<i64> {
    (1..=latest_migration_version()).find(|version| legacy_profile_matches(*version, actual))
}

fn is_partial_s3_v5_profile(actual: &LegacyProfileInspection) -> bool {
    actual.baseline_revision
        && actual.hourly_telemetry_refresh
        && actual.s3_settings_columns
        && actual.artifact_run_id_not_null
        && !actual.s3_locator_index
}

pub async fn inspect_recovery_dump(package: &Path) -> Result<DumpInspection, AppError> {
    let package = package.to_path_buf();
    let temporary =
        std::env::temp_dir().join(format!("riviamigo-dump-inspect-{}.dump", Uuid::new_v4()));
    let output = async {
        let dump = temporary.clone();
        tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
            let mut archive = Archive::new(GzDecoder::new(File::open(package)?));
            for entry in archive.entries()? {
                let mut entry = entry?;
                if entry.path()?.to_string_lossy().replace('\\', "/") == "database.dump" {
                    let mut file = File::create(&dump)?;
                    std::io::copy(&mut entry, &mut file)?;
                    return Ok(());
                }
            }
            anyhow::bail!("recovery package is missing database.dump")
        })
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
        .map_err(AppError::Internal)?;
        let pg_restore = resolve_pg_restore_executable().await.ok_or_else(|| {
            AppError::DependencyUnavailable(
                "pg_restore is unavailable for restore preflight".into(),
            )
        })?;
        let inspected = Command::new(pg_restore)
            .arg("--schema-only")
            .arg("--file=-")
            .arg(&temporary)
            .output()
            .await
            .map_err(|error| {
                AppError::DependencyUnavailable(format!(
                    "pg_restore is unavailable for restore preflight: {error}"
                ))
            })?;
        if !inspected.status.success() {
            return Err(AppError::Validation(format!(
                "pg_restore could not inspect the recovery dump: {}",
                String::from_utf8_lossy(&inspected.stderr).trim()
            )));
        }
        let schema = String::from_utf8_lossy(&inspected.stdout);
        let backup_settings = relation_definition(&schema, "riviamigo.backup_settings");
        let backup_artifacts = relation_definition(&schema, "riviamigo.backup_artifacts");
        let has_s3_v5_columns = backup_settings.contains("local_enabled boolean")
            && backup_settings.contains("s3_enabled boolean");
        Ok(DumpInspection {
            has_riviamigo_schema: schema.contains("CREATE SCHEMA riviamigo"),
            has_timeseries_schema: schema.contains("CREATE SCHEMA timeseries"),
            has_s3_v5_columns,
            partial_s3_v5: has_s3_v5_columns && backup_artifacts.contains("run_id uuid NOT NULL"),
        })
    }
    .await;
    let _ = fs::remove_file(&temporary).await;
    output
}

async fn resolve_pg_restore_executable() -> Option<PathBuf> {
    if Command::new("pg_restore")
        .arg("--version")
        .output()
        .await
        .is_ok_and(|output| output.status.success())
    {
        return Some(PathBuf::from("pg_restore"));
    }
    find_windows_pg_restore()
}

#[cfg(windows)]
fn find_windows_pg_restore() -> Option<PathBuf> {
    for root in [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
    ]
    .into_iter()
    .flatten()
    {
        let postgres = PathBuf::from(root).join("PostgreSQL");
        let Ok(entries) = std::fs::read_dir(postgres) else {
            continue;
        };
        let mut versions = entries.filter_map(Result::ok).collect::<Vec<_>>();
        versions.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
        for version in versions {
            let candidate = version.path().join("bin").join("pg_restore.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn find_windows_pg_restore() -> Option<PathBuf> {
    None
}

fn relation_definition<'a>(schema: &'a str, relation: &str) -> &'a str {
    let marker = format!("CREATE TABLE {relation}");
    let Some(start) = schema.find(&marker) else {
        return "";
    };
    let remaining = &schema[start..];
    let end = remaining.find(";\n").unwrap_or(remaining.len());
    &remaining[..end]
}

pub fn compiled_migration_ledger() -> Vec<MigrationIdentity> {
    MIGRATOR
        .migrations
        .iter()
        .map(|migration| MigrationIdentity {
            version: migration.version,
            description: migration.description.to_string(),
            checksum_sha384: hex::encode(migration.checksum.as_ref()),
        })
        .collect()
}

pub fn latest_migration_version() -> i64 {
    MIGRATOR
        .migrations
        .last()
        .map(|migration| migration.version)
        .unwrap_or(0)
}

pub async fn runtime_database_profile(pool: &PgPool) -> Result<DatabaseProfile, AppError> {
    let postgres_major: i32 =
        sqlx::query_scalar("SELECT current_setting('server_version_num')::integer / 10000")
            .fetch_one(pool)
            .await?;
    let timescale_version: Option<String> =
        sqlx::query_scalar("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'")
            .fetch_optional(pool)
            .await?;
    let migration_ledger = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT version, description, encode(checksum, 'hex') FROM public._sqlx_migrations WHERE success = TRUE ORDER BY version",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(version, description, checksum_sha384)| MigrationIdentity {
        version,
        description,
        checksum_sha384,
    })
    .collect::<Vec<_>>();
    let migration_version = migration_ledger
        .last()
        .map(|migration| migration.version)
        .unwrap_or(0);
    Ok(DatabaseProfile {
        postgres_major: Some(postgres_major),
        timescale_version,
        migration_version,
        migration_ledger,
        schema_fingerprint: Some(schema_fingerprint(pool).await?),
    })
}

pub async fn schema_fingerprint(pool: &PgPool) -> Result<String, AppError> {
    let description: Value = sqlx::query_scalar(
        r#"
        SELECT COALESCE(jsonb_agg(jsonb_build_array(
            schema_name, relation_name, relation_kind, column_name,
            data_type, not_null, column_default
        ) ORDER BY schema_name, relation_name, relation_kind, ordinal_position), '[]'::jsonb)
        FROM (
            SELECT
                namespace.nspname AS schema_name,
                relation.relname AS relation_name,
                relation.relkind::text AS relation_kind,
                attribute.attnum AS ordinal_position,
                attribute.attname AS column_name,
                pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                attribute.attnotnull AS not_null,
                pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) AS column_default
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
            LEFT JOIN pg_catalog.pg_attrdef default_value
                ON default_value.adrelid = relation.oid
               AND default_value.adnum = attribute.attnum
            WHERE namespace.nspname IN ('riviamigo', 'timeseries')
              AND relation.relkind IN ('r', 'p', 'v', 'm')
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
        ) schema_columns
        "#,
    )
    .fetch_one(pool)
    .await?;
    let canonical = serde_json::to_vec(&description)
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

pub async fn validate_schema_contract(pool: &PgPool) -> Result<SchemaContractReport, AppError> {
    const REQUIRED_RELATIONS: &[&str] = &[
        "riviamigo.users",
        "riviamigo.vehicles",
        "riviamigo.dashboards",
        "riviamigo.trips",
        "riviamigo.charge_sessions",
        "riviamigo.backup_runs",
        "riviamigo.backup_artifacts",
        "riviamigo.backup_restore_requests",
        "timeseries.telemetry",
    ];
    let mut missing_relations = Vec::new();
    for relation in REQUIRED_RELATIONS {
        let present: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(relation)
            .fetch_one(pool)
            .await?;
        if !present {
            missing_relations.push((*relation).to_string());
        }
    }
    let telemetry_hypertable: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_schema = 'timeseries' AND hypertable_name = 'telemetry'
        )
        "#,
    )
    .fetch_one(pool)
    .await?;
    Ok(SchemaContractReport {
        schema_fingerprint: schema_fingerprint(pool).await?,
        required_relations_present: missing_relations.is_empty(),
        missing_relations,
        telemetry_hypertable,
    })
}

/// Repair restore-induced SQLx bookkeeping drift only when the live database
/// can be proven to match a registered schema profile. This is intentionally
/// additive: it never deletes ledger rows or infers state from PostgreSQL error
/// text. Unknown, incomplete, or checksum-divergent databases fail closed and
/// remain available for operator inspection.
pub async fn reconcile_verified_live_migration_drift(
    pool: &PgPool,
) -> anyhow::Result<Option<LiveMigrationRepairReport>> {
    let ledger_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    if !ledger_exists {
        return Ok(None);
    }

    let schema_contract = validate_schema_contract(pool).await?;
    if !schema_contract.required_relations_present || !schema_contract.telemetry_hypertable {
        return Ok(None);
    }

    let compiled = MIGRATOR.migrations.iter().collect::<Vec<_>>();
    let ledger = sqlx::query_as::<_, (i64, String)>(
        "SELECT version, encode(checksum, 'hex') FROM public._sqlx_migrations WHERE success = TRUE ORDER BY version",
    )
    .fetch_all(pool)
    .await?;
    for (version, checksum) in &ledger {
        let migration = compiled
            .iter()
            .find(|migration| migration.version == *version)
            .ok_or_else(|| {
                anyhow::anyhow!("live migration ledger contains unknown migration {version}")
            })?;
        let expected = hex::encode(migration.checksum.as_ref());
        if checksum != &expected {
            anyhow::bail!(
                "live migration ledger checksum mismatch for migration {version}; automatic repair refused"
            );
        }
    }

    let ledger_version_before = ledger.last().map(|(version, _)| *version).unwrap_or(0);
    for migration in compiled
        .iter()
        .filter(|migration| migration.version <= ledger_version_before)
    {
        if !ledger
            .iter()
            .any(|(version, _)| *version == migration.version)
        {
            anyhow::bail!(
                "live migration ledger is missing migration {} below its recorded high-water mark; automatic repair refused",
                migration.version
            );
        }
    }

    let actual = inspect_legacy_profile(pool).await?;
    let mut applied_transform = None;
    let schema_version = if let Some(version) = registered_legacy_profile_version(&actual) {
        version
    } else if is_partial_s3_v5_profile(&actual) && ledger_version_before <= 4 {
        apply_partial_s3_v5_transform(pool).await?;
        applied_transform = Some("complete-partial-s3-v5".to_string());
        5
    } else {
        anyhow::bail!(
            "live database schema does not match a registered migration profile; automatic ledger repair refused: {actual:?}"
        );
    };

    if schema_version < ledger_version_before {
        anyhow::bail!(
            "live database schema matches migration {schema_version}, but its ledger records migration {ledger_version_before}; automatic repair refused"
        );
    }
    if schema_version == ledger_version_before && applied_transform.is_none() {
        return Ok(None);
    }

    let missing = compiled
        .iter()
        .filter(|migration| {
            migration.version <= schema_version
                && !ledger
                    .iter()
                    .any(|(version, _)| *version == migration.version)
        })
        .copied()
        .collect::<Vec<_>>();
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('riviamigo-live-migration-repair'))")
        .execute(&mut *transaction)
        .await?;
    for migration in &missing {
        sqlx::query(
            r#"
            INSERT INTO public._sqlx_migrations
                (version, description, success, checksum, execution_time)
            VALUES ($1, $2, TRUE, $3, 0)
            ON CONFLICT (version) DO NOTHING
            "#,
        )
        .bind(migration.version)
        .bind(migration.description.as_ref())
        .bind(migration.checksum.as_ref())
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;

    let repaired = inspect_legacy_profile(pool).await?;
    if !legacy_profile_matches(schema_version, &repaired) {
        anyhow::bail!(
            "live database failed registered schema validation after migration repair: {repaired:?}"
        );
    }

    Ok(Some(LiveMigrationRepairReport {
        ledger_version_before,
        schema_version,
        ledger_versions_added: missing.iter().map(|migration| migration.version).collect(),
        applied_transform,
    }))
}

/// Reconcile and migrate an isolated restore candidate. This is intentionally
/// unavailable to normal application startup: historical bookkeeping may only
/// be reconstructed after the restored schema has passed its source contract.
pub async fn prepare_candidate_schema(
    pool: &PgPool,
    manifest: &Value,
) -> anyhow::Result<CandidatePreparationReport> {
    let format = manifest
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source = source_profile_from_manifest(manifest)?;
    let source_schema = validate_schema_contract(pool).await?;
    if !source_schema.required_relations_present || !source_schema.telemetry_hypertable {
        anyhow::bail!(
            "restored candidate does not match a complete Riviamigo schema: missing={:?}, telemetry_hypertable={}",
            source_schema.missing_relations,
            source_schema.telemetry_hypertable
        );
    }

    if format == RECOVERY_FORMAT_V2 {
        let expected = source.schema_fingerprint.as_deref().ok_or_else(|| {
            anyhow::anyhow!("v2 recovery package is missing its source schema fingerprint")
        })?;
        if expected != source_schema.schema_fingerprint {
            anyhow::bail!(
                "v2 recovery package schema fingerprint mismatch: declared {expected}, restored {}",
                source_schema.schema_fingerprint
            );
        }
    }

    let (legacy_profile, transforms, effective_source_version) = if format == RECOVERY_FORMAT_V1 {
        identify_and_transform_legacy_profile(pool, source.migration_version).await?
    } else {
        (None, Vec::new(), source.migration_version)
    };

    crate::db::migrations::restore_ledger(pool, effective_source_version).await?;
    let migrations_applied = compiled_migration_ledger()
        .into_iter()
        .filter(|migration| migration.version > effective_source_version)
        .map(|migration| migration.version)
        .collect::<Vec<_>>();
    let ledger_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public._sqlx_migrations WHERE success = TRUE")
            .fetch_one(pool)
            .await?;
    let expected_ledger_count = compiled_migration_ledger()
        .iter()
        .filter(|migration| migration.version <= effective_source_version)
        .count() as i64;
    if ledger_count != expected_ledger_count {
        anyhow::bail!(
            "candidate migration ledger contains {ledger_count} successful entries; expected {expected_ledger_count}"
        );
    }
    // SQLx resolves its bookkeeping table through the active connection's
    // search_path. Pin migration execution to the same connection on which we
    // set `public`; setting it through a pool can affect a different session
    // and make SQLx treat the reconstructed ledger as absent.
    let mut migration_connection = pool.acquire().await?;
    sqlx::query("SET search_path = public")
        .execute(&mut *migration_connection)
        .await?;
    inject_candidate_fault("target_migrations")?;
    crate::db::migrations::MIGRATOR
        .run_direct(None, &mut *migration_connection, false)
        .await?;
    drop(migration_connection);

    let target_schema = validate_schema_contract(pool).await?;
    let target_profile = runtime_database_profile(pool).await?;
    if target_profile.migration_version != latest_migration_version() {
        anyhow::bail!(
            "candidate migration ledger stopped at {}, target requires {}",
            target_profile.migration_version,
            latest_migration_version()
        );
    }
    let foreign_keys_validated: bool = sqlx::query_scalar(
        "SELECT COALESCE(bool_and(convalidated), TRUE) FROM pg_constraint WHERE contype = 'f' AND connamespace IN ('riviamigo'::regnamespace, 'timeseries'::regnamespace)",
    )
    .fetch_one(pool)
    .await?;
    if !foreign_keys_validated {
        anyhow::bail!("candidate contains unvalidated foreign-key constraints");
    }

    Ok(CandidatePreparationReport {
        source_schema,
        target_schema,
        legacy_profile,
        applied_transforms: transforms,
        migrations_applied,
        foreign_keys_validated,
    })
}

fn inject_candidate_fault(phase: &str) -> anyhow::Result<()> {
    if std::env::var("RIVIAMIGO_RESTORE_FAULT_PHASE").as_deref() == Ok(phase) {
        anyhow::bail!("restore fault injection triggered at {phase}");
    }
    Ok(())
}

async fn inspect_legacy_profile(pool: &PgPool) -> anyhow::Result<LegacyProfileInspection> {
    let upload_restore_constraints: bool = sqlx::query_scalar(
        r#"
        SELECT COALESCE(bool_or(pg_get_constraintdef(oid) LIKE '%upload%'), FALSE)
        FROM pg_constraint
        WHERE conrelid = 'riviamigo.backup_runs'::regclass AND contype = 'c'
        "#,
    )
    .fetch_one(pool)
    .await?;
    let hourly_telemetry_refresh: bool = sqlx::query_scalar(
        r#"
        SELECT COALESCE(bool_or(schedule_interval = interval '1 hour'), FALSE)
        FROM timescaledb_information.jobs
        WHERE proc_name = 'policy_refresh_continuous_aggregate'
          AND hypertable_schema = 'timeseries'
          AND hypertable_name = 'telemetry_1min'
        "#,
    )
    .fetch_one(pool)
    .await?;
    let s3_locator_index: bool = sqlx::query_scalar(
        "SELECT to_regclass('riviamigo.backup_artifacts_s3_locator_unique') IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;
    Ok(LegacyProfileInspection {
        baseline_revision: column_exists(pool, "riviamigo", "dashboards", "baseline_revision")
            .await?,
        hourly_telemetry_refresh,
        upload_restore_constraints,
        s3_settings_columns: column_exists(pool, "riviamigo", "backup_settings", "local_enabled")
            .await?
            && column_exists(pool, "riviamigo", "backup_settings", "s3_enabled").await?,
        artifact_run_id_not_null: column_is_not_null(
            pool,
            "riviamigo",
            "backup_artifacts",
            "run_id",
        )
        .await?,
        s3_locator_index,
    })
}

async fn identify_and_transform_legacy_profile(
    pool: &PgPool,
    declared_migration: i64,
) -> anyhow::Result<(Option<String>, Vec<RestoreTransform>, i64)> {
    if !(1..=latest_migration_version()).contains(&declared_migration) {
        anyhow::bail!(
            "legacy package migration {declared_migration} is not a registered schema profile"
        );
    }
    let actual = inspect_legacy_profile(pool).await?;
    let partial_s3_v5 = declared_migration == 3 && is_partial_s3_v5_profile(&actual);
    if partial_s3_v5 {
        inject_candidate_fault("compatibility_transform")?;
        apply_partial_s3_v5_transform(pool).await?;
        return Ok((
            Some("v1-migration-3-partial-s3-v5".into()),
            vec![RestoreTransform {
                id: "complete-partial-s3-v5".into(),
                from_migration: 3,
                to_migration: 5,
                transactional: true,
            }],
            5,
        ));
    }

    let matches_registered_profile = legacy_profile_matches(declared_migration, &actual);
    if !matches_registered_profile {
        anyhow::bail!(
            "legacy package migration {declared_migration} does not match its registered schema profile: {actual:?}"
        );
    }
    Ok((
        Some(format!("v1-migration-{declared_migration}")),
        Vec::new(),
        declared_migration,
    ))
}

fn legacy_profile_matches(declared_migration: i64, actual: &LegacyProfileInspection) -> bool {
    match declared_migration {
        1 => {
            !actual.baseline_revision
                && !actual.hourly_telemetry_refresh
                && !actual.upload_restore_constraints
                && !actual.s3_settings_columns
                && actual.artifact_run_id_not_null
                && !actual.s3_locator_index
        }
        2 => {
            !actual.baseline_revision
                && actual.hourly_telemetry_refresh
                && !actual.upload_restore_constraints
                && !actual.s3_settings_columns
                && actual.artifact_run_id_not_null
                && !actual.s3_locator_index
        }
        3 => {
            actual.baseline_revision
                && actual.hourly_telemetry_refresh
                && !actual.upload_restore_constraints
                && !actual.s3_settings_columns
                && actual.artifact_run_id_not_null
                && !actual.s3_locator_index
        }
        4 => {
            actual.baseline_revision
                && actual.hourly_telemetry_refresh
                && actual.upload_restore_constraints
                && !actual.s3_settings_columns
                && actual.artifact_run_id_not_null
                && !actual.s3_locator_index
        }
        5 => {
            actual.baseline_revision
                && actual.hourly_telemetry_refresh
                && actual.upload_restore_constraints
                && actual.s3_settings_columns
                && !actual.artifact_run_id_not_null
                && actual.s3_locator_index
        }
        _ => false,
    }
}

async fn column_exists(
    pool: &PgPool,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3)",
    )
    .bind(schema)
    .bind(table)
    .bind(column)
    .fetch_one(pool)
    .await
}

async fn column_is_not_null(
    pool: &PgPool,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, Option<String>>(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
    )
    .bind(schema)
    .bind(table)
    .bind(column)
    .fetch_optional(pool)
    .await?
    .flatten()
    .as_deref()
        == Some("NO"))
}

async fn apply_partial_s3_v5_transform(pool: &PgPool) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    sqlx::raw_sql(
        r#"
        ALTER TABLE riviamigo.backup_runs DROP CONSTRAINT IF EXISTS backup_runs_trigger_check;
        ALTER TABLE riviamigo.backup_runs ADD CONSTRAINT backup_runs_trigger_check
          CHECK (trigger = ANY (ARRAY['manual'::text, 'scheduled'::text, 'restore'::text, 'upload'::text, 'pre_restore'::text]));
        ALTER TABLE riviamigo.backup_settings
          ADD COLUMN IF NOT EXISTS local_enabled boolean NOT NULL DEFAULT true,
          ADD COLUMN IF NOT EXISTS s3_enabled boolean NOT NULL DEFAULT false;
        ALTER TABLE riviamigo.backup_artifacts ALTER COLUMN run_id DROP NOT NULL;
        ALTER TABLE riviamigo.backup_artifacts DROP CONSTRAINT IF EXISTS backup_artifacts_run_id_key;
        ALTER TABLE riviamigo.backup_artifacts DROP CONSTRAINT IF EXISTS backup_artifacts_storage_type_check;
        ALTER TABLE riviamigo.backup_artifacts ADD CONSTRAINT backup_artifacts_storage_type_check
          CHECK (storage_type = ANY (ARRAY['local'::text, 'uploaded'::text, 'safety'::text, 's3'::text]));
        CREATE UNIQUE INDEX IF NOT EXISTS backup_artifacts_s3_locator_unique
          ON riviamigo.backup_artifacts (storage_path) WHERE storage_type = 's3';
        "#,
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

pub async fn plan_restore(
    manifest: &Value,
    package_checksum_sha256: &str,
    target_pool: &PgPool,
    dump: Option<&DumpInspection>,
) -> Result<RestorePlan, AppError> {
    let package_format = manifest
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let source = source_profile_from_manifest(manifest)?;
    let target = runtime_database_profile(target_pool).await?;
    let mut blocking_errors = Vec::new();
    let mut warnings = Vec::new();
    let mut transforms = Vec::new();

    if !matches!(
        package_format.as_str(),
        RECOVERY_FORMAT_V1 | RECOVERY_FORMAT_V2
    ) {
        blocking_errors.push(RestoreBlockingError {
            code: RestoreBlockingCode::UnsupportedPackageFormat,
            message: format!("Unsupported recovery package format: {package_format}"),
        });
    }
    if let Some(dump) = dump {
        if !dump.has_riviamigo_schema || !dump.has_timeseries_schema {
            blocking_errors.push(RestoreBlockingError {
                code: RestoreBlockingCode::SchemaContractMismatch,
                message: "The recovery dump is missing required Riviamigo schemas.".into(),
            });
        }
        if dump.partial_s3_v5 {
            if package_format == RECOVERY_FORMAT_V1 && source.migration_version == 3 {
                transforms.push(RestoreTransform {
                    id: "complete-partial-s3-v5".into(),
                    from_migration: 3,
                    to_migration: 5,
                    transactional: true,
                });
            } else {
                blocking_errors.push(RestoreBlockingError {
                    code: RestoreBlockingCode::SchemaContractMismatch,
                    message:
                        "The dump contains an unrecognized partially applied migration 5 schema."
                            .into(),
                });
            }
        } else if dump.has_s3_v5_columns && source.migration_version < 5 {
            blocking_errors.push(RestoreBlockingError {
                code: RestoreBlockingCode::UnknownLegacySchema,
                message: "The dump contains migration 5 columns but does not match a registered legacy profile.".into(),
            });
        }
    }
    if source.migration_version < 1 {
        blocking_errors.push(RestoreBlockingError {
            code: RestoreBlockingCode::InvalidSourceMigration,
            message: "The recovery package does not declare a valid source migration.".into(),
        });
    } else if source.migration_version > target.migration_version {
        blocking_errors.push(RestoreBlockingError {
            code: RestoreBlockingCode::NewerSourceSchema,
            message: format!(
                "The package schema version {} is newer than target version {}.",
                source.migration_version, target.migration_version
            ),
        });
    }
    if let (Some(source_major), Some(target_major)) = (source.postgres_major, target.postgres_major)
    {
        if source_major > target_major {
            blocking_errors.push(RestoreBlockingError {
                code: RestoreBlockingCode::UnsupportedPostgresVersion,
                message: format!(
                    "PostgreSQL {source_major} packages cannot be restored into PostgreSQL {target_major}."
                ),
            });
        }
    } else if package_format == RECOVERY_FORMAT_V1 {
        warnings.push("Legacy v1 packages do not declare their PostgreSQL major version; the restored candidate will be verified before swap.".into());
    }
    if !timescale_versions_compatible(
        source.timescale_version.as_deref(),
        target.timescale_version.as_deref(),
    ) {
        blocking_errors.push(RestoreBlockingError {
            code: RestoreBlockingCode::UnsupportedTimescaleVersion,
            message: format!(
                "TimescaleDB source {:?} is not compatible with target {:?}.",
                source.timescale_version, target.timescale_version
            ),
        });
    }

    let compiled = compiled_migration_ledger();
    for target_migration in &target.migration_ledger {
        if let Some(compiled_migration) = compiled
            .iter()
            .find(|migration| migration.version == target_migration.version)
        {
            if compiled_migration.checksum_sha384 != target_migration.checksum_sha384 {
                blocking_errors.push(RestoreBlockingError {
                    code: RestoreBlockingCode::MigrationChecksumMismatch,
                    message: format!(
                        "Target migration {} does not match this release checksum.",
                        target_migration.version
                    ),
                });
            }
        } else {
            blocking_errors.push(RestoreBlockingError {
                code: RestoreBlockingCode::MigrationChecksumMismatch,
                message: format!(
                    "Target migration {} is unknown to this release.",
                    target_migration.version
                ),
            });
        }
    }
    for compiled_migration in compiled
        .iter()
        .filter(|migration| migration.version <= target.migration_version)
    {
        if !target
            .migration_ledger
            .iter()
            .any(|migration| migration.version == compiled_migration.version)
        {
            blocking_errors.push(RestoreBlockingError {
                code: RestoreBlockingCode::MigrationChecksumMismatch,
                message: format!(
                    "Target migration ledger is missing migration {}.",
                    compiled_migration.version
                ),
            });
        }
    }
    if !source.migration_ledger.is_empty() {
        for source_migration in &source.migration_ledger {
            if let Some(target_migration) = compiled
                .iter()
                .find(|migration| migration.version == source_migration.version)
            {
                if target_migration.checksum_sha384 != source_migration.checksum_sha384 {
                    blocking_errors.push(RestoreBlockingError {
                        code: RestoreBlockingCode::MigrationChecksumMismatch,
                        message: format!(
                            "Migration {} has a different checksum in the package and target release.",
                            source_migration.version
                        ),
                    });
                }
            } else {
                blocking_errors.push(RestoreBlockingError {
                    code: RestoreBlockingCode::MigrationChecksumMismatch,
                    message: format!(
                        "Package migration {} is unknown to this release.",
                        source_migration.version
                    ),
                });
            }
        }
        for compiled_migration in compiled
            .iter()
            .filter(|migration| migration.version <= source.migration_version)
        {
            if !source
                .migration_ledger
                .iter()
                .any(|migration| migration.version == compiled_migration.version)
            {
                blocking_errors.push(RestoreBlockingError {
                    code: RestoreBlockingCode::MigrationChecksumMismatch,
                    message: format!(
                        "Package migration ledger is missing migration {}.",
                        compiled_migration.version
                    ),
                });
            }
        }
    }

    let pending_migrations = compiled
        .iter()
        .filter(|migration| migration.version > source.migration_version)
        .map(|migration| migration.version)
        .collect::<Vec<_>>();
    let plan_material = serde_json::to_vec(&serde_json::json!({
        "engine_version": RESTORE_ENGINE_VERSION,
        "package_checksum_sha256": package_checksum_sha256,
        "package_format": package_format,
        "source": source,
        "target": target,
        "dump": dump,
        "pending_migrations": pending_migrations,
        "transforms": transforms,
        "validation_checks": [
            "required_relations",
            "schema_fingerprint",
            "migration_checksums",
            "timescale_hypertables",
            "foreign_key_integrity",
            "application_health"
        ]
    }))
    .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
    Ok(RestorePlan {
        plan_id: hex::encode(Sha256::digest(plan_material)),
        engine_version: RESTORE_ENGINE_VERSION,
        package_checksum_sha256: package_checksum_sha256.to_string(),
        package_format,
        compatible: blocking_errors.is_empty(),
        source,
        target,
        pending_migrations,
        transforms,
        validation_checks: vec![
            "required_relations".into(),
            "schema_fingerprint".into(),
            "migration_checksums".into(),
            "timescale_hypertables".into(),
            "foreign_key_integrity".into(),
            "application_health".into(),
        ],
        warnings,
        blocking_errors,
        planned_at: Utc::now(),
    })
}

fn source_profile_from_manifest(manifest: &Value) -> Result<DatabaseProfile, AppError> {
    let source = manifest.get("source").ok_or_else(|| {
        AppError::Validation("Recovery manifest is missing source metadata.".into())
    })?;
    let migration_version = source
        .get("migration_version")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let migration_ledger = source
        .get("migration_ledger")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| AppError::Validation(format!("Invalid migration ledger: {error}")))?
        .unwrap_or_default();
    Ok(DatabaseProfile {
        postgres_major: source
            .get("postgres_major")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok()),
        timescale_version: source
            .get("timescale_version")
            .and_then(Value::as_str)
            .map(str::to_string),
        migration_version,
        migration_ledger,
        schema_fingerprint: source
            .get("schema_fingerprint")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn timescale_versions_compatible(source: Option<&str>, target: Option<&str>) -> bool {
    let Some(source) = source.and_then(parse_version_triplet) else {
        return true;
    };
    let Some(target) = target.and_then(parse_version_triplet) else {
        return false;
    };
    source.0 == target.0 && target >= source
}

fn parse_version_triplet(value: &str) -> Option<(u32, u32, u32)> {
    let mut components = value.split('.');
    Some((
        components.next()?.parse().ok()?,
        components.next()?.parse().ok()?,
        components
            .next()
            .unwrap_or("0")
            .split(|character: char| !character.is_ascii_digit())
            .next()?
            .parse()
            .ok()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timescale_compatibility_is_forward_only_within_a_major() {
        assert!(timescale_versions_compatible(
            Some("2.20.0"),
            Some("2.28.3")
        ));
        assert!(timescale_versions_compatible(
            Some("2.28.3"),
            Some("2.28.3")
        ));
        assert!(!timescale_versions_compatible(
            Some("2.29.0"),
            Some("2.28.3")
        ));
        assert!(!timescale_versions_compatible(
            Some("2.28.3"),
            Some("3.0.0")
        ));
    }

    #[test]
    fn compiled_ledger_tracks_the_embedded_migrations() {
        let ledger = compiled_migration_ledger();
        assert_eq!(ledger.last().map(|migration| migration.version), Some(5));
        assert!(ledger
            .iter()
            .all(|migration| !migration.checksum_sha384.is_empty()));
    }

    #[test]
    fn partial_s3_profile_is_registered_without_matching_complete_v5() {
        let partial = LegacyProfileInspection {
            baseline_revision: true,
            hourly_telemetry_refresh: true,
            upload_restore_constraints: true,
            s3_settings_columns: true,
            artifact_run_id_not_null: true,
            s3_locator_index: false,
        };
        assert!(is_partial_s3_v5_profile(&partial));
        assert_eq!(registered_legacy_profile_version(&partial), None);
    }

    #[test]
    fn complete_v5_profile_is_not_treated_as_partial() {
        let complete = LegacyProfileInspection {
            baseline_revision: true,
            hourly_telemetry_refresh: true,
            upload_restore_constraints: true,
            s3_settings_columns: true,
            artifact_run_id_not_null: false,
            s3_locator_index: true,
        };
        assert!(!is_partial_s3_v5_profile(&complete));
        assert_eq!(registered_legacy_profile_version(&complete), Some(5));
    }

    #[test]
    fn v2_source_profile_reads_engine_versions_and_checksums() {
        let manifest = serde_json::json!({
            "source": {
                "postgres_major": 18,
                "timescale_version": "2.28.3",
                "migration_version": 5,
                "migration_ledger": compiled_migration_ledger(),
                "schema_fingerprint": "fingerprint"
            }
        });
        let profile = source_profile_from_manifest(&manifest).expect("source profile");
        assert_eq!(profile.postgres_major, Some(18));
        assert_eq!(profile.timescale_version.as_deref(), Some("2.28.3"));
        assert_eq!(profile.migration_version, 5);
        assert_eq!(profile.migration_ledger.len(), 5);
        assert_eq!(profile.schema_fingerprint.as_deref(), Some("fingerprint"));
    }

    #[test]
    fn every_registered_legacy_profile_rejects_adjacent_schema_shapes() {
        let profiles = [
            LegacyProfileInspection {
                baseline_revision: false,
                hourly_telemetry_refresh: false,
                upload_restore_constraints: false,
                s3_settings_columns: false,
                artifact_run_id_not_null: true,
                s3_locator_index: false,
            },
            LegacyProfileInspection {
                baseline_revision: false,
                hourly_telemetry_refresh: true,
                upload_restore_constraints: false,
                s3_settings_columns: false,
                artifact_run_id_not_null: true,
                s3_locator_index: false,
            },
            LegacyProfileInspection {
                baseline_revision: true,
                hourly_telemetry_refresh: true,
                upload_restore_constraints: false,
                s3_settings_columns: false,
                artifact_run_id_not_null: true,
                s3_locator_index: false,
            },
            LegacyProfileInspection {
                baseline_revision: true,
                hourly_telemetry_refresh: true,
                upload_restore_constraints: true,
                s3_settings_columns: false,
                artifact_run_id_not_null: true,
                s3_locator_index: false,
            },
            LegacyProfileInspection {
                baseline_revision: true,
                hourly_telemetry_refresh: true,
                upload_restore_constraints: true,
                s3_settings_columns: true,
                artifact_run_id_not_null: false,
                s3_locator_index: true,
            },
        ];
        for (index, profile) in profiles.iter().enumerate() {
            let version = i64::try_from(index + 1).expect("version");
            assert!(legacy_profile_matches(version, profile));
            let adjacent = if version == 5 { 4 } else { version + 1 };
            assert!(!legacy_profile_matches(adjacent, profile));
        }
    }
}
