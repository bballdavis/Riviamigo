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

use crate::{
    db::migrations::{self, LedgerValidationKind, MigrationIdentity, MIGRATION_CHAIN_ID, MIGRATOR},
    errors::AppError,
};

pub const RECOVERY_FORMAT_V1: &str = "riviamigo-recovery-v1";
pub const RECOVERY_FORMAT_V2: &str = "riviamigo-recovery-v2";
pub const RECOVERY_FORMAT_V3: &str = "riviamigo-recovery-v3";
pub const RESTORE_ENGINE_VERSION: u32 = 3;
pub const SCHEMA_CONTRACT_VERSION: &str = "riviamigo-schema-contract-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatabaseProfile {
    pub postgres_major: Option<i32>,
    pub timescale_version: Option<String>,
    pub migration_version: i64,
    #[serde(default)]
    pub migration_ledger: Vec<MigrationIdentity>,
    #[serde(default)]
    pub migration_ledger_successful: bool,
    pub migration_chain_id: Option<String>,
    pub migration_catalog_digest: Option<String>,
    pub schema_contract_version: Option<String>,
    pub schema_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RestoreBlockingCode {
    UnsupportedPackageFormat,
    UnsupportedMigrationChain,
    SourceLedgerInvalid,
    TargetMigrationDrift,
    MigrationChecksumMismatch,
    NewerSourceSchema,
    UnsupportedPostgresVersion,
    UnsupportedTimescaleVersion,
    SchemaContractMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoreBlockingError {
    pub code: RestoreBlockingCode,
    pub message: String,
}

/// Reserved for future data-shape transitions that cannot be represented as a
/// normal forward SQL migration. The discarded pre-release chain has no
/// registered transforms.
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
    pub contract_version: String,
    pub schema_fingerprint: String,
    pub required_relations_present: bool,
    pub missing_relations: Vec<String>,
    pub telemetry_hypertable: bool,
    pub foreign_keys_validated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CandidatePreparationReport {
    pub source_schema: SchemaContractReport,
    pub target_schema: SchemaContractReport,
    pub applied_transforms: Vec<RestoreTransform>,
    pub migrations_applied: Vec<i64>,
    pub foreign_keys_validated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DumpInspection {
    pub has_riviamigo_schema: bool,
    pub has_timeseries_schema: bool,
}

pub use migrations::{compiled_migration_ledger, latest_migration_version};

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
        Ok(DumpInspection {
            has_riviamigo_schema: schema.contains("CREATE SCHEMA riviamigo"),
            has_timeseries_schema: schema.contains("CREATE SCHEMA timeseries"),
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

pub async fn runtime_database_profile(pool: &PgPool) -> Result<DatabaseProfile, AppError> {
    let postgres_major: i32 =
        sqlx::query_scalar("SELECT current_setting('server_version_num')::integer / 10000")
            .fetch_one(pool)
            .await?;
    let timescale_version: Option<String> =
        sqlx::query_scalar("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'")
            .fetch_optional(pool)
            .await?;
    let ledger_rows = sqlx::query_as::<_, (i64, String, bool, String)>(
        "SELECT version, description, success, encode(checksum, 'hex') FROM public._sqlx_migrations ORDER BY version",
    )
    .fetch_all(pool)
    .await?;
    let migration_ledger_successful = ledger_rows.iter().all(|row| row.2);
    let migration_ledger = ledger_rows
        .into_iter()
        .map(
            |(version, description, _success, checksum_sha384)| MigrationIdentity {
                version,
                description,
                checksum_sha384,
            },
        )
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
        migration_ledger_successful,
        migration_chain_id: Some(MIGRATION_CHAIN_ID.into()),
        migration_catalog_digest: Some(migrations::migration_catalog_digest()),
        schema_contract_version: Some(SCHEMA_CONTRACT_VERSION.into()),
        schema_fingerprint: Some(schema_fingerprint(pool).await?),
    })
}

/// Produce a canonical, data-free database contract. The contract intentionally
/// excludes SQLx bookkeeping, ownership, statistics, sequence positions, and
/// application rows.
pub async fn schema_contract_description(pool: &PgPool) -> Result<Value, AppError> {
    let mut transaction = pool.begin().await?;
    sqlx::query("SET LOCAL search_path = pg_catalog")
        .execute(&mut *transaction)
        .await?;
    let description: Value = sqlx::query_scalar(
        r#"
        SELECT COALESCE(jsonb_agg(item ORDER BY category, identity), '[]'::jsonb)
        FROM (
            SELECT 'column' AS category,
                   format('%I.%I.%s', namespace.nspname, relation.relname, attribute.attnum) AS identity,
                   jsonb_build_object(
                       'schema', namespace.nspname,
                       'relation', relation.relname,
                       'kind', relation.relkind::text,
                       'ordinal', attribute.attnum,
                       'name', attribute.attname,
                       'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
                       'not_null', attribute.attnotnull,
                       'generated', attribute.attgenerated,
                       'identity', attribute.attidentity,
                       'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
                   ) AS item
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
            LEFT JOIN pg_catalog.pg_attrdef default_value
              ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
            WHERE namespace.nspname IN ('riviamigo', 'timeseries')
              AND relation.relkind IN ('r', 'p', 'v', 'm')
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped

            UNION ALL
            SELECT 'constraint',
                   format('%I.%I.%I', namespace.nspname, relation.relname, constraint_record.conname),
                   jsonb_build_object(
                       'schema', namespace.nspname,
                       'relation', relation.relname,
                       'name', constraint_record.conname,
                       'type', constraint_record.contype,
                       'validated', constraint_record.convalidated,
                       'definition', pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
                   )
            FROM pg_catalog.pg_constraint constraint_record
            JOIN pg_catalog.pg_class relation ON relation.oid = constraint_record.conrelid
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname IN ('riviamigo', 'timeseries')

            UNION ALL
            SELECT 'index',
                   format('%I.%I.%I', namespace.nspname, relation.relname, index_relation.relname),
                   jsonb_build_object(
                       'schema', namespace.nspname,
                       'relation', relation.relname,
                       'name', index_relation.relname,
                       'unique', index_record.indisunique,
                       'valid', index_record.indisvalid,
                       'definition', pg_catalog.pg_get_indexdef(index_record.indexrelid)
                   )
            FROM pg_catalog.pg_index index_record
            JOIN pg_catalog.pg_class relation ON relation.oid = index_record.indrelid
            JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_record.indexrelid
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname IN ('riviamigo', 'timeseries')

            UNION ALL
            SELECT 'view',
                   format('%I.%I', namespace.nspname, relation.relname),
                   jsonb_build_object(
                       'schema', namespace.nspname,
                       'name', relation.relname,
                       'kind', relation.relkind::text,
                       'definition', regexp_replace(
                           regexp_replace(
                               pg_catalog.pg_get_viewdef(relation.oid, true),
                               '_materialized_hypertable_[0-9]+',
                               '_materialized_hypertable_ID',
                               'g'
                           ),
                           'cagg_watermark\([0-9]+\)',
                           'cagg_watermark(ID)',
                           'g'
                       )
                   )
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname IN ('riviamigo', 'timeseries')
              AND relation.relkind IN ('v', 'm')

            UNION ALL
            SELECT 'function',
                   format('%I.%I(%s)', namespace.nspname, procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)),
                   jsonb_build_object(
                       'schema', namespace.nspname,
                       'name', procedure.proname,
                       'arguments', pg_catalog.pg_get_function_identity_arguments(procedure.oid),
                       'definition', pg_catalog.pg_get_functiondef(procedure.oid)
                   )
            FROM pg_catalog.pg_proc procedure
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname IN ('riviamigo', 'timeseries')
              AND procedure.prokind IN ('f', 'p')
              AND NOT EXISTS (
                  SELECT 1
                  FROM pg_catalog.pg_depend dependency
                  WHERE dependency.classid = 'pg_proc'::regclass
                    AND dependency.objid = procedure.oid
                    AND dependency.deptype = 'e'
              )

            UNION ALL
            SELECT 'trigger',
                   format('%I.%I.%I', namespace.nspname, relation.relname, trigger_record.tgname),
                   jsonb_build_object(
                       'schema', namespace.nspname,
                       'relation', relation.relname,
                       'name', trigger_record.tgname,
                       'definition', pg_catalog.pg_get_triggerdef(trigger_record.oid, true)
                   )
            FROM pg_catalog.pg_trigger trigger_record
            JOIN pg_catalog.pg_class relation ON relation.oid = trigger_record.tgrelid
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname IN ('riviamigo', 'timeseries')
              AND NOT trigger_record.tgisinternal

            UNION ALL
            SELECT 'extension', extension_record.extname,
                   jsonb_build_object('name', extension_record.extname)
            FROM pg_catalog.pg_extension extension_record
            WHERE extension_record.extname IN ('timescaledb', 'pgcrypto')

            UNION ALL
            SELECT 'hypertable',
                   format('%I.%I', hypertable_schema, hypertable_name),
                   jsonb_build_object(
                       'schema', hypertable_schema,
                       'name', hypertable_name,
                       'dimensions', num_dimensions,
                       'compression_enabled', compression_enabled
                   )
            FROM timescaledb_information.hypertables
            WHERE hypertable_schema IN ('riviamigo', 'timeseries')

            UNION ALL
            SELECT 'continuous_aggregate',
                   format('%I.%I', view_schema, view_name),
                   jsonb_build_object(
                       'schema', view_schema,
                       'name', view_name,
                       'materialized_only', materialized_only,
                       'compression_enabled', compression_enabled
                   )
            FROM timescaledb_information.continuous_aggregates
            WHERE view_schema IN ('riviamigo', 'timeseries')

            UNION ALL
            SELECT 'timescale_job',
                   format('%I.%I:%I.%I', proc_schema, proc_name, hypertable_schema, hypertable_name),
                   jsonb_build_object(
                       'proc_schema', proc_schema,
                       'proc_name', proc_name,
                       'schedule_interval', schedule_interval::text,
                       'scheduled', scheduled,
                       'hypertable_schema', hypertable_schema,
                       'hypertable_name', hypertable_name,
                       'config', config - 'mat_hypertable_id' - 'hypertable_id'
                   )
            FROM timescaledb_information.jobs
            WHERE hypertable_schema IN ('riviamigo', 'timeseries')
        ) contract_items
        "#,
    )
    .fetch_one(&mut *transaction)
    .await?;
    transaction.rollback().await?;
    Ok(description)
}

pub async fn schema_fingerprint(pool: &PgPool) -> Result<String, AppError> {
    let canonical = serde_json::to_vec(&serde_json::json!({
        "version": SCHEMA_CONTRACT_VERSION,
        "items": schema_contract_description(pool).await?,
    }))
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
        "timeseries.telemetry_1min",
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
        "SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_schema = 'timeseries' AND hypertable_name = 'telemetry')",
    )
    .fetch_one(pool)
    .await?;
    let foreign_keys_validated: bool = sqlx::query_scalar(
        "SELECT COALESCE(bool_and(convalidated), TRUE) FROM pg_constraint WHERE contype = 'f' AND connamespace IN ('riviamigo'::regnamespace, 'timeseries'::regnamespace)",
    )
    .fetch_one(pool)
    .await?;
    Ok(SchemaContractReport {
        contract_version: SCHEMA_CONTRACT_VERSION.into(),
        schema_fingerprint: schema_fingerprint(pool).await?,
        required_relations_present: missing_relations.is_empty(),
        missing_relations,
        telemetry_hypertable,
        foreign_keys_validated,
    })
}

