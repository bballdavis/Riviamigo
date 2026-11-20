//! Frames here are written byte by byte from the field numbers in
//! rivian-python-client's `navigation.proto`, not encoded from the structs
//! under test, so a wrong tag in a struct fails a test.

use super::*;

/// A minimal protobuf writer.
#[derive(Default, Clone)]
struct Wire(Vec<u8>);

impl Wire {
    fn raw_varint(&mut self, mut value: u64) {
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                self.0.push(byte);
                return;
            }
            self.0.push(byte | 0x80);
        }
    }

    fn key(&mut self, tag: u32, wire_type: u64) {
        self.raw_varint(u64::from(tag) << 3 | wire_type);
    }

    fn int(mut self, tag: u32, value: i64) -> Self {
        self.key(tag, 0);
        self.raw_varint(value as u64);
        self
    }

    fn double(mut self, tag: u32, value: f64) -> Self {
        self.key(tag, 1);
        self.0.extend(value.to_le_bytes());
        self
    }

    fn bytes(mut self, tag: u32, value: &[u8]) -> Self {
        self.key(tag, 2);
        self.raw_varint(value.len() as u64);
        self.0.extend(value);
        self
    }

    fn text(self, tag: u32, value: &str) -> Self {
        self.bytes(tag, value.as_bytes())
    }

    fn message(self, tag: u32, value: Wire) -> Self {
        self.bytes(tag, &value.0)
    }
}

// GeoCoordinate { latitude = 1, longitude = 2 }
fn geo((latitude, longitude): (f64, f64)) -> Wire {
    Wire::default().double(1, latitude).double(2, longitude)
}

// Timestamp { seconds = 1 }
fn time(at: DateTime<Utc>) -> Wire {
    Wire::default().int(1, at.timestamp())
}

// Place { location = 1, snapped_location = 2, status = 3, name = 4, arrival = 9 }
fn place(name: &str, at: (f64, f64), arrival: DateTime<Utc>) -> Wire {
    Wire::default()
        .message(1, geo(at))
        .message(2, geo(at))
        .int(3, 2)
        .text(4, name)
        .text(5, "place-id")
        .double(7, 41.0)
        .message(9, time(arrival))
}

// ChargingStop { station_id = 1, label = 2, location = 3, departure_time = 10, arrival_time = 11 }
fn charging_stop(label: &str, at: (f64, f64), arrival: DateTime<Utc>) -> Wire {
    Wire::default()
        .text(1, "100103")
        .text(2, label)
        .message(3, geo(at))
        .double(4, 1_080.0)
        .message(10, time(arrival + Duration::minutes(18)))
        .message(11, time(arrival))
}

// WaypointWrapper { place = 1, charging_stop = 2 }
fn place_waypoint(place: Wire) -> Wire {
    Wire::default().message(1, place)
}

fn charging_waypoint(stop: Wire) -> Wire {
    Wire::default().message(2, stop)
}

// Leg { distance = 1, duration = 2, road_label = 3, polyline = 4 }
fn leg(polyline: Option<&str>) -> Wire {
    let leg = Wire::default()
        .double(1, 12_000.0)
        .double(2, 900.0)
        .text(3, "I-80");
    match polyline {
        Some(polyline) => leg.text(4, polyline),
        None => leg,
    }
}

// TripInfo { trip_id = 1, origin = 2, trip = 3 }
// Trip { distance = 1, duration = 2, waypoint = 3, leg = 4, overview_polyline = 10 }
fn trip_info(waypoints: Vec<Wire>, legs: Vec<Wire>, overview: Option<&str>) -> Vec<u8> {
    let mut trip = Wire::default().double(1, 24_000.0).double(2, 1_800.0);
    for waypoint in waypoints {
        trip = trip.message(3, waypoint);
    }
    for leg in legs {
        trip = trip.message(4, leg);
    }
    if let Some(overview) = overview {
        trip = trip.text(10, overview);
    }
    Wire::default()
        .text(1, "-123")
        .message(2, Wire::default().message(1, geo(START)))
        .message(3, trip)
        .double(5, 78.0)
        .0
}

