//! The direction a vehicle's nose points, derived from its GNSS bearing.
//!
//! Rivian's `gnssBearing` is the course over ground: the direction of travel,
//! not of the nose. In recorded telemetry it matches the GPS track in reverse
//! just as it does in drive, and a parked vehicle keeps the course of its last
//! movement. After backing into a space, the stored bearing therefore points
//! out of the space, 180° from where the vehicle faces.
//!
//! The course reflects whichever motion gear last moved the vehicle, so the
//! facing is anchored on the most recent `drive` or `reverse` shift that was
//! followed by movement:
//!
//! - a reverse shift counts only when a later bearing (before the next shift)
//!   turned at least [`COURSE_TURN_DEG`] away from the bearing held at the
//!   shift, because reversing straight back can leave the stored course
//!   unchanged until it updates;
//! - a drive shift counts when the course turned the same way or the vehicle
//!   reported a speed of at least [`MOVING_SPEED_MPH`] soon after the shift.
//!
//! Shifts the vehicle did not move after are skipped. Shifting to reverse,
//! or to drive, and back to park without moving therefore leaves the facing
//! of the earlier manoeuvre in place. The bearing is flipped only when the
//! anchor is a reverse shift.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// A course change this large after a shift means the vehicle moved in that
/// gear: a straight back-in turns the course about 180°, a back-in to a
/// perpendicular space about 90°. Parked GNSS jitter stays well below it.
pub const COURSE_TURN_DEG: f64 = 45.0;

/// A reported speed at least this high after a drive shift means the vehicle
/// pulled away.
pub const MOVING_SPEED_MPH: f64 = 1.0;

/// How many recent motion-gear shifts are examined for an anchor.
const MAX_SHIFTS: i64 = 6;

/// How many recent drive/reverse telemetry rows are read to find those
/// shifts. The gear is repeated on every row while it is engaged, so a shift
/// is the first row of a run of one gear. When the budget is used up, the
/// oldest run read is usually cut short, so it is not treated as a shift.
const MOTION_ROW_BUDGET: i64 = 1000;

/// One `drive` or `reverse` shift and what happened before the next one.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct GearShift {
    /// The gear, lower-cased.
    pub gear: String,
    pub shifted_at: DateTime<Utc>,
    /// The last bearing reported before the shift, or the shift row's own
    /// bearing when there is none in the day before it. The shift row may
    /// already carry the new course, so it is compared like any later bearing.
    pub bearing_at_shift: Option<f64>,
    /// A later bearing, before the next shift, turned at least
    /// [`COURSE_TURN_DEG`] from `bearing_at_shift`.
    pub course_turned: bool,
    /// A drive shift was followed by a moving speed report.
    pub moved: bool,
}

impl GearShift {
    /// `Some(true)` when this shift left the course pointing backwards,
    /// `Some(false)` when forwards, and `None` when the vehicle did not move
    /// after it.
    fn course_points_backwards(&self) -> Option<bool> {
        if self.gear.eq_ignore_ascii_case("reverse") {
            self.course_turned.then_some(true)
        } else if self.gear.eq_ignore_ascii_case("drive") {
            (self.course_turned || self.moved).then_some(false)
        } else {
            None
        }
    }
}

/// Telemetry facts that decide whether the latest bearing is a reverse course.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FacingEvidence {
    /// Recent motion-gear shifts, newest first.
    pub shifts: Vec<GearShift>,
}

/// The vehicle's facing in compass degrees `[0, 360)`, or `None` without a bearing.
pub fn facing_deg(bearing_deg: Option<f64>, evidence: &FacingEvidence) -> Option<f64> {
    let bearing = normalize(bearing_deg?)?;
    Some(if backed_into_position(evidence) {
        normalize(bearing + 180.0).unwrap_or(bearing)
    } else {
        bearing
    })
}

fn backed_into_position(evidence: &FacingEvidence) -> bool {
    evidence
        .shifts
        .iter()
        .find_map(GearShift::course_points_backwards)
        .unwrap_or(false)
}

fn normalize(degrees: f64) -> Option<f64> {
    degrees.is_finite().then(|| degrees.rem_euclid(360.0))
}