/// Validate and migrate an isolated restore candidate. This function never
/// targets the live database.
pub async fn prepare_candidate_schema(
    pool: &PgPool,
    manifest: &Value,
) -> anyhow::Result<CandidatePreparationReport> {
    let format = manifest
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if format != RECOVERY_FORMAT_V3 {
        anyhow::bail!("recovery package belongs to an unsupported migration chain");
    }
    let source = source_profile_from_manifest(manifest)?;
    validate_source_identity(&source).map_err(|error| anyhow::anyhow!(error.message))?;

    let source_schema = validate_schema_contract(pool).await?;
    if !source_schema.required_relations_present
        || !source_schema.telemetry_hypertable
        || !source_schema.foreign_keys_validated
    {
        anyhow::bail!(
            "restored candidate does not match a complete Riviamigo schema contract: missing={:?}, telemetry_hypertable={}, foreign_keys_validated={}",
            source_schema.missing_relations,
            source_schema.telemetry_hypertable,
            source_schema.foreign_keys_validated
        );
    }
    let expected_fingerprint = source
        .schema_fingerprint
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("v3 recovery package is missing its schema fingerprint"))?;
    if source.schema_contract_version.as_deref() != Some(SCHEMA_CONTRACT_VERSION) {
        anyhow::bail!("recovery package uses an unsupported schema contract version");
    }
    if expected_fingerprint != source_schema.schema_fingerprint {
        anyhow::bail!(
            "recovery package schema contract mismatch: declared {expected_fingerprint}, restored {}",
            source_schema.schema_fingerprint
        );
    }

    migrations::restore_ledger(pool, &source.migration_ledger).await?;
    let migrations_applied = compiled_migration_ledger()
        .into_iter()
        .skip(source.migration_ledger.len())
        .map(|migration| migration.version)
        .collect::<Vec<_>>();

    let mut migration_connection = pool.acquire().await?;
    sqlx::query("SET search_path = public")
        .execute(&mut *migration_connection)
        .await?;
    inject_candidate_fault("target_migrations")?;
    MIGRATOR
        .run_direct(None, &mut *migration_connection, false)
        .await?;
    drop(migration_connection);

    let target_profile = runtime_database_profile(pool).await?;
    migrations::validate_complete_ledger(&target_profile.migration_ledger)
        .map_err(|error| anyhow::anyhow!("candidate migration ledger invalid: {error}"))?;
    if !target_profile.migration_ledger_successful {
        anyhow::bail!("candidate migration ledger contains a failed migration");
    }
    let target_schema = validate_schema_contract(pool).await?;
    if !target_schema.required_relations_present
        || !target_schema.telemetry_hypertable
        || !target_schema.foreign_keys_validated
    {
        anyhow::bail!("candidate final schema contract is incomplete");
    }

    Ok(CandidatePreparationReport {
        foreign_keys_validated: target_schema.foreign_keys_validated,
        source_schema,
        target_schema,
        applied_transforms: Vec::new(),
        migrations_applied,
    })
}

