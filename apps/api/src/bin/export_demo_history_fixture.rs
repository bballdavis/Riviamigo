//! Export a privacy-safe aggregate profile for the bundled demo seeder.
//!
//! This command never serializes identifiers, timestamps, addresses, telemetry
//! values, or coordinates. It emits only counts and non-null coverage ratios.
//!
//! Usage:
//!   cargo run --bin export_demo_history_fixture -- <vehicle_uuid> <output.json>

use std::{env, path::PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::{postgres::PgPoolOptions, FromRow};
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct AggregateShape {
    telemetry_rows: i64,
    active_days: i64,
    location_rows: i64,
    battery_rows: i64,
    tire_rows: i64,
    door_rows: i64,
    outside_temperature_rows: i64,
}

#[derive(Debug, Serialize)]
struct FixtureCoverage {
    location: f64,
    battery: f64,
    tires: f64,
    doors: f64,
    outside_temperature: f64,
}

#[derive(Debug, Serialize)]
struct FixtureExport {
    schema_version: u32,
    source_model: &'static str,
    window_days: i64,
    telemetry_rows: i64,
    active_days: i64,
    trip_count: i64,
    charge_count: i64,
    weather_sample_count: i64,
    coverage: FixtureCoverage,
}

fn ratio(numerator: i64, denominator: i64) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        ((numerator as f64 / denominator as f64) * 1_000.0).round() / 1_000.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_fixture_is_strictly_aggregate_and_allowlisted() {
        let export = FixtureExport {
            schema_version: 1,
            source_model: "R1S",
            window_days: 14,
            telemetry_rows: 5_664,
            active_days: 12,
            trip_count: 31,
            charge_count: 4,
            weather_sample_count: 80,
            coverage: FixtureCoverage {
                location: 0.558,
                battery: 0.517,
                tires: 0.065,
                doors: 0.085,
                outside_temperature: 0.0,
            },
        };
        let value = serde_json::to_value(export).expect("aggregate fixture serializes");
        let object = value.as_object().expect("fixture object");
        let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "active_days",
                "charge_count",
                "coverage",
                "schema_version",
                "source_model",
                "telemetry_rows",
                "trip_count",
                "weather_sample_count",
                "window_days",
            ]
        );

        let json = serde_json::to_string(&value).unwrap().to_lowercase();
        for forbidden in [
            "vehicle_id",
            "vin",
            "account",
            "address",
            "latitude",
            "longitude",
            "coordinate",
            "raw_payload",
            "started_at",
            "2026-",
        ] {
            assert!(
                !json.contains(forbidden),
                "fixture leaked forbidden field {forbidden}"
            );
        }
    }

    #[test]
    fn coverage_ratio_is_bounded_and_rounded() {
        assert_eq!(ratio(1, 3), 0.333);
        assert_eq!(ratio(2, 0), 0.0);
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let vehicle_id = args
        .next()
        .context("usage: export_demo_history_fixture <vehicle_uuid> <output.json>")?
        .parse::<Uuid>()
        .context("vehicle_uuid must be a UUID")?;
    let output = PathBuf::from(
        args.next()
            .context("usage: export_demo_history_fixture <vehicle_uuid> <output.json>")?,
    );
    if args.next().is_some() {
        anyhow::bail!("usage: export_demo_history_fixture <vehicle_uuid> <output.json>");
    }

    let database_url = env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .context("connect to database")?;

    let shape = sqlx::query_as::<_, AggregateShape>(
        r#"SELECT
             count(*)::bigint AS telemetry_rows,
             count(DISTINCT date_trunc('day', ts))::bigint AS active_days,
             count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::bigint AS location_rows,
             count(*) FILTER (WHERE battery_level IS NOT NULL)::bigint AS battery_rows,
             count(*) FILTER (WHERE tire_fl_psi IS NOT NULL)::bigint AS tire_rows,
             count(*) FILTER (WHERE door_front_left_closed IS NOT NULL)::bigint AS door_rows,
             count(*) FILTER (WHERE outside_temp_c IS NOT NULL)::bigint AS outside_temperature_rows
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts>=now()-interval '14 days'"#,
    )
    .bind(vehicle_id)
    .fetch_one(&pool)
    .await?;

    let trip_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM riviamigo.trips WHERE vehicle_id=$1 AND started_at>=now()-interval '14 days'",
    )
    .bind(vehicle_id)
    .fetch_one(&pool)
    .await?;
    let charge_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at>=now()-interval '14 days'",
    )
    .bind(vehicle_id)
    .fetch_one(&pool)
    .await?;
    let weather_sample_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT count(*) FROM riviamigo.trip_weather_samples weather
           JOIN riviamigo.trips trip ON trip.id=weather.trip_id
           WHERE trip.vehicle_id=$1 AND trip.started_at>=now()-interval '14 days'"#,
    )
    .bind(vehicle_id)
    .fetch_one(&pool)
    .await?;

    let export = FixtureExport {
        schema_version: 1,
        source_model: "R1S",
        window_days: 14,
        telemetry_rows: shape.telemetry_rows,
        active_days: shape.active_days,
        trip_count,
        charge_count,
        weather_sample_count,
        coverage: FixtureCoverage {
            location: ratio(shape.location_rows, shape.telemetry_rows),
            battery: ratio(shape.battery_rows, shape.telemetry_rows),
            tires: ratio(shape.tire_rows, shape.telemetry_rows),
            doors: ratio(shape.door_rows, shape.telemetry_rows),
            outside_temperature: ratio(shape.outside_temperature_rows, shape.telemetry_rows),
        },
    };

    std::fs::write(&output, serde_json::to_vec_pretty(&export)?)
        .with_context(|| format!("write sanitized fixture to {}", output.display()))?;
    println!(
        "Wrote sanitized aggregate fixture: {} telemetry rows, {} trips, {} charges, {} weather samples",
        export.telemetry_rows, export.trip_count, export.charge_count, export.weather_sample_count
    );
    Ok(())
}
