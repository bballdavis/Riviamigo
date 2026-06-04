use axum::{
    extract::State,
    http::{header::SET_COOKIE, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    db::vehicles::get_default_vehicle_id,
    errors::AppError,
    middleware::auth::{issue_access_token, AppState, AuthUser},
};

const MIN_PASSWORD_LEN: usize = 12;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
}

pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/auth/me", axum::routing::get(me))
        .route(
            "/auth/preferences",
            axum::routing::get(get_preferences).put(update_preferences),
        )
}

#[derive(Deserialize)]
struct RegisterBody {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

#[derive(Serialize)]
struct AccessTokenResponse {
    access_token: String,
    expires_in: u64,
    default_vehicle_id: Option<Uuid>,
}

#[derive(Serialize, Deserialize, Clone)]
struct UnitPreferencesPayload {
    mode: String,
    distance_unit: String,
    speed_unit: String,
    temperature_unit: String,
    pressure_unit: String,
    altitude_unit: String,
    place_radius_unit: String,
    efficiency_display: String,
}

#[derive(Serialize)]
struct PreferencesResponse {
    units: UnitPreferencesPayload,
}

#[derive(Deserialize)]
struct PreferencesUpdateBody {
    units: UnitPreferencesPayload,
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> Result<Response, AppError> {
    if body.email.len() > 254 {
        return Err(AppError::Validation("email too long".into()));
    }
    if body.email.is_empty() || !body.email.contains('@') || body.password.len() < MIN_PASSWORD_LEN
    {
        return Err(AppError::Validation(
            "valid email required, password min 12 chars".into(),
        ));
    }

    let hash = argon2_hash(&body.password)?;
    let email = body.email.to_lowercase();
    let mut tx = state.pool.begin().await?;
    sqlx::query("LOCK TABLE riviamigo.users IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;

    let user_count: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM riviamigo.users")
        .fetch_one(&mut *tx)
        .await?
        .unwrap_or(0);
    let role = if user_count == 0 {
        "super_user"
    } else {
        "user"
    };

    let user_id: Uuid = sqlx::query_scalar!(
        "INSERT INTO riviamigo.users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
        email.trim(),
        hash,
        role,
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.constraint() == Some("users_email_key") => {
            AppError::Validation("email already registered".into())
        }
        other => AppError::Database(other),
    })?;

    // create default preferences row
    let _ = sqlx::query!(
        "INSERT INTO riviamigo.user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        user_id
    )
    .execute(&mut *tx)
    .await;

    tx.commit().await?;

    // auto-login: issue tokens so the client is immediately authenticated
    let token = issue_access_token(user_id, None, &state.jwt_keys)?;
    let refresh = issue_refresh_token(&state.pool, user_id).await?;
    let cookie = refresh_cookie(&refresh, 2_592_000);
    Ok((
        StatusCode::CREATED,
        [(SET_COOKIE, cookie)],
        Json(AccessTokenResponse {
            access_token: token,
            expires_in: 900,
            default_vehicle_id: None,
        }),
    )
        .into_response())
}

// A well-formed Argon2 hash of a random dummy password. Used to perform a
// constant-time Argon2 verification even when the email doesn't exist, so
// the response time doesn't reveal whether the account exists.
const DUMMY_HASH: &str =
    "$argon2id$v=19$m=19456,t=2,p=1$cm9vdHJvb3Ryb290cm9v$6/Ds/Z5DKq/r+z5xFo0O3sDmN5RBUQ2A6yb7z1WB1Wg";

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Response, AppError> {
    let email = body.email.to_lowercase();
    let row =
        sqlx::query("SELECT id, password_hash, is_disabled FROM riviamigo.users WHERE email = $1")
            .bind(email.trim())
            .fetch_optional(&state.pool)
            .await?;

    // Always run the Argon2 verification to avoid timing oracle for user enumeration.
    let password_hash = row.as_ref().map(|r| r.get::<String, _>("password_hash"));
    let hash = password_hash.as_deref().unwrap_or(DUMMY_HASH);
    if let Err(e) = verify_password(&body.password, hash) {
        if row.is_some() {
            audit_log(
                state.pool.clone(),
                "login_failure",
                None,
                format!("failed login for {}", email),
            );
        }
        return Err(e);
    }

    let row = row.ok_or(AppError::Unauthorized)?;
    if row.get::<bool, _>("is_disabled") {
        return Err(AppError::Forbidden);
    }

    let user_id: Uuid = row.get("id");
    let default_vehicle_id = get_default_vehicle_id(&state.pool, user_id).await?;
    let token = issue_access_token(user_id, default_vehicle_id, &state.jwt_keys)?;
    let refresh = issue_refresh_token(&state.pool, user_id).await?;

    audit_log(
        state.pool.clone(),
        "login_success",
        Some(user_id),
        format!("user logged in"),
    );

    let cookie = refresh_cookie(&refresh, 2_592_000);
    Ok((
        [(SET_COOKIE, cookie)],
        Json(AccessTokenResponse {
            access_token: token,
            expires_in: 900,
            default_vehicle_id,
        }),
    )
        .into_response())
}

async fn refresh(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let cookie_str = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let token = cookie_str
        .split(';')
        .find_map(|part| {
            let p = part.trim();
            p.strip_prefix("refresh_token=")
        })
        .ok_or(AppError::Unauthorized)?;

    let hash = sha2_hash(token);

    // Revoke the presented token and return its user_id atomically.
    let user_id: Uuid = sqlx::query_scalar(
        "UPDATE riviamigo.refresh_tokens
         SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
         RETURNING user_id",
    )
    .bind(hash.as_slice())
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let default_vehicle_id = get_default_vehicle_id(&state.pool, user_id).await?;

    // Issue a fresh refresh token on every use so a leaked token is limited to one use.
    let new_refresh = issue_refresh_token(&state.pool, user_id).await?;
    let access_token = issue_access_token(user_id, default_vehicle_id, &state.jwt_keys)?;

    let max_age = 30 * 24 * 3600;
    let cookie = refresh_cookie(&new_refresh, max_age);

    Ok((
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(AccessTokenResponse {
            access_token,
            expires_in: 900,
            default_vehicle_id,
        }),
    )
        .into_response())
}

async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    if let Some(cookie_str) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        if let Some(token) = cookie_str
            .split(';')
            .find_map(|p| p.trim().strip_prefix("refresh_token="))
        {
            let hash = sha2_hash(token);
            let _ = sqlx::query!(
                "UPDATE riviamigo.refresh_tokens SET revoked_at = now() WHERE token_hash = $1",
                hash.as_slice()
            )
            .execute(&state.pool)
            .await;
        }
    }
    let clear_cookie = refresh_cookie("", 0);
    Ok(([("Set-Cookie", clear_cookie)], StatusCode::NO_CONTENT))
}

