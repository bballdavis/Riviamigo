use chrono::{DateTime, Duration, Timelike, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::errors::AppError;

const FIXTURE_JSON: &str = include_str!("../../fixtures/demo/history-v1.json");
const DEMO_OSM_ID_BASE: i64 = -9_100_000;
const DEMO_ACTIVE_DAY_OFFSETS: [i64; 12] = [0, 1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoFixtureSpec {
    pub schema_version: u32,
    pub source_model: String,
    pub window_days: i64,
    pub telemetry_rows: i64,
    pub active_days: i32,
    pub trip_count: i32,
    pub charge_count: i32,
    pub weather_sample_count: i32,
    pub coverage: DemoFixtureCoverage,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemoFixtureCoverage {
    pub location: f64,
    pub battery: f64,
    pub tires: f64,
    pub doors: f64,
    pub outside_temperature: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DemoSeedCounts {
    pub telemetry: i64,
    pub trips: i64,
    pub charges: i64,
    pub weather_samples: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DemoSeedSummary {
    pub seeded_at: DateTime<Utc>,
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    pub counts: DemoSeedCounts,
}

#[derive(Clone, Copy)]
struct DemoAddress {
    label: &'static str,
    road: &'static str,
    city: &'static str,
    latitude: f64,
    longitude: f64,
}

const DEMO_ADDRESSES: [DemoAddress; 4] = [
    DemoAddress {
        label: "Demo National Mall",
        road: "National Mall",
        city: "Washington",
        latitude: 38.8895,
        longitude: -77.0353,
    },
    DemoAddress {
        label: "Demo Arlington",
        road: "Memorial Avenue",
        city: "Arlington",
        latitude: 38.8816,
        longitude: -77.0910,
    },
    DemoAddress {
        label: "Demo Dulles",
        road: "Saarinen Circle",
        city: "Dulles",
        latitude: 38.9531,
        longitude: -77.4565,
    },
    DemoAddress {
        label: "Demo Great Falls",
        road: "Old Dominion Drive",
        city: "McLean",
        latitude: 38.9987,
        longitude: -77.2544,
    },
];

#[derive(Clone, Copy)]
struct ModelProfile {
    capacity_wh: f64,
    max_range_mi: f64,
    has_liftgate: bool,
    has_truck_closures: bool,
}

fn model_profile(model: &str) -> Result<ModelProfile, AppError> {
    match model {
        "R1S" => Ok(ModelProfile {
            capacity_wh: 135_000.0,
            max_range_mi: 260.0,
            has_liftgate: true,
            has_truck_closures: false,
        }),
        "R1T" => Ok(ModelProfile {
            capacity_wh: 135_000.0,
            max_range_mi: 248.0,
            has_liftgate: false,
            has_truck_closures: true,
        }),
        "R2S" => Ok(ModelProfile {
            capacity_wh: 82_000.0,
            max_range_mi: 300.0,
            has_liftgate: false,
            has_truck_closures: false,
        }),
        _ => Err(AppError::Validation(
            "model must be one of R1T, R1S, R2S".into(),
        )),
    }
}

pub fn load_fixture() -> Result<DemoFixtureSpec, AppError> {
    let fixture: DemoFixtureSpec = serde_json::from_str(FIXTURE_JSON)
        .map_err(|error| AppError::Validation(format!("demo fixture is invalid: {error}")))?;
    validate_fixture(&fixture)?;
    Ok(fixture)
}

pub fn validate_fixture(fixture: &DemoFixtureSpec) -> Result<(), AppError> {
    if fixture.schema_version != 1 {
        return Err(AppError::Validation(format!(
            "unsupported demo fixture schema version {}",
            fixture.schema_version
        )));
    }
    if fixture.source_model != "R1S" || fixture.window_days != 14 {
        return Err(AppError::Validation(
            "demo fixture must be a 14-day sanitized R1S profile".into(),
        ));
    }
    if !(1_000..=20_000).contains(&fixture.telemetry_rows)
        || !(7..=14).contains(&fixture.active_days)
        || !(10..=100).contains(&fixture.trip_count)
        || !(2..=20).contains(&fixture.charge_count)
        || fixture.weather_sample_count < fixture.trip_count
    {
        return Err(AppError::Validation(
            "demo fixture density is outside the approved bounds".into(),
        ));
    }
    for (name, value) in [
        ("location", fixture.coverage.location),
        ("battery", fixture.coverage.battery),
        ("tires", fixture.coverage.tires),
        ("doors", fixture.coverage.doors),
        ("outside_temperature", fixture.coverage.outside_temperature),
    ] {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(AppError::Validation(format!(
                "demo fixture coverage '{name}' must be between zero and one"
            )));
        }
    }
    Ok(())
}

pub async fn seed_demo_vehicle(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
    model: &str,
    anchor: DateTime<Utc>,
) -> Result<DemoSeedSummary, AppError> {
    let fixture = load_fixture()?;
    let profile = model_profile(model)?;
    let anchor = anchor.with_nanosecond(0).unwrap_or(anchor);
    let window_start = anchor - Duration::days(fixture.window_days);

    clear_seeded_history(tx, vehicle_id).await?;
    let address_ids = ensure_demo_addresses(tx).await?;
    seed_trips(
        tx,
        vehicle_id,
        anchor,
        fixture.trip_count,
        fixture.weather_sample_count,
        &address_ids,
    )
    .await?;
    seed_charges(tx, vehicle_id, anchor, fixture.charge_count, &address_ids).await?;
    seed_telemetry(tx, vehicle_id, anchor, &fixture, profile).await?;
    seed_state_periods(tx, vehicle_id).await?;
    seed_software_history(tx, vehicle_id, anchor).await?;
    seed_latest_status(tx, vehicle_id, model, anchor, profile).await?;

    let counts = read_seed_counts(tx, vehicle_id).await?;
    if counts.telemetry != fixture.telemetry_rows
        || counts.trips != i64::from(fixture.trip_count)
        || counts.charges != i64::from(fixture.charge_count)
        || counts.weather_samples != i64::from(fixture.weather_sample_count)
    {
        return Err(AppError::Validation(format!(
            "demo seed count mismatch: telemetry={}, trips={}, charges={}, weather={}",
            counts.telemetry, counts.trips, counts.charges, counts.weather_samples
        )));
    }

    Ok(DemoSeedSummary {
        seeded_at: anchor,
        window_start,
        window_end: anchor,
        counts,
    })
}

async fn clear_seeded_history(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    for statement in [
        "DELETE FROM timeseries.telemetry WHERE vehicle_id = $1",
        "DELETE FROM riviamigo.vehicle_state_periods WHERE vehicle_id = $1",
        "DELETE FROM riviamigo.rivian_charge_curve_points WHERE vehicle_id = $1",
        "DELETE FROM riviamigo.trips WHERE vehicle_id = $1",
        "DELETE FROM riviamigo.charge_sessions WHERE vehicle_id = $1",
        "DELETE FROM riviamigo.software_versions WHERE vehicle_id = $1",
        "DELETE FROM riviamigo.vehicle_images WHERE vehicle_id = $1",
    ] {
        sqlx::query(statement)
            .bind(vehicle_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

async fn ensure_demo_addresses(tx: &mut Transaction<'_, Postgres>) -> Result<Vec<Uuid>, AppError> {
    let mut ids = Vec::with_capacity(DEMO_ADDRESSES.len());
    for (index, address) in DEMO_ADDRESSES.iter().enumerate() {
        let osm_id = DEMO_OSM_ID_BASE - index as i64;
        let id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO riviamigo.addresses
                 (display_name, osm_id, latitude, longitude, road, city, state, country, raw)
               VALUES ($1, $2, $3, $4, $5, $6, 'DC', 'US',
                       jsonb_build_object('source', 'riviamigo_demo_fixture', 'fixture_version', 1))
               ON CONFLICT (osm_id) DO UPDATE
               SET display_name = EXCLUDED.display_name,
                   latitude = EXCLUDED.latitude,
                   longitude = EXCLUDED.longitude,
                   road = EXCLUDED.road,
                   city = EXCLUDED.city,
                   state = EXCLUDED.state,
                   country = EXCLUDED.country,
                   raw = EXCLUDED.raw
               RETURNING id"#,
        )
        .bind(address.label)
        .bind(osm_id)
        .bind(address.latitude)
        .bind(address.longitude)
        .bind(address.road)
        .bind(address.city)
        .fetch_one(&mut **tx)
        .await?;
        ids.push(id);
    }
    Ok(ids)
}

async fn seed_trips(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
    anchor: DateTime<Utc>,
    trip_count: i32,
    weather_sample_count: i32,
    address_ids: &[Uuid],
) -> Result<(), AppError> {
    let mut remaining_weather = weather_sample_count;
    for index in 0..trip_count {
        let route = index as usize % DEMO_ADDRESSES.len();
        let destination = (route + 1) % DEMO_ADDRESSES.len();
        let day_slot = index as usize % DEMO_ACTIVE_DAY_OFFSETS.len();
        let occurrence = index as usize / DEMO_ACTIVE_DAY_OFFSETS.len();
        let started_at = anchor - Duration::days(14)
            + Duration::days(DEMO_ACTIVE_DAY_OFFSETS[day_slot])
            + Duration::hours(8 + occurrence as i64 * 5);
        let duration_minutes = 18 + (index % 5) * 7;
        let ended_at = started_at + Duration::minutes(i64::from(duration_minutes));
        let start = DEMO_ADDRESSES[route];
        let end = DEMO_ADDRESSES[destination];
        let mid_lat = (start.latitude + end.latitude) / 2.0 + 0.006;
        let mid_lng = (start.longitude + end.longitude) / 2.0 - 0.004;
        let distance_miles = 4.5 + f64::from(index % 7) * 3.1;
        let efficiency = 330.0 + f64::from(index % 6) * 28.0;
        let soc_start = 82.0 - f64::from(index % 8) * 5.0;
        let soc_end = (soc_start - (distance_miles / 3.2)).max(18.0);
        let outside_temp = 8.0 + f64::from(index % 9) * 2.2;
        let drive_mode = ["all_purpose", "conserve", "sport", "snow"][index as usize % 4];
        let route_preview = serde_json::json!([
            [start.longitude, start.latitude],
            [mid_lng, mid_lat],
            [end.longitude, end.latitude]
        ]);

        let trip_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO riviamigo.trips
                 (vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng,
                  distance_miles, duration_seconds, soc_start, soc_end, efficiency_wh_per_mile,
                  max_speed_mph, drive_mode, outside_temp_c, avg_speed_mph, energy_wh, regen_wh,
                  elevation_gain_m, elevation_loss_m, inside_temp_avg_c, start_odometer_mi,
                  end_odometer_mi, start_position_ts, end_position_ts, start_address_id,
                  end_address_id, power_max_kw, power_min_kw, range_start_mi, range_end_mi,
                  energy_strategy, route_preview, route_preview_version, outside_temp_source)
               VALUES
                 ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                  $19,$20,$21,$22,$23,$2,$3,$24,$25,$26,$27,$28,$29,'telemetry_delta',$30,1,'open_meteo')
               RETURNING id"#,
        )
        .bind(vehicle_id)
        .bind(started_at)
        .bind(ended_at)
        .bind(start.latitude)
        .bind(start.longitude)
        .bind(end.latitude)
        .bind(end.longitude)
        .bind(distance_miles)
        .bind(duration_minutes * 60)
        .bind(soc_start)
        .bind(soc_end)
        .bind(efficiency)
        .bind(45.0 + f64::from(index % 5) * 4.0)
        .bind(drive_mode)
        .bind(outside_temp)
        .bind(distance_miles / (f64::from(duration_minutes) / 60.0))
        .bind(distance_miles * efficiency)
        .bind(distance_miles * efficiency * 0.12)
        .bind(18.0 + f64::from(index % 6) * 12.0)
        .bind(12.0 + f64::from(index % 4) * 9.0)
        .bind(20.5 + f64::from(index % 5) * 0.6)
        .bind(15_000.0 + f64::from(index) * 11.0)
        .bind(15_000.0 + f64::from(index) * 11.0 + distance_miles)
        .bind(address_ids[route])
        .bind(address_ids[destination])
        .bind(70.0 + f64::from(index % 5) * 8.0)
        .bind(-28.0 - f64::from(index % 4) * 5.0)
        .bind(245.0 - f64::from(index % 8) * 11.0)
        .bind(235.0 - f64::from(index % 8) * 11.0)
        .bind(route_preview)
        .fetch_one(&mut **tx)
        .await?;

        let trips_left = trip_count - index;
        let samples_for_trip = (remaining_weather / trips_left).max(1);
        remaining_weather -= samples_for_trip;
        for sample_index in 0..samples_for_trip {
            let fraction = if samples_for_trip == 1 {
                0.5
            } else {
                f64::from(sample_index) / f64::from(samples_for_trip - 1)
            };
            let elapsed_seconds = (f64::from(duration_minutes * 60) * fraction).round() as i32;
            let sampled_at = started_at + Duration::seconds(i64::from(elapsed_seconds));
            let latitude = start.latitude + (end.latitude - start.latitude) * fraction;
            let longitude = start.longitude + (end.longitude - start.longitude) * fraction;
            sqlx::query(
                r#"INSERT INTO riviamigo.trip_weather_samples
                     (trip_id, sampled_at, elapsed_seconds, provider_latitude,
                      provider_longitude, temperature_c, source)
                   VALUES ($1,$2,$3,$4,$5,$6,'open_meteo')"#,
            )
            .bind(trip_id)
            .bind(sampled_at)
            .bind(elapsed_seconds)
            .bind(latitude)
            .bind(longitude)
            .bind(outside_temp + fraction * 1.8)
            .execute(&mut **tx)
            .await?;
        }

        sqlx::query(
            r#"INSERT INTO riviamigo.weather_enrichment_jobs
                 (trip_id, status, attempts, next_attempt_at, completed_at, updated_at)
               VALUES ($1, 'succeeded', 1, $2, $2, $2)"#,
        )
        .bind(trip_id)
        .bind(anchor)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn seed_charges(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
    anchor: DateTime<Utc>,
    charge_count: i32,
    address_ids: &[Uuid],
) -> Result<(), AppError> {
    let day_offsets = [12_i64, 8, 4, 1];
    let durations = [180_i32, 115, 46, 135];
    let types = [Some("ac"), Some("ac"), Some("dc"), None];
    for index in 0..charge_count {
        let slot = index as usize % day_offsets.len();
        let started_at = anchor - Duration::days(day_offsets[slot]) + Duration::hours(2);
        let duration = durations[slot];
        let ended_at = started_at + Duration::minutes(i64::from(duration));
        let soc_start = 31.0 + f64::from(index) * 7.0;
        let soc_end = if types[slot] == Some("dc") {
            82.0
        } else {
            (soc_start + 24.0).min(90.0)
        };
        let kwh_added = 18.0 + f64::from(index) * 7.5;
        let max_rate = if types[slot] == Some("dc") {
            186.0
        } else {
            11.2
        };
        let charge_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO riviamigo.charge_sessions
                 (vehicle_id, started_at, ended_at, location_lat, location_lng, is_home,
                  charger_type, kwh_added, soc_start, soc_end, charge_limit, max_charge_rate_kw,
                  duration_minutes, cost_usd, outside_temp_c, energy_added_wh, energy_used_wh,
                  avg_charge_rate_kw, address_id, network_vendor, is_free_session,
                  is_rivian_network, source, currency_code, data_confidence)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,85,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                       FALSE,$20,'telemetry','USD','telemetry') RETURNING id"#,
        )
        .bind(vehicle_id)
        .bind(started_at)
        .bind(ended_at)
        .bind(DEMO_ADDRESSES[slot].latitude)
        .bind(DEMO_ADDRESSES[slot].longitude)
        .bind(slot < 2)
        .bind(types[slot])
        .bind(kwh_added)
        .bind(soc_start)
        .bind(soc_end)
        .bind(max_rate)
        .bind(duration)
        .bind(kwh_added * if slot < 2 { 0.16 } else { 0.38 })
        .bind(11.0 + f64::from(index) * 3.0)
        .bind(kwh_added * 1_000.0)
        .bind(kwh_added * 1_045.0)
        .bind(kwh_added / (f64::from(duration) / 60.0))
        .bind(address_ids[slot])
        .bind(if types[slot] == Some("dc") {
            Some("Demo Adventure Network")
        } else {
            None
        })
        .bind(types[slot] == Some("dc"))
        .fetch_one(&mut **tx)
        .await?;

        if types[slot] == Some("dc") {
            for point in 0..=24 {
                let fraction = f64::from(point) / 24.0;
                let power_kw = 186.0 - fraction.powf(1.7) * 118.0;
                sqlx::query(
                    "INSERT INTO riviamigo.rivian_charge_curve_points
                       (vehicle_id, charge_session_id, ts, power_kw, captured_at)
                     VALUES ($1,$2,$3,$4,$5)",
                )
                .bind(vehicle_id)
                .bind(charge_id)
                .bind(started_at + Duration::seconds((fraction * f64::from(duration * 60)) as i64))
                .bind(power_kw)
                .bind(anchor)
                .execute(&mut **tx)
                .await?;
            }
        }
    }
    Ok(())
}

async fn seed_telemetry(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
    anchor: DateTime<Utc>,
    fixture: &DemoFixtureSpec,
    profile: ModelProfile,
) -> Result<(), AppError> {
    let samples_per_day = fixture.telemetry_rows / i64::from(fixture.active_days);
    if samples_per_day * i64::from(fixture.active_days) != fixture.telemetry_rows {
        return Err(AppError::Validation(
            "demo telemetry row count must divide evenly across active days".into(),
        ));
    }
    let location_cutoff = (fixture.coverage.location * 1_000.0).round() as i64;
    let battery_cutoff = (fixture.coverage.battery * 1_000.0).round() as i64;
    let tire_cutoff = (fixture.coverage.tires * 1_000.0).round() as i64;
    let door_cutoff = (fixture.coverage.doors * 1_000.0).round() as i64;

    for (day_index, day_offset) in DEMO_ACTIVE_DAY_OFFSETS.iter().enumerate() {
        let result = sqlx::query(
        r#"WITH active_days(day_offset) AS (
               SELECT $13::int
             ), samples AS (
               SELECT row_number() OVER (ORDER BY s.sample_no) - 1 + ($14::bigint * $3::bigint) AS sample_index,
                      $2::timestamptz - interval '14 days'
                        + make_interval(days => d.day_offset)
                        + make_interval(secs => (s.sample_no * 86400.0 / $3::float8)) AS ts
               FROM active_days d
               CROSS JOIN generate_series(0, $3::int - 1) AS s(sample_no)
             ), linked AS (
               SELECT samples.*,
                      tr.id AS trip_id, tr.started_at AS trip_start, tr.ended_at AS trip_end,
                      tr.start_lat, tr.start_lng, tr.end_lat, tr.end_lng, tr.drive_mode,
                      cs.id AS charge_session_id, cs.started_at AS charge_start,
                      cs.ended_at AS charge_end, cs.charger_type
               FROM samples
               LEFT JOIN LATERAL (
                 SELECT id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng, drive_mode
                 FROM riviamigo.trips
                 WHERE vehicle_id=$1 AND samples.ts BETWEEN started_at AND ended_at
                 ORDER BY started_at LIMIT 1
               ) tr ON TRUE
               LEFT JOIN LATERAL (
                 SELECT id, started_at, ended_at, charger_type
                 FROM riviamigo.charge_sessions
                 WHERE vehicle_id=$1 AND samples.ts BETWEEN started_at AND ended_at
                 ORDER BY started_at LIMIT 1
               ) cs ON TRUE
             )
             INSERT INTO timeseries.telemetry
               (ts, vehicle_id, latitude, longitude, altitude_m, speed_mph,
                battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
                power_state, charger_state, charger_status, time_to_end_of_charge_min,
                drive_mode, gear_status, cabin_temp_c, driver_temp_c, odometer_miles,
                hv_thermal_event, twelve_volt_health, is_online, heading_deg, outside_temp_c,
                hvac_active, power_kw, regen_power_kw,
                tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
                tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
                door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
                door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
                closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
                closure_tailgate_locked, closure_tailgate_closed, ota_current_version, ota_status,
                trip_id, charge_session_id, charge_port_open, charger_derate_active,
                cabin_precon_status, cabin_precon_type, pet_mode_active, pet_mode_temp_ok,
                defrost_active, steering_wheel_heat, seat_fl_heat, seat_fr_heat, seat_rl_heat,
                seat_rr_heat, seat_fl_vent, seat_fr_vent, tonneau_locked, tonneau_closed,
                side_bin_left_locked, side_bin_right_locked, window_fl_closed, window_fr_closed,
                window_rl_closed, window_rr_closed, gear_guard_locked, gear_guard_video_status,
                wiper_fluid_low, brake_fluid_low, alarm_active, service_mode,
                tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
                side_bin_left_closed, side_bin_right_closed)
             SELECT
               l.ts, $1,
               CASE WHEN l.trip_id IS NOT NULL THEN
                 l.start_lat + (l.end_lat-l.start_lat) *
                   (extract(epoch FROM (l.ts-l.trip_start)) / NULLIF(extract(epoch FROM (l.trip_end-l.trip_start)),0))
                 WHEN mod(l.sample_index,1000) < $4 THEN 38.8895 + mod(l.sample_index,17)::float8/100000.0 END,
               CASE WHEN l.trip_id IS NOT NULL THEN
                 l.start_lng + (l.end_lng-l.start_lng) *
                   (extract(epoch FROM (l.ts-l.trip_start)) / NULLIF(extract(epoch FROM (l.trip_end-l.trip_start)),0))
                 WHEN mod(l.sample_index,1000) < $4 THEN -77.0353 - mod(l.sample_index,19)::float8/100000.0 END,
               CASE WHEN l.trip_id IS NOT NULL OR mod(l.sample_index,1000) < $4
                    THEN 8.0 + mod(l.sample_index,70)::float8 END,
               CASE WHEN l.trip_id IS NOT NULL THEN 18.0 + mod(l.sample_index,47)::float8 ELSE 0.0 END,
               CASE WHEN mod(l.sample_index,1000) < $5
                    THEN 85.0 - (l.sample_index::float8 / GREATEST($8::float8-1,1)) * 17.0 END,
               CASE WHEN mod(l.sample_index,1000) < $5
                    THEN $9::float8 * (0.996 - (l.sample_index::float8 / GREATEST($8::float8-1,1)) * 0.006) END,
               CASE WHEN mod(l.sample_index,1000) < $5
                    THEN $10::float8 * ((85.0 - (l.sample_index::float8 / GREATEST($8::float8-1,1)) * 17.0) / 100.0) END,
               85.0,
               CASE WHEN l.trip_id IS NOT NULL THEN 'drive'
                    WHEN l.charge_session_id IS NOT NULL THEN 'charging'
                    WHEN mod(l.sample_index,7)=0 THEN 'sleep' ELSE 'ready' END,
               CASE WHEN l.charge_session_id IS NOT NULL THEN 'Charging' ELSE 'Disconnected' END,
               CASE WHEN l.charge_session_id IS NOT NULL THEN 'chrgr_sts_connected_charging'
                    ELSE 'chrgr_sts_not_connected' END,
               CASE WHEN l.charge_session_id IS NOT NULL
                    THEN GREATEST(0, ceil(extract(epoch FROM (l.charge_end-l.ts))/60.0)::int) END,
               CASE WHEN l.trip_id IS NOT NULL THEN l.drive_mode END,
               CASE WHEN l.trip_id IS NOT NULL THEN 'drive' ELSE 'park' END,
               CASE WHEN mod(l.sample_index,13) < 8 THEN 20.0 + mod(l.sample_index,42)::float8/10.0 END,
               CASE WHEN mod(l.sample_index,17) < 10 THEN 19.0 + mod(l.sample_index,35)::float8/10.0 END,
               CASE WHEN mod(l.sample_index,1000) < $5 THEN 15000.0 + l.sample_index::float8 * 0.011 END,
               CASE WHEN mod(l.sample_index,181)=0 THEN 'none' END,
               CASE WHEN mod(l.sample_index,173)=0 THEN 'normal' END,
               TRUE,
               CASE WHEN l.trip_id IS NOT NULL THEN mod(l.sample_index*17,360)::float8 END,
               NULL::float8,
               CASE WHEN mod(l.sample_index,23)=0 THEN TRUE END,
               CASE WHEN l.trip_id IS NOT NULL THEN 16.0 + mod(l.sample_index,55)::float8 END,
               CASE WHEN l.trip_id IS NOT NULL AND mod(l.sample_index,11)=0 THEN 6.0 + mod(l.sample_index,18)::float8 END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 47.5 + mod(l.sample_index,18)::float8/10.0 END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 47.6 + mod(l.sample_index,19)::float8/10.0 END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 49.0 + mod(l.sample_index,17)::float8/10.0 END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 49.1 + mod(l.sample_index,16)::float8/10.0 END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 'normal' END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 'normal' END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 'normal' END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN 'normal' END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $11::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $11::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,100)=0 THEN '2026.18.0' END,
               CASE WHEN mod(l.sample_index,100)=0 THEN 'idle' END,
               l.trip_id, l.charge_session_id,
               CASE WHEN l.charge_session_id IS NOT NULL THEN TRUE ELSE FALSE END,
               CASE WHEN mod(l.sample_index,211)=0 THEN FALSE END,
               CASE WHEN mod(l.sample_index,191)=0 THEN 'off' END,
               CASE WHEN mod(l.sample_index,191)=0 THEN 'none' END,
               CASE WHEN mod(l.sample_index,223)=0 THEN FALSE END,
               CASE WHEN mod(l.sample_index,223)=0 THEN TRUE END,
               CASE WHEN mod(l.sample_index,229)=0 THEN FALSE END,
               CASE WHEN mod(l.sample_index,227)=0 THEN 0 END,
               CASE WHEN mod(l.sample_index,233)=0 THEN 0 END,
               CASE WHEN mod(l.sample_index,239)=0 THEN 0 END,
               CASE WHEN mod(l.sample_index,241)=0 THEN 0 END,
               CASE WHEN mod(l.sample_index,251)=0 THEN 0 END,
               CASE WHEN mod(l.sample_index,257)=0 THEN 0 END,
               CASE WHEN mod(l.sample_index,263)=0 THEN 0 END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN mod(l.sample_index,269)=0 THEN TRUE END,
               CASE WHEN mod(l.sample_index,269)=0 THEN 'idle' END,
               CASE WHEN mod(l.sample_index,271)=0 THEN FALSE END,
               CASE WHEN mod(l.sample_index,277)=0 THEN FALSE END,
               CASE WHEN mod(l.sample_index,281)=0 THEN FALSE END,
               CASE WHEN mod(l.sample_index,283)=0 THEN FALSE END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN TRUE END,
               CASE WHEN mod(l.sample_index,1000) < $6 THEN TRUE END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END,
               CASE WHEN $12::bool AND mod(l.sample_index,1000) < $7 THEN TRUE END
             FROM linked l"#,
    )
    .bind(vehicle_id)
    .bind(anchor)
    .bind(samples_per_day as i32)
    .bind(location_cutoff)
    .bind(battery_cutoff)
    .bind(tire_cutoff)
    .bind(door_cutoff)
    .bind(fixture.telemetry_rows)
    .bind(profile.capacity_wh)
    .bind(profile.max_range_mi)
    .bind(profile.has_liftgate)
    .bind(profile.has_truck_closures)
    .bind(*day_offset as i32)
    .bind(day_index as i64)
    .execute(&mut **tx)
    .await?;
        if result.rows_affected() != samples_per_day as u64 {
            return Err(AppError::Validation(format!(
                "demo telemetry batch {day_index} inserted {} rows instead of {samples_per_day}",
                result.rows_affected()
            )));
        }
    }
    Ok(())
}

async fn seed_state_periods(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        r#"WITH anchors AS (
             SELECT started_at, ended_at, 'drive'::text AS state
             FROM riviamigo.trips WHERE vehicle_id=$1
             UNION ALL
             SELECT started_at, ended_at, 'charging'::text AS state
             FROM riviamigo.charge_sessions WHERE vehicle_id=$1
           ), ordered AS (
             SELECT *, lag(ended_at) OVER (ORDER BY started_at) AS previous_end
             FROM anchors
           ), periods AS (
             SELECT state, started_at, ended_at FROM ordered
             UNION ALL
             SELECT 'sleep', previous_end, started_at - interval '45 minutes' FROM ordered
             WHERE previous_end IS NOT NULL AND started_at > previous_end + interval '45 minutes'
             UNION ALL
             SELECT 'ready', GREATEST(previous_end, started_at - interval '45 minutes'), started_at
             FROM ordered
             WHERE previous_end IS NOT NULL AND started_at > previous_end
           )
           INSERT INTO riviamigo.vehicle_state_periods (vehicle_id, state, started_at, ended_at)
           SELECT $1, state, started_at, ended_at FROM periods
           WHERE ended_at > started_at ORDER BY started_at"#,
    )
    .bind(vehicle_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn seed_software_history(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
    anchor: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO riviamigo.software_versions
             (vehicle_id, version, installed_at, observed_until)
           VALUES
             ($1, '2026.10.0', $2 - interval '120 days', $2 - interval '45 days'),
             ($1, '2026.14.0', $2 - interval '45 days', $2 - interval '14 days'),
             ($1, '2026.18.0', $2 - interval '14 days', NULL)"#,
    )
    .bind(vehicle_id)
    .bind(anchor)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn seed_latest_status(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
    model: &str,
    anchor: DateTime<Utc>,
    profile: ModelProfile,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_latest_status
             (vehicle_id, ts, battery_level, battery_capacity_wh, distance_to_empty_mi,
              battery_limit, power_state, charger_state, charger_state_ts, charger_status,
              time_to_end_of_charge_min, drive_mode, gear_status, altitude_m, speed_mph,
              cabin_temp_c, driver_temp_c, heading_deg, odometer_miles,
              tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
              tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
              tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
              door_front_left_locked, door_front_right_locked, door_rear_left_locked,
              door_rear_right_locked, door_front_left_closed, door_front_right_closed,
              door_rear_left_closed, door_rear_right_closed, closure_frunk_locked,
              closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
              closure_tailgate_locked, closure_tailgate_closed, ota_current_version,
              ota_status, ota_current_status, hv_thermal_event, twelve_volt_health,
              charge_port_open, charger_derate_active, cabin_precon_status,
              cabin_precon_type, pet_mode_active, pet_mode_temp_ok, defrost_active,
              steering_wheel_heat, seat_fl_heat, seat_fr_heat, seat_rl_heat, seat_rr_heat,
              seat_fl_vent, seat_fr_vent, tonneau_locked, tonneau_closed,
              side_bin_left_locked, side_bin_right_locked, side_bin_left_closed,
              side_bin_right_closed, window_fl_closed, window_fr_closed, window_rl_closed,
              window_rr_closed, gear_guard_locked, gear_guard_video_status,
              wiper_fluid_low, brake_fluid_low, alarm_active, service_mode, updated_at)
           VALUES
             ($1,$2,68,$3,$4,85,'ready','Connected',$2,'chrgr_sts_connected_no_chrg',NULL,
              'all_purpose','park',18,0,22.1,21.0,118,15062,
              48.1,48.0,49.8,49.7,'normal','normal','normal','normal',
              TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,
              TRUE,TRUE,
              CASE WHEN $5::bool THEN TRUE END, CASE WHEN $5::bool THEN TRUE END,
              CASE WHEN $6::bool THEN TRUE END, CASE WHEN $6::bool THEN TRUE END,
              '2026.18.0','idle','up_to_date','none','normal',
              TRUE,FALSE,'off','none',FALSE,TRUE,FALSE,0,0,0,0,0,0,0,
              CASE WHEN $6::bool THEN TRUE END, CASE WHEN $6::bool THEN TRUE END,
              CASE WHEN $6::bool THEN TRUE END, CASE WHEN $6::bool THEN TRUE END,
              CASE WHEN $6::bool THEN TRUE END, CASE WHEN $6::bool THEN TRUE END,
              TRUE,TRUE,TRUE,TRUE,TRUE,'idle',FALSE,FALSE,FALSE,FALSE,$2)
           ON CONFLICT (vehicle_id) DO UPDATE SET
             ts=EXCLUDED.ts, battery_level=EXCLUDED.battery_level,
             battery_capacity_wh=EXCLUDED.battery_capacity_wh,
             distance_to_empty_mi=EXCLUDED.distance_to_empty_mi,
             battery_limit=EXCLUDED.battery_limit, power_state=EXCLUDED.power_state,
             charger_state=EXCLUDED.charger_state, charger_state_ts=EXCLUDED.charger_state_ts,
             charger_status=EXCLUDED.charger_status, time_to_end_of_charge_min=EXCLUDED.time_to_end_of_charge_min,
             drive_mode=EXCLUDED.drive_mode, gear_status=EXCLUDED.gear_status,
             altitude_m=EXCLUDED.altitude_m, speed_mph=EXCLUDED.speed_mph,
             cabin_temp_c=EXCLUDED.cabin_temp_c, driver_temp_c=EXCLUDED.driver_temp_c,
             heading_deg=EXCLUDED.heading_deg, odometer_miles=EXCLUDED.odometer_miles,
             tire_fl_psi=EXCLUDED.tire_fl_psi, tire_fr_psi=EXCLUDED.tire_fr_psi,
             tire_rl_psi=EXCLUDED.tire_rl_psi, tire_rr_psi=EXCLUDED.tire_rr_psi,
             tire_fl_status=EXCLUDED.tire_fl_status, tire_fr_status=EXCLUDED.tire_fr_status,
             tire_rl_status=EXCLUDED.tire_rl_status, tire_rr_status=EXCLUDED.tire_rr_status,
             tire_fl_valid=EXCLUDED.tire_fl_valid, tire_fr_valid=EXCLUDED.tire_fr_valid,
             tire_rl_valid=EXCLUDED.tire_rl_valid, tire_rr_valid=EXCLUDED.tire_rr_valid,
             door_front_left_locked=EXCLUDED.door_front_left_locked,
             door_front_right_locked=EXCLUDED.door_front_right_locked,
             door_rear_left_locked=EXCLUDED.door_rear_left_locked,
             door_rear_right_locked=EXCLUDED.door_rear_right_locked,
             door_front_left_closed=EXCLUDED.door_front_left_closed,
             door_front_right_closed=EXCLUDED.door_front_right_closed,
             door_rear_left_closed=EXCLUDED.door_rear_left_closed,
             door_rear_right_closed=EXCLUDED.door_rear_right_closed,
             closure_frunk_locked=EXCLUDED.closure_frunk_locked,
             closure_frunk_closed=EXCLUDED.closure_frunk_closed,
             closure_liftgate_locked=EXCLUDED.closure_liftgate_locked,
             closure_liftgate_closed=EXCLUDED.closure_liftgate_closed,
             closure_tailgate_locked=EXCLUDED.closure_tailgate_locked,
             closure_tailgate_closed=EXCLUDED.closure_tailgate_closed,
             ota_current_version=EXCLUDED.ota_current_version, ota_status=EXCLUDED.ota_status,
             ota_current_status=EXCLUDED.ota_current_status,
             hv_thermal_event=EXCLUDED.hv_thermal_event, twelve_volt_health=EXCLUDED.twelve_volt_health,
             charge_port_open=EXCLUDED.charge_port_open,
             charger_derate_active=EXCLUDED.charger_derate_active,
             cabin_precon_status=EXCLUDED.cabin_precon_status,
             cabin_precon_type=EXCLUDED.cabin_precon_type,
             pet_mode_active=EXCLUDED.pet_mode_active, pet_mode_temp_ok=EXCLUDED.pet_mode_temp_ok,
             defrost_active=EXCLUDED.defrost_active, steering_wheel_heat=EXCLUDED.steering_wheel_heat,
             seat_fl_heat=EXCLUDED.seat_fl_heat, seat_fr_heat=EXCLUDED.seat_fr_heat,
             seat_rl_heat=EXCLUDED.seat_rl_heat, seat_rr_heat=EXCLUDED.seat_rr_heat,
             seat_fl_vent=EXCLUDED.seat_fl_vent, seat_fr_vent=EXCLUDED.seat_fr_vent,
             tonneau_locked=EXCLUDED.tonneau_locked, tonneau_closed=EXCLUDED.tonneau_closed,
             side_bin_left_locked=EXCLUDED.side_bin_left_locked,
             side_bin_right_locked=EXCLUDED.side_bin_right_locked,
             side_bin_left_closed=EXCLUDED.side_bin_left_closed,
             side_bin_right_closed=EXCLUDED.side_bin_right_closed,
             window_fl_closed=EXCLUDED.window_fl_closed, window_fr_closed=EXCLUDED.window_fr_closed,
             window_rl_closed=EXCLUDED.window_rl_closed, window_rr_closed=EXCLUDED.window_rr_closed,
             gear_guard_locked=EXCLUDED.gear_guard_locked,
             gear_guard_video_status=EXCLUDED.gear_guard_video_status,
             wiper_fluid_low=EXCLUDED.wiper_fluid_low, brake_fluid_low=EXCLUDED.brake_fluid_low,
             alarm_active=EXCLUDED.alarm_active, service_mode=EXCLUDED.service_mode,
             updated_at=EXCLUDED.updated_at"#,
    )
    .bind(vehicle_id)
    .bind(anchor)
    .bind(profile.capacity_wh)
    .bind(profile.max_range_mi * 0.68)
    .bind(profile.has_liftgate)
    .bind(profile.has_truck_closures)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
             (vehicle_id, is_online, last_event_at, worker_health, worker_health_msg, updated_at)
           VALUES ($1, FALSE, $2, 'passive', $3, $2)
           ON CONFLICT (vehicle_id) DO UPDATE SET
             is_online=FALSE, last_event_at=EXCLUDED.last_event_at,
             worker_health=EXCLUDED.worker_health,
             worker_health_msg=EXCLUDED.worker_health_msg, updated_at=EXCLUDED.updated_at"#,
    )
    .bind(vehicle_id)
    .bind(anchor)
    .bind(format!("Demo {model} data through {}", anchor.date_naive()))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn read_seed_counts(
    tx: &mut Transaction<'_, Postgres>,
    vehicle_id: Uuid,
) -> Result<DemoSeedCounts, AppError> {
    let telemetry = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM timeseries.telemetry WHERE vehicle_id=$1",
    )
    .bind(vehicle_id)
    .fetch_one(&mut **tx)
    .await?;
    let trips =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM riviamigo.trips WHERE vehicle_id=$1")
            .bind(vehicle_id)
            .fetch_one(&mut **tx)
            .await?;
    let charges = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM riviamigo.charge_sessions WHERE vehicle_id=$1",
    )
    .bind(vehicle_id)
    .fetch_one(&mut **tx)
    .await?;
    let weather_samples = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM riviamigo.trip_weather_samples tw
         JOIN riviamigo.trips t ON t.id=tw.trip_id WHERE t.vehicle_id=$1",
    )
    .bind(vehicle_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(DemoSeedCounts {
        telemetry,
        trips,
        charges,
        weather_samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_in_fixture_is_valid_and_contains_only_aggregate_shape() {
        let fixture = load_fixture().expect("fixture should validate");
        assert_eq!(fixture.telemetry_rows, 5_664);
        assert_eq!(fixture.trip_count, 31);
        assert!(!FIXTURE_JSON.contains("latitude"));
        assert!(!FIXTURE_JSON.contains("longitude"));
        assert!(!FIXTURE_JSON.contains("vin"));
        assert!(!FIXTURE_JSON.contains("started_at"));
    }

    #[test]
    fn model_profiles_keep_truck_and_suv_closures_distinct() {
        let r1t = model_profile("R1T").unwrap();
        let r1s = model_profile("R1S").unwrap();
        let r2s = model_profile("R2S").unwrap();
        assert!(r1t.has_truck_closures);
        assert!(!r1t.has_liftgate);
        assert!(r1s.has_liftgate);
        assert!(!r1s.has_truck_closures);
        assert!(!r2s.has_liftgate);
        assert!(!r2s.has_truck_closures);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn seeds_every_model_with_stable_relational_counts() {
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
        let user_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM riviamigo.users ORDER BY created_at LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .expect("fixture database must contain a user");

        for model in ["R1T", "R1S", "R2S"] {
            let mut tx = pool.begin().await.unwrap();
            let vehicle_id = sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO riviamigo.vehicles
                   (user_id, rivian_vehicle_id, model, battery_capacity_wh, name)
                 VALUES ($1,$2,$3,135000,$4) RETURNING id",
            )
            .bind(user_id)
            .bind(format!("demo-{model}-seed-test"))
            .bind(model)
            .bind(format!("Demo {model}"))
            .fetch_one(&mut *tx)
            .await
            .unwrap();

            let first_anchor = Utc::now();
            let summary = seed_demo_vehicle(&mut tx, vehicle_id, model, first_anchor)
                .await
                .unwrap();
            assert_eq!(summary.counts.telemetry, 5_664);
            assert_eq!(summary.counts.trips, 31);
            assert_eq!(summary.counts.charges, 4);
            assert_eq!(summary.counts.weather_samples, 80);

            let unlinked_trips = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM riviamigo.trips trip
                 WHERE trip.vehicle_id=$1 AND NOT EXISTS (
                   SELECT 1 FROM timeseries.telemetry telemetry WHERE telemetry.trip_id=trip.id
                 )",
            )
            .bind(vehicle_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(unlinked_trips, 0, "every demo trip needs detail samples");

            let curve_points = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM riviamigo.rivian_charge_curve_points WHERE vehicle_id=$1",
            )
            .bind(vehicle_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(curve_points, 25);

            let pending_weather_jobs = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM riviamigo.weather_enrichment_jobs job
                 JOIN riviamigo.trips trip ON trip.id=job.trip_id
                 WHERE trip.vehicle_id=$1 AND job.status <> 'succeeded'",
            )
            .bind(vehicle_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(pending_weather_jobs, 0);

            let out_of_bounds_locations = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM timeseries.telemetry
                 WHERE vehicle_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL
                   AND NOT (latitude BETWEEN 38.70 AND 39.10 AND longitude BETWEEN -77.60 AND -76.80)",
            )
            .bind(vehicle_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(out_of_bounds_locations, 0);

            let states = sqlx::query_scalar::<_, String>(
                "SELECT DISTINCT state FROM riviamigo.vehicle_state_periods
                 WHERE vehicle_id=$1 ORDER BY state",
            )
            .bind(vehicle_id)
            .fetch_all(&mut *tx)
            .await
            .unwrap();
            for expected in ["charging", "drive", "ready", "sleep"] {
                assert!(
                    states.iter().any(|state| state == expected),
                    "missing {expected} period"
                );
            }

            let phantom_drain_periods = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM riviamigo.vehicle_state_periods period
                 WHERE period.vehicle_id=$1 AND period.state='sleep'
                   AND (SELECT count(*) FROM timeseries.telemetry telemetry
                        WHERE telemetry.vehicle_id=period.vehicle_id
                          AND telemetry.ts BETWEEN period.started_at AND period.ended_at
                          AND telemetry.battery_level IS NOT NULL) >= 2
                   AND (SELECT max(telemetry.battery_level)-min(telemetry.battery_level)
                        FROM timeseries.telemetry telemetry
                        WHERE telemetry.vehicle_id=period.vehicle_id
                          AND telemetry.ts BETWEEN period.started_at AND period.ended_at) > 0",
            )
            .bind(vehicle_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert!(
                phantom_drain_periods > 0,
                "demo needs a measurable sleep drain example"
            );

            let closures = sqlx::query_as::<
                _,
                (
                    Option<bool>,
                    Option<bool>,
                    Option<bool>,
                    Option<bool>,
                    Option<bool>,
                    Option<bool>,
                ),
            >(
                "SELECT closure_liftgate_closed, closure_tailgate_closed,
                        tonneau_closed, side_bin_left_closed, side_bin_right_closed,
                        closure_frunk_closed
                 FROM riviamigo.vehicle_latest_status WHERE vehicle_id=$1",
            )
            .bind(vehicle_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            match model {
                "R1S" => {
                    assert_eq!(closures.0, Some(true));
                    assert_eq!(closures.1, None);
                    assert_eq!(closures.2, None);
                }
                "R1T" => {
                    assert_eq!(closures.0, None);
                    assert_eq!(closures.1, Some(true));
                    assert_eq!(closures.2, Some(true));
                    assert_eq!(closures.3, Some(true));
                    assert_eq!(closures.4, Some(true));
                }
                "R2S" => {
                    assert_eq!(
                        (closures.0, closures.1, closures.2, closures.3, closures.4),
                        (None, None, None, None, None)
                    );
                    assert_eq!(closures.5, Some(true));
                }
                _ => unreachable!(),
            }

            let connection = sqlx::query_as::<
                _,
                (Option<String>, Option<String>, Option<i32>, Option<bool>),
            >(
                "SELECT charger_state, charger_status, time_to_end_of_charge_min, charge_port_open
                 FROM riviamigo.vehicle_latest_status WHERE vehicle_id=$1",
            )
            .bind(vehicle_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(connection.0.as_deref(), Some("Connected"));
            assert_eq!(connection.1.as_deref(), Some("chrgr_sts_connected_no_chrg"));
            assert_eq!(connection.2, None);
            assert_eq!(connection.3, Some(true));

            sqlx::query("UPDATE riviamigo.vehicles SET name='Keep this demo name' WHERE id=$1")
                .bind(vehicle_id)
                .execute(&mut *tx)
                .await
                .unwrap();
            let refreshed = seed_demo_vehicle(
                &mut tx,
                vehicle_id,
                model,
                first_anchor + Duration::hours(1),
            )
            .await
            .unwrap();
            assert_eq!(refreshed.counts.telemetry, 5_664);
            assert_eq!(refreshed.counts.trips, 31);
            assert_eq!(refreshed.counts.charges, 4);
            assert_eq!(refreshed.counts.weather_samples, 80);
            let preserved_name =
                sqlx::query_scalar::<_, String>("SELECT name FROM riviamigo.vehicles WHERE id=$1")
                    .bind(vehicle_id)
                    .fetch_one(&mut *tx)
                    .await
                    .unwrap();
            assert_eq!(preserved_name, "Keep this demo name");
            tx.rollback().await.unwrap();
        }
    }
}
