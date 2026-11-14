//! Re-derive stored trip energy and efficiency from each trip's endpoints.
//!
//! Used by Settings > Jobs ("Recalculate trip energy") and the
//! `recompute_trip_energy` binary, so both apply the live trip detector's
//! energy strategy (`ingestion::worker::persist_trip`) to stored trips.

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::ingestion::trip_detector::compute_trip_energy;

/// Totals from re-deriving trip energy.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TripEnergyRecomputeSummary {
    pub processed: usize,
    pub changed: usize,
}

#[derive(Debug, sqlx::FromRow)]
struct TripEnergyRow {
    id: Uuid,
    distance_miles: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    range_start_mi: Option<f64>,
    range_end_mi: Option<f64>,
    efficiency_wh_per_mile: Option<f64>,
    energy_wh: Option<f64>,
    energy_strategy: Option<String>,
    battery_capacity_wh: Option<f64>,
}

/// The energy fields a trip should store.
#[derive(Debug, Clone, PartialEq)]
struct TripEnergy {
    energy_wh: Option<f64>,
    energy_strategy: Option<String>,
    /// `None` keeps the stored efficiency.
    efficiency_wh_per_mile: Option<f64>,
}

fn derive_trip_energy(trip: &TripEnergyRow) -> TripEnergy {
    let distance = trip.distance_miles.unwrap_or(0.0);
    match compute_trip_energy(
        trip.soc_start,
        trip.soc_end,
        trip.battery_capacity_wh,
        trip.range_start_mi,
        trip.range_end_mi,
        distance,
        // Like the live detector: no historical efficiency. Feeding the
        // trip's own stored efficiency back in made repeated runs drift.
        None,
    ) {
        Some((wh, strategy)) => TripEnergy {
            energy_wh: Some(wh),
            energy_strategy: Some(strategy.to_string()),
            efficiency_wh_per_mile: (distance > 0.0).then(|| wh / distance),
        },
        None => TripEnergy {
            energy_wh: None,
            energy_strategy: None,
            efficiency_wh_per_mile: match (trip.soc_start, trip.soc_end, trip.battery_capacity_wh) {
                (Some(s0), Some(s1), Some(cap)) if distance > 0.0 && s0 > s1 => {
                    Some(((s0 - s1) / 100.0) * cap / distance)
                }
                _ => None,
            },
        },
    }
}

fn is_changed(trip: &TripEnergyRow, next: &TripEnergy) -> bool {
    trip.energy_wh != next.energy_wh
        || trip.energy_strategy != next.energy_strategy
        || next
            .efficiency_wh_per_mile
            .is_some_and(|efficiency| trip.efficiency_wh_per_mile != Some(efficiency))
}

/// Re-derive energy for every trip of `vehicle_id`, or of every vehicle when
/// `None`. Only trips whose energy fields change are written.
pub async fn recompute_trip_energy(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<TripEnergyRecomputeSummary> {
    let trips = sqlx::query_as::<_, TripEnergyRow>(
        r#"SELECT t.id, t.distance_miles, t.soc_start, t.soc_end,
                  t.range_start_mi, t.range_end_mi, t.efficiency_wh_per_mile,
                  t.energy_wh, t.energy_strategy,
                  v.battery_capacity_wh
           FROM riviamigo.trips t
           JOIN riviamigo.vehicles v ON v.id = t.vehicle_id
           WHERE $1::uuid IS NULL OR t.vehicle_id = $1
           ORDER BY t.started_at, t.id"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut summary = TripEnergyRecomputeSummary::default();
    for trip in &trips {
        summary.processed += 1;
        let next = derive_trip_energy(trip);
        if !is_changed(trip, &next) {
            continue;
        }
        sqlx::query(
            r#"UPDATE riviamigo.trips
               SET energy_wh = $2,
                   energy_strategy = $3,
                   efficiency_wh_per_mile = COALESCE($4, efficiency_wh_per_mile)
               WHERE id = $1"#,
        )
        .bind(trip.id)
        .bind(next.energy_wh)
        .bind(&next.energy_strategy)
        .bind(next.efficiency_wh_per_mile)
        .execute(pool)
        .await?;
        summary.changed += 1;
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trip() -> TripEnergyRow {
        TripEnergyRow {
            id: Uuid::nil(),
            distance_miles: Some(20.0),
            soc_start: Some(80.0),
            soc_end: Some(76.0),
            range_start_mi: None,
            range_end_mi: None,
            efficiency_wh_per_mile: None,
            energy_wh: None,
            energy_strategy: None,
            battery_capacity_wh: Some(135_000.0),
        }
    }

    #[test]
    fn soc_drop_sets_energy_and_efficiency() {
        let next = derive_trip_energy(&trip());
        let wh = next.energy_wh.expect("energy");
        assert!((wh - 5_400.0).abs() < 1e-6, "{wh}");
        assert!(next.energy_strategy.is_some());
        assert!((next.efficiency_wh_per_mile.unwrap() - 270.0).abs() < 1e-6);
    }

    #[test]
    fn a_trip_already_matching_is_left_alone() {
        let mut stored = trip();
        let next = derive_trip_energy(&stored);
        stored.energy_wh = next.energy_wh;
        stored.energy_strategy = next.energy_strategy.clone();
        stored.efficiency_wh_per_mile = next.efficiency_wh_per_mile;
        assert!(!is_changed(&stored, &derive_trip_energy(&stored)));
    }

    #[test]
    fn repeated_runs_are_stable() {
        let mut stored = trip();
        stored.soc_start = None;
        stored.soc_end = None;
        stored.range_start_mi = Some(200.0);
        stored.range_end_mi = Some(190.0);
        stored.distance_miles = Some(8.0);
        stored.efficiency_wh_per_mile = Some(300.0);
        let first = derive_trip_energy(&stored);
        stored.energy_wh = first.energy_wh;
        stored.energy_strategy = first.energy_strategy.clone();
        if let Some(efficiency) = first.efficiency_wh_per_mile {
            stored.efficiency_wh_per_mile = Some(efficiency);
        }
        assert!(!is_changed(&stored, &derive_trip_energy(&stored)));
    }

    #[test]
    fn missing_inputs_clear_energy_but_keep_stored_efficiency() {
        let mut stored = trip();
        stored.soc_start = None;
        stored.soc_end = None;
        stored.distance_miles = Some(0.0);
        stored.efficiency_wh_per_mile = Some(300.0);
        let next = derive_trip_energy(&stored);
        assert_eq!(next.energy_wh, None);
        assert_eq!(next.efficiency_wh_per_mile, None);
        assert!(!is_changed(&stored, &next));
    }
}
