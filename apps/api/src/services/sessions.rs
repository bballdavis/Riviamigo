//! Session authorization shared by HTTP and live connections.
use sqlx::PgPool;
use uuid::Uuid;

use crate::{errors::AppError, middleware::auth::Claims};

pub async fn require_enabled_session(pool: &PgPool, claims: &Claims) -> Result<(), AppError> {
    if claims.exp <= chrono::Utc::now().timestamp() {
        return Err(AppError::Unauthorized);
    }
    let enabled =
        sqlx::query_scalar::<_, bool>("SELECT NOT is_disabled FROM riviamigo.users WHERE id = $1")
            .bind(claims.sub)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::Unauthorized)?;
    if !enabled {
        return Err(AppError::Forbidden);
    }
    // Old JWTs have no sid and expire within the existing 15-minute lifetime.
    if let Some(sid) = claims.sid {
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM riviamigo.session_families f
             WHERE f.id=$1 AND f.user_id=$2 AND f.revoked_at IS NULL
               AND EXISTS(SELECT 1 FROM riviamigo.refresh_tokens t
                 WHERE t.family_id=f.id AND t.revoked_at IS NULL AND t.expires_at > now()))",
        )
        .bind(sid)
        .bind(claims.sub)
        .fetch_one(pool)
        .await?;
        if !active {
            return Err(AppError::Unauthorized);
        }
    }
    Ok(())
}

pub async fn revoke_family(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    family_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE riviamigo.session_families SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1",
    )
    .bind(family_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE riviamigo.refresh_tokens SET revoked_at=COALESCE(revoked_at, now()) WHERE family_id=$1")
        .bind(family_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn revoke_user_sessions(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<(), AppError> {
    // Match refresh's family-before-token lock order. A rotation which wins the
    // lock finishes first, then its new descendant is revoked in this snapshot.
    let families: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM riviamigo.session_families WHERE user_id=$1 ORDER BY id FOR UPDATE",
    )
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?;
    for family in families {
        revoke_family(tx, family).await?;
    }
    Ok(())
}