// TripProgress { next_waypoint = 1, final_destination = 2, next_stop_index = 3,
//                distance_remaining = 4, duration_remaining = 5, location_fix = 6 }
fn progress(
    next_stop: Option<DateTime<Utc>>,
    destination: Option<DateTime<Utc>>,
) -> NavigationTripArrival {
    let mut frame = Wire::default();
    if let Some(next_stop) = next_stop {
        frame = frame.message(1, time(next_stop));
    }
    if let Some(destination) = destination {
        frame = frame.message(2, time(destination));
    }
    let frame = frame.int(3, 1).double(4, 5_400.0).double(5, 380.0);
    NavigationTripArrival::decode(frame.0.as_slice()).unwrap()
}

/// The reference encoder for encoded polylines.
fn encode_polyline(points: &[(f64, f64)], precision: u8) -> String {
    let factor = 10_f64.powi(i32::from(precision));
    let mut encoded = String::new();
    let (mut last_latitude, mut last_longitude) = (0_i64, 0_i64);
    for &(latitude, longitude) in points {
        let latitude = (latitude * factor).round() as i64;
        let longitude = (longitude * factor).round() as i64;
        for delta in [latitude - last_latitude, longitude - last_longitude] {
            let mut value = if delta < 0 { !(delta << 1) } else { delta << 1 };
            while value >= 0x20 {
                encoded.push(char::from(((0x20 | (value & 0x1f)) + 63) as u8));
                value >>= 5;
            }
            encoded.push(char::from((value + 63) as u8));
        }
        (last_latitude, last_longitude) = (latitude, longitude);
    }
    encoded
}

const START: (f64, f64) = (39.5296, -119.8138);
const CHARGER: (f64, f64) = (39.3280, -120.1833);
const TRAILHEAD: (f64, f64) = (39.1970, -120.2357);

fn at(minute: i64) -> DateTime<Utc> {
    "2026-11-19T15:00:00Z".parse::<DateTime<Utc>>().unwrap() + Duration::minutes(minute)
}

/// A two-stop trip: a planner-added charger, then the destination.
fn two_stop_trip(precision: u8) -> Vec<u8> {
    let first = encode_polyline(&[START, (39.43, -120.0), CHARGER], precision);
    let second = encode_polyline(&[CHARGER, (39.26, -120.21), TRAILHEAD], precision);
    trip_info(
        vec![
            charging_waypoint(charging_stop("12 Donner Pass Rd [RAN]", CHARGER, at(40))),
            place_waypoint(place("Trailhead", TRAILHEAD, at(72))),
        ],
        vec![leg(Some(&first)), leg(Some(&second))],
        Some(&encode_polyline(&[START, TRAILHEAD], precision)),
    )
}

fn one_stop_trip() -> Vec<u8> {
    let line = encode_polyline(&[START, TRAILHEAD], 5);
    trip_info(
        vec![place_waypoint(place("Trailhead", TRAILHEAD, at(72)))],
        vec![leg(Some(&line))],
        None,
    )
}

fn observe(tracker: &mut NavigationTracker, payload: &[u8], minute: i64) -> NavigationOutcome {
    let mut notes = Vec::new();
    let outcome = tracker
        .observe_trip_info(payload, at(minute), &mut notes)
        .unwrap();
    assert!(notes.is_empty(), "{notes:?}");
    outcome
}

#[test]
fn decodes_the_published_polyline_example() {
    // The worked example from Google's encoded polyline format documentation.
    let points = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5).unwrap();
    assert_eq!(
        points,
        vec![(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    );
    assert_eq!(decode_polyline("", 5), Some(Vec::new()));
}

#[test]
fn rejects_malformed_polylines() {
    // Ends in the middle of a number.
    assert!(decode_polyline("_p~iF~ps|", 5).is_none());
    // A latitude with no longitude.
    assert!(decode_polyline("_p~iF", 5).is_none());
    // Bytes outside the encoding's alphabet.
    assert!(decode_polyline("_p~iF ~ps|U", 5).is_none());
    assert!(decode_polyline("_p~iF\u{e9}ps|U", 5).is_none());
    // A number that never terminates.
    assert!(decode_polyline(&"~".repeat(40), 5).is_none());
    // Off the globe: this is the example read with one digit too few.
    assert!(decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 4).is_none());
}

