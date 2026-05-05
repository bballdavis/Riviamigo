use axum::{extract::State, routing::get, Json, Router};
use serde_json::json;
use sqlx::Row;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/rivian/stewardship", get(stewardship))
}

async fn stewardship(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    require_jwt_admin(&state, &auth).await?;

    let totals = sqlx::query(
        r#"
        SELECT
          COALESCE(SUM(ws_messages_received), 0)::BIGINT AS ws_messages_received,
          COALESCE(SUM(ws_heartbeats_received), 0)::BIGINT AS ws_heartbeats_received,
          COALESCE(SUM(ws_payload_messages_received), 0)::BIGINT AS ws_payload_messages_received,
          COALESCE(SUM(ws_control_messages_received), 0)::BIGINT AS ws_control_messages_received,
          COALESCE(SUM(ws_connections_opened), 0)::BIGINT AS ws_connections_opened,
          COALESCE(SUM(ws_reconnects), 0)::BIGINT AS ws_reconnects,
          COALESCE(SUM(outbound_messages_sent), 0)::BIGINT AS outbound_messages_sent,
          COALESCE(SUM(outbound_graphql_requests), 0)::BIGINT AS outbound_graphql_requests,
          COALESCE(SUM(telemetry_writes_persisted), 0)::BIGINT AS telemetry_writes_persisted,
          COALESCE(SUM(telemetry_writes_suppressed), 0)::BIGINT AS telemetry_writes_suppressed,
          COALESCE(SUM(telemetry_suppressed_duplicate), 0)::BIGINT AS telemetry_suppressed_duplicate,
          COALESCE(SUM(telemetry_suppressed_empty), 0)::BIGINT AS telemetry_suppressed_empty,
          COALESCE(SUM(telemetry_suppressed_threshold), 0)::BIGINT AS telemetry_suppressed_threshold,
          COALESCE(SUM(collector_lock_skips), 0)::BIGINT AS collector_lock_skips,
          COALESCE(SUM(raw_events_persisted), 0)::BIGINT AS raw_events_persisted
        FROM riviamigo.rivian_stewardship_counters
        WHERE day >= CURRENT_DATE - 1
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    let active_collectors: i64 = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::BIGINT
        FROM riviamigo.vehicle_runtime_state
        WHERE worker_health = 'connected'
          AND COALESCE(last_seen_at, last_event_at, updated_at) > now() - INTERVAL '10 minutes'
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    let raw_events_retained: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM riviamigo.rivian_ws_raw_events WHERE received_at >= now() - ($1::int * INTERVAL '1 day')",
    )
    .bind(state.config.rivian_raw_event_retention_days.max(1) as i32)
    .fetch_one(&state.pool)
    .await?;

    let rows = sqlx::query(
        r#"
        SELECT
          v.id::TEXT AS vehicle_id,
          COALESCE(v.name, v.model) AS display_name,
          r.worker_health,
          r.last_seen_at,
          r.last_payload_at,
          r.last_persisted_at,
          r.last_heartbeat_at,
          COALESCE(SUM(c.ws_messages_received), 0)::BIGINT AS ws_messages_received,
          COALESCE(SUM(c.ws_heartbeats_received), 0)::BIGINT AS ws_heartbeats_received,
          COALESCE(SUM(c.ws_payload_messages_received), 0)::BIGINT AS ws_payload_messages_received,
          COALESCE(SUM(c.ws_reconnects), 0)::BIGINT AS ws_reconnects,
          COALESCE(SUM(c.telemetry_writes_persisted), 0)::BIGINT AS telemetry_writes_persisted,
          COALESCE(SUM(c.telemetry_writes_suppressed), 0)::BIGINT AS telemetry_writes_suppressed,
          COALESCE(SUM(c.collector_lock_skips), 0)::BIGINT AS collector_lock_skips
        FROM riviamigo.vehicles v
        LEFT JOIN riviamigo.vehicle_runtime_state r ON r.vehicle_id = v.id
        LEFT JOIN riviamigo.rivian_stewardship_counters c
          ON c.vehicle_id = v.id AND c.day >= CURRENT_DATE - 1
        GROUP BY v.id, v.name, v.model, r.worker_health, r.last_seen_at, r.last_payload_at,
                 r.last_persisted_at, r.last_heartbeat_at
        ORDER BY display_name
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let vehicles = rows
        .into_iter()
        .map(|row| {
            json!({
                "vehicle_id": row.try_get::<String, _>("vehicle_id").ok(),
                "display_name": row.try_get::<String, _>("display_name").ok(),
                "worker_health": row.try_get::<Option<String>, _>("worker_health").ok().flatten(),
                "last_seen_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_seen_at").ok().flatten(),
                "last_payload_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_payload_at").ok().flatten(),
                "last_persisted_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_persisted_at").ok().flatten(),
                "last_heartbeat_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_heartbeat_at").ok().flatten(),
                "ws_messages_received": row.try_get::<i64, _>("ws_messages_received").unwrap_or(0),
                "ws_heartbeats_received": row.try_get::<i64, _>("ws_heartbeats_received").unwrap_or(0),
                "ws_payload_messages_received": row.try_get::<i64, _>("ws_payload_messages_received").unwrap_or(0),
                "ws_reconnects": row.try_get::<i64, _>("ws_reconnects").unwrap_or(0),
                "telemetry_writes_persisted": row.try_get::<i64, _>("telemetry_writes_persisted").unwrap_or(0),
                "telemetry_writes_suppressed": row.try_get::<i64, _>("telemetry_writes_suppressed").unwrap_or(0),
                "collector_lock_skips": row.try_get::<i64, _>("collector_lock_skips").unwrap_or(0),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(json!({
        "generated_at": chrono::Utc::now(),
        "retention_days": state.config.rivian_raw_event_retention_days,
        "raw_event_persistence_enabled": state.config.rivian_persist_raw_events,
        "duplicate_suppression_enabled": state.config.rivian_suppress_duplicate_telemetry,
        "active_collectors": active_collectors,
        "raw_events_retained": raw_events_retained,
        "totals_24h": {
            "ws_messages_received": totals.try_get::<i64, _>("ws_messages_received").unwrap_or(0),
            "ws_heartbeats_received": totals.try_get::<i64, _>("ws_heartbeats_received").unwrap_or(0),
            "ws_payload_messages_received": totals.try_get::<i64, _>("ws_payload_messages_received").unwrap_or(0),
            "ws_control_messages_received": totals.try_get::<i64, _>("ws_control_messages_received").unwrap_or(0),
            "ws_connections_opened": totals.try_get::<i64, _>("ws_connections_opened").unwrap_or(0),
            "ws_reconnects": totals.try_get::<i64, _>("ws_reconnects").unwrap_or(0),
            "outbound_messages_sent": totals.try_get::<i64, _>("outbound_messages_sent").unwrap_or(0),
            "outbound_graphql_requests": totals.try_get::<i64, _>("outbound_graphql_requests").unwrap_or(0),
            "telemetry_writes_persisted": totals.try_get::<i64, _>("telemetry_writes_persisted").unwrap_or(0),
            "telemetry_writes_suppressed": totals.try_get::<i64, _>("telemetry_writes_suppressed").unwrap_or(0),
            "telemetry_suppressed_duplicate": totals.try_get::<i64, _>("telemetry_suppressed_duplicate").unwrap_or(0),
            "telemetry_suppressed_empty": totals.try_get::<i64, _>("telemetry_suppressed_empty").unwrap_or(0),
            "telemetry_suppressed_threshold": totals.try_get::<i64, _>("telemetry_suppressed_threshold").unwrap_or(0),
            "collector_lock_skips": totals.try_get::<i64, _>("collector_lock_skips").unwrap_or(0),
            "raw_events_persisted": totals.try_get::<i64, _>("raw_events_persisted").unwrap_or(0),
        },
        "vehicles": vehicles,
    })))
}

async fn require_jwt_admin(state: &AppState, auth: &AuthUser) -> Result<(), AppError> {
    if auth.api_access_level.is_some() {
        return Err(AppError::Forbidden);
    }

    let role: Option<String> = sqlx::query_scalar("SELECT role FROM riviamigo.users WHERE id = $1")
        .bind(auth.user_id)
        .fetch_optional(&state.pool)
        .await?
        .flatten();

    if role.as_deref() == Some("admin") {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}
