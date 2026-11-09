//! Table data which can never be imported from a recovery archive. Keep dump
//! redaction, TOC filtering and post-migration sanitation on one policy.
pub const PROTECTED_TABLES: &[&str] = &[
    "vehicle_credentials",
    "external_connection_activity",
    "external_connection_settings",
    "system_config",
    "authentication_settings",
    "refresh_tokens",
    "session_families",
    "api_keys",
    "account_invitation_vehicles",
    "account_invitations",
    "vehicle_invites",
    "backup_restore_requests",
    "backup_artifacts",
    "backup_runs",
    "backup_settings",
];

pub fn skip_toc_entry(line: &str) -> bool {
    PROTECTED_TABLES
        .iter()
        .any(|table| line.contains(&format!(" TABLE DATA riviamigo {table} ")))
        || line.contains(" EXTENSION - ")
        || line.contains(" COMMENT - EXTENSION ")
        || line.contains(" SCHEMA - public ")
        || line.contains(" COMMENT - SCHEMA public ")
        || line.contains(" SCHEMA - riviamigo ")
        || line.contains(" COMMENT - SCHEMA riviamigo ")
}

pub async fn sanitize(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for table in PROTECTED_TABLES {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(format!("riviamigo.{table}"))
            .fetch_one(&mut *tx)
            .await?;
        if exists {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM riviamigo.\"{table}\""
            )))
            .execute(&mut *tx)
            .await?;
        }
    }
    sqlx::query("INSERT INTO riviamigo.authentication_settings (id) VALUES (TRUE)")
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_every_protected_data_entry_without_removing_schema() {
        for table in PROTECTED_TABLES {
            assert!(skip_toc_entry(&format!(
                "52; 0 12 TABLE DATA riviamigo {table} postgres"
            )));
            assert!(!skip_toc_entry(&format!(
                "52; 0 12 TABLE riviamigo {table} postgres"
            )));
        }
        assert!(!skip_toc_entry(
            "52; 0 12 TABLE DATA riviamigo vehicles postgres"
        ));
    }
}