#[test]
fn route_frame_becomes_stops_and_verified_leg_lines() {
    let mut tracker = NavigationTracker::default();
    let outcome = observe(&mut tracker, &two_stop_trip(5), 0);
    assert!(outcome.changed);
    assert_eq!(outcome.transition, Some(NavigationTransition::Started));
    assert_eq!(
        outcome.summary,
        json!({
            "navigation": "route",
            "stops": 2,
            "charging_stops": 1,
            "polyline_source": "legs",
            "polyline_precision": 5,
            "polyline_points": 6,
        })
    );

    let live = tracker.snapshot().unwrap();
    assert_eq!(live.route.id.len(), 16);
    assert_eq!(live.route.polyline_precision, 5);
    assert_eq!(live.route.polylines.len(), 2);
    let stops = &live.route.stops;
    assert_eq!(stops.len(), 2);
    assert_eq!(stops[0].kind, NavigationStopKind::Charging);
    assert_eq!(stops[0].name.as_deref(), Some("12 Donner Pass Rd [RAN]"));
    assert_eq!((stops[0].latitude, stops[0].longitude), CHARGER);
    assert_eq!(stops[0].arrival_at, Some(at(40)));
    assert_eq!(stops[1].kind, NavigationStopKind::Place);
    assert_eq!(stops[1].name.as_deref(), Some("Trailhead"));
    assert_eq!((stops[1].latitude, stops[1].longitude), TRAILHEAD);
    // With no live arrival time yet, the planned one is shown.
    assert_eq!(live.destination_eta, Some(at(72)));
    assert_eq!(live.alive_at, at(0));
}

#[test]
fn capture_summary_carries_no_place_or_position() {
    let mut tracker = NavigationTracker::default();
    let summary = observe(&mut tracker, &two_stop_trip(5), 0)
        .summary
        .to_string();
    assert!(!summary.contains("Trailhead"));
    assert!(!summary.contains("Donner"));
    assert!(!summary.contains("39."));
    assert!(!summary.contains("120."));
}

#[test]
fn six_digit_lines_are_read_at_six_digits() {
    let mut tracker = NavigationTracker::default();
    let outcome = observe(&mut tracker, &two_stop_trip(6), 0);
    assert_eq!(outcome.summary["polyline_precision"], 6);
    assert_eq!(outcome.summary["polyline_points"], 6);
    assert_eq!(tracker.snapshot().unwrap().route.polyline_precision, 6);
}

#[test]
fn falls_back_to_the_whole_trip_line_when_a_leg_has_none() {
    let overview = encode_polyline(&[START, CHARGER, TRAILHEAD], 5);
    let payload = trip_info(
        vec![
            charging_waypoint(charging_stop("Charger", CHARGER, at(40))),
            place_waypoint(place("Trailhead", TRAILHEAD, at(72))),
        ],
        vec![leg(Some(&encode_polyline(&[START, CHARGER], 5))), leg(None)],
        Some(&overview),
    );
    let mut tracker = NavigationTracker::default();
    let outcome = observe(&mut tracker, &payload, 0);
    assert_eq!(outcome.summary["polyline_source"], "overview");
    assert_eq!(tracker.snapshot().unwrap().route.polylines, vec![overview]);
}

#[test]
fn a_line_that_misses_the_destination_is_dropped_but_the_stops_stay() {
    // The line ends at the charger, not at the destination it claims to reach.
    let wrong = encode_polyline(&[START, CHARGER], 5);
    let payload = trip_info(
        vec![place_waypoint(place("Trailhead", TRAILHEAD, at(72)))],
        vec![leg(Some(&wrong))],
        Some("not a polyline"),
    );
    let mut tracker = NavigationTracker::default();
    let mut notes = Vec::new();
    let outcome = tracker
        .observe_trip_info(&payload, at(0), &mut notes)
        .unwrap();
    assert_eq!(
        notes,
        vec!["dropped a route line that did not lead to the destination"]
    );
    assert_eq!(outcome.summary["polyline_source"], "none");
    let live = tracker.snapshot().unwrap();
    assert!(live.route.polylines.is_empty());
    assert_eq!(live.route.stops.len(), 1);
}

#[test]
fn empty_frames_end_navigation() {
    let mut tracker = NavigationTracker::default();
    // Nothing of this tracker's to end, but the live state is still cleared:
    // an earlier collector may have left a route there.
    let idle = observe(&mut tracker, &[], 0);
    assert!(idle.changed);
    assert_eq!(idle.transition, None);

    observe(&mut tracker, &one_stop_trip(), 1);
    let ended = observe(&mut tracker, &[], 2);
    assert!(ended.changed);
    assert_eq!(ended.transition, Some(NavigationTransition::Ended));
    assert_eq!(ended.summary, json!({ "navigation": "ended" }));
    assert!(tracker.snapshot().is_none());

    // A trip with no stops left is also the end of navigation.
    observe(&mut tracker, &one_stop_trip(), 3);
    let no_stops = observe(&mut tracker, &trip_info(Vec::new(), Vec::new(), None), 4);
    assert_eq!(no_stops.transition, Some(NavigationTransition::Ended));
    assert!(tracker.snapshot().is_none());
}

