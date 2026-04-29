use axum::{
    extract::State,
    http::{header::SET_COOKIE, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{issue_access_token, AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
}

pub fn protected_router() -> Router<AppState> {
    Router::new().route("/auth/me", axum::routing::get(me))
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

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> Result<Response, AppError> {
    if body.email.is_empty() || body.password.len() < 8 {
        return Err(AppError::Validation(
            "email required, password min 8 chars".into(),
        ));
    }

    let hash = argon2_hash(&body.password)?;
    let email = body.email.to_lowercase();
    let user_id: Uuid = sqlx::query_scalar!(
        "INSERT INTO riviamigo.users (email, password_hash) VALUES ($1, $2) RETURNING id",
        email.trim(),
        hash,
    )
    .fetch_one(&state.pool)
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
    .execute(&state.pool)
    .await;

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

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Response, AppError> {
    let email = body.email.to_lowercase();
    let row = sqlx::query!(
        "SELECT id, password_hash, default_vehicle_id FROM riviamigo.users WHERE email = $1",
        email.trim()
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    verify_password(&body.password, &row.password_hash)?;

    let token = issue_access_token(row.id, row.default_vehicle_id, &state.jwt_keys)?;
    let refresh = issue_refresh_token(&state.pool, row.id).await?;

    let cookie = refresh_cookie(&refresh, 2_592_000);
    Ok((
        [(SET_COOKIE, cookie)],
        Json(AccessTokenResponse {
            access_token: token,
            expires_in: 900,
            default_vehicle_id: row.default_vehicle_id,
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
    let row = sqlx::query!(
        "SELECT user_id FROM riviamigo.refresh_tokens \
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
        hash.as_slice()
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let default_vehicle_id = sqlx::query_scalar!(
        "SELECT default_vehicle_id FROM riviamigo.users WHERE id = $1",
        row.user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    let access_token = issue_access_token(row.user_id, default_vehicle_id, &state.jwt_keys)?;
    Ok(Json(AccessTokenResponse {
        access_token,
        expires_in: 900,
        default_vehicle_id,
    })
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
    let row = sqlx::query!(
        "SELECT email, default_vehicle_id FROM riviamigo.users WHERE id = $1",
        auth.user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(serde_json::json!({
        "user_id":            auth.user_id,
        "email":              row.email,
        "default_vehicle_id": row.default_vehicle_id
    })))
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
    let secure = if cfg!(debug_assertions) {
        ""
    } else {
        "; Secure"
    };
    format!(
        "refresh_token={value}; HttpOnly{secure}; SameSite=Lax; Path=/v1/auth; Max-Age={max_age}"
    )
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