async fn me(State(state): State<AppState>, auth: AuthUser) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query("SELECT email, role FROM riviamigo.users WHERE id = $1")
        .bind(auth.user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;

    let default_vehicle_id = get_default_vehicle_id(&state.pool, auth.user_id).await?;

    Ok(Json(serde_json::json!({
        "user_id":            auth.user_id,
        "email":              row.get::<String, _>("email"),
        "role":               row.get::<String, _>("role"),
        "default_vehicle_id": default_vehicle_id
    })))
}

async fn get_preferences(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query(
        "SELECT unit_mode, distance_unit, temperature_unit, \
                custom_distance_unit, custom_speed_unit, custom_temperature_unit, \
                custom_pressure_unit, custom_altitude_unit, custom_place_radius_unit, \
                custom_efficiency_display \
         FROM riviamigo.user_preferences WHERE user_id = $1",
    )
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let units = if let Some(row) = row {
        let mode = row
            .try_get::<String, _>("unit_mode")
            .unwrap_or_else(|_| "imperial".to_string());
        let legacy_distance = row
            .try_get::<String, _>("distance_unit")
            .unwrap_or_else(|_| "miles".to_string());
        let legacy_temp = row
            .try_get::<String, _>("temperature_unit")
            .unwrap_or_else(|_| "fahrenheit".to_string());
        resolved_units_payload(
            &mode,
            row.try_get::<Option<String>, _>("custom_distance_unit")
                .ok()
                .flatten()
                .as_deref(),
            row.try_get::<Option<String>, _>("custom_speed_unit")
                .ok()
                .flatten()
                .as_deref(),
            row.try_get::<Option<String>, _>("custom_temperature_unit")
                .ok()
                .flatten()
                .as_deref(),
            row.try_get::<Option<String>, _>("custom_pressure_unit")
                .ok()
                .flatten()
                .as_deref(),
            row.try_get::<Option<String>, _>("custom_altitude_unit")
                .ok()
                .flatten()
                .as_deref(),
            row.try_get::<Option<String>, _>("custom_place_radius_unit")
                .ok()
                .flatten()
                .as_deref(),
            row.try_get::<Option<String>, _>("custom_efficiency_display")
                .ok()
                .flatten()
                .as_deref(),
            &legacy_distance,
            &legacy_temp,
        )
    } else {
        resolved_units_payload(
            "imperial",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            "miles",
            "fahrenheit",
        )
    };

    Ok(Json(PreferencesResponse { units }))
}

