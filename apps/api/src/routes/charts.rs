use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    services::{
        chart_registry::{merge_entries, ChartManagerEntry, ChartRecord},
        chart_validation::parse_and_validate,
    },
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChartInput {
    slug: String,
    name: String,
    description: Option<String>,
    #[serde(alias = "is_enabled")]
    is_enabled: Option<bool>,
    config: Value,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChartPatch {
    name: Option<String>,
    description: Option<String>,
    #[serde(alias = "is_enabled")]
    is_enabled: Option<bool>,
    config: Option<Value>,
}
#[derive(Debug, Deserialize)]
struct LockInput {
    locked: bool,
}
#[derive(Debug, Deserialize)]
struct EffectiveQuery {
    dashboard_slug: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlacementInput {
    dashboard_slug: String,
}

#[derive(Debug, Deserialize)]
struct PlacementPatch {
    placements: Vec<PlacementInput>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/charts", get(list).post(create))
        .route("/chart-sources", get(source_manifest))
        .route("/charts/effective", get(effective))
        .route(
            "/charts/{id}",
            get(fetch).put(update).patch(update).delete(remove),
        )
        .route("/charts/{id}/clone", post(clone_chart))
        .route("/charts/{id}/reset", post(reset))
        .route("/charts/{id}/placements", patch(set_placements))
        .route("/admin/charts/{id}", put(admin_update).patch(admin_update))
        .route("/admin/charts/{id}/lock", put(admin_lock).patch(admin_lock))
        .route("/admin/charts/{id}/restore", post(admin_restore))
}

async fn source_manifest(_auth: AuthUser) -> Json<Value> {
    Json(
        serde_json::from_str(include_str!(
            "../../../../packages/dashboards/src/charts/sources/sources.json"
        ))
        .expect("bundled chart source manifest must be valid JSON"),
    )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ChartManagerEntry>>, AppError> {
    let rows = visible_rows(&state, auth.user_id).await?;
    Ok(Json(merge_entries(
        rows,
        auth.user_id,
        is_admin(&state, auth.user_id).await?,
    )))
}

async fn effective(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<EffectiveQuery>,
) -> Result<Json<Vec<ChartManagerEntry>>, AppError> {
    let admin = is_admin(&state, auth.user_id).await?;
    let entries = merge_entries(
        visible_rows(&state, auth.user_id).await?,
        auth.user_id,
        admin,
    );
    let entries = entries
        .into_iter()
        .filter(|entry| {
            entry.effective.is_enabled
                && query.dashboard_slug.as_deref().is_none_or(|slug| {
                    entry
                        .effective
                        .config
                        .get("placements")
                        .and_then(Value::as_array)
                        .is_some_and(|placements| {
                            placements.iter().any(|placement| {
                                placement.get("dashboardSlug").and_then(Value::as_str) == Some(slug)
                            })
                        })
                })
        })
        .collect();
    Ok(Json(entries))
}

async fn fetch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChartRecord>, AppError> {
    let row = get_chart(&state, id).await?;
    check_read(&row, auth.user_id)?;
    Ok(Json(row))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<ChartInput>,
) -> Result<(StatusCode, Json<ChartRecord>), AppError> {
    validate_slug(&body.slug)?;
    validate_name(&body.name)?;
    validate_config(&body.config)?;
    let row = sqlx::query_as::<_, ChartRecord>("INSERT INTO riviamigo.charts (owner_id, slug, name, description, is_default, is_locked, is_enabled, config) VALUES ($1,$2,$3,$4,FALSE,FALSE,COALESCE($5,TRUE),$6) RETURNING id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at")
        .bind(auth.user_id).bind(body.slug).bind(body.name).bind(body.description).bind(body.is_enabled).bind(body.config).fetch_one(&state.pool).await.map_err(map_conflict)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ChartPatch>,
) -> Result<Json<ChartRecord>, AppError> {
    let existing = get_chart(&state, id).await?;
    check_write(&existing, auth.user_id, false)?;
    if let Some(config) = &body.config {
        validate_config(config)?;
    }
    let row = sqlx::query_as::<_, ChartRecord>("UPDATE riviamigo.charts SET name=COALESCE($1,name),description=COALESCE($2,description),is_enabled=COALESCE($3,is_enabled),config=COALESCE($4,config),updated_at=NOW() WHERE id=$5 RETURNING id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at")
        .bind(body.name).bind(body.description).bind(body.is_enabled).bind(body.config).bind(id).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn remove(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let row = get_chart(&state, id).await?;
    check_write(&row, auth.user_id, false)?;
    sqlx::query("DELETE FROM riviamigo.charts WHERE id=$1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clone_chart(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<ChartRecord>), AppError> {
    let source = get_chart(&state, id).await?;
    check_read(&source, auth.user_id)?;
    let slug = format!("{}-copy-{}", source.slug, Uuid::new_v4().simple());
    let row = sqlx::query_as::<_, ChartRecord>("INSERT INTO riviamigo.charts (owner_id,slug,name,description,is_default,is_locked,is_enabled,config) VALUES ($1,$2,$3,$4,FALSE,FALSE,$5,$6) RETURNING id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at")
        .bind(auth.user_id).bind(slug).bind(format!("{} (copy)",source.name)).bind(source.description).bind(source.is_enabled).bind(source.config).fetch_one(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn reset(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChartRecord>, AppError> {
    let existing = get_chart(&state, id).await?;
    if existing.owner_id != Some(auth.user_id) {
        return Err(AppError::Forbidden);
    }
    let system = sqlx::query_as::<_,ChartRecord>("SELECT id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at FROM riviamigo.charts WHERE owner_id IS NULL AND slug=$1").bind(&existing.slug).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound)?;
    sqlx::query("DELETE FROM riviamigo.charts WHERE id=$1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(system))
}

async fn set_placements(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<PlacementPatch>,
) -> Result<Json<ChartRecord>, AppError> {
    let existing = get_chart(&state, id).await?;
    check_write(&existing, auth.user_id, false)?;
    if body.placements.len() > 20
        || body
            .placements
            .iter()
            .any(|placement| !validate_slug_value(&placement.dashboard_slug))
    {
        return Err(AppError::Validation(
            "placements must contain at most 20 valid dashboard slugs".into(),
        ));
    }
    let mut config = existing.config;
    let object = config
        .as_object_mut()
        .ok_or_else(|| AppError::Validation("chart config must be an object".into()))?;
    object.insert(
        "placements".into(),
        serde_json::to_value(&body.placements)
            .map_err(|_| AppError::Validation("placements could not be encoded".into()))?,
    );
    validate_config(&config)?;
    let row = sqlx::query_as::<_, ChartRecord>("UPDATE riviamigo.charts SET config=$1,updated_at=NOW() WHERE id=$2 RETURNING id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at")
        .bind(config)
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn admin_update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ChartPatch>,
) -> Result<Json<ChartRecord>, AppError> {
    require_admin(&state, auth.user_id).await?;
    if let Some(config) = &body.config {
        validate_config(config)?;
    }
    let row=sqlx::query_as::<_,ChartRecord>("UPDATE riviamigo.charts SET name=COALESCE($1,name),description=COALESCE($2,description),is_enabled=COALESCE($3,is_enabled),config=COALESCE($4,config),updated_at=NOW() WHERE id=$5 RETURNING id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at").bind(body.name).bind(body.description).bind(body.is_enabled).bind(body.config).bind(id).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}
async fn admin_lock(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<LockInput>,
) -> Result<Json<ChartRecord>, AppError> {
    require_admin(&state, auth.user_id).await?;
    let row=sqlx::query_as::<_,ChartRecord>("UPDATE riviamigo.charts SET is_locked=$1,updated_at=NOW() WHERE id=$2 RETURNING id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at").bind(body.locked).bind(id).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}
async fn admin_restore(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChartRecord>, AppError> {
    require_admin(&state, auth.user_id).await?;
    let row = get_chart(&state, id).await?;
    if row.owner_id == Some(auth.user_id) || row.owner_id.is_some() {
        let system=sqlx::query_as::<_,ChartRecord>("SELECT id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at FROM riviamigo.charts WHERE owner_id IS NULL AND slug=$1").bind(&row.slug).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound)?;
        sqlx::query("DELETE FROM riviamigo.charts WHERE id=$1")
            .bind(id)
            .execute(&state.pool)
            .await?;
        return Ok(Json(system));
    }
    let bundled = bundled_default(&row.slug).ok_or(AppError::NotFound)?;
    let name = bundled["name"].as_str().unwrap_or(row.name.as_str());
    let description = bundled["description"].as_str();
    let enabled = bundled["enabled"].as_bool().unwrap_or(true);
    let config = bundled["definition"].clone();
    validate_config(&config)?;
    let restored = sqlx::query_as::<_, ChartRecord>("UPDATE riviamigo.charts SET name=$1,description=$2,is_enabled=$3,config=$4,baseline_revision=1,updated_at=NOW() WHERE id=$5 RETURNING id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at")
        .bind(name)
        .bind(description)
        .bind(enabled)
        .bind(config)
        .bind(row.id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(restored))
}

fn bundled_default(slug: &str) -> Option<Value> {
    serde_json::from_str::<Vec<Value>>(include_str!("../../charts/defaults.json"))
        .ok()?
        .into_iter()
        .find(|chart| chart["slug"].as_str() == Some(slug))
}

async fn visible_rows(state: &AppState, user_id: Uuid) -> Result<Vec<ChartRecord>, AppError> {
    Ok(sqlx::query_as::<_,ChartRecord>("SELECT id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at FROM riviamigo.charts WHERE owner_id IS NULL OR owner_id=$1 ORDER BY slug,owner_id NULLS FIRST").bind(user_id).fetch_all(&state.pool).await?)
}
async fn get_chart(state: &AppState, id: Uuid) -> Result<ChartRecord, AppError> {
    sqlx::query_as::<_,ChartRecord>("SELECT id,owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision,created_at,updated_at FROM riviamigo.charts WHERE id=$1").bind(id).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound)
}
fn check_read(row: &ChartRecord, user_id: Uuid) -> Result<(), AppError> {
    if row.owner_id.is_none() || row.owner_id == Some(user_id) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}
fn check_write(row: &ChartRecord, user_id: Uuid, admin: bool) -> Result<(), AppError> {
    if admin || row.owner_id == Some(user_id) && !row.is_locked {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}
async fn is_admin(state: &AppState, user_id: Uuid) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, Option<String>>("SELECT role FROM riviamigo.users WHERE id=$1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?
            .flatten()
            .is_some_and(|r| r == "admin" || r == "super_user"),
    )
}
async fn require_admin(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    if is_admin(state, user_id).await? {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}
fn validate_slug(slug: &str) -> Result<(), AppError> {
    if !validate_slug_value(slug) {
        Err(AppError::Validation(
            "slug must use lowercase letters, digits, dots, hyphens, and underscores".into(),
        ))
    } else {
        Ok(())
    }
}

fn validate_slug_value(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 80
        && slug.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
        })
}
fn validate_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() || name.len() > 160 {
        Err(AppError::Validation(
            "name must be between 1 and 160 characters".into(),
        ))
    } else {
        Ok(())
    }
}
fn validate_config(config: &Value) -> Result<(), AppError> {
    parse_and_validate(config).map(|_| ()).map_err(|errors| {
        AppError::Validation(
            serde_json::to_string(
                &serde_json::json!({"code":"CHART_DEFINITION_INVALID","errors":errors}),
            )
            .unwrap_or_else(|_| "invalid chart definition".into()),
        )
    })
}
fn map_conflict(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|e| e.constraint())
        .is_some()
    {
        AppError::Conflict("a chart with that slug already exists for this owner".into())
    } else {
        AppError::Database(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slug_validation_is_bounded() {
        assert!(validate_slug("soc-history").is_ok());
        assert!(validate_slug("SOC").is_err());
        assert!(validate_slug("https://bad").is_err());
    }
}