#[test]
fn a_route_without_a_destination_position_is_not_shown() {
    // Place { name = 4 } with no location.
    let nowhere = place_waypoint(Wire::default().text(4, "Somewhere"));
    let payload = trip_info(vec![nowhere], Vec::new(), None);
    let mut tracker = NavigationTracker::default();
    let mut notes = Vec::new();
    let outcome = tracker
        .observe_trip_info(&payload, at(0), &mut notes)
        .unwrap();
    assert_eq!(
        notes,
        vec!["skipped a route whose destination has no position"]
    );
    assert_eq!(outcome.transition, None);
    assert!(tracker.snapshot().is_none());
}

#[test]
fn stop_names_and_arrival_times_are_cleaned() {
    let long_name = format!("  Trail\u{7}head\n{}", "x".repeat(300));
    // An arrival years away is not a real plan.
    let payload = trip_info(
        vec![place_waypoint(place(
            &long_name,
            TRAILHEAD,
            at(60 * 24 * 900),
        ))],
        Vec::new(),
        None,
    );
    let mut tracker = NavigationTracker::default();
    observe(&mut tracker, &payload, 0);
    let live = tracker.snapshot().unwrap();
    let name = live.route.stops[0].name.as_deref().unwrap();
    assert!(name.starts_with("Trailheadxxx"));
    assert_eq!(name.chars().count(), MAX_NAME_CHARS);
    assert_eq!(live.route.stops[0].arrival_at, None);
    assert_eq!(live.destination_eta, None);
}

#[test]
fn the_same_route_sent_again_keeps_its_id_and_confirms_navigation() {
    let mut tracker = NavigationTracker::default();
    observe(&mut tracker, &one_stop_trip(), 0);
    let again = observe(&mut tracker, &one_stop_trip(), 9);
    assert_eq!(again.transition, None);
    assert_eq!(again.summary, json!({ "navigation": "unchanged" }));
    let live = tracker.snapshot().unwrap();
    let first_id = live.route.id.clone();
    assert_eq!(live.alive_at, at(9));

    // A different route gets a different id; an older frame is ignored.
    observe(&mut tracker, &two_stop_trip(5), 10);
    let second_id = tracker.snapshot().unwrap().route.id.clone();
    assert_ne!(second_id, first_id);
    let mut notes = Vec::new();
    let stale = tracker
        .observe_trip_info(&one_stop_trip(), at(5), &mut notes)
        .unwrap();
    assert!(!stale.changed);
    assert_eq!(notes, vec!["skipped a route older than the current one"]);
    assert_eq!(tracker.snapshot().unwrap().route.id, second_id);
}

#[test]
fn a_route_id_names_its_content_whichever_collector_decoded_it() {
    // A replaced collector starts a new tracker. Its first route must not
    // reuse the id of a different route an open socket was already sent.
    let mut before = NavigationTracker::default();
    observe(&mut before, &one_stop_trip(), 0);
    let mut after = NavigationTracker::default();
    observe(&mut after, &two_stop_trip(5), 1);
    assert_ne!(
        before.snapshot().unwrap().route.id,
        after.snapshot().unwrap().route.id
    );

    // The same route keeps its id, so a socket that has it is not sent it again.
    let mut again = NavigationTracker::default();
    observe(&mut again, &one_stop_trip(), 2);
    assert_eq!(
        before.snapshot().unwrap().route.id,
        again.snapshot().unwrap().route.id
    );
}

#[test]
fn the_next_stop_arrival_is_not_the_destination_arrival_when_an_earlier_stop_was_dropped() {
    // Two stops, the first with no position: one stop is shown, but the
    // vehicle's next stop is still that first one.
    let nowhere = place_waypoint(Wire::default().text(4, "Somewhere"));
    let payload = trip_info(
        vec![
            nowhere,
            place_waypoint(place("Trailhead", TRAILHEAD, at(72))),
        ],
        Vec::new(),
        None,
    );
    let mut tracker = NavigationTracker::default();
    let mut notes = Vec::new();
    tracker
        .observe_trip_info(&payload, at(0), &mut notes)
        .unwrap();
    assert_eq!(notes, vec!["skipped navigation stops without a position"]);
    assert_eq!(tracker.snapshot().unwrap().route.stops.len(), 1);

    tracker.observe_trip_progress(&progress(Some(at(20)), None), at(1), true);
    assert_eq!(tracker.snapshot().unwrap().destination_eta, Some(at(72)));
}

