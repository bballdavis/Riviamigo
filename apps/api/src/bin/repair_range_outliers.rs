use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use sqlx::postgres::PgPoolOptions;
use tracing::info;
use uuid::Uuid;

const PLAUSIBLE_MAX_MI_PER_KWH: f64 = 3.4;

#[derive(Debug, Default)]
struct RepairScope {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    dry_run: bool,
}

fn parse_scope() -> Result<RepairScope> {
    let mut scope = RepairScope::default();
    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--vehicle-id" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow!("--vehicle-id requires a UUID value"))?;
                scope.vehicle_id = Some(value.parse::<Uuid>()?);
            }
            "--from" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow!("--from requires an RFC3339 timestamp"))?;
                scope.from = Some(DateTime::parse_from_rfc3339(&value)?.with_timezone(&Utc));
            }
            "--to" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow!("--to requires an RFC3339 timestamp"))?;
                scope.to = Some(DateTime::parse_from_rfc3339(&value)?.with_timezone(&Utc));
            }
            "--dry-run" => {
                scope.dry_run = true;
            }
            "--help" | "-h" => {
                println!(
                    "Usage: cargo run --bin repair_range_outliers [--dry-run] [--vehicle-id <uuid>] [--from <rfc3339>] [--to <rfc3339>]"
                );
                std::process::exit(0);
            }
            other => return Err(anyhow!("Unknown argument: {other}")),
        }
    }

    Ok(scope)
}

#[derive(Debug, sqlx::FromRow)]
struct RepairSummary {
    converted_rows: i64,
    nulled_rows: i64,
    untouched_rows: i64,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let scope = parse_scope()?;
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let summary = summarize(&pool, &scope).await?;
    info!(
        converted_rows = summary.converted_rows,
        nulled_rows = summary.nulled_rows,
        untouched_rows = summary.untouched_rows,
        dry_run = scope.dry_run,
        "range outlier analysis"
    );

    if scope.dry_run {
        return Ok(());
    }

    let updated = apply_repairs(&pool, &scope).await?;
    info!(rows_updated = updated, "range outlier repair complete");

    Ok(())
}

async fn summarize(pool: &sqlx::PgPool, scope: &RepairScope) -> Result<RepairSummary> {
    let summary = sqlx::query_as::<_, RepairSummary>(
        r#"
        WITH scoped AS (
            SELECT
                distance_to_empty_mi,
                battery_level,
                battery_capacity_wh,
                CASE
                    WHEN battery_capacity_wh > 1000.0 THEN battery_capacity_wh / 1000.0
                    ELSE battery_capacity_wh
                END AS capacity_kwh
            FROM timeseries.telemetry
            WHERE distance_to_empty_mi IS NOT NULL
              AND battery_level IS NOT NULL
              AND battery_level > 0
              AND battery_capacity_wh IS NOT NULL
              AND battery_capacity_wh > 10000
              AND ($1::uuid IS NULL OR vehicle_id = $1)
              AND ($2::timestamptz IS NULL OR ts >= $2)
              AND ($3::timestamptz IS NULL OR ts <= $3)
        ), assessed AS (
            SELECT
                distance_to_empty_mi,
                battery_level,
                capacity_kwh,
                distance_to_empty_mi / battery_level * 100.0 AS raw_full_range,
                (distance_to_empty_mi / 1.609344) / battery_level * 100.0 AS converted_full_range,
                capacity_kwh * $4::float8 AS plausible_full_range
            FROM scoped
            WHERE capacity_kwh > 0
        )
        SELECT
            COUNT(*) FILTER (
                WHERE raw_full_range > plausible_full_range
                  AND converted_full_range <= plausible_full_range
            )::int8 AS converted_rows,
            COUNT(*) FILTER (
                WHERE raw_full_range > plausible_full_range
                  AND converted_full_range > plausible_full_range
            )::int8 AS nulled_rows,
            COUNT(*) FILTER (
                WHERE raw_full_range <= plausible_full_range
            )::int8 AS untouched_rows
        FROM assessed
        "#,
    )
    .bind(scope.vehicle_id)
    .bind(scope.from)
    .bind(scope.to)
    .bind(PLAUSIBLE_MAX_MI_PER_KWH)
    .fetch_one(pool)
    .await?;

    Ok(summary)
}

async fn apply_repairs(pool: &sqlx::PgPool, scope: &RepairScope) -> Result<u64> {
    let result = sqlx::query(
        r#"
        WITH candidates AS (
            SELECT
                ts,
                vehicle_id,
                distance_to_empty_mi,
                battery_level,
                CASE
                    WHEN battery_capacity_wh > 1000.0 THEN battery_capacity_wh / 1000.0
                    ELSE battery_capacity_wh
                END AS capacity_kwh
            FROM timeseries.telemetry
            WHERE distance_to_empty_mi IS NOT NULL
              AND battery_level IS NOT NULL
              AND battery_level > 0
              AND battery_capacity_wh IS NOT NULL
              AND battery_capacity_wh > 10000
              AND ($1::uuid IS NULL OR vehicle_id = $1)
              AND ($2::timestamptz IS NULL OR ts >= $2)
              AND ($3::timestamptz IS NULL OR ts <= $3)
        ), repairs AS (
            SELECT
                ts,
                vehicle_id,
                CASE
                    WHEN (distance_to_empty_mi / battery_level * 100.0) <= (capacity_kwh * $4::float8)
                        THEN NULL
                    WHEN ((distance_to_empty_mi / 1.609344) / battery_level * 100.0) <= (capacity_kwh * $4::float8)
                        THEN distance_to_empty_mi / 1.609344
                    ELSE 0.0
                END AS repaired_miles
            FROM candidates
            WHERE capacity_kwh > 0
        )
        UPDATE timeseries.telemetry t
        SET distance_to_empty_mi = CASE
            WHEN repairs.repaired_miles = 0.0 THEN NULL
            ELSE repairs.repaired_miles
        END
        FROM repairs
        WHERE t.ts = repairs.ts
          AND t.vehicle_id = repairs.vehicle_id
          AND repairs.repaired_miles IS NOT NULL
        "#,
    )
    .bind(scope.vehicle_id)
    .bind(scope.from)
    .bind(scope.to)
    .bind(PLAUSIBLE_MAX_MI_PER_KWH)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}
