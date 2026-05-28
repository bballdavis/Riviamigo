//! Report potential duplicate charge sessions.
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin report_charge_session_duplicates

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPoolOptions, FromRow};
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct DuplicateRivianIdRow {
    vehicle_id: Uuid,
    rivian_session_id: String,
    row_count: i64,
    earliest_started_at: DateTime<Utc>,
    latest_started_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct OverlapPairRow {
    vehicle_id: Uuid,
    left_id: Uuid,
    right_id: Uuid,
    left_started_at: DateTime<Utc>,
    left_ended_at: DateTime<Utc>,
    right_started_at: DateTime<Utc>,
    right_ended_at: DateTime<Utc>,
    left_rivian_session_id: Option<String>,
    right_rivian_session_id: Option<String>,
}

#[derive(Debug, FromRow)]
struct MidnightSplitRow {
    vehicle_id: Uuid,
    left_id: Uuid,
    right_id: Uuid,
    left_started_at: DateTime<Utc>,
    left_ended_at: DateTime<Utc>,
    right_started_at: DateTime<Utc>,
    right_ended_at: DateTime<Utc>,
    gap_minutes: i64,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let duplicate_rivian_ids = sqlx::query_as::<_, DuplicateRivianIdRow>(
        r#"
        SELECT
            vehicle_id,
            rivian_session_id,
            COUNT(*)::bigint AS row_count,
            MIN(started_at) AS earliest_started_at,
            MAX(started_at) AS latest_started_at
        FROM riviamigo.charge_sessions
        WHERE rivian_session_id IS NOT NULL
        GROUP BY vehicle_id, rivian_session_id
        HAVING COUNT(*) > 1
        ORDER BY row_count DESC, latest_started_at DESC
        LIMIT 200
        "#,
    )
    .fetch_all(&pool)
    .await?;

    let overlap_pairs = sqlx::query_as::<_, OverlapPairRow>(
        r#"
        SELECT
            a.vehicle_id,
            a.id AS left_id,
            b.id AS right_id,
            a.started_at AS left_started_at,
            COALESCE(a.ended_at, a.started_at) AS left_ended_at,
            b.started_at AS right_started_at,
            COALESCE(b.ended_at, b.started_at) AS right_ended_at,
            a.rivian_session_id AS left_rivian_session_id,
            b.rivian_session_id AS right_rivian_session_id
        FROM riviamigo.charge_sessions a
        JOIN riviamigo.charge_sessions b
          ON a.vehicle_id = b.vehicle_id
         AND a.id < b.id
         AND a.started_at <= COALESCE(b.ended_at, b.started_at)
         AND b.started_at <= COALESCE(a.ended_at, a.started_at)
        ORDER BY GREATEST(a.created_at, b.created_at) DESC
        LIMIT 200
        "#,
    )
    .fetch_all(&pool)
    .await?;

    let midnight_splits = sqlx::query_as::<_, MidnightSplitRow>(
        r#"
        WITH ordered AS (
            SELECT
                id,
                vehicle_id,
                started_at,
                COALESCE(ended_at, started_at) AS ended_at,
                LAG(id) OVER (PARTITION BY vehicle_id ORDER BY started_at) AS prev_id,
                LAG(started_at) OVER (PARTITION BY vehicle_id ORDER BY started_at) AS prev_started_at,
                LAG(COALESCE(ended_at, started_at)) OVER (PARTITION BY vehicle_id ORDER BY started_at) AS prev_ended_at
            FROM riviamigo.charge_sessions
        )
        SELECT
            vehicle_id,
            prev_id AS left_id,
            id AS right_id,
            prev_started_at AS left_started_at,
            prev_ended_at AS left_ended_at,
            started_at AS right_started_at,
            ended_at AS right_ended_at,
            EXTRACT(EPOCH FROM (started_at - prev_ended_at))::bigint / 60 AS gap_minutes
        FROM ordered
        WHERE prev_id IS NOT NULL
          AND prev_ended_at IS NOT NULL
          AND prev_ended_at::date <> started_at::date
          AND started_at - prev_ended_at <= interval '2 hours'
        ORDER BY started_at DESC
        LIMIT 200
        "#,
    )
    .fetch_all(&pool)
    .await?;

    println!("=== Duplicate report: rivian_session_id collisions ===");
    println!("rows={}", duplicate_rivian_ids.len());
    for row in &duplicate_rivian_ids {
        println!(
            "vehicle={} rivian_session_id={} count={} first={} last={}",
            row.vehicle_id,
            row.rivian_session_id,
            row.row_count,
            row.earliest_started_at,
            row.latest_started_at
        );
    }

    println!();
    println!("=== Duplicate report: overlapping session pairs ===");
    println!("rows={}", overlap_pairs.len());
    for row in &overlap_pairs {
        println!(
            "vehicle={} left={} [{}..{}] right={} [{}..{}] left_rivian={:?} right_rivian={:?}",
            row.vehicle_id,
            row.left_id,
            row.left_started_at,
            row.left_ended_at,
            row.right_id,
            row.right_started_at,
            row.right_ended_at,
            row.left_rivian_session_id,
            row.right_rivian_session_id
        );
    }

    println!();
    println!("=== Duplicate report: near-midnight split candidates ===");
    println!("rows={}", midnight_splits.len());
    for row in &midnight_splits {
        println!(
            "vehicle={} left={} [{}..{}] right={} [{}..{}] gap_min={}",
            row.vehicle_id,
            row.left_id,
            row.left_started_at,
            row.left_ended_at,
            row.right_id,
            row.right_started_at,
            row.right_ended_at,
            row.gap_minutes
        );
    }

    Ok(())
}
