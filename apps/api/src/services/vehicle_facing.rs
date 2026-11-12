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
//!
//! That decision changes only when telemetry arrives that moves the vehicle
//! or its course, so it is saved with the vehicle's latest state
//! (`vehicle_latest_status.facing_reversed`). Ingestion marks it stale with
//! [`mark_stale`] after storing such telemetry ([`FacingInputs`] decides), and
//! the next status read works it out once and saves it. A parked vehicle's
//! status therefore reads one saved value instead of its telemetry.

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
    apply_facing(bearing_deg, backed_into_position(evidence))
}

/// The bearing, turned 180° when it is a reverse course.
fn apply_facing(bearing_deg: Option<f64>, reversed: bool) -> Option<f64> {
    let bearing = normalize(bearing_deg?)?;
    Some(if reversed {
        normalize(bearing + 180.0).unwrap_or(bearing)
    } else {
        bearing
    })
}

/// Whether the latest bearing is a reverse course: the newest shift the
/// vehicle moved after was reverse.
pub fn backed_into_position(evidence: &FacingEvidence) -> bool {
    evidence
        .shifts
        .iter()
        .find_map(GearShift::course_points_backwards)
        .unwrap_or(false)
}

/// Tracks the stored telemetry that can change the saved facing, for one
/// vehicle's ingestion worker.
///
/// The evidence reads drive/reverse rows, the speed after a drive shift, and
/// bearings after a shift. A stored row can therefore change the answer only
/// when it is in drive or reverse, reports a moving speed, or carries a
/// bearing different from the last one stored. A parked vehicle repeating its
/// bearing changes nothing. The first bearing after a worker starts always
/// counts, since the last one stored before it is unknown. A mark that failed
/// stays pending and is asked for again with the next stored row.
#[derive(Debug, Default)]
pub struct FacingInputs {
    last_bearing: Option<f64>,
    mark_pending: bool,
}

impl FacingInputs {
    /// Record a telemetry row that was stored, and return whether the saved
    /// facing must be marked stale: this row can change it, or an earlier
    /// mark has not succeeded yet. Call it only for rows actually written, so
    /// a row that failed to store is not mistaken for one already counted,
    /// and call [`FacingInputs::marked`] once [`mark_stale`] succeeds.
    pub fn stored(
        &mut self,
        gear_status: Option<&str>,
        speed_mph: Option<f64>,
        bearing_deg: Option<f64>,
    ) -> bool {
        let motion_gear = gear_status.is_some_and(|gear| {
            gear.eq_ignore_ascii_case("drive") || gear.eq_ignore_ascii_case("reverse")
        });
        let moving = speed_mph.is_some_and(|speed| speed >= MOVING_SPEED_MPH);
        let new_bearing = match bearing_deg {
            Some(bearing) if self.last_bearing != Some(bearing) => {
                self.last_bearing = Some(bearing);
                true
            }
            _ => false,
        };
        self.mark_pending |= motion_gear || moving || new_bearing;
        self.mark_pending
    }

    /// The saved facing was marked stale.
    pub fn marked(&mut self) {
        self.mark_pending = false;
    }
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
/// most 15 minutes after a drive shift. It runs only when no saved answer is
/// current (see [`reversed_course`]): about 4 ms on 30 days of recorded
/// telemetry, which partial gear and bearing indexes did not improve.
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

/// Forget the saved facing after storing telemetry that can change it, and
/// bump the epoch so a status read already working it out from older
/// telemetry does not save its answer. Call it after the telemetry commits.
pub async fn mark_stale(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE riviamigo.vehicle_latest_status
         SET facing_reversed = NULL, facing_epoch = facing_epoch + 1
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Save a worked-out facing, unless telemetry stored since `epoch` was read
/// could have changed it. Returns whether it was saved.
pub async fn save_facing(
    pool: &PgPool,
    vehicle_id: Uuid,
    epoch: i64,
    reversed: bool,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE riviamigo.vehicle_latest_status
         SET facing_reversed = $2
         WHERE vehicle_id = $1 AND facing_epoch = $3 AND facing_reversed IS NULL",
    )
    .bind(vehicle_id)
    .bind(reversed)
    .bind(epoch)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Whether the vehicle's current bearing is a reverse course: the saved
/// answer, or one worked out from telemetry and saved when nothing changed
/// while it was worked out.
pub async fn reversed_course(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<bool> {
    let saved = sqlx::query_as::<_, (Option<bool>, i64)>(
        "SELECT facing_reversed, facing_epoch
         FROM riviamigo.vehicle_latest_status
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?;
    if let Some((Some(reversed), _)) = saved {
        return Ok(reversed);
    }
    // The epoch was read before the evidence, so telemetry stored after it
    // started is either seen by the evidence query or has bumped the epoch.
    let reversed = backed_into_position(&load_facing_evidence(pool, vehicle_id).await?);
    if let Some((None, epoch)) = saved {
        if let Err(error) = save_facing(pool, vehicle_id, epoch, reversed).await {
            tracing::warn!(vehicle_id=%vehicle_id, err=%error, "vehicle facing could not be saved");
        }
    }
    Ok(reversed)
}

/// The facing for a status response. A facing that cannot be worked out
/// leaves the raw course in place rather than failing the status read.
pub async fn resolve_facing_deg(
    pool: &PgPool,
    vehicle_id: Uuid,
    bearing_deg: Option<f64>,
) -> Option<f64> {
    bearing_deg?;
    let reversed = reversed_course(pool, vehicle_id)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(vehicle_id=%vehicle_id, err=%error, "vehicle facing evidence unavailable");
            false
        });
    apply_facing(bearing_deg, reversed)
}

#[cfg(test)]
mod tests;