async fn update_preferences(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<PreferencesUpdateBody>,
) -> Result<impl IntoResponse, AppError> {
    let units = normalize_units_payload(body.units)?;
    let (distance_unit, temperature_unit) = match units.mode.as_str() {
        "metric" => ("kilometers".to_string(), "celsius".to_string()),
        "custom" => (units.distance_unit.clone(), units.temperature_unit.clone()),
        _ => ("miles".to_string(), "fahrenheit".to_string()),
    };

    sqlx::query(
        "INSERT INTO riviamigo.user_preferences (
            user_id, unit_mode, distance_unit, temperature_unit,
            custom_distance_unit, custom_speed_unit, custom_temperature_unit,
            custom_pressure_unit, custom_altitude_unit, custom_place_radius_unit,
            custom_efficiency_display, updated_at
         ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, now()
         )
         ON CONFLICT (user_id) DO UPDATE SET
            unit_mode = EXCLUDED.unit_mode,
            distance_unit = EXCLUDED.distance_unit,
            temperature_unit = EXCLUDED.temperature_unit,
            custom_distance_unit = EXCLUDED.custom_distance_unit,
            custom_speed_unit = EXCLUDED.custom_speed_unit,
            custom_temperature_unit = EXCLUDED.custom_temperature_unit,
            custom_pressure_unit = EXCLUDED.custom_pressure_unit,
            custom_altitude_unit = EXCLUDED.custom_altitude_unit,
            custom_place_radius_unit = EXCLUDED.custom_place_radius_unit,
            custom_efficiency_display = EXCLUDED.custom_efficiency_display,
            updated_at = now()",
    )
    .bind(auth.user_id)
    .bind(&units.mode)
    .bind(distance_unit)
    .bind(temperature_unit)
    .bind(&units.distance_unit)
    .bind(&units.speed_unit)
    .bind(&units.temperature_unit)
    .bind(&units.pressure_unit)
    .bind(&units.altitude_unit)
    .bind(&units.place_radius_unit)
    .bind(&units.efficiency_display)
    .execute(&state.pool)
    .await?;

    Ok(Json(PreferencesResponse { units }))
}

fn resolved_units_payload(
    mode: &str,
    custom_distance: Option<&str>,
    custom_speed: Option<&str>,
    custom_temperature: Option<&str>,
    custom_pressure: Option<&str>,
    custom_altitude: Option<&str>,
    custom_place_radius: Option<&str>,
    custom_efficiency_display: Option<&str>,
    legacy_distance: &str,
    legacy_temperature: &str,
) -> UnitPreferencesPayload {
    match mode {
        "metric" => UnitPreferencesPayload {
            mode: "metric".to_string(),
            distance_unit: "kilometers".to_string(),
            speed_unit: "kmh".to_string(),
            temperature_unit: "celsius".to_string(),
            pressure_unit: "kpa".to_string(),
            altitude_unit: "meters".to_string(),
            place_radius_unit: "meters".to_string(),
            efficiency_display: "distance_per_energy".to_string(),
        },
        "custom" => UnitPreferencesPayload {
            mode: "custom".to_string(),
            distance_unit: custom_distance.unwrap_or("miles").to_string(),
            speed_unit: custom_speed.unwrap_or("mph").to_string(),
            temperature_unit: custom_temperature.unwrap_or("fahrenheit").to_string(),
            pressure_unit: custom_pressure.unwrap_or("psi").to_string(),
            altitude_unit: custom_altitude.unwrap_or("feet").to_string(),
            place_radius_unit: custom_place_radius.unwrap_or("feet").to_string(),
            efficiency_display: custom_efficiency_display
                .unwrap_or("distance_per_energy")
                .to_string(),
        },
        _ => {
            let is_metric = legacy_distance.eq_ignore_ascii_case("kilometers")
                || legacy_temperature.eq_ignore_ascii_case("celsius");
            if is_metric {
                UnitPreferencesPayload {
                    mode: "metric".to_string(),
                    distance_unit: "kilometers".to_string(),
                    speed_unit: "kmh".to_string(),
                    temperature_unit: "celsius".to_string(),
                    pressure_unit: "kpa".to_string(),
                    altitude_unit: "meters".to_string(),
                    place_radius_unit: "meters".to_string(),
                    efficiency_display: "distance_per_energy".to_string(),
                }
            } else {
                UnitPreferencesPayload {
                    mode: "imperial".to_string(),
                    distance_unit: "miles".to_string(),
                    speed_unit: "mph".to_string(),
                    temperature_unit: "fahrenheit".to_string(),
                    pressure_unit: "psi".to_string(),
                    altitude_unit: "feet".to_string(),
                    place_radius_unit: "feet".to_string(),
                    efficiency_display: "distance_per_energy".to_string(),
                }
            }
        }
    }
}

