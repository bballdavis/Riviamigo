use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

use axum::{
    body::Body,
    extract::{OriginalUri, Path, Query, State},
    http::{header, HeaderValue, Response, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use base64::Engine;
use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{
    db::users::{get_user_role, require_admin_or_super_user, UserRole},
    errors::AppError,
    ingestion::session_store::encrypt_json,
    middleware::auth::{AppState, AuthUser},
    services::external_connections::{self as connections, ConnectionSettingsRow},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/external-connections", get(list_connections))
        .route(
            "/settings/external-connections/disable-optional",
            post(disable_optional),
        )
        .route("/settings/external-connections/:id", put(update_connection))
        .route(
            "/settings/external-connections/:id/test",
            post(test_connection),
        )
        .route("/external/basemap/:style/:z/:x/:y", get(proxy_basemap_tile))
        .route("/external/basemap/config", get(basemap_config))
        .route("/external/iconify/search", get(proxy_iconify_search))
        .route("/external/iconify/:resource", get(proxy_iconify_resource))
}

#[derive(Debug, Serialize)]
struct ExternalConnectionsResponse {
    can_manage: bool,
    connections: Vec<ConnectionResponse>,
}

#[derive(Debug, Serialize)]
struct ConnectionResponse {
    id: String,
    name: &'static str,
    purpose: &'static str,
    data_shared: &'static [&'static str],
    disabled_effect: &'static str,
    execution: &'static str,
    privacy_url: Option<&'static str>,
    terms_url: Option<&'static str>,
    editable: bool,
    enabled: bool,
    mode: String,
    endpoint: Option<String>,
    endpoint_is_private: bool,
    weather_precision: Option<String>,
    forecast_url: Option<String>,
    archive_url: Option<String>,
    base_url: Option<String>,
    light_url_template: Option<String>,
    dark_url_template: Option<String>,
    attribution: Option<String>,
    attribution_url: Option<String>,
    request_identifier: Option<String>,
    custom_autocomplete: bool,
    allow_private_network: bool,
    has_api_key: bool,
    has_bearer_token: bool,
    updated_at: DateTime<Utc>,
    last_attempt_at: Option<DateTime<Utc>>,
    last_success_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
    request_count_today: i32,
}

struct ConnectionDefinition {
    id: &'static str,
    name: &'static str,
    purpose: &'static str,
    data_shared: &'static [&'static str],
    disabled_effect: &'static str,
    execution: &'static str,
    privacy_url: Option<&'static str>,
    terms_url: Option<&'static str>,
    editable: bool,
}

