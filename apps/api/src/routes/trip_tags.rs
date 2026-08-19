//! Shared, vehicle-scoped trip tag catalog and assignment routes.

use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{
    db::vehicles::{require_vehicle_manager_access, require_vehicle_read_access},
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

const COLOR_TOKENS: &[&str] = &["accent", "neutral", "info", "success", "warning", "danger"];
const MAX_BATCH_TRIPS: usize = 500;
const MAX_BATCH_TAGS: usize = 50;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/vehicles/{vehicle_id}/trip-tags",
            get(list_tags).post(create_tag),
        )
        .route(
            "/vehicles/{vehicle_id}/trip-tags/{tag_id}",
            patch(update_tag).delete(delete_tag),
        )
        .route(
            "/vehicles/{vehicle_id}/trip-tags/assignments",
            post(update_assignments),
        )
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TripTagResponse {
    pub id: Uuid,
    pub vehicle_id: Uuid,
    pub name: String,
    pub color_token: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct CreateTagBody {
    name: String,
    color_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateTagBody {
    name: Option<String>,
    color_token: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AssignmentMode {
    Add,
    Remove,
    Replace,
}

#[derive(Debug, Deserialize)]
struct AssignmentBody {
    trip_ids: Vec<Uuid>,
    tag_ids: Vec<Uuid>,
    mode: AssignmentMode,
}

#[derive(Debug, Serialize)]
struct AssignmentResponse {
    updated_trip_count: usize,
}

/// Produce a stable display value and uniqueness key. NFC prevents equivalent
/// Unicode spellings from creating visually indistinguishable catalog entries;
/// whitespace and Unicode lowercasing make lookup/collision behavior explicit.
fn normalize_name(raw: &str) -> Result<(String, String), AppError> {
    let display = raw.nfc().collect::<String>();
    let display = display.split_whitespace().collect::<Vec<_>>().join(" ");
    if display.is_empty() || display.chars().count() > 64 {
        return Err(AppError::Validation(
            "tag name must contain 1 to 64 non-whitespace characters".into(),
        ));
    }
    let normalized = display.nfc().collect::<String>().to_lowercase();
    Ok((display, normalized))
}

fn validate_color_token(token: Option<String>) -> Result<String, AppError> {
    let token = token.unwrap_or_else(|| "accent".into());
    if COLOR_TOKENS.contains(&token.as_str()) {
        Ok(token)
    } else {
        Err(AppError::Validation(
            "color_token must be a supported semantic color token".into(),
        ))
    }
}

async fn list_tags(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<Vec<TripTagResponse>>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;
    let tags = sqlx::query_as::<_, TripTagResponse>(
        "SELECT id, vehicle_id, name, color_token, created_by, created_at, updated_at
         FROM riviamigo.trip_tags WHERE vehicle_id=$1 ORDER BY lower(name), id",
    )
    .bind(vehicle_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(tags))
}

async fn create_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
    Json(body): Json<CreateTagBody>,
) -> Result<Json<TripTagResponse>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    let (name, normalized_name) = normalize_name(&body.name)?;
    let color_token = validate_color_token(body.color_token)?;
    let tag = sqlx::query_as::<_, TripTagResponse>(
        "INSERT INTO riviamigo.trip_tags (vehicle_id, name, normalized_name, color_token, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, vehicle_id, name, color_token, created_by, created_at, updated_at",
    )
    .bind(vehicle_id)
    .bind(name)
    .bind(normalized_name)
    .bind(color_token)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|error| match error.as_database_error().and_then(|db| db.code()) {
        Some(code) if code == "23505" => AppError::Conflict("a tag with that name already exists".into()),
        _ => AppError::Database(error),
    })?;
    Ok(Json(tag))
}

async fn update_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, tag_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateTagBody>,
) -> Result<Json<TripTagResponse>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    if body.name.is_none() && body.color_token.is_none() {
        return Err(AppError::Validation(
            "at least one tag field is required".into(),
        ));
    }
    let named = body.name.as_deref().map(normalize_name).transpose()?;
    let color_token = body
        .color_token
        .map(|token| validate_color_token(Some(token)))
        .transpose()?;
    let tag = sqlx::query_as::<_, TripTagResponse>(
        "UPDATE riviamigo.trip_tags
         SET name=COALESCE($3, name), normalized_name=COALESCE($4, normalized_name),
             color_token=COALESCE($5, color_token), updated_at=now()
         WHERE id=$1 AND vehicle_id=$2
         RETURNING id, vehicle_id, name, color_token, created_by, created_at, updated_at",
    )
    .bind(tag_id)
    .bind(vehicle_id)
    .bind(named.as_ref().map(|(name, _)| name))
    .bind(named.as_ref().map(|(_, normalized)| normalized))
    .bind(color_token)
    .fetch_optional(&state.pool)
    .await
    .map_err(
        |error| match error.as_database_error().and_then(|db| db.code()) {
            Some(code) if code == "23505" => {
                AppError::Conflict("a tag with that name already exists".into())
            }
            _ => AppError::Database(error),
        },
    )?
    .ok_or(AppError::NotFound)?;
    Ok(Json(tag))
}