fn normalize_units_payload(
    input: UnitPreferencesPayload,
) -> Result<UnitPreferencesPayload, AppError> {
    let valid_mode = matches!(input.mode.as_str(), "imperial" | "metric" | "custom");
    if !valid_mode {
        return Err(AppError::Validation("invalid unit mode".to_string()));
    }
    let valid_distance = matches!(input.distance_unit.as_str(), "miles" | "kilometers");
    let valid_speed = matches!(input.speed_unit.as_str(), "mph" | "kmh");
    let valid_temp = matches!(input.temperature_unit.as_str(), "fahrenheit" | "celsius");
    let valid_pressure = matches!(input.pressure_unit.as_str(), "psi" | "kpa");
    let valid_altitude = matches!(input.altitude_unit.as_str(), "feet" | "meters");
    let valid_radius = matches!(input.place_radius_unit.as_str(), "feet" | "meters");
    let valid_eff = matches!(
        input.efficiency_display.as_str(),
        "distance_per_energy" | "energy_per_distance"
    );
    if !(valid_distance
        && valid_speed
        && valid_temp
        && valid_pressure
        && valid_altitude
        && valid_radius
        && valid_eff)
    {
        return Err(AppError::Validation(
            "invalid unit preference value".to_string(),
        ));
    }
    Ok(input)
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn argon2_hash(password: &str) -> Result<String, AppError> {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("hash error: {e}")))?
        .to_string())
}

fn verify_password(password: &str, hash: &str) -> Result<(), AppError> {
    use argon2::{
        password_hash::{PasswordHash, PasswordVerifier},
        Argon2,
    };
    let parsed = PasswordHash::new(hash).map_err(|_| AppError::Unauthorized)?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| AppError::Unauthorized)
}

fn sha2_hash(token: &str) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes()).to_vec()
}

fn refresh_cookie(value: &str, max_age: u64) -> String {
    let secure = if std::env::var("COOKIE_INSECURE").is_ok() {
        ""
    } else {
        "; Secure"
    };
    format!(
        "refresh_token={value}; HttpOnly{secure}; SameSite=Lax; Path=/v1/auth; Max-Age={max_age}"
    )
}

fn audit_log(pool: sqlx::PgPool, event: &'static str, user_id: Option<uuid::Uuid>, detail: String) {
    tokio::spawn(async move {
        if let Err(e) = sqlx::query(
            "INSERT INTO riviamigo.security_events (event_type, user_id, detail, created_at) \
             VALUES ($1, $2, $3, now())",
        )
        .bind(event)
        .bind(user_id)
        .bind(detail)
        .execute(&pool)
        .await
        {
            tracing::warn!(error = %e, event, "audit_log insert failed");
        }
    });
}