const DEFINITIONS: &[ConnectionDefinition] = &[
    ConnectionDefinition { id: connections::RIVIAN_ACCOUNT, name: "Rivian account", purpose: "Vehicle telemetry, history, and remote operations.", data_shared: &["Rivian account tokens", "Vehicle identifiers", "Telemetry queries and commands"], disabled_effect: "Disconnecting a vehicle stops telemetry, history import, and remote operations.", execution: "Server", privacy_url: Some("https://rivian.com/legal/privacy"), terms_url: Some("https://rivian.com/legal/terms"), editable: false },
    ConnectionDefinition { id: connections::OPEN_METEO, name: "Open-Meteo weather", purpose: "Estimated outside temperature along completed drives.", data_shared: &["Rounded drive coordinates by default", "Drive date", "Temperature variable request"], disabled_effect: "New drives will not receive estimated outside temperatures or temperature-based efficiency data. Existing values remain.", execution: "Server", privacy_url: Some("https://open-meteo.com/en/terms"), terms_url: Some("https://open-meteo.com/en/terms"), editable: true },
    ConnectionDefinition { id: connections::NOMINATIM, name: "OpenStreetMap Nominatim", purpose: "Address search and readable trip endpoint labels.", data_shared: &["Exact coordinate for reverse geocoding", "Search text after explicit submit"], disabled_effect: "Address search and new automatic trip labels stop. Coordinates, saved places, and cached labels remain.", execution: "Server", privacy_url: Some("https://osmfoundation.org/wiki/Privacy_Policy"), terms_url: Some("https://operations.osmfoundation.org/policies/nominatim/"), editable: true },
    ConnectionDefinition { id: connections::BASEMAP, name: "Map basemap", purpose: "Street and geographic context behind exact trip routes.", data_shared: &["Requested map tile coordinates", "Riviamigo server IP"], disabled_effect: "Routes remain visible on a neutral background, without streets or place context.", execution: "Server proxy", privacy_url: Some("https://carto.com/privacy/"), terms_url: Some("https://carto.com/legal/"), editable: true },
    ConnectionDefinition { id: connections::ICONIFY, name: "Iconify catalog", purpose: "Search and load dashboard icons not bundled locally.", data_shared: &["Icon names", "Explicit icon search text"], disabled_effect: "Remote icon search stops; bundled icons and local fallbacks remain.", execution: "Server proxy", privacy_url: Some("https://iconify.design/privacy/"), terms_url: Some("https://iconify.design/terms/"), editable: true },
    ConnectionDefinition { id: connections::RIVIAN_ARTWORK, name: "Rivian vehicle artwork", purpose: "Mirror vehicle artwork into Riviamigo.", data_shared: &["Rivian vehicle configuration and image request"], disabled_effect: "Cached artwork remains; uncached vehicles use the local placeholder.", execution: "Server", privacy_url: Some("https://rivian.com/legal/privacy"), terms_url: None, editable: true },
    ConnectionDefinition { id: connections::S3_BACKUP, name: "S3-compatible backups", purpose: "Optional off-site backup storage managed in Backups.", data_shared: &["Backup artifact", "Configured object-store credentials"], disabled_effect: "New off-site backups stop; local backup behavior and existing objects remain.", execution: "Server", privacy_url: None, terms_url: None, editable: false },
];

