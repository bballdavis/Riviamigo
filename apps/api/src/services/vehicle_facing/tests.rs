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
fn only_motion_speed_or_a_new_bearing_can_change_the_saved_facing() {
    let mut inputs = FacingInputs::default();
    let mut stored = |gear, speed, bearing| {
        let mark = inputs.stored(gear, speed, bearing);
        if mark {
            inputs.marked();
        }
        mark
    };
    // The first bearing a worker stores always counts.
    assert!(stored(Some("park"), Some(0.0), Some(118.0)));
    // A parked vehicle repeating its course, or reporting no bearing.
    assert!(!stored(Some("park"), Some(0.0), Some(118.0)));
    assert!(!stored(None, None, None));
    assert!(!stored(Some("park"), Some(0.4), None));
    // Motion gears in any case, a moving speed, or a changed course.
    assert!(stored(Some("Reverse"), Some(0.0), Some(118.0)));
    assert!(stored(Some("DRIVE"), None, None));
    assert!(stored(None, Some(MOVING_SPEED_MPH), None));
    assert!(stored(Some("park"), Some(0.0), Some(298.0)));
    assert!(!stored(Some("park"), Some(0.0), Some(298.0)));
}

#[test]
fn a_failed_mark_is_asked_for_again_until_it_succeeds() {
    let mut inputs = FacingInputs::default();
    assert!(inputs.stored(Some("reverse"), Some(2.0), Some(190.0)));
    // The mark failed: parked rows repeating the course still ask for it.
    assert!(inputs.stored(Some("park"), Some(0.0), Some(190.0)));
    assert!(inputs.stored(Some("park"), Some(0.0), Some(190.0)));
    inputs.marked();
    assert!(!inputs.stored(Some("park"), Some(0.0), Some(190.0)));
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
