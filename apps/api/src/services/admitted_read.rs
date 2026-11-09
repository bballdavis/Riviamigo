//! A heavy-read permit follows the database work, including cancellation.
use crate::{errors::AppError, services::resource_limits::ResourcePermit};
use sqlx::{Connection, PgConnection, PgPool, Postgres, Transaction};
use std::{
    ops::{Deref, DerefMut},
    time::Duration,
};

pub(crate) struct AdmittedRead {
    pool: PgPool,
    transaction: Option<Transaction<'static, Postgres>>,
    permit: Option<ResourcePermit>,
    backend_pid: Option<i32>,
}

impl AdmittedRead {
    pub(crate) async fn begin(
        pool: &PgPool,
        permit: ResourcePermit,
        timeout_seconds: u64,
    ) -> Result<Self, AppError> {
        let mut read = Self {
            pool: pool.clone(),
            transaction: None,
            permit: Some(permit),
            backend_pid: None,
        };
        read.transaction = Some(pool.begin().await?);
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *read)
            .await?;
        sqlx::query("SELECT set_config('statement_timeout', $1, true)")
            .bind(format!("{}ms", timeout_seconds.saturating_mul(1000)))
            .execute(&mut *read)
            .await?;
        read.backend_pid = Some(
            sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *read)
                .await?,
        );
        Ok(read)
    }

    pub(crate) async fn commit(mut self) -> Result<(), AppError> {
        let tx = self.transaction.take().expect("active read transaction");
        let permit = self.permit.take();
        // COMMIT and its permit also survive cancellation of their waiter.
        tokio::spawn(async move {
            let _permit = permit;
            tx.commit().await.map_err(AppError::from)
        })
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
    }
}

impl Deref for AdmittedRead {
    type Target = PgConnection;
    fn deref(&self) -> &Self::Target {
        self.transaction
            .as_deref()
            .expect("active read transaction")
    }
}

impl DerefMut for AdmittedRead {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.transaction
            .as_deref_mut()
            .expect("active read transaction")
    }
}

impl Drop for AdmittedRead {
    fn drop(&mut self) {
        let Some(tx) = self.transaction.take() else {
            return;
        };
        let permit = self.permit.take();
        let pool = self.pool.clone();
        let pid = self.backend_pid;
        tokio::spawn(async move {
            let _permit = permit;
            if let Some(pid) = pid {
                // Use a short-lived control connection: the main pool may be
                // occupied, or configured with a single connection in tests.
                // The retained transaction prevents this PID being reused.
                let cancelled = tokio::time::timeout(Duration::from_secs(5), async {
                    let mut control = PgConnection::connect_with(&pool.connect_options()).await?;
                    sqlx::query_scalar::<_, bool>("SELECT pg_cancel_backend($1)")
                        .bind(pid)
                        .fetch_one(&mut control)
                        .await?;
                    control.close().await
                })
                .await;
                if !matches!(cancelled, Ok(Ok(()))) {
                    tracing::warn!(
                        backend_pid = pid,
                        "heavy read cancellation failed; waiting for database deadline"
                    );
                }
            }
            // Rollback drains the pending server response. Keep admission
            // until that work has ended, even if the client has disconnected.
            if let Err(error) = tx.rollback().await {
                tracing::warn!(?error, "heavy read rollback failed");
            }
        });
    }
}