async fn list_connections(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ExternalConnectionsResponse>, AppError> {
    let role = get_user_role(&state.pool, auth.user_id).await?;
    let can_manage = matches!(role, UserRole::Admin | UserRole::SuperUser);
    Ok(Json(build_response(&state, can_manage).await?))
}

async fn build_response(
    state: &AppState,
    can_manage: bool,
) -> Result<ExternalConnectionsResponse, AppError> {
    let rows = connections::list(&state.pool).await?;
    let backup = sqlx::query_as::<_, (bool, Option<String>)>(
        "SELECT enabled, NULLIF(endpoint, '') FROM riviamigo.backup_settings WHERE id = TRUE",
    )
    .fetch_optional(&state.pool)
    .await?
    .unwrap_or((false, None));
    let mut result = Vec::with_capacity(rows.len());
    for (settings, activity) in rows {
        let Some(definition) = DEFINITIONS.iter().find(|item| item.id == settings.id) else {
            continue;
        };
        let (enabled, mode, endpoint) = if settings.id == connections::S3_BACKUP {
            (backup.0, "custom".to_string(), backup.1.clone())
        } else {
            (
                settings.is_active(),
                settings.mode.clone(),
                active_endpoint(&settings),
            )
        };
        result.push(ConnectionResponse {
            id: settings.id.clone(),
            name: definition.name,
            purpose: definition.purpose,
            data_shared: definition.data_shared,
            disabled_effect: definition.disabled_effect,
            execution: definition.execution,
            privacy_url: definition.privacy_url,
            terms_url: definition.terms_url,
            editable: definition.editable && can_manage,
            enabled,
            mode,
            endpoint_is_private: settings.allow_private_network
                || endpoint
                    .as_deref()
                    .map(endpoint_is_private)
                    .unwrap_or(false),
            endpoint,
            weather_precision: settings.weather_precision,
            forecast_url: settings.forecast_url,
            archive_url: settings.archive_url,
            base_url: settings.base_url,
            light_url_template: settings.light_url_template,
            dark_url_template: settings.dark_url_template,
            attribution: settings.attribution,
            attribution_url: settings.attribution_url,
            request_identifier: settings.request_identifier,
            custom_autocomplete: settings.custom_autocomplete,
            allow_private_network: settings.allow_private_network,
            has_api_key: settings.api_key_encrypted.is_some(),
            has_bearer_token: settings.bearer_token_encrypted.is_some(),
            updated_at: settings.updated_at,
            last_attempt_at: activity.last_attempt_at,
            last_success_at: activity.last_success_at,
            last_error: activity.last_error,
            request_count_today: if activity.usage_date == Utc::now().date_naive() {
                activity.request_count
            } else {
                0
            },
        });
    }
    Ok(ExternalConnectionsResponse {
        can_manage,
        connections: result,
    })
}

#[derive(Debug, Deserialize)]
struct UpdateConnectionBody {
    enabled: bool,
    mode: String,
    weather_precision: Option<String>,
    forecast_url: Option<String>,
    archive_url: Option<String>,
    base_url: Option<String>,
    light_url_template: Option<String>,
    dark_url_template: Option<String>,
    attribution: Option<String>,
    attribution_url: Option<String>,
    request_identifier: Option<String>,
    custom_autocomplete: Option<bool>,
    allow_private_network: Option<bool>,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
    bearer_token: Option<String>,
    clear_bearer_token: Option<bool>,
}

async fn update_connection(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateConnectionBody>,
) -> Result<Json<ExternalConnectionsResponse>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let definition = DEFINITIONS
        .iter()
        .find(|item| item.id == id)
        .ok_or(AppError::NotFound)?;
    if !definition.editable {
        return Err(AppError::Forbidden);
    }
    validate_update(&id, &body).await?;

    let api_key_encrypted = encrypt_secret(&state.age_key, body.api_key.as_deref())?;
    let bearer_token_encrypted = encrypt_secret(&state.age_key, body.bearer_token.as_deref())?;
    let mode = if body.enabled {
        body.mode.as_str()
    } else {
        "disabled"
    };
    let mut forecast_url = normalize(body.forecast_url);
    let mut archive_url = normalize(body.archive_url);
    let mut base_url = normalize(body.base_url);
    let mut light_url_template = normalize(body.light_url_template);
    let mut dark_url_template = normalize(body.dark_url_template);
    let mut attribution = normalize(body.attribution);
    let mut attribution_url = normalize(body.attribution_url);

    // Hosted mode is a named policy, not merely a label over the last custom
    // values. Restore Riviamigo's audited defaults when an admin switches back.
    if mode == "hosted" {
        match id.as_str() {
            connections::OPEN_METEO => {
                forecast_url = Some("https://api.open-meteo.com/v1/forecast".into());
                archive_url = Some("https://archive-api.open-meteo.com/v1/archive".into());
                attribution = Some("Weather data by Open-Meteo".into());
                attribution_url = Some("https://open-meteo.com/".into());
            }
            connections::NOMINATIM => {
                base_url = Some("https://nominatim.openstreetmap.org".into());
                attribution = Some("OpenStreetMap contributors".into());
                attribution_url = Some("https://www.openstreetmap.org/copyright".into());
            }
            connections::BASEMAP => {
                light_url_template =
                    Some("https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png".into());
                dark_url_template =
                    Some("https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png".into());
                attribution = Some("OpenStreetMap contributors and CARTO".into());
                attribution_url = Some("https://carto.com/attributions".into());
            }
            connections::ICONIFY => {
                base_url = Some("https://api.iconify.design".into());
                attribution = Some("Iconify".into());
                attribution_url = Some("https://iconify.design/".into());
            }
            _ => {}
        }
    }

    sqlx::query(
        r#"UPDATE riviamigo.external_connection_settings SET
             enabled = $2, mode = $3, weather_precision = COALESCE($4, weather_precision),
             forecast_url = COALESCE($5, forecast_url), archive_url = COALESCE($6, archive_url),
             base_url = COALESCE($7, base_url), light_url_template = COALESCE($8, light_url_template),
             dark_url_template = $9, attribution = COALESCE($10, attribution),
             attribution_url = $11, request_identifier = $12,
             custom_autocomplete = COALESCE($13, custom_autocomplete),
             allow_private_network = COALESCE($14, allow_private_network),
             api_key_encrypted = CASE WHEN $15 THEN NULL WHEN $16 IS NOT NULL THEN $16 ELSE api_key_encrypted END,
             bearer_token_encrypted = CASE WHEN $17 THEN NULL WHEN $18 IS NOT NULL THEN $18 ELSE bearer_token_encrypted END,
             updated_at = now(), updated_by = $19
           WHERE id = $1"#,
    )
    .bind(&id)
    .bind(body.enabled)
    .bind(mode)
    .bind(body.weather_precision.as_deref())
    .bind(forecast_url)
    .bind(archive_url)
    .bind(base_url)
    .bind(light_url_template)
    .bind(dark_url_template)
    .bind(attribution)
    .bind(attribution_url)
    .bind(normalize(body.request_identifier))
    .bind(body.custom_autocomplete)
    .bind(body.allow_private_network)
    .bind(body.clear_api_key.unwrap_or(false))
    .bind(api_key_encrypted)
    .bind(body.clear_bearer_token.unwrap_or(false))
    .bind(bearer_token_encrypted)
    .bind(auth.user_id)
    .execute(&state.pool)
    .await?;

    Ok(Json(build_response(&state, true).await?))
}