#[test]
fn progress_sets_the_live_arrival_for_the_current_route_only() {
    let mut tracker = NavigationTracker::default();
    // Progress with no route (the vehicle re-sends it after navigation ends).
    let orphan = tracker.observe_trip_progress(&progress(None, Some(at(80))), at(0), true);
    assert!(!orphan.changed);
    assert!(tracker.snapshot().is_none());

    observe(&mut tracker, &two_stop_trip(5), 10);

    // From before this route was planned: it describes the previous trip.
    let earlier = tracker.observe_trip_progress(&progress(None, Some(at(99))), at(9), true);
    assert!(!earlier.changed);
    // A stale position fix: the vehicle is not driving this route right now.
    let stale = tracker.observe_trip_progress(&progress(None, Some(at(99))), at(11), false);
    assert!(!stale.changed);
    let live = tracker.snapshot().unwrap();
    assert_eq!(live.destination_eta, Some(at(72)));
    assert_eq!(live.alive_at, at(10));

    // Live progress moves the arrival time and confirms navigation.
    let fresh = tracker.observe_trip_progress(&progress(Some(at(41)), Some(at(75))), at(12), true);
    assert!(fresh.changed);
    assert_eq!(fresh.summary["live_arrival"], true);
    let live = tracker.snapshot().unwrap();
    assert_eq!(live.destination_eta, Some(at(75)));
    assert_eq!(live.alive_at, at(12));

    // While the vehicle recomputes, the final arrival time is missing: the
    // last live value stays, and the next stop's time is not mistaken for it.
    let recomputing = tracker.observe_trip_progress(&progress(Some(at(42)), None), at(13), true);
    assert_eq!(recomputing.summary["live_arrival"], false);
    let live = tracker.snapshot().unwrap();
    assert_eq!(live.destination_eta, Some(at(75)));
    assert_eq!(live.alive_at, at(13));

    // Frames arriving out of order do not move the state backwards.
    let reordered = tracker.observe_trip_progress(&progress(None, Some(at(60))), at(12), true);
    assert!(!reordered.changed);

    // A new route starts again from its own planned arrival.
    observe(&mut tracker, &one_stop_trip(), 20);
    assert_eq!(tracker.snapshot().unwrap().destination_eta, Some(at(72)));
}

#[test]
fn with_one_stop_left_the_next_stop_arrival_is_the_destination_arrival() {
    let mut tracker = NavigationTracker::default();
    observe(&mut tracker, &one_stop_trip(), 0);
    tracker.observe_trip_progress(&progress(Some(at(70)), None), at(1), true);
    assert_eq!(tracker.snapshot().unwrap().destination_eta, Some(at(70)));

    // An arrival time far outside the trip is ignored.
    tracker.observe_trip_progress(&progress(Some(at(60 * 24 * 400)), None), at(2), true);
    assert_eq!(tracker.snapshot().unwrap().destination_eta, Some(at(70)));
}

#[test]
fn applying_a_frame_publishes_it_and_describes_it_in_a_capture_with_counts_only() {
    use crate::services::live_navigation;

    let vehicle_id = uuid::Uuid::new_v4();
    let live = live_navigation::subscribe(vehicle_id);
    let mut tracker = NavigationTracker::default();

    let mut report = super::super::EnvelopeReport::new();
    let outcome = observe(&mut tracker, &two_stop_trip(5), 0);
    super::super::apply_navigation(vehicle_id, &tracker, outcome, &mut report, true);
    assert_eq!(
        live.borrow().as_ref().unwrap().route.stops[1]
            .name
            .as_deref(),
        Some("Trailhead")
    );
    let captured = report.decoded.unwrap();
    assert_eq!(captured["navigation"], "route");
    assert_eq!(captured["stops"], 2);
    assert!(!captured.to_string().contains("Trailhead"));

    // Outside a capture nothing is recorded, and the end clears the live state.
    let mut report = super::super::EnvelopeReport::new();
    let outcome = observe(&mut tracker, &[], 1);
    super::super::apply_navigation(vehicle_id, &tracker, outcome, &mut report, false);
    assert!(live.borrow().is_none());
    assert!(report.decoded.is_none());
}
