use sqlx::{Executor, PgPool};
use uuid::Uuid;

fn replace_database_name(url: &str, database_name: &str) -> String {
    let (prefix, _) = url
        .rsplit_once('/')
        .expect("database URL should contain a database name");
    format!("{prefix}/{database_name}")
}

#[tokio::test]
#[ignore = "requires a TimescaleDB DATABASE_URL with CREATEDB permission"]
async fn telemetry_minute_refresh_policy_is_hourly_and_real_time() {
    let base_db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://riviamigo:devpassword@127.0.0.1:5432/riviamigo".into());
    let admin_db_url = replace_database_name(&base_db_url, "postgres");
    let db_name = format!("riviamigo_cagg_policy_test_{}", Uuid::new_v4().simple());

    let admin = PgPool::connect(&admin_db_url)
        .await
        .expect("admin db connect");
    admin
        .execute(sqlx::AssertSqlSafe(format!(
            "CREATE DATABASE \"{db_name}\""
        )))
        .await
        .expect("create test database");

    let db_url = replace_database_name(&base_db_url, &db_name);
    let pool = PgPool::connect(&db_url).await.expect("test db connect");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("apply migrations");

    let policy: (i64, bool) = sqlx::query_as(
        "SELECT EXTRACT(EPOCH FROM j.schedule_interval)::int8, c.materialized_only \
         FROM timescaledb_information.jobs j \
         JOIN timescaledb_information.continuous_aggregates c \
           ON c.view_schema = j.hypertable_schema \
          AND c.view_name = j.hypertable_name \
         WHERE j.proc_name = 'policy_refresh_continuous_aggregate' \
           AND j.hypertable_schema = 'timeseries' \
           AND j.hypertable_name = 'telemetry_1min'",
    )
    .fetch_one(&pool)
    .await
    .expect("telemetry policy query");

    assert_eq!(policy.0, 60 * 60);
    assert!(!policy.1, "telemetry_1min must preserve its real-time tail");

    pool.close().await;
    admin
        .execute(sqlx::AssertSqlSafe(format!("DROP DATABASE \"{db_name}\"")))
        .await
        .expect("drop test database");
}