async fn disable_optional(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ExternalConnectionsResponse>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    sqlx::query(
        "UPDATE riviamigo.external_connection_settings SET enabled = FALSE, mode = 'disabled', updated_at = now(), updated_by = $1 WHERE id = ANY($2)",
    )
    .bind(auth.user_id)
    .bind(connections::OPTIONAL_CONNECTIONS)
    .execute(&state.pool)
    .await?;
    Ok(Json(build_response(&state, true).await?))
}

#[derive(Debug, Serialize)]
struct TestConnectionResponse {
    ok: bool,
    message: String,
    preview_data_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct BasemapConfigResponse {
    enabled: bool,
    light_url: &'static str,
    dark_url: &'static str,
    attribution: Option<String>,
    attribution_url: Option<String>,
}

async fn basemap_config(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<BasemapConfigResponse>, AppError> {
    let settings = connections::load(&state.pool, connections::BASEMAP).await?;
    Ok(Json(BasemapConfigResponse {
        enabled: settings.is_active(),
        light_url: "/v1/external/basemap/light/{z}/{x}/{y}.png",
        dark_url: "/v1/external/basemap/dark/{z}/{x}/{y}.png",
        attribution: settings.attribution,
        attribution_url: settings.attribution_url,
    }))
}

async fn test_connection(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateConnectionBody>,
) -> Result<Json<TestConnectionResponse>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    if !body.enabled || body.mode == "disabled" {
        return Err(AppError::ExternalConnectionDisabled(id));
    }
    validate_update(&id, &body).await?;
    let settings = connections::load(&state.pool, &id).await?;
    let client = outbound_client()?;
    connections::record_attempt(&state.pool, &id).await;
    let result = match id.as_str() {
        connections::OPEN_METEO => {
            let endpoint = if body.mode == "custom" {
                body.forecast_url.as_deref()
            } else {
                Some("https://api.open-meteo.com/v1/forecast")
            }
            .ok_or_else(|| AppError::Validation("forecast URL required".into()))?;
            let mut request = client.get(endpoint).query(&[
                ("latitude", "39.0"),
                ("longitude", "-98.0"),
                ("hourly", "temperature_2m"),
                ("forecast_days", "1"),
            ]);
            let api_key = body
                .api_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or(decrypt_secret(
                    &state.age_key,
                    settings.api_key_encrypted.as_deref(),
                )?);
            if let Some(api_key) = api_key.as_deref() {
                request = request.query(&[("apikey", api_key)]);
            }
            request.send().await
        }
        connections::NOMINATIM => {
            let base = if body.mode == "custom" {
                body.base_url.as_deref()
            } else {
                Some("https://nominatim.openstreetmap.org")
            };
            let endpoint = endpoint_join(base, "search")?;
            let user_agent = body
                .request_identifier
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Riviamigo (+https://github.com/bretterer/rivian-telemetry)");
            client
                .get(endpoint)
                .header(header::USER_AGENT, user_agent)
                .query(&[("format", "jsonv2"), ("q", "Kansas"), ("limit", "1")])
                .send()
                .await
        }
        connections::BASEMAP => {
            let template = if body.mode == "custom" {
                body.light_url_template.as_deref()
            } else {
                Some("https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png")
            }
            .ok_or_else(|| AppError::Validation("light tile template required".into()))?;
            // z6/14/24 is a generic central-US tile and never uses trip data.
            let mut request = client.get(expand_tile_template(template, 6, 14, 24));
            let bearer_token = body
                .bearer_token
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or(decrypt_secret(
                    &state.age_key,
                    settings.bearer_token_encrypted.as_deref(),
                )?);
            if let Some(token) = bearer_token {
                request = request.bearer_auth(token);
            }
            request.send().await
        }
        connections::ICONIFY => {
            let endpoint = endpoint_join(Some("https://api.iconify.design"), "search")?;
            client
                .get(endpoint)
                .query(&[("query", "thermometer"), ("limit", "1")])
                .send()
                .await
        }
        _ => {
            return Ok(Json(TestConnectionResponse {
                ok: true,
                message: "Connection is managed by its owning settings surface.".into(),
                preview_data_url: None,
            }))
        }
    };

    match result {
        Ok(response) if response.status().is_success() => {
            let preview_data_url = if id == connections::BASEMAP {
                let content_type = response
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("image/png")
                    .to_string();
                let bytes = response.bytes().await.map_err(|_| {
                    AppError::DependencyUnavailable("Basemap preview response failed".into())
                })?;
                if bytes.len() > 5 * 1024 * 1024 {
                    return Err(AppError::DependencyUnavailable(
                        "Basemap preview exceeded the response limit".into(),
                    ));
                }
                Some(format!(
                    "data:{content_type};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ))
            } else {
                None
            };
            connections::record_success(&state.pool, &id).await;
            Ok(Json(TestConnectionResponse {
                ok: true,
                message: "Connection succeeded with synthetic test data.".into(),
                preview_data_url,
            }))
        }
        Ok(response) => {
            let message = format!("Provider returned HTTP {}", response.status());
            connections::record_failure(&state.pool, &id, &message).await;
            Ok(Json(TestConnectionResponse {
                ok: false,
                message,
                preview_data_url: None,
            }))
        }
        Err(error) => {
            connections::record_failure(&state.pool, &id, &error.to_string()).await;
            Ok(Json(TestConnectionResponse {
                ok: false,
                message: "Connection failed; no trip data was sent.".into(),
                preview_data_url: None,
            }))
        }
    }
}

async fn proxy_basemap_tile(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path((style, z, x, y)): Path<(String, u8, u32, String)>,
) -> Result<Response<Body>, AppError> {
    let settings = connections::require_enabled(&state.pool, connections::BASEMAP).await?;
    let y = y
        .trim_end_matches(".png")
        .parse::<u32>()
        .map_err(|_| AppError::Validation("invalid tile coordinate".into()))?;
    if z > 22 {
        return Err(AppError::Validation("invalid tile zoom".into()));
    }
    let tile_limit = 1_u32.checked_shl(u32::from(z)).unwrap_or(0);
    if x >= tile_limit || y >= tile_limit {
        return Err(AppError::Validation("invalid tile coordinate".into()));
    }
    let template = if style == "dark" {
        settings
            .dark_url_template
            .as_deref()
            .or(settings.light_url_template.as_deref())
    } else {
        settings.light_url_template.as_deref()
    }
    .ok_or_else(|| AppError::Validation("tile template missing".into()))?;
    let cache_key = format!(
        "external:basemap:{}:{style}:{z}:{x}:{y}",
        settings.updated_at.timestamp()
    );
    let content_type_key = format!("{cache_key}:content-type");
    let max_age_key = format!("{cache_key}:max-age");
    if let Ok(mut redis) = state.redis.get_multiplexed_async_connection().await {
        if let Ok(Some(bytes)) = redis.get::<_, Option<Vec<u8>>>(&cache_key).await {
            let content_type = redis
                .get::<_, Option<String>>(&content_type_key)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| "image/png".into());
            let max_age = redis
                .get::<_, Option<u64>>(&max_age_key)
                .await
                .ok()
                .flatten()
                .unwrap_or(86_400);
            return tile_response(bytes, &content_type, max_age);
        }
    }
    let url = expand_tile_template(template, z, x, y);
    connections::record_attempt(&state.pool, connections::BASEMAP).await;
    let mut request = outbound_client()?.get(url);
    if let Some(token) = decrypt_secret(&state.age_key, settings.bearer_token_encrypted.as_deref())?
    {
        request = request.bearer_auth(token);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => {
            connections::record_failure(
                &state.pool,
                connections::BASEMAP,
                "Basemap request failed",
            )
            .await;
            return Err(AppError::DependencyUnavailable(
                "Basemap request failed".into(),
            ));
        }
    };
    if !response.status().is_success() {
        connections::record_failure(
            &state.pool,
            connections::BASEMAP,
            &format!("HTTP {}", response.status()),
        )
        .await;
        return Err(AppError::DependencyUnavailable(
            "Basemap provider returned an error".into(),
        ));
    }
    if response.content_length().unwrap_or(0) > 5 * 1024 * 1024 {
        return Err(AppError::DependencyUnavailable(
            "Basemap tile exceeded the response limit".into(),
        ));
    }
    let cache_ttl = upstream_cache_ttl(response.headers());
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| {
            AppError::DependencyUnavailable(format!("Basemap response failed: {error}"))
        })?
        .to_vec();
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(AppError::DependencyUnavailable(
            "Basemap tile exceeded the response limit".into(),
        ));
    }
    if cache_ttl > 0 {
        if let Ok(mut redis) = state.redis.get_multiplexed_async_connection().await {
            let _: Result<(), _> = redis.set_ex(&cache_key, &bytes, cache_ttl).await;
            let _: Result<(), _> = redis
                .set_ex(&content_type_key, &content_type, cache_ttl)
                .await;
            let _: Result<(), _> = redis.set_ex(&max_age_key, cache_ttl, cache_ttl).await;
        }
    }
    connections::record_success(&state.pool, connections::BASEMAP).await;
    tile_response(bytes, &content_type, cache_ttl)
}

#[derive(Debug, Deserialize)]
struct IconifySearchParams {
    query: String,
    limit: Option<u8>,
    prefix: Option<String>,
}

async fn proxy_iconify_search(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(params): Query<IconifySearchParams>,
) -> Result<Response<Body>, AppError> {
    let settings = connections::require_enabled(&state.pool, connections::ICONIFY).await?;
    let endpoint = endpoint_join(settings.base_url.as_deref(), "search")?;
    let mut request = outbound_client()?.get(endpoint).query(&[
        ("query", params.query.as_str()),
        (
            "limit",
            &params.limit.unwrap_or(40).clamp(1, 40).to_string(),
        ),
    ]);
    if let Some(prefix) = params.prefix.as_deref().filter(|value| !value.is_empty()) {
        request = request.query(&[("prefix", prefix)]);
    }
    proxy_json(&state, connections::ICONIFY, request).await
}

async fn proxy_iconify_resource(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(resource): Path<String>,
    OriginalUri(uri): OriginalUri,
) -> Result<Response<Body>, AppError> {
    if !resource.ends_with(".json") || resource.contains('/') || resource.contains("..") {
        return Err(AppError::Validation("invalid icon resource".into()));
    }
    let settings = connections::require_enabled(&state.pool, connections::ICONIFY).await?;
    let mut endpoint = endpoint_join(settings.base_url.as_deref(), &resource)?;
    if let Some(query) = uri.query() {
        endpoint.set_query(Some(query));
    }
    proxy_json(
        &state,
        connections::ICONIFY,
        outbound_client()?.get(endpoint),
    )
    .await
}

async fn proxy_json(
    state: &AppState,
    id: &str,
    request: reqwest::RequestBuilder,
) -> Result<Response<Body>, AppError> {
    connections::record_attempt(&state.pool, id).await;
    let upstream = request
        .send()
        .await
        .map_err(|_| AppError::DependencyUnavailable(format!("{id} request failed")))?;
    let status = upstream.status();
    if !status.is_success() {
        connections::record_failure(&state.pool, id, &format!("HTTP {status}")).await;
        return Err(AppError::DependencyUnavailable(format!(
            "{id} provider returned an error"
        )));
    }
    let bytes = upstream
        .bytes()
        .await
        .map_err(|_| AppError::DependencyUnavailable(format!("{id} response failed")))?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(AppError::DependencyUnavailable(format!(
            "{id} response exceeded the limit"
        )));
    }
    connections::record_success(&state.pool, id).await;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "private, max-age=3600")
        .body(Body::from(bytes))
        .map_err(|error| AppError::Internal(error.into()))
}

