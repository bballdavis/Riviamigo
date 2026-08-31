use std::collections::BTreeSet;

use axum::{
    extract::{Path, State},
    http::{header::ETAG, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

const MAX_CUSTOM_THEMES: i64 = 20;
const MAX_DEFINITION_BYTES: usize = 64 * 1024;
const BUILTIN_MANIFEST: &str = include_str!("../themes/builtins.generated.json");

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/themes/catalog", get(catalog))
        .route("/themes", post(create_theme))
        .route("/themes/{theme_id}", get(get_theme).delete(retire_theme))
        .route("/themes/{theme_id}/revisions", post(save_revision))
        .route(
            "/themes/{theme_id}/revisions/{revision}/publish",
            post(publish_revision),
        )
        .route("/themes/{theme_id}/rollback", post(rollback_theme))
        .route(
            "/auth/preferences/theme",
            get(get_theme_preferences).put(update_theme_preferences),
        )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThemeSummary {
    theme_id: Uuid,
    name: String,
    base_theme_id: String,
    published_revision: Option<i32>,
    retired_at: Option<chrono::DateTime<chrono::Utc>>,
    etag: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateThemeBody {
    name: String,
    base_theme_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveRevisionBody {
    definition: Value,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublishRevisionBody {
    #[serde(default)]
    apply: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RollbackBody {
    revision: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ThemeSelection {
    Builtin {
        #[serde(rename = "themeId")]
        theme_id: String,
    },
    Custom {
        #[serde(rename = "themeId")]
        theme_id: Uuid,
        revision: i32,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateThemePreferencesBody {
    schema_version: u8,
    mode: String,
    selection: ThemeSelection,
}

fn builtin_manifest() -> Result<Value, AppError> {
    serde_json::from_str(BUILTIN_MANIFEST).map_err(|error| {
        AppError::Internal(anyhow::anyhow!("invalid generated theme manifest: {error}"))
    })
}

fn builtin_ids(manifest: &Value) -> BTreeSet<&str> {
    manifest["builtins"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|theme| theme["id"].as_str())
        .collect()
}

fn validate_builtin_id(theme_id: &str) -> Result<(), AppError> {
    let manifest = builtin_manifest()?;
    if builtin_ids(&manifest).contains(theme_id) {
        Ok(())
    } else {
        Err(AppError::Validation("unknown built-in theme".into()))
    }
}

fn normalize_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::Validation(
            "theme name must be between 1 and 80 characters".into(),
        ));
    }
    Ok(name.to_owned())
}

fn validate_mode(mode: &str) -> Result<(), AppError> {
    if matches!(mode, "light" | "dark" | "system") {
        Ok(())
    } else {
        Err(AppError::Validation("invalid theme mode".into()))
    }
}

fn validate_color(value: &Value, context: &str) -> Result<(), AppError> {
    let Some(color) = value.as_str() else {
        return Err(AppError::Validation(format!("{context} must be a color")));
    };
    let bytes = color.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err(AppError::Validation(format!(
            "{context} must be a six-digit hex color"
        )));
    }
    Ok(())
}

fn validate_color_pair(value: &Value, context: &str) -> Result<(), AppError> {
    let Some(pair) = value.as_object() else {
        return Err(AppError::Validation(format!("{context} must be an object")));
    };
    if pair.is_empty() || pair.keys().any(|key| key != "light" && key != "dark") {
        return Err(AppError::Validation(format!(
            "{context} may contain only light and dark"
        )));
    }
    for (mode, value) in pair {
        validate_color(value, &format!("{context}.{mode}"))?;
    }
    Ok(())
}

fn validate_theme_definition(base_theme_id: &str, definition: &Value) -> Result<Vec<u8>, AppError> {
    let bytes = serde_json::to_vec(definition)
        .map_err(|_| AppError::Validation("theme definition is not valid JSON".into()))?;
    if bytes.len() > MAX_DEFINITION_BYTES {
        return Err(AppError::Validation(
            "theme definition exceeds 64 KiB".into(),
        ));
    }
    let Some(root) = definition.as_object() else {
        return Err(AppError::Validation(
            "theme definition must be an object".into(),
        ));
    };
    let allowed_root = ["theme", "tokens", "series", "brandPaints"];
    if root.keys().any(|key| !allowed_root.contains(&key.as_str())) {
        return Err(AppError::Validation(
            "theme definition contains an unsupported property".into(),
        ));
    }
    if root.get("theme").and_then(Value::as_str) != Some(base_theme_id) {
        return Err(AppError::Validation(
            "theme definition must inherit from its built-in base".into(),
        ));
    }

    let manifest = builtin_manifest()?;
    let base = manifest["builtins"]
        .as_array()
        .and_then(|themes| themes.iter().find(|theme| theme["id"] == base_theme_id))
        .ok_or_else(|| AppError::Validation("unknown built-in theme".into()))?;
    let token_ids: BTreeSet<&str> = base["tokens"]["light"]
        .as_object()
        .into_iter()
        .flat_map(Map::keys)
        .map(String::as_str)
        .filter(|token| {
            !token.starts_with("glow-") && !token.starts_with("shadow-") && *token != "value-halo"
        })
        .collect();

    if let Some(tokens) = root.get("tokens") {
        let Some(tokens) = tokens.as_object() else {
            return Err(AppError::Validation("tokens must be an object".into()));
        };
        for (token, pair) in tokens {
            if !token_ids.contains(token.as_str()) {
                return Err(AppError::Validation(format!(
                    "unknown or non-customizable theme token: {token}"
                )));
            }
            validate_color_pair(pair, &format!("tokens.{token}"))?;
        }
    }

    if let Some(series) = root.get("series") {
        let Some(series) = series.as_object() else {
            return Err(AppError::Validation("series must be an object".into()));
        };
        for (slot, pair) in series {
            let valid = slot
                .strip_prefix("series-")
                .and_then(|value| value.parse::<u8>().ok())
                .is_some_and(|value| (1..=16).contains(&value) && slot.len() == 9);
            if !valid {
                return Err(AppError::Validation(format!("unknown series slot: {slot}")));
            }
            validate_color_pair(pair, &format!("series.{slot}"))?;
        }
    }

    if let Some(paints) = root.get("brandPaints") {
        let Some(paints) = paints.as_object() else {
            return Err(AppError::Validation("brandPaints must be an object".into()));
        };
        for (paint, pair) in paints {
            if !matches!(paint.as_str(), "accent" | "accentMuted" | "mark") {
                return Err(AppError::Validation(format!(
                    "unknown brand paint: {paint}"
                )));
            }
            validate_color_pair(pair, &format!("brandPaints.{paint}"))?;
        }
    }
    Ok(bytes)
}

fn definition_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn theme_etag(theme_id: Uuid, version: i64) -> String {
    format!("\"theme-{theme_id}-{version}\"")
}

fn preferences_etag(version: i64) -> String {
    format!("\"theme-preferences-{version}\"")
}

fn require_etag(headers: &HeaderMap, expected: &str) -> Result<(), AppError> {
    let supplied = headers
        .get(axum::http::header::IF_MATCH)
        .and_then(|value| value.to_str().ok());
    if supplied == Some(expected) {
        Ok(())
    } else {
        Err(AppError::Conflict(
            "theme changed since it was loaded; refresh and try again".into(),
        ))
    }
}

fn etag_json(etag: &str, payload: Value) -> Result<Response, AppError> {
    let value = HeaderValue::from_str(etag)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid generated ETag")))?;
    Ok(([(ETAG, value)], Json(payload)).into_response())
}

async fn list_owned_themes(
    state: &AppState,
    user_id: Uuid,
    include_retired: bool,
) -> Result<Vec<ThemeSummary>, AppError> {
    let rows = sqlx::query(
        "SELECT id, name, base_theme_id, published_revision, retired_at, etag_version
         FROM riviamigo.user_themes
         WHERE owner_id = $1 AND ($2 OR retired_at IS NULL)
         ORDER BY updated_at DESC, id",
    )
    .bind(user_id)
    .bind(include_retired)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let id = row.get("id");
            let version = row.get("etag_version");
            ThemeSummary {
                theme_id: id,
                name: row.get("name"),
                base_theme_id: row.get("base_theme_id"),
                published_revision: row.get("published_revision"),
                retired_at: row.get("retired_at"),
                etag: theme_etag(id, version),
            }
        })
        .collect())
}

async fn catalog(State(state): State<AppState>, auth: AuthUser) -> Result<Json<Value>, AppError> {
    let manifest = builtin_manifest()?;
    let custom = list_owned_themes(&state, auth.user_id, false).await?;
    Ok(Json(json!({
        "schemaVersion": 2,
        "registryHash": manifest["registryHash"],
        "builtins": manifest["builtins"],
        "customThemes": custom,
    })))
}

async fn create_theme(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateThemeBody>,
) -> Result<Response, AppError> {
    validate_builtin_id(&body.base_theme_id)?;
    let name = normalize_name(&body.name)?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM riviamigo.user_themes WHERE owner_id = $1 AND retired_at IS NULL",
    )
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await?;
    if count >= MAX_CUSTOM_THEMES {
        return Err(AppError::Validation(
            "custom theme limit of 20 reached".into(),
        ));
    }
    let row = sqlx::query(
        "INSERT INTO riviamigo.user_themes (owner_id, name, base_theme_id)
         VALUES ($1, $2, $3)
         RETURNING id, etag_version",
    )
    .bind(auth.user_id)
    .bind(name)
    .bind(body.base_theme_id)
    .fetch_one(&state.pool)
    .await?;
    let id: Uuid = row.get("id");
    let etag = theme_etag(id, row.get("etag_version"));
    etag_json(&etag, json!({ "themeId": id, "etag": etag }))
}

async fn get_theme(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(theme_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let row = sqlx::query(
        "SELECT name, base_theme_id, published_revision, retired_at, etag_version
         FROM riviamigo.user_themes WHERE id = $1 AND owner_id = $2",
    )
    .bind(theme_id)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let revisions = sqlx::query(
        "SELECT r.revision, r.definition, r.definition_hash, r.created_at, p.published_at
         FROM riviamigo.user_theme_revisions r
         LEFT JOIN riviamigo.user_theme_publications p
           ON p.theme_id = r.theme_id AND p.revision = r.revision
         WHERE r.theme_id = $1 ORDER BY r.revision DESC",
    )
    .bind(theme_id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|revision| {
        json!({
            "revision": revision.get::<i32, _>("revision"),
            "definition": revision.get::<Value, _>("definition"),
            "definitionHash": revision.get::<String, _>("definition_hash"),
            "createdAt": revision.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "publishedAt": revision.get::<Option<chrono::DateTime<chrono::Utc>>, _>("published_at"),
        })
    })
    .collect::<Vec<_>>();
    let version: i64 = row.get("etag_version");
    let etag = theme_etag(theme_id, version);
    etag_json(
        &etag,
        json!({
            "themeId": theme_id,
            "name": row.get::<String, _>("name"),
            "baseThemeId": row.get::<String, _>("base_theme_id"),
            "publishedRevision": row.get::<Option<i32>, _>("published_revision"),
            "retiredAt": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("retired_at"),
            "etag": etag,
            "revisions": revisions,
        }),
    )
}

async fn lock_owned_theme(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    theme_id: Uuid,
) -> Result<(String, i64, Option<chrono::DateTime<chrono::Utc>>), AppError> {
    let row = sqlx::query(
        "SELECT base_theme_id, etag_version, retired_at
         FROM riviamigo.user_themes
         WHERE id = $1 AND owner_id = $2 FOR UPDATE",
    )
    .bind(theme_id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok((
        row.get("base_theme_id"),
        row.get("etag_version"),
        row.get("retired_at"),
    ))
}

async fn save_revision(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(theme_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SaveRevisionBody>,
) -> Result<Response, AppError> {
    let mut tx = state.pool.begin().await?;
    let (base, version, retired_at) = lock_owned_theme(&mut tx, auth.user_id, theme_id).await?;
    require_etag(&headers, &theme_etag(theme_id, version))?;
    if retired_at.is_some() {
        return Err(AppError::Conflict(
            "retired themes cannot be changed".into(),
        ));
    }
    let bytes = validate_theme_definition(&base, &body.definition)?;
    let revision: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(revision), 0) + 1
         FROM riviamigo.user_theme_revisions WHERE theme_id = $1",
    )
    .bind(theme_id)
    .fetch_one(&mut *tx)
    .await?;
    let hash = definition_hash(&bytes);
    sqlx::query(
        "INSERT INTO riviamigo.user_theme_revisions
            (theme_id, revision, definition, definition_hash)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(theme_id)
    .bind(revision)
    .bind(&body.definition)
    .bind(&hash)
    .execute(&mut *tx)
    .await?;
    let new_version: i64 = sqlx::query_scalar(
        "UPDATE riviamigo.user_themes
         SET etag_version = etag_version + 1, updated_at = now()
         WHERE id = $1 RETURNING etag_version",
    )
    .bind(theme_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    let etag = theme_etag(theme_id, new_version);
    etag_json(
        &etag,
        json!({ "themeId": theme_id, "revision": revision, "definitionHash": hash, "etag": etag }),
    )
}

async fn apply_custom_selection_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    mode: Option<&str>,
    theme_id: Uuid,
    revision: i32,
    base_theme_id: &str,
) -> Result<i64, AppError> {
    sqlx::query(
        "INSERT INTO riviamigo.user_preferences
            (user_id, theme_mode, theme_palette, theme_selection_kind, theme_builtin_id,
             theme_custom_id, theme_custom_revision, theme_etag_version, updated_at)
         VALUES ($1, COALESCE($2, 'dark'), $3, 'custom', $3, $4, $5, 1, now())
         ON CONFLICT (user_id) DO UPDATE SET
            theme_mode = COALESCE($2, riviamigo.user_preferences.theme_mode),
            theme_palette = $3,
            theme_selection_kind = 'custom',
            theme_builtin_id = $3,
            theme_custom_id = $4,
            theme_custom_revision = $5,
            theme_etag_version = riviamigo.user_preferences.theme_etag_version + 1,
            updated_at = now()",
    )
    .bind(user_id)
    .bind(mode)
    .bind(base_theme_id)
    .bind(theme_id)
    .bind(revision)
    .execute(&mut **tx)
    .await?;
    sqlx::query_scalar(
        "SELECT theme_etag_version FROM riviamigo.user_preferences WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(AppError::from)
}

async fn publish_revision(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((theme_id, revision)): Path<(Uuid, i32)>,
    headers: HeaderMap,
    Json(body): Json<PublishRevisionBody>,
) -> Result<Response, AppError> {
    let mut tx = state.pool.begin().await?;
    let (base, version, retired_at) = lock_owned_theme(&mut tx, auth.user_id, theme_id).await?;
    require_etag(&headers, &theme_etag(theme_id, version))?;
    if retired_at.is_some() {
        return Err(AppError::Conflict(
            "retired themes cannot be published".into(),
        ));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.user_theme_revisions WHERE theme_id = $1 AND revision = $2)",
    )
    .bind(theme_id)
    .bind(revision)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Err(AppError::NotFound);
    }
    sqlx::query(
        "INSERT INTO riviamigo.user_theme_publications (theme_id, revision)
         VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(theme_id)
    .bind(revision)
    .execute(&mut *tx)
    .await?;
    let new_version: i64 = sqlx::query_scalar(
        "UPDATE riviamigo.user_themes
         SET published_revision = $2, etag_version = etag_version + 1, updated_at = now()
         WHERE id = $1 RETURNING etag_version",
    )
    .bind(theme_id)
    .bind(revision)
    .fetch_one(&mut *tx)
    .await?;
    if body.apply {
        apply_custom_selection_tx(&mut tx, auth.user_id, None, theme_id, revision, &base).await?;
    }
    tx.commit().await?;
    let etag = theme_etag(theme_id, new_version);
    etag_json(
        &etag,
        json!({ "themeId": theme_id, "publishedRevision": revision, "applied": body.apply, "etag": etag }),
    )
}

async fn rollback_theme(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(theme_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<RollbackBody>,
) -> Result<Response, AppError> {
    let mut tx = state.pool.begin().await?;
    let (base, version, retired_at) = lock_owned_theme(&mut tx, auth.user_id, theme_id).await?;
    require_etag(&headers, &theme_etag(theme_id, version))?;
    if retired_at.is_some() {
        return Err(AppError::Conflict(
            "retired themes cannot be selected".into(),
        ));
    }
    let published: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.user_theme_publications
         WHERE theme_id = $1 AND revision = $2)",
    )
    .bind(theme_id)
    .bind(body.revision)
    .fetch_one(&mut *tx)
    .await?;
    if !published {
        return Err(AppError::Validation(
            "only published revisions can be selected".into(),
        ));
    }
    let preference_version =
        apply_custom_selection_tx(&mut tx, auth.user_id, None, theme_id, body.revision, &base)
            .await?;
    tx.commit().await?;
    etag_json(
        &preferences_etag(preference_version),
        json!({ "schemaVersion": 2, "selection": { "kind": "custom", "themeId": theme_id, "revision": body.revision } }),
    )
}

async fn retire_theme(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(theme_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let mut tx = state.pool.begin().await?;
    let (base, version, retired_at) = lock_owned_theme(&mut tx, auth.user_id, theme_id).await?;
    require_etag(&headers, &theme_etag(theme_id, version))?;
    if retired_at.is_some() {
        return Err(AppError::Conflict("theme is already retired".into()));
    }
    let new_version: i64 = sqlx::query_scalar(
        "UPDATE riviamigo.user_themes
         SET retired_at = now(), etag_version = etag_version + 1, updated_at = now()
         WHERE id = $1 RETURNING etag_version",
    )
    .bind(theme_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE riviamigo.user_preferences
         SET theme_palette = $3,
             theme_selection_kind = 'builtin', theme_builtin_id = $3,
             theme_custom_id = NULL, theme_custom_revision = NULL,
             theme_etag_version = theme_etag_version + 1, updated_at = now()
         WHERE user_id = $1 AND theme_custom_id = $2",
    )
    .bind(auth.user_id)
    .bind(theme_id)
    .bind(base)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let etag = theme_etag(theme_id, new_version);
    etag_json(
        &etag,
        json!({ "themeId": theme_id, "retired": true, "etag": etag }),
    )
}

async fn ensure_preferences_row(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO riviamigo.user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn theme_preferences_payload(
    state: &AppState,
    user_id: Uuid,
) -> Result<(Value, String), AppError> {
    let row = sqlx::query(
        "SELECT theme_mode, theme_selection_kind, theme_builtin_id,
                theme_custom_id, theme_custom_revision, theme_etag_version
         FROM riviamigo.user_preferences WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(row) = row else {
        return Ok((
            json!({ "schemaVersion": 2, "mode": "dark", "selection": { "kind": "builtin", "themeId": "classic" } }),
            preferences_etag(1),
        ));
    };
    let version: i64 = row.get("theme_etag_version");
    let selection = if row.get::<String, _>("theme_selection_kind") == "custom" {
        let theme_id: Uuid = row.get("theme_custom_id");
        let revision: i32 = row.get("theme_custom_revision");
        let custom = sqlx::query(
            "SELECT t.base_theme_id, r.definition, r.definition_hash
             FROM riviamigo.user_themes t
             JOIN riviamigo.user_theme_revisions r ON r.theme_id = t.id AND r.revision = $3
             WHERE t.id = $1 AND t.owner_id = $2 AND t.retired_at IS NULL",
        )
        .bind(theme_id)
        .bind(user_id)
        .bind(revision)
        .fetch_optional(&state.pool)
        .await?;
        if let Some(custom) = custom {
            json!({
                "kind": "custom",
                "themeId": theme_id,
                "revision": revision,
                "baseThemeId": custom.get::<String, _>("base_theme_id"),
                "definition": custom.get::<Value, _>("definition"),
                "definitionHash": custom.get::<String, _>("definition_hash"),
            })
        } else {
            json!({ "kind": "builtin", "themeId": "classic", "fallbackReason": "unavailable-custom-theme" })
        }
    } else {
        json!({ "kind": "builtin", "themeId": row.get::<String, _>("theme_builtin_id") })
    };
    Ok((
        json!({
            "schemaVersion": 2,
            "mode": row.get::<String, _>("theme_mode"),
            "selection": selection,
        }),
        preferences_etag(version),
    ))
}

async fn get_theme_preferences(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Response, AppError> {
    let (payload, etag) = theme_preferences_payload(&state, auth.user_id).await?;
    etag_json(&etag, payload)
}

async fn update_theme_preferences(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<UpdateThemePreferencesBody>,
) -> Result<Response, AppError> {
    if body.schema_version != 2 {
        return Err(AppError::Validation(
            "unsupported theme schema version".into(),
        ));
    }
    validate_mode(&body.mode)?;
    let mut tx = state.pool.begin().await?;
    ensure_preferences_row(&mut tx, auth.user_id).await?;
    let current_version: i64 = sqlx::query_scalar(
        "SELECT theme_etag_version FROM riviamigo.user_preferences WHERE user_id = $1 FOR UPDATE",
    )
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await?;
    require_etag(&headers, &preferences_etag(current_version))?;

    match body.selection {
        ThemeSelection::Builtin { theme_id } => {
            validate_builtin_id(&theme_id)?;
            sqlx::query(
                "UPDATE riviamigo.user_preferences
                 SET theme_mode = $2, theme_palette = $3,
                     theme_selection_kind = 'builtin', theme_builtin_id = $3,
                     theme_custom_id = NULL, theme_custom_revision = NULL,
                     theme_etag_version = theme_etag_version + 1, updated_at = now()
                 WHERE user_id = $1",
            )
            .bind(auth.user_id)
            .bind(&body.mode)
            .bind(theme_id)
            .execute(&mut *tx)
            .await?;
        }
        ThemeSelection::Custom { theme_id, revision } => {
            let row = sqlx::query(
                "SELECT t.base_theme_id
                 FROM riviamigo.user_themes t
                 JOIN riviamigo.user_theme_revisions r ON r.theme_id = t.id AND r.revision = $3
                 JOIN riviamigo.user_theme_publications p ON p.theme_id = r.theme_id AND p.revision = r.revision
                 WHERE t.id = $1 AND t.owner_id = $2 AND t.retired_at IS NULL
                ",
            )
            .bind(theme_id)
            .bind(auth.user_id)
            .bind(revision)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| {
                AppError::Validation("custom theme revision is unavailable or unpublished".into())
            })?;
            apply_custom_selection_tx(
                &mut tx,
                auth.user_id,
                Some(&body.mode),
                theme_id,
                revision,
                row.get("base_theme_id"),
            )
            .await?;
        }
    }
    tx.commit().await?;
    let (payload, etag) = theme_preferences_payload(&state, auth.user_id).await?;
    etag_json(&etag, payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bounded_theme_override_shape() {
        let valid = json!({
            "theme": "classic",
            "tokens": { "accent": { "light": "#123456", "dark": "#abcdef" } },
            "series": { "series-16": { "dark": "#112233" } },
            "brandPaints": { "mark": { "light": "#445566" } }
        });
        assert!(validate_theme_definition("classic", &valid).is_ok());

        for invalid in [
            json!({ "theme": "classic", "font": "Comic Sans" }),
            json!({ "theme": "classic", "tokens": { "unknown": { "light": "#123456" } } }),
            json!({ "theme": "classic", "series": { "series-17": { "light": "#123456" } } }),
            json!({ "theme": "classic", "tokens": { "accent": { "light": "url(https://example.test)" } } }),
            json!({ "theme": "rad", "tokens": {} }),
        ] {
            assert!(validate_theme_definition("classic", &invalid).is_err());
        }
    }

    #[test]
    fn generated_manifest_is_readable_and_complete() {
        let manifest = builtin_manifest().expect("manifest");
        assert_eq!(manifest["schemaVersion"], 1);
        assert_eq!(manifest["builtins"].as_array().map(Vec::len), Some(2));
        for theme in manifest["builtins"].as_array().unwrap() {
            assert_eq!(theme["series"].as_object().map(Map::len), Some(16));
        }
    }

    #[test]
    fn etags_are_resource_specific() {
        let id = Uuid::nil();
        assert_eq!(theme_etag(id, 3), format!("\"theme-{id}-3\""));
        assert_eq!(preferences_etag(4), "\"theme-preferences-4\"");
    }
}