async fn delete_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    let result = sqlx::query("DELETE FROM riviamigo.trip_tags WHERE id=$1 AND vehicle_id=$2")
        .bind(tag_id)
        .bind(vehicle_id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn update_assignments(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
    Json(body): Json<AssignmentBody>,
) -> Result<Json<AssignmentResponse>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    validate_assignment_ids(&body)?;
    assert_vehicle_ids(&state.pool, vehicle_id, &body.trip_ids, &body.tag_ids).await?;

    let mut tx = state.pool.begin().await?;
    match body.mode {
        AssignmentMode::Add => {
            sqlx::query(
                "INSERT INTO riviamigo.trip_tag_assignments (trip_id, tag_id, assigned_by)
                 SELECT trip_id, tag_id, $3 FROM unnest($1::uuid[]) trip_id CROSS JOIN unnest($2::uuid[]) tag_id
                 ON CONFLICT (trip_id, tag_id) DO NOTHING",
            )
            .bind(&body.trip_ids)
            .bind(&body.tag_ids)
            .bind(auth.user_id)
            .execute(&mut *tx)
            .await?;
        }
        AssignmentMode::Remove => {
            sqlx::query("DELETE FROM riviamigo.trip_tag_assignments WHERE trip_id=ANY($1) AND tag_id=ANY($2)")
                .bind(&body.trip_ids)
                .bind(&body.tag_ids)
                .execute(&mut *tx)
                .await?;
        }
        AssignmentMode::Replace => {
            sqlx::query("DELETE FROM riviamigo.trip_tag_assignments WHERE trip_id=ANY($1)")
                .bind(&body.trip_ids)
                .execute(&mut *tx)
                .await?;
            if !body.tag_ids.is_empty() {
                sqlx::query(
                    "INSERT INTO riviamigo.trip_tag_assignments (trip_id, tag_id, assigned_by)
                     SELECT trip_id, tag_id, $3 FROM unnest($1::uuid[]) trip_id CROSS JOIN unnest($2::uuid[]) tag_id",
                )
                .bind(&body.trip_ids)
                .bind(&body.tag_ids)
                .bind(auth.user_id)
                .execute(&mut *tx)
                .await?;
            }
        }
    }
    tx.commit().await?;
    Ok(Json(AssignmentResponse {
        updated_trip_count: body.trip_ids.len(),
    }))
}

fn validate_assignment_ids(body: &AssignmentBody) -> Result<(), AppError> {
    if body.trip_ids.is_empty() || body.trip_ids.len() > MAX_BATCH_TRIPS {
        return Err(AppError::Validation(format!(
            "trip_ids must contain 1 to {MAX_BATCH_TRIPS} IDs"
        )));
    }
    if body.tag_ids.len() > MAX_BATCH_TAGS {
        return Err(AppError::Validation(format!(
            "tag_ids may contain at most {MAX_BATCH_TAGS} IDs"
        )));
    }
    if matches!(body.mode, AssignmentMode::Add | AssignmentMode::Remove) && body.tag_ids.is_empty()
    {
        return Err(AppError::Validation(
            "tag_ids is required for add and remove".into(),
        ));
    }
    if has_duplicates(&body.trip_ids) || has_duplicates(&body.tag_ids) {
        return Err(AppError::Validation(
            "trip_ids and tag_ids must not contain duplicates".into(),
        ));
    }
    Ok(())
}

fn has_duplicates(ids: &[Uuid]) -> bool {
    let mut ids = ids.to_vec();
    ids.sort_unstable();
    ids.windows(2).any(|pair| pair[0] == pair[1])
}

async fn assert_vehicle_ids(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    trip_ids: &[Uuid],
    tag_ids: &[Uuid],
) -> Result<(), AppError> {
    let trip_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM riviamigo.trips WHERE vehicle_id=$1 AND id=ANY($2)",
    )
    .bind(vehicle_id)
    .bind(trip_ids)
    .fetch_one(pool)
    .await?;
    if trip_count != trip_ids.len() as i64 {
        return Err(AppError::Validation(
            "every trip_id must belong to this vehicle".into(),
        ));
    }
    if !tag_ids.is_empty() {
        let tag_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM riviamigo.trip_tags WHERE vehicle_id=$1 AND id=ANY($2)",
        )
        .bind(vehicle_id)
        .bind(tag_ids)
        .fetch_one(pool)
        .await?;
        if tag_count != tag_ids.len() as i64 {
            return Err(AppError::Validation(
                "every tag_id must belong to this vehicle".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_is_unicode_and_whitespace_stable() {
        let (display, normalized) = normalize_name("  Biké   Rack ").unwrap();
        assert_eq!(display, "Biké Rack");
        assert_eq!(normalized, "biké rack");
    }

    #[test]
    fn rejects_invalid_semantic_color() {
        assert!(validate_color_token(Some("#ff0000".into())).is_err());
    }

    #[test]
    fn replace_allows_clearing_tags_but_add_requires_a_tag() {
        let trip_id = Uuid::new_v4();
        let replace = AssignmentBody {
            trip_ids: vec![trip_id],
            tag_ids: vec![],
            mode: AssignmentMode::Replace,
        };
        assert!(validate_assignment_ids(&replace).is_ok());

        let add = AssignmentBody {
            mode: AssignmentMode::Add,
            ..replace
        };
        assert!(validate_assignment_ids(&add).is_err());
    }
}