fn tile_response(
    bytes: Vec<u8>,
    content_type: &str,
    max_age: u64,
) -> Result<Response<Body>, AppError> {
    let content_type = HeaderValue::from_str(content_type)
        .unwrap_or_else(|_| HeaderValue::from_static("image/png"));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, format!("private, max-age={max_age}"))
        .body(Body::from(bytes))
        .map_err(|error| AppError::Internal(error.into()))
}

fn upstream_cache_ttl(headers: &axum::http::HeaderMap) -> u64 {
    let Some(value) = headers
        .get(header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
    else {
        return 86_400;
    };
    if value
        .split(',')
        .any(|part| part.trim().eq_ignore_ascii_case("no-store"))
    {
        return 0;
    }
    value
        .split(',')
        .find_map(|part| part.trim().strip_prefix("max-age=")?.parse::<u64>().ok())
        .unwrap_or(86_400)
        .min(86_400)
}

async fn validate_update(id: &str, body: &UpdateConnectionBody) -> Result<(), AppError> {
    if !matches!(body.mode.as_str(), "hosted" | "custom" | "disabled") {
        return Err(AppError::Validation(
            "mode must be hosted, custom, or disabled".into(),
        ));
    }
    if body.mode == "custom"
        && !matches!(
            id,
            connections::OPEN_METEO | connections::NOMINATIM | connections::BASEMAP
        )
    {
        return Err(AppError::Validation(
            "this connection does not support a custom endpoint".into(),
        ));
    }
    if let Some(precision) = body.weather_precision.as_deref() {
        if !matches!(precision, "approximate" | "exact") {
            return Err(AppError::Validation(
                "weather_precision must be approximate or exact".into(),
            ));
        }
    }
    if body.mode != "custom" || !body.enabled {
        return Ok(());
    }
    let allow_private = body.allow_private_network.unwrap_or(false);
    match id {
        connections::OPEN_METEO => {
            validate_endpoint(body.forecast_url.as_deref(), allow_private).await?;
            validate_endpoint(body.archive_url.as_deref(), allow_private).await?;
        }
        connections::NOMINATIM => {
            validate_endpoint(body.base_url.as_deref(), allow_private).await?;
        }
        connections::BASEMAP => {
            let light = body.light_url_template.as_deref().ok_or_else(|| {
                AppError::Validation("custom basemap requires a light URL template".into())
            })?;
            validate_tile_template(light, allow_private).await?;
            if let Some(dark) = body.dark_url_template.as_deref() {
                validate_tile_template(dark, allow_private).await?;
            }
            if body
                .attribution
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
            {
                return Err(AppError::Validation(
                    "custom basemap attribution is required".into(),
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

async fn validate_tile_template(value: &str, allow_private: bool) -> Result<(), AppError> {
    for token in ["{z}", "{x}", "{y}"] {
        if !value.contains(token) {
            return Err(AppError::Validation(format!(
                "tile template must contain {token}"
            )));
        }
    }
    validate_endpoint(
        Some(
            &value
                .replace("{z}", "0")
                .replace("{x}", "0")
                .replace("{y}", "0"),
        ),
        allow_private,
    )
    .await
}

async fn validate_endpoint(value: Option<&str>, allow_private: bool) -> Result<(), AppError> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Validation("endpoint is required".into()))?;
    let url = Url::parse(value)
        .map_err(|_| AppError::Validation("endpoint must be a valid URL".into()))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Validation(
            "endpoint must use HTTP or HTTPS".into(),
        ));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Validation("endpoint credentials, query strings, and fragments are not allowed; use the encrypted secret field".into()));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Validation("endpoint host is required".into()))?;
    if is_link_local_or_metadata(host) {
        return Err(AppError::Validation(
            "link-local and cloud metadata endpoints are not allowed".into(),
        ));
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::Validation("endpoint port is required".into()))?;
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| AppError::Validation("endpoint host could not be resolved".into()))?;
    let mut private = endpoint_is_private(value);
    for address in addresses {
        let ip = address.ip();
        if is_forbidden_ip(ip) {
            return Err(AppError::Validation(
                "link-local and cloud metadata endpoints are not allowed".into(),
            ));
        }
        private |= match ip {
            IpAddr::V4(ip) => ip.is_private() || ip.is_loopback(),
            IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local(),
        };
    }
    if private && !allow_private {
        return Err(AppError::Validation(
            "confirm private-network access for this endpoint".into(),
        ));
    }
    if url.scheme() == "http" && (!private || !allow_private) {
        return Err(AppError::Validation(
            "HTTP is permitted only for a confirmed local/private endpoint".into(),
        ));
    }
    Ok(())
}

fn endpoint_is_private(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    IpAddr::from_str(host)
        .map(|ip| match ip {
            IpAddr::V4(ip) => ip.is_private() || ip.is_loopback(),
            IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local(),
        })
        .unwrap_or(false)
}

fn is_link_local_or_metadata(host: &str) -> bool {
    if host.eq_ignore_ascii_case("metadata.google.internal") {
        return true;
    }
    IpAddr::from_str(host).map(is_forbidden_ip).unwrap_or(false)
}

fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_link_local() || ip.octets() == [169, 254, 169, 254],
        IpAddr::V6(ip) => ip.is_unicast_link_local(),
    }
}

