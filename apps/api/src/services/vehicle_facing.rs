//! The direction a vehicle's nose points, derived from its GNSS bearing.
//!
//! Rivian's `gnssBearing` is the course over ground: the direction of travel,
//! not of the nose. In recorded telemetry it matches the GPS track in reverse
//! just as it does in drive, and a parked vehicle keeps the course of its last
//! movement. After backing into a space, the stored bearing therefore points
//! out of the space, 180° from where the vehicle faces.
//!
//! The bearing is flipped only when the last driving gear was reverse and a
//! bearing newer than that shift has turned at least [`REVERSE_COURSE_TURN_DEG`]
//! away from the bearing held when reverse was engaged. Shifting to reverse and
//! back to park without moving leaves the course, and so the facing, alone.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// A course change this large after engaging reverse means the vehicle moved
/// backwards: a straight back-in turns the course about 180°, a back-in to a
/// perpendicular space about 90°. Parked GNSS jitter stays well below it.
pub const REVERSE_COURSE_TURN_DEG: f64 = 45.0;

/// Telemetry facts that decide whether the latest bearing is a reverse course.
#[derive(Debug, Clone, Default, PartialEq, sqlx::FromRow)]
pub struct FacingEvidence {
    /// The most recent `drive` or `reverse` gear report.
    pub last_motion_gear: Option<String>,
    pub last_motion_gear_at: Option<DateTime<Utc>>,
    /// The newest recorded bearing and when it was recorded.
    pub latest_bearing_at: Option<DateTime<Utc>>,
    /// The bearing held when the last motion gear was reported.
    pub bearing_at_gear: Option<f64>,
}

/// The vehicle's facing in compass degrees `[0, 360)`, or `None` without a bearing.
pub fn facing_deg(bearing_deg: Option<f64>, evidence: &FacingEvidence) -> Option<f64> {
    let bearing = normalize(bearing_deg?)?;
    Some(if backed_into_position(bearing, evidence) {
        normalize(bearing + 180.0).unwrap_or(bearing)
    } else {
        bearing
    })
}

fn backed_into_position(bearing: f64, evidence: &FacingEvidence) -> bool {
    let reversing = evidence
        .last_motion_gear
        .as_deref()
        .is_some_and(|gear| gear.eq_ignore_ascii_case("reverse"));
    let course_updated_after_shift = matches!(
        (evidence.latest_bearing_at, evidence.last_motion_gear_at),
        (Some(bearing_at), Some(gear_at)) if bearing_at > gear_at
    );
    let course_turned = evidence
        .bearing_at_gear
        .and_then(normalize)
        .is_some_and(|before| angular_distance(bearing, before) >= REVERSE_COURSE_TURN_DEG);
    reversing && course_updated_after_shift && course_turned
}

fn normalize(degrees: f64) -> Option<f64> {
    degrees.is_finite().then(|| degrees.rem_euclid(360.0))
}

fn angular_distance(a: f64, b: f64) -> f64 {
    let difference = (a - b).rem_euclid(360.0);
    difference.min(360.0 - difference)
}