/// The evidence query. `$1` vehicle, `$2` shift limit, `$3` course turn in
/// degrees, `$4` moving speed in mph, `$5` motion row budget.
///
/// Telemetry repeats the engaged gear on every row, so `motion` reads the
/// newest drive/reverse rows and `shifts` keeps the first row of each run of
/// one gear. A park between two runs of the same gear does not split them.
/// When the budget is full, the oldest row read starts a run that is probably
/// cut short, so it is skipped. Each shift's phase lasts until the next shift,
/// so a back-in's whole reverse run, and any bearing reported after it,
/// decides whether the course turned.
///
/// Every read is a range on the vehicle's `(vehicle_id, ts DESC)` index, so no
/// index of its own is needed: `motion` stops after the budget or 30 days of
/// the vehicle's rows, the bearing probes take the first matching row, the
/// turn probe stops at the first turned bearing, and the speed probe reads at
/// most 15 minutes after a drive shift. About 4 ms on 30 days of recorded
/// telemetry; partial gear and bearing indexes did not change that and would
/// add a write on most telemetry inserts.
const FACING_EVIDENCE_SQL: &str = r#"WITH motion AS (
               SELECT ts, lower(gear_status) AS gear
               FROM timeseries.telemetry
               WHERE vehicle_id = $1
                 AND ts > now() - interval '30 days'
                 AND lower(gear_status) IN ('drive', 'reverse')
               ORDER BY ts DESC
               LIMIT $5
           ),
           runs AS (
               SELECT ts, gear,
                      CASE
                          WHEN lag(gear) OVER (ORDER BY ts) IS NULL
                              THEN count(*) OVER () < $5
                          ELSE gear <> lag(gear) OVER (ORDER BY ts)
                      END AS starts_run
               FROM motion
           ),
           shifts AS (
               SELECT ts, gear
               FROM runs
               WHERE starts_run
               ORDER BY ts DESC
               LIMIT $2
           ),
           phases AS (
               SELECT ts, gear,
                      COALESCE(lag(ts) OVER (ORDER BY ts DESC), 'infinity'::timestamptz) AS ended_at
               FROM shifts
           )
           SELECT p.gear,
                  p.ts AS shifted_at,
                  held.heading_deg AS bearing_at_shift,
                  turned.ts IS NOT NULL AS course_turned,
                  moving.ts IS NOT NULL AS moved
           FROM phases p
           LEFT JOIN LATERAL (
               SELECT COALESCE(
                   (SELECT t.heading_deg
                    FROM timeseries.telemetry t
                    WHERE t.vehicle_id = $1
                      AND t.ts > now() - interval '31 days'
                      AND t.ts < p.ts
                      AND t.ts > p.ts - interval '1 day'
                      AND t.heading_deg IS NOT NULL
                    ORDER BY t.ts DESC
                    LIMIT 1),
                   (SELECT t.heading_deg
                    FROM timeseries.telemetry t
                    WHERE t.vehicle_id = $1
                      AND t.ts > now() - interval '31 days'
                      AND t.ts = p.ts
                      AND t.heading_deg IS NOT NULL
                    LIMIT 1)
               ) AS heading_deg
           ) held ON TRUE
           LEFT JOIN LATERAL (
               SELECT t.ts
               FROM timeseries.telemetry t
               WHERE t.vehicle_id = $1
                 AND t.ts > now() - interval '31 days'
                 AND t.ts >= p.ts
                 AND t.ts < p.ended_at
                 AND t.heading_deg IS NOT NULL
                 AND abs((t.heading_deg - held.heading_deg)
                         - 360 * floor((t.heading_deg - held.heading_deg + 180) / 360)) >= $3
               LIMIT 1
           ) turned ON TRUE
           LEFT JOIN LATERAL (
               SELECT t.ts
               FROM timeseries.telemetry t
               WHERE p.gear = 'drive'
                 AND t.vehicle_id = $1
                 AND t.ts > now() - interval '31 days'
                 AND t.ts >= p.ts
                 AND t.ts < LEAST(p.ended_at, p.ts + interval '15 minutes')
                 AND t.speed_mph >= $4
               LIMIT 1
           ) moving ON TRUE
           ORDER BY p.ts DESC"#;