fn active_endpoint(settings: &ConnectionSettingsRow) -> Option<String> {
    match settings.id.as_str() {
        connections::OPEN_METEO => settings.forecast_url.clone(),
        connections::BASEMAP => settings.light_url_template.clone(),
        _ => settings.base_url.clone(),
    }
}

fn endpoint_join(base: Option<&str>, path: &str) -> Result<Url, AppError> {
    let base = base.ok_or_else(|| AppError::Validation("connection endpoint missing".into()))?;
    let mut normalized = base.trim_end_matches('/').to_string();
    normalized.push('/');
    Url::parse(&normalized)
        .and_then(|url| url.join(path))
        .map_err(|_| AppError::Validation("connection endpoint is invalid".into()))
}

fn expand_tile_template(template: &str, z: u8, x: u32, y: u32) -> String {
    template
        .replace("{z}", &z.to_string())
        .replace("{x}", &x.to_string())
        .replace("{y}", &y.to_string())
}
fn normalize(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
fn outbound_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::Internal(error.into()))
}

fn encrypt_secret(age_key: &str, secret: Option<&str>) -> Result<Option<Vec<u8>>, AppError> {
    let Some(secret) = secret.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let identity = age_key.parse::<age::x25519::Identity>().map_err(|_| {
        AppError::Internal(anyhow::anyhow!(
            "invalid age key for external connection secret"
        ))
    })?;
    Ok(Some(encrypt_json(&secret.to_string(), &identity)?))
}

