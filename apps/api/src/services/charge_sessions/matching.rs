//! Database lookups that match an incoming charge summary to an existing
//! charge session.

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::{ChargeSessionExternalAlias, MatchRow};

pub(super) async fn find_session_by_external_alias(
    pool: &PgPool,
    vehicle_id: Uuid,
    aliases: &[ChargeSessionExternalAlias],
) -> Result<Option<MatchRow>> {
    if aliases.is_empty() {
        return Ok(None);
    }

    let external_ids = aliases
        .iter()
        .map(|alias| alias.external_id.clone())
        .collect::<Vec<_>>();

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        SELECT DISTINCT ON (cs.id)
            cs.id,
            cs.source
        FROM riviamigo.charge_sessions cs
        LEFT JOIN riviamigo.charge_session_external_aliases alias
          ON alias.charge_session_id = cs.id
        WHERE cs.vehicle_id = $1
          AND (
              cs.rivian_session_id = ANY($2)
              OR alias.external_id = ANY($2)
          )
        ORDER BY cs.id,
                 CASE COALESCE(cs.source, '')
                     WHEN 'telemetry+rivian_api' THEN 4
                     WHEN 'telemetry' THEN 3
                     WHEN 'rivian_api' THEN 1
                     ELSE 2
                 END DESC
        "#,
    )
    .bind(vehicle_id)
    .bind(&external_ids)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}

pub(super) async fn find_session_by_grouping_key(
    pool: &PgPool,
    vehicle_id: Uuid,
    grouping_key: Option<&str>,
    started_at: Option<DateTime<Utc>>,
) -> Result<Option<MatchRow>> {
    let Some(grouping_key) = grouping_key else {
        return Ok(None);
    };

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        SELECT DISTINCT ON (cs.id)
            cs.id,
            cs.source
        FROM riviamigo.charge_sessions cs
        JOIN riviamigo.charge_session_external_aliases alias
          ON alias.charge_session_id = cs.id
        WHERE cs.vehicle_id = $1
          AND alias.transaction_id_grouping_key = $2
        ORDER BY cs.id,
                 CASE COALESCE(cs.source, '')
                     WHEN 'telemetry+rivian_api' THEN 4
                     WHEN 'telemetry' THEN 3
                     WHEN 'rivian_api' THEN 1
                     ELSE 2
                 END DESC,
                 ABS(EXTRACT(EPOCH FROM (cs.started_at - COALESCE($3, cs.started_at)))) ASC
        "#,
    )
    .bind(vehicle_id)
    .bind(grouping_key)
    .bind(started_at)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}

pub(super) async fn find_overlapping_session(
    pool: &PgPool,
    vehicle_id: Uuid,
    started_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
) -> Result<Option<MatchRow>> {
    let Some(started_at) = started_at else {
        return Ok(None);
    };
    let end_bound = ended_at.unwrap_or(started_at);

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        SELECT
            cs.id,
            cs.source
        FROM riviamigo.charge_sessions cs
        WHERE cs.vehicle_id = $1
          AND cs.started_at <= $3
          AND COALESCE(cs.ended_at, cs.started_at) >= $2
        ORDER BY CASE COALESCE(cs.source, '')
                     WHEN 'telemetry+rivian_api' THEN 4
                     WHEN 'telemetry' THEN 3
                     WHEN 'rivian_api' THEN 1
                     ELSE 2
                 END DESC,
                 ABS(EXTRACT(EPOCH FROM (cs.started_at - $2))) ASC,
                 cs.started_at ASC,
                 cs.id ASC
        LIMIT 1
        "#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(end_bound)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}

pub(super) async fn find_time_window_session(
    pool: &PgPool,
    vehicle_id: Uuid,
    started_at: Option<DateTime<Utc>>,
) -> Result<Option<MatchRow>> {
    let Some(started_at) = started_at else {
        return Ok(None);
    };
    let window_start = started_at - chrono::Duration::minutes(60);
    let window_end = started_at + chrono::Duration::minutes(60);

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        WITH ranked AS (
            SELECT
                cs.id,
                cs.source,
                ABS(EXTRACT(EPOCH FROM (cs.started_at - $4))) AS delta_secs,
                ROW_NUMBER() OVER (
                    ORDER BY
                        CASE COALESCE(cs.source, '')
                            WHEN 'telemetry+rivian_api' THEN 4
                            WHEN 'telemetry' THEN 3
                            WHEN 'rivian_api' THEN 1
                            ELSE 2
                        END DESC,
                        ABS(EXTRACT(EPOCH FROM (cs.started_at - $4))) ASC,
                        cs.started_at ASC,
                        cs.id ASC
                ) AS rn,
                LEAD(ABS(EXTRACT(EPOCH FROM (cs.started_at - $4)))) OVER (
                    ORDER BY
                        CASE COALESCE(cs.source, '')
                            WHEN 'telemetry+rivian_api' THEN 4
                            WHEN 'telemetry' THEN 3
                            WHEN 'rivian_api' THEN 1
                            ELSE 2
                        END DESC,
                        ABS(EXTRACT(EPOCH FROM (cs.started_at - $4))) ASC,
                        cs.started_at ASC,
                        cs.id ASC
                ) AS next_delta_secs
            FROM riviamigo.charge_sessions cs
            WHERE cs.vehicle_id = $1
              AND cs.started_at BETWEEN $2 AND $3
        )
        SELECT id, source
        FROM ranked
        WHERE rn = 1
          AND (next_delta_secs IS NULL OR (next_delta_secs - delta_secs) >= 900)
        "#,
    )
    .bind(vehicle_id)
    .bind(window_start)
    .bind(window_end)
    .bind(started_at)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}