/// Loads the evidence for [`facing_deg`] from the last 30 days of telemetry:
/// up to [`MAX_SHIFTS`] recent motion-gear shifts (runs of one gear within the
/// newest [`MOTION_ROW_BUDGET`] drive/reverse rows), and for each the bearing
/// at the shift, whether the course later turned before the next shift, and
/// (for drive) whether a moving speed followed within 15 minutes. Gear values
/// are compared case-insensitively, as everywhere else in ingestion.
pub async fn load_facing_evidence(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<FacingEvidence> {
    let shifts = sqlx::query_as::<_, GearShift>(FACING_EVIDENCE_SQL)
        .bind(vehicle_id)
        .bind(MAX_SHIFTS)
        .bind(COURSE_TURN_DEG)
        .bind(MOVING_SPEED_MPH)
        .bind(MOTION_ROW_BUDGET)
        .fetch_all(pool)
        .await?;
    Ok(FacingEvidence { shifts })
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

    fn at(hour: u32, minute: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 9, hour, minute, 0).unwrap()
    }

    fn shift(gear: &str, minute: u32, course_turned: bool, moved: bool) -> GearShift {
        GearShift {
            gear: gear.into(),
            shifted_at: at(23, minute),
            bearing_at_shift: Some(103.6),
            course_turned,
            moved,
        }
    }

    fn evidence(newest_first: Vec<GearShift>) -> FacingEvidence {
        FacingEvidence {
            shifts: newest_first,
        }
    }

    #[test]
    fn forward_driving_keeps_the_bearing_and_normalizes_it() {
        let driven = evidence(vec![shift("drive", 38, true, true)]);
        let facing = facing_deg(Some(-88.6), &driven).unwrap();
        assert!((facing - 271.4).abs() < 1e-9, "{facing}");
        assert_eq!(facing_deg(Some(360.0), &driven), Some(0.0));
    }

    #[test]
    fn backing_in_flips_the_course_to_the_nose() {
        // Recorded case: east-bound at 103.6°, reverse engaged, the next-day
        // parked bearing reads -88.6° (west). The nose faces east.
        let backed_in = evidence(vec![
            shift("reverse", 41, true, false),
            shift("drive", 30, true, true),
        ]);
        let facing = facing_deg(Some(-88.6), &backed_in).unwrap();
        assert!((facing - 91.4).abs() < 1e-9, "{facing}");
        // A perpendicular back-in: reversing north, so the nose points south.
        assert_eq!(facing_deg(Some(0.0), &backed_in), Some(180.0));
    }

    #[test]
    fn shifting_to_drive_without_moving_keeps_the_backed_in_facing() {
        // Back into a space, shift to drive without moving, then park.
        let still = evidence(vec![
            shift("drive", 50, false, false),
            shift("reverse", 41, true, false),
            shift("drive", 30, true, true),
        ]);
        let facing = facing_deg(Some(-88.6), &still).unwrap();
        assert!((facing - 91.4).abs() < 1e-9, "{facing}");
    }

    #[test]
    fn pulling_away_after_backing_in_trusts_the_course_again() {
        for pulled_away in [
            shift("drive", 50, false, true),
            shift("drive", 50, true, false),
        ] {
            let driven = evidence(vec![pulled_away, shift("reverse", 41, true, false)]);
            assert_eq!(facing_deg(Some(271.4), &driven), Some(271.4));
        }
    }

    #[test]
    fn engaging_reverse_without_moving_keeps_the_bearing() {
        // The course has not turned since the shift (jitter only, or no bearing
        // newer than the shift), so the earlier forward drive anchors.
        let still = evidence(vec![
            shift("reverse", 41, false, false),
            shift("drive", 30, true, true),
        ]);
        assert_eq!(facing_deg(Some(95.9), &still), Some(95.9));
        // Reverse with speed but an unchanged course: the course still shows
        // the earlier forward travel.
        let lagging = evidence(vec![
            shift("reverse", 41, false, true),
            shift("drive", 30, true, true),
        ]);
        assert_eq!(facing_deg(Some(95.9), &lagging), Some(95.9));
    }

    #[test]
    fn gear_names_are_compared_case_insensitively() {
        let backed_in = evidence(vec![
            shift("Drive", 50, false, false),
            shift("REVERSE", 41, true, false),
        ]);
        assert_eq!(facing_deg(Some(0.0), &backed_in), Some(180.0));
    }

    #[test]
    fn the_query_matches_gears_case_insensitively() {
        assert!(FACING_EVIDENCE_SQL.contains("lower(gear_status) IN ('drive', 'reverse')"));
        assert!(!FACING_EVIDENCE_SQL.contains("AND gear_status IN"));
    }

    #[test]
    fn missing_or_invalid_bearings_yield_nothing_or_the_raw_course() {
        let backed_in = evidence(vec![shift("reverse", 41, true, false)]);
        assert_eq!(facing_deg(None, &backed_in), None);
        assert_eq!(facing_deg(Some(f64::NAN), &FacingEvidence::default()), None);
        assert_eq!(
            facing_deg(Some(45.0), &FacingEvidence::default()),
            Some(45.0)
        );
        // No shift moved the vehicle: nothing to anchor on.
        let unmoved = evidence(vec![
            shift("reverse", 41, false, false),
            shift("drive", 30, false, false),
        ]);
        assert_eq!(facing_deg(Some(45.0), &unmoved), Some(45.0));
    }
}