fn decrypt_secret(age_key: &str, encrypted: Option<&[u8]>) -> Result<Option<String>, AppError> {
    let Some(encrypted) = encrypted else {
        return Ok(None);
    };
    let identity = age_key.parse::<age::x25519::Identity>().map_err(|_| {
        AppError::Internal(anyhow::anyhow!(
            "invalid age key for external connection secret"
        ))
    })?;
    Ok(Some(crate::ingestion::session_store::decrypt_json(
        encrypted, &identity,
    )?))
}

#[cfg(test)]
mod tests {
    use super::{endpoint_is_private, validate_tile_template};

    #[tokio::test]
    async fn validates_xyz_template_and_private_confirmation() {
        assert!(
            validate_tile_template("https://127.0.0.1/{z}/{x}/{y}.png", true)
                .await
                .is_ok()
        );
        assert!(
            validate_tile_template("http://127.0.0.1/{z}/{x}/{y}.png", false)
                .await
                .is_err()
        );
        assert!(
            validate_tile_template("http://127.0.0.1/{z}/{x}/{y}.png", true)
                .await
                .is_ok()
        );
        assert!(
            validate_tile_template("https://127.0.0.1/{z}/{x}.png", true)
                .await
                .is_err()
        );
        assert!(endpoint_is_private("http://localhost:8080"));
    }
}