fn inject_candidate_fault(phase: &str) -> anyhow::Result<()> {
    if std::env::var("RIVIAMIGO_RESTORE_FAULT_PHASE").as_deref() == Ok(phase) {
        anyhow::bail!("restore fault injection triggered at {phase}");
    }
    Ok(())
}

fn blocking_from_ledger_error(
    target: bool,
    error: migrations::LedgerValidationError,
) -> RestoreBlockingError {
    let code = if error.kind == LedgerValidationKind::Checksum {
        RestoreBlockingCode::MigrationChecksumMismatch
    } else if target {
        RestoreBlockingCode::TargetMigrationDrift
    } else {
        RestoreBlockingCode::SourceLedgerInvalid
    };
    RestoreBlockingError {
        code,
        message: if target {
            format!("Target migration ledger is not compatible with this release: {error}")
        } else {
            format!("Recovery package migration ledger is invalid: {error}")
        },
    }
}

fn validate_source_identity(source: &DatabaseProfile) -> Result<(), RestoreBlockingError> {
    if source.migration_chain_id.as_deref() != Some(MIGRATION_CHAIN_ID) {
        return Err(RestoreBlockingError {
            code: RestoreBlockingCode::UnsupportedMigrationChain,
            message: format!(
                "The recovery package belongs to migration chain {:?}; this release requires {MIGRATION_CHAIN_ID}.",
                source.migration_chain_id
            ),
        });
    }
    migrations::validate_ledger_prefix(&source.migration_ledger)
        .map_err(|error| blocking_from_ledger_error(false, error))?;
    let declared_head = source.migration_version;
    let ledger_head = source
        .migration_ledger
        .last()
        .map(|entry| entry.version)
        .unwrap_or(0);
    if declared_head != ledger_head {
        return Err(RestoreBlockingError {
            code: RestoreBlockingCode::SourceLedgerInvalid,
            message: format!(
                "Recovery package declares migration {declared_head}, but its ledger stops at {ledger_head}."
            ),
        });
    }
    let source_catalog_digest = migrations::migration_ledger_digest(&source.migration_ledger);
    if source.migration_catalog_digest.as_deref() != Some(source_catalog_digest.as_str()) {
        return Err(RestoreBlockingError {
            code: RestoreBlockingCode::MigrationChecksumMismatch,
            message: "Recovery package migration catalog digest differs from this release catalog."
                .into(),
        });
    }
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

    if package_format != RECOVERY_FORMAT_V3 {
        blocking_errors.push(RestoreBlockingError {
            code: if matches!(
                package_format.as_str(),
                RECOVERY_FORMAT_V1 | RECOVERY_FORMAT_V2
            ) {
                RestoreBlockingCode::UnsupportedMigrationChain
            } else {
                RestoreBlockingCode::UnsupportedPackageFormat
            },
            message: if matches!(
                package_format.as_str(),
                RECOVERY_FORMAT_V1 | RECOVERY_FORMAT_V2
            ) {
                "This package predates the public migration baseline and is retained for rollback only. Create a new v3 package after adopting the baseline.".into()
            } else {
                format!("Unsupported recovery package format: {package_format}")
            },
        });
    } else if let Err(error) = validate_source_identity(&source) {
        blocking_errors.push(error);
    }

    if let Some(dump) = dump {
        if !dump.has_riviamigo_schema || !dump.has_timeseries_schema {
            blocking_errors.push(RestoreBlockingError {
                code: RestoreBlockingCode::SchemaContractMismatch,
                message: "The recovery dump is missing required Riviamigo schemas.".into(),
            });
        }
    }

    if !target.migration_ledger_successful {
        blocking_errors.push(RestoreBlockingError {
            code: RestoreBlockingCode::TargetMigrationDrift,
            message: "The target migration ledger contains a failed migration.".into(),
        });
    }
    if let Err(error) = migrations::validate_complete_ledger(&target.migration_ledger) {
        blocking_errors.push(blocking_from_ledger_error(true, error));
    }

    if source.migration_version > latest_migration_version() {
        blocking_errors.push(RestoreBlockingError {
            code: RestoreBlockingCode::NewerSourceSchema,
            message: format!(
                "The package schema version {} is newer than this release version {}.",
                source.migration_version,
                latest_migration_version()
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
    if package_format == RECOVERY_FORMAT_V3
        && (source.schema_contract_version.as_deref() != Some(SCHEMA_CONTRACT_VERSION)
            || source.schema_fingerprint.is_none())
    {
        blocking_errors.push(RestoreBlockingError {
            code: RestoreBlockingCode::SchemaContractMismatch,
            message: "The package is missing the supported versioned schema contract.".into(),
        });
    }

    let pending_migrations = compiled_migration_ledger()
        .into_iter()
        .skip(source.migration_ledger.len())
        .map(|migration| migration.version)
        .collect::<Vec<_>>();
    let transforms = Vec::new();
    let validation_checks = vec![
        "migration_chain".into(),
        "migration_ledger_exact_prefix".into(),
        "schema_contract".into(),
        "timescale_objects".into(),
        "foreign_key_integrity".into(),
        "application_health".into(),
    ];
    let plan_material = serde_json::to_vec(&serde_json::json!({
        "engine_version": RESTORE_ENGINE_VERSION,
        "package_checksum_sha256": package_checksum_sha256,
        "package_format": package_format,
        "source": source,
        "target": target,
        "compiled_catalog": compiled_migration_ledger(),
        "compiled_catalog_digest": migrations::migration_catalog_digest(),
        "schema_contract_version": SCHEMA_CONTRACT_VERSION,
        "dump": dump,
        "pending_migrations": pending_migrations,
        "transforms": transforms,
        "validation_checks": validation_checks,
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
        validation_checks,
        warnings: Vec::new(),
        blocking_errors,
        planned_at: Utc::now(),
    })
}

fn source_profile_from_manifest(manifest: &Value) -> Result<DatabaseProfile, AppError> {
    let empty_source = Value::Null;
    let source = manifest.get("source").unwrap_or(&empty_source);
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
        migration_version: source
            .get("migration_version")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        migration_ledger,
        migration_ledger_successful: true,
        migration_chain_id: source
            .get("migration_chain_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        migration_catalog_digest: source
            .get("migration_catalog_digest")
            .and_then(Value::as_str)
            .map(str::to_string),
        schema_contract_version: source
            .get("schema_contract_version")
            .and_then(Value::as_str)
            .map(str::to_string),
        schema_fingerprint: source
            .get("schema_fingerprint")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn timescale_versions_compatible(source: Option<&str>, target: Option<&str>) -> bool {
    let Some(source) = source.and_then(parse_version_triplet) else {
        return false;
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

    fn v3_manifest() -> Value {
        serde_json::json!({
            "format": RECOVERY_FORMAT_V3,
            "source": {
                "postgres_major": 18,
                "timescale_version": "2.28.3",
                "migration_version": latest_migration_version(),
                "migration_chain_id": MIGRATION_CHAIN_ID,
                "migration_ledger": compiled_migration_ledger(),
                "migration_catalog_digest": migrations::migration_catalog_digest(),
                "schema_contract_version": SCHEMA_CONTRACT_VERSION,
                "schema_fingerprint": "fingerprint"
            }
        })
    }

    #[test]
    fn timescale_compatibility_is_forward_only_within_a_major() {
        assert!(timescale_versions_compatible(
            Some("2.20.0"),
            Some("2.28.3")
        ));
        assert!(!timescale_versions_compatible(
            Some("2.29.0"),
            Some("2.28.3")
        ));
        assert!(!timescale_versions_compatible(None, Some("2.28.3")));
    }

    #[test]
    fn v3_source_profile_reads_chain_catalog_and_contract() {
        let profile = source_profile_from_manifest(&v3_manifest()).expect("source profile");
        assert_eq!(
            profile.migration_chain_id.as_deref(),
            Some(MIGRATION_CHAIN_ID)
        );
        assert_eq!(profile.migration_ledger.len(), 1);
        assert_eq!(
            profile.schema_contract_version.as_deref(),
            Some(SCHEMA_CONTRACT_VERSION)
        );
        validate_source_identity(&profile).expect("v3 identity validates");
    }

    #[test]
    fn source_identity_rejects_checksum_drift_and_unknown_chain() {
        let mut profile = source_profile_from_manifest(&v3_manifest()).expect("source profile");
        profile.migration_ledger[0]
            .checksum_sha384
            .replace_range(0..2, "00");
        assert_eq!(
            validate_source_identity(&profile)
                .expect_err("checksum drift")
                .code,
            RestoreBlockingCode::MigrationChecksumMismatch
        );

        let mut profile = source_profile_from_manifest(&v3_manifest()).expect("source profile");
        profile.migration_chain_id = Some("unknown-chain".into());
        assert_eq!(
            validate_source_identity(&profile)
                .expect_err("unknown chain")
                .code,
            RestoreBlockingCode::UnsupportedMigrationChain
        );
    }
}