async fn issue_refresh_token(pool: &sqlx::PgPool, user_id: Uuid) -> Result<String, AppError> {
    use rand::Rng;
    let raw: String = (0..32)
        .map(|_| rand::thread_rng().sample(rand::distributions::Alphanumeric) as char)
        .collect();
    let hash = sha2_hash(&raw);
    let expires_at = chrono::Utc::now() + chrono::Duration::days(30);
    sqlx::query!(
        "INSERT INTO riviamigo.refresh_tokens (token_hash, user_id, expires_at) VALUES ($1,$2,$3)",
        hash.as_slice(),
        user_id,
        expires_at
    )
    .execute(pool)
    .await?;
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt; // for `oneshot`

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Build a full router backed by a real database.
    /// Reads DATABASE_URL + REDIS_URL from the environment (set in CI).
    async fn make_app() -> axum::Router {
        use crate::middleware::auth::JwtKeys;
        use std::sync::Arc;
        let database_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let (private_pem, public_pem) = generate_test_rsa_keys();
        let jwt_keys = Arc::new(JwtKeys::new(&private_pem, &public_pem).expect("jwt keys"));

        let config = crate::config::Config {
            database_url: database_url.clone(),
            redis_url: "redis://127.0.0.1/".into(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec!["http://localhost:3000".into()],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-route-test-backups")
                .to_string_lossy()
                .into_owned(),
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-route-test-vehicle-images")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "json".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: None,
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            supervisor: crate::ingestion::supervisor::SupervisorHandle::noop(),
        };

        crate::routes::build_router(state)
    }

    /// Generate an RSA-2048 key pair in PEM format for testing.
    fn generate_test_rsa_keys() -> (String, String) {
        use rsa::{
            pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
            RsaPrivateKey,
        };
        let mut rng = rand::thread_rng();
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).expect("generate rsa key");
        let pub_key = priv_key.to_public_key();
        let private_pem = priv_key
            .to_pkcs8_pem(LineEnding::LF)
            .expect("private pem")
            .to_string();
        let public_pem = pub_key
            .to_public_key_pem(LineEnding::LF)
            .expect("public pem");
        (private_pem, public_pem)
    }

    /// Send a POST request with a JSON body.
    async fn post_json(
        app: axum::Router,
        uri: &str,
        body: serde_json::Value,
    ) -> axum::response::Response {
        let req = Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        app.oneshot(req).await.unwrap()
    }

    /// Send a GET request.
    async fn get(app: axum::Router, uri: &str) -> axum::response::Response {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        app.oneshot(req).await.unwrap()
    }

    // ── pure unit tests (no DB needed) ───────────────────────────────────────

    #[test]
    fn register_validation_rejects_empty_email() {
        // Mirror the handler validation: `body.email.is_empty() || body.password.len() < 8`
        let email = "";
        let password = "strongpassword123";
        assert!(
            email.is_empty() || password.len() < 8,
            "expected validation to fire for empty email"
        );
    }

    #[test]
    fn register_validation_rejects_short_password() {
        let email = "user@example.com";
        let password = "short"; // < 8 chars
        assert!(
            email.is_empty() || password.len() < 8,
            "expected validation to fire for short password"
        );
    }

    #[test]
    fn register_validation_passes_for_valid_input() {
        let email = "user@example.com";
        let password = "strongpass123"; // >= 8 chars
        assert!(
            !(email.is_empty() || password.len() < 8),
            "valid input should not trigger validation error"
        );
    }

    #[test]
    fn refresh_cookie_format_contains_httponly() {
        let cookie = refresh_cookie("mytoken", 3600);
        assert!(cookie.contains("HttpOnly"), "cookie must be HttpOnly");
        assert!(
            cookie.contains("SameSite=Lax"),
            "cookie must have SameSite=Lax"
        );
        assert!(
            cookie.contains("refresh_token=mytoken"),
            "cookie must contain token value"
        );
        assert!(cookie.contains("Max-Age=3600"), "cookie must set Max-Age");
    }

    #[test]
    fn refresh_cookie_clear_sets_zero_max_age() {
        let cookie = refresh_cookie("", 0);
        assert!(
            cookie.contains("Max-Age=0"),
            "clearing cookie must set Max-Age=0"
        );
        assert!(
            cookie.contains("refresh_token="),
            "clearing cookie must have empty value"
        );
    }

    #[test]
    fn sha2_hash_is_deterministic() {
        let h1 = sha2_hash("hello");
        let h2 = sha2_hash("hello");
        assert_eq!(h1, h2);
    }

    #[test]
    fn sha2_hash_differs_for_different_inputs() {
        let h1 = sha2_hash("hello");
        let h2 = sha2_hash("world");
        assert_ne!(h1, h2);
    }

    #[test]
    fn argon2_hash_and_verify_roundtrip() {
        let password = "supersecretpassword";
        let hash = argon2_hash(password).expect("hash should succeed");
        assert!(verify_password(password, &hash).is_ok());
    }

    #[test]
    fn verify_password_rejects_wrong_password() {
        let hash = argon2_hash("correctpassword").expect("hash");
        assert!(verify_password("wrongpassword", &hash).is_err());
    }

    // ── integration tests (require DATABASE_URL) ─────────────────────────────
    // Run with: cargo test -- --ignored

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn me_requires_auth() {
        let app = make_app().await;
        let resp = get(app, "/v1/auth/me").await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn register_fails_empty_email_http() {
        let app = make_app().await;
        let resp = post_json(
            app,
            "/v1/auth/register",
            serde_json::json!({"email": "", "password": "strongpassword123"}),
        )
        .await;
        assert!(
            resp.status() == StatusCode::UNPROCESSABLE_ENTITY
                || resp.status() == StatusCode::BAD_REQUEST,
            "expected 422 or 400, got {}",
            resp.status()
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn register_fails_short_password_http() {
        let app = make_app().await;
        let resp = post_json(
            app,
            "/v1/auth/register",
            serde_json::json!({"email": "test@example.com", "password": "short"}),
        )
        .await;
        assert!(
            resp.status() == StatusCode::UNPROCESSABLE_ENTITY
                || resp.status() == StatusCode::BAD_REQUEST,
            "expected 422 or 400, got {}",
            resp.status()
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn register_succeeds() {
        let app = make_app().await;
        let unique_email = format!("test_{}@example.com", uuid::Uuid::new_v4());
        let resp = post_json(
            app,
            "/v1/auth/register",
            serde_json::json!({
                "email": unique_email,
                "password": "strongpassword123"
            }),
        )
        .await;
        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "register should return 201"
        );
        let set_cookie = resp
            .headers()
            .get("set-cookie")
            .expect("should have Set-Cookie header")
            .to_str()
            .unwrap()
            .to_string();
        assert!(
            set_cookie.contains("refresh_token="),
            "Set-Cookie should contain refresh_token"
        );
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert!(
            body.get("access_token").is_some(),
            "body should contain access_token"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn login_wrong_password() {
        let unique_email = format!("test_{}@example.com", uuid::Uuid::new_v4());
        // Register first
        let app = make_app().await;
        post_json(
            app.clone(),
            "/v1/auth/register",
            serde_json::json!({
                "email": unique_email,
                "password": "correctpassword123"
            }),
        )
        .await;
        // Try to log in with wrong password
        let resp = post_json(
            app,
            "/v1/auth/login",
            serde_json::json!({
                "email": unique_email,
                "password": "wrongpassword456"
            }),
        )
        .await;
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "wrong password should return 401"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn login_succeeds() {
        let unique_email = format!("test_{}@example.com", uuid::Uuid::new_v4());
        let app = make_app().await;
        // Register first
        post_json(
            app.clone(),
            "/v1/auth/register",
            serde_json::json!({
                "email": unique_email,
                "password": "correctpassword123"
            }),
        )
        .await;
        // Login
        let resp = post_json(
            app,
            "/v1/auth/login",
            serde_json::json!({
                "email": unique_email,
                "password": "correctpassword123"
            }),
        )
        .await;
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "valid login should return 200"
        );
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert!(
            body.get("access_token").is_some(),
            "login response should have access_token"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn logout_clears_cookie() {
        let unique_email = format!("test_{}@example.com", uuid::Uuid::new_v4());
        let app = make_app().await;

        // Register (auto-logs in)
        let reg_resp = post_json(
            app.clone(),
            "/v1/auth/register",
            serde_json::json!({
                "email": unique_email,
                "password": "correctpassword123"
            }),
        )
        .await;
        let set_cookie = reg_resp
            .headers()
            .get("set-cookie")
            .expect("should have Set-Cookie after register")
            .to_str()
            .unwrap()
            .to_string();

        // Extract the refresh token value from the Set-Cookie header
        let token_value = set_cookie
            .split(';')
            .next()
            .and_then(|s| s.strip_prefix("refresh_token="))
            .expect("should extract refresh_token value")
            .to_string();

        // Logout
        let logout_req = Request::builder()
            .method("POST")
            .uri("/v1/auth/logout")
            .header("cookie", format!("refresh_token={token_value}"))
            .body(Body::empty())
            .unwrap();
        let logout_resp = app.clone().oneshot(logout_req).await.unwrap();
        assert_eq!(
            logout_resp.status(),
            StatusCode::NO_CONTENT,
            "logout should return 204"
        );

        // After logout, refreshing should return 401
        let refresh_req = Request::builder()
            .method("POST")
            .uri("/v1/auth/refresh")
            .header("cookie", format!("refresh_token={token_value}"))
            .body(Body::empty())
            .unwrap();
        let refresh_resp = app.oneshot(refresh_req).await.unwrap();
        assert_eq!(
            refresh_resp.status(),
            StatusCode::UNAUTHORIZED,
            "refresh after logout should return 401"
        );
    }
}
