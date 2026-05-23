use sqlx::PgPool;
use uuid::Uuid;

use crate::ingestion::{rivian_poll, session_store};

#[derive(Debug, Clone)]
pub struct ClaimedChargeBackfill {
    pub vehicle_id: Uuid,
    pub rivian_vehicle_id: String,
    encrypted_tokens: Vec<u8>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChargeBackfillStatus {
    pub vehicle_id: Uuid,
    pub history_backfilled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub status: Option<String>,
    pub rivian_session_count: Option<i32>,
    pub local_session_count: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChargeBackfillStart {
    pub ok: bool,
    pub status: &'static str,
}

#[derive(Debug, thiserror::Error)]
pub enum ChargeBackfillError {
    #[error("backfill already running")]
    AlreadyRunning,
    #[error("vehicle credentials not found")]
    CredentialsNotFound,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub async fn get_status(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<ChargeBackfillStatus, ChargeBackfillError> {
    let row: Option<(
        Option<chrono::DateTime<chrono::Utc>>,
        Option<String>,
        Option<i32>,
        i64,
    )> = sqlx::query_as(
        "SELECT v.history_backfilled_at, v.history_backfill_status, v.history_session_count,
                    COUNT(cs.id)
             FROM riviamigo.vehicles v
             LEFT JOIN riviamigo.charge_sessions cs ON cs.vehicle_id = v.id
             WHERE v.id = $1
             GROUP BY v.history_backfilled_at, v.history_backfill_status, v.history_session_count",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?;

    let (history_backfilled_at, status, rivian_session_count, local_session_count) =
        row.unwrap_or((None, None, None, 0));

    Ok(ChargeBackfillStatus {
        vehicle_id,
        history_backfilled_at,
        status,
        rivian_session_count,
        local_session_count,
    })
}

pub async fn claim(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<ClaimedChargeBackfill, ChargeBackfillError> {
    let claimed: Option<(String, Vec<u8>)> = sqlx::query_as(
        "UPDATE riviamigo.vehicles v
         SET history_backfill_status = 'running',
             history_backfilled_at = NULL,
             history_session_count = NULL,
             updated_at = now()
         FROM riviamigo.vehicle_credentials c
         WHERE v.id = $1
           AND c.vehicle_id = v.id
           AND COALESCE(v.history_backfill_status, '') <> 'running'
         RETURNING v.rivian_vehicle_id, c.encrypted_tokens",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?;

    if let Some((rivian_vehicle_id, encrypted_tokens)) = claimed {
        return Ok(ClaimedChargeBackfill {
            vehicle_id,
            rivian_vehicle_id,
            encrypted_tokens,
        });
    }

    let current_status: Option<String> =
        sqlx::query_scalar("SELECT history_backfill_status FROM riviamigo.vehicles WHERE id = $1")
            .bind(vehicle_id)
            .fetch_optional(pool)
            .await?
            .flatten();

    if current_status.as_deref() == Some("running") {
        Err(ChargeBackfillError::AlreadyRunning)
    } else {
        Err(ChargeBackfillError::CredentialsNotFound)
    }
}

pub async fn run_claimed(
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
    claimed: ClaimedChargeBackfill,
) -> Result<usize, ChargeBackfillError> {
    let result = run_claimed_inner(pool, client, age_key, &claimed).await;
    match &result {
        Ok(count) => {
            sqlx::query(
                "UPDATE riviamigo.vehicles
                 SET history_backfill_status = 'done',
                     history_backfilled_at = now(),
                     history_session_count = $2,
                     updated_at = now()
                 WHERE id = $1",
            )
            .bind(claimed.vehicle_id)
            .bind(*count as i32)
            .execute(pool)
            .await?;
        }
        Err(error) => {
            tracing::warn!(
                vehicle_id = %claimed.vehicle_id,
                error = %error,
                "charge history backfill failed"
            );
            let _ = sqlx::query(
                "UPDATE riviamigo.vehicles
                 SET history_backfill_status = 'error',
                     updated_at = now()
                 WHERE id = $1",
            )
            .bind(claimed.vehicle_id)
            .execute(pool)
            .await;
        }
    }

    result
}

pub async fn run(
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
    vehicle_id: Uuid,
) -> Result<usize, ChargeBackfillError> {
    let claimed = claim(pool, vehicle_id).await?;
    run_claimed(pool, client, age_key, claimed).await
}

pub async fn spawn(
    pool: PgPool,
    age_key: String,
    vehicle_id: Uuid,
) -> Result<ChargeBackfillStart, ChargeBackfillError> {
    let claimed = claim(&pool, vehicle_id).await?;
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        match run_claimed(&pool, &client, &age_key, claimed).await {
            Ok(count) => {
                tracing::info!(vehicle_id=%vehicle_id, count, "charge history backfill complete");
            }
            Err(error) => {
                tracing::warn!(vehicle_id=%vehicle_id, error=%error, "charge history backfill task failed");
            }
        }
    });

    Ok(ChargeBackfillStart {
        ok: true,
        status: "running",
    })
}

async fn run_claimed_inner(
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
    claimed: &ClaimedChargeBackfill,
) -> Result<usize, ChargeBackfillError> {
    let identity = age_key
        .parse::<age::x25519::Identity>()
        .map_err(|e| anyhow::anyhow!("age key parse failed: {e}"))?;
    let tokens = session_store::decrypt_tokens(&claimed.encrypted_tokens, &identity)
        .map_err(|e| anyhow::anyhow!("token decrypt failed: {e}"))?;

    rivian_poll::fetch_charge_history_full(
        &claimed.rivian_vehicle_id,
        claimed.vehicle_id,
        pool,
        client,
        &tokens,
    )
    .await
    .map_err(ChargeBackfillError::Other)
}