/// Loads the evidence for [`facing_deg`] from the last 30 days of telemetry.
/// Each lookup is a single-row index scan on `(vehicle_id, ts DESC)`.
pub async fn load_facing_evidence(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<FacingEvidence> {
    let evidence = sqlx::query_as::<_, FacingEvidence>(
        r#"WITH gear AS (
               SELECT ts, gear_status
               FROM timeseries.telemetry
               WHERE vehicle_id = $1
                 AND ts > now() - interval '30 days'
                 AND gear_status IN ('drive', 'reverse')
               ORDER BY ts DESC
               LIMIT 1
           ),
           bearing AS (
               SELECT ts
               FROM timeseries.telemetry
               WHERE vehicle_id = $1
                 AND ts > now() - interval '30 days'
                 AND heading_deg IS NOT NULL
               ORDER BY ts DESC
               LIMIT 1
           )
           SELECT gear.gear_status AS last_motion_gear,
                  gear.ts AS last_motion_gear_at,
                  bearing.ts AS latest_bearing_at,
                  (SELECT t.heading_deg
                   FROM timeseries.telemetry t
                   WHERE t.vehicle_id = $1
                     AND t.ts <= gear.ts
                     AND t.ts > gear.ts - interval '1 day'
                     AND t.heading_deg IS NOT NULL
                   ORDER BY t.ts DESC
                   LIMIT 1) AS bearing_at_gear
           FROM gear
           FULL JOIN bearing ON true"#,
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?;
    Ok(evidence.unwrap_or_default())
}

/// [`facing_deg`] for a status response. Evidence that cannot be loaded leaves
/// the raw course in place rather than failing the status read.
pub async fn resolve_facing_deg(
    pool: &PgPool,
    vehicle_id: Uuid,
    bearing_deg: Option<f64>,
) -> Option<f64> {
    let evidence = load_facing_evidence(pool, vehicle_id)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(vehicle_id=%vehicle_id, err=%error, "vehicle facing evidence unavailable");
            FacingEvidence::default()
        });
    facing_deg(bearing_deg, &evidence)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32, minute: u32) -> Option<DateTime<Utc>> {
        Some(Utc.with_ymd_and_hms(2026, 11, 9, hour, minute, 0).unwrap())
    }

    fn reversed(bearing_at_gear: f64, latest_bearing_at: Option<DateTime<Utc>>) -> FacingEvidence {
        FacingEvidence {
            last_motion_gear: Some("reverse".into()),
            last_motion_gear_at: at(23, 41),
            latest_bearing_at,
            bearing_at_gear: Some(bearing_at_gear),
        }
    }

    #[test]
    fn forward_driving_keeps_the_bearing_and_normalizes_it() {
        let evidence = FacingEvidence {
            last_motion_gear: Some("drive".into()),
            last_motion_gear_at: at(23, 38),
            latest_bearing_at: at(23, 40),
            bearing_at_gear: Some(80.0),
        };
        let facing = facing_deg(Some(-88.6), &evidence).unwrap();
        assert!((facing - 271.4).abs() < 1e-9, "{facing}");
        assert_eq!(facing_deg(Some(360.0), &evidence), Some(0.0));
    }

    #[test]
    fn backing_straight_in_flips_the_course_to_the_nose() {
        // Recorded case: east-bound at 103.6°, reverse engaged, the next-day
        // parked bearing reads -88.6° (west). The nose faces east.
        let facing = facing_deg(Some(-88.6), &reversed(103.6, at(23, 59))).unwrap();
        assert!((facing - 91.4).abs() < 1e-9, "{facing}");
    }

    #[test]
    fn backing_into_a_perpendicular_space_also_flips() {
        // East-bound, then reversing north into a space: the nose points south.
        assert_eq!(
            facing_deg(Some(0.0), &reversed(90.0, at(23, 50))),
            Some(180.0)
        );
    }

    #[test]
    fn engaging_reverse_without_moving_keeps_the_bearing() {
        // The course has not turned since the shift (jitter only).
        assert_eq!(
            facing_deg(Some(95.9), &reversed(103.6, at(23, 47))),
            Some(95.9)
        );
        // No bearing newer than the shift: the course cannot reflect reversing.
        assert_eq!(
            facing_deg(Some(283.0), &reversed(103.6, at(23, 41))),
            Some(283.0)
        );
        assert_eq!(
            facing_deg(Some(283.0), &reversed(103.6, at(23, 30))),
            Some(283.0)
        );
    }

    #[test]
    fn missing_or_invalid_bearings_yield_nothing_or_the_raw_course() {
        assert_eq!(facing_deg(None, &reversed(10.0, at(23, 59))), None);
        assert_eq!(facing_deg(Some(f64::NAN), &FacingEvidence::default()), None);
        assert_eq!(
            facing_deg(Some(45.0), &FacingEvidence::default()),
            Some(45.0)
        );
        let unknown_prior = FacingEvidence {
            bearing_at_gear: None,
            ..reversed(0.0, at(23, 59))
        };
        assert_eq!(facing_deg(Some(45.0), &unknown_prior), Some(45.0));
    }

    #[test]
    fn angular_distance_wraps_around_north() {
        assert_eq!(angular_distance(350.0, 10.0), 20.0);
        assert_eq!(angular_distance(10.0, 350.0), 20.0);
        assert!((angular_distance(91.4, 271.4) - 180.0).abs() < 1e-9);
    }
}
