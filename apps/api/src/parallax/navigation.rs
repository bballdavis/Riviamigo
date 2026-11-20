//! The vehicle's planned route and arrival time, for the live map.
//!
//! `navigation.navigation_service.trip_info` carries the route the vehicle's
//! own planner computed: the remaining stops and an encoded line per leg. It
//! is sent again whenever the route changes and sent empty when navigation
//! ends. `trip_progress` carries the live arrival time about every five
//! seconds, and keeps being re-sent after navigation ends.
//!
//! Everything decoded here is live-only. It goes to
//! [`crate::services::live_navigation`] in memory and nowhere else: no table,
//! no telemetry history, no capture payload. Capture records describe a frame
//! with counts, never with a place name or a coordinate.

use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Duration, TimeZone, Utc};
use prost::Message as ProstMessage;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{NavigationCoordinate, NavigationTimestamp, NavigationTripProgress};
use crate::services::live_navigation::{
    LiveNavigation, NavigationRoute, NavigationStop, NavigationStopKind,
};

pub(super) const TRIP_INFO_TOPIC: &str = "navigation.navigation_service.trip_info";
pub(super) const TRIP_PROGRESS_TOPIC: &str = "navigation.navigation_service.trip_progress";

/// Bounds on what one route may hand to the live socket.
const MAX_STOPS: usize = 40;
const MAX_NAME_CHARS: usize = 120;
const MAX_POLYLINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_POLYLINE_POINTS: usize = 400_000;
/// A decoded route line must end this close to the destination it leads to.
/// Reading a line at the wrong precision misses by far more than this.
const DESTINATION_MATCH_METERS: f64 = 5_000.0;
/// Arrival times outside this range around the frame are not believable.
const ARRIVAL_MAX_PAST: Duration = Duration::days(2);
const ARRIVAL_MAX_AHEAD: Duration = Duration::days(60);

// Field numbers follow rivian-python-client's reverse-engineered
// `navigation.proto`. Only what the map shows is modelled; prost drops the
// rest (origin, energy, traffic, preferences) on decode.
#[derive(Clone, PartialEq, ProstMessage)]
struct TripInfo {
    #[prost(message, optional, tag = "3")]
    trip: Option<Trip>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct Trip {
    #[prost(message, repeated, tag = "3")]
    waypoints: Vec<Waypoint>,
    #[prost(message, repeated, tag = "4")]
    legs: Vec<Leg>,
    /// The whole trip as one line, used when a leg has no line of its own.
    #[prost(string, optional, tag = "10")]
    overview_polyline: Option<String>,
}

#[derive(Clone, PartialEq, ProstMessage)]
struct Waypoint {
    #[prost(message, optional, tag = "1")]
    place: Option<Place>,
    #[prost(message, optional, tag = "2")]
    charging_stop: Option<ChargingStop>,
}

/// A destination the driver chose, including a charger they picked.
#[derive(Clone, PartialEq, ProstMessage)]
struct Place {
    #[prost(message, optional, tag = "1")]
    location: Option<NavigationCoordinate>,
    /// The point on the road the route actually leads to.
    #[prost(message, optional, tag = "2")]
    snapped_location: Option<NavigationCoordinate>,
    #[prost(string, optional, tag = "4")]
    name: Option<String>,
    #[prost(message, optional, tag = "9")]
    arrival: Option<NavigationTimestamp>,
}

/// A charging stop the route planner added.
#[derive(Clone, PartialEq, ProstMessage)]
struct ChargingStop {
    /// The station's address, with its network in brackets.
    #[prost(string, optional, tag = "2")]
    label: Option<String>,
    #[prost(message, optional, tag = "3")]
    location: Option<NavigationCoordinate>,
    #[prost(message, optional, tag = "11")]
    arrival_time: Option<NavigationTimestamp>,
}

/// The drive to one waypoint: `legs[i]` leads to `waypoints[i]`.
#[derive(Clone, PartialEq, ProstMessage)]
struct Leg {
    #[prost(string, optional, tag = "4")]
    polyline: Option<String>,
}

#[derive(Debug)]
struct TrackedRoute {
    route: Arc<NavigationRoute>,
    /// The vehicle's timestamp for the frame that carried this route.
    source_at: DateTime<Utc>,
    payload_hash: Vec<u8>,
    planned_eta: Option<DateTime<Utc>>,
    /// The vehicle reported exactly one stop, so its next stop is the
    /// destination. Counted before stops without a position were dropped.
    next_stop_is_destination: bool,
}

/// One vehicle's navigation state, folded from its Parallax frames.
#[derive(Debug, Default)]
pub(crate) struct NavigationTracker {
    route: Option<TrackedRoute>,
    live_eta: Option<DateTime<Utc>>,
    progress_at: Option<DateTime<Utc>>,
    alive_at: Option<DateTime<Utc>>,
}

/// What a frame did to the tracked state.
#[derive(Debug, PartialEq)]
pub(crate) struct NavigationOutcome {
    /// The state changed and should be published.
    pub(crate) changed: bool,
    /// Navigation began or ended with this frame.
    pub(crate) transition: Option<NavigationTransition>,
    /// Counts for an ingestion capture; never a name or a coordinate.
    pub(crate) summary: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NavigationTransition {
    Started,
    Ended,
}

impl NavigationTracker {
    /// The state to publish, or `None` when the vehicle is not navigating.
    pub(crate) fn snapshot(&self) -> Option<LiveNavigation> {
        let tracked = self.route.as_ref()?;
        Some(LiveNavigation {
            route: Arc::clone(&tracked.route),
            destination_eta: self.live_eta.or(tracked.planned_eta),
            alive_at: self.alive_at.unwrap_or(tracked.source_at),
        })
    }

    /// Fold in a `trip_info` frame: a new route, the same route again, or an
    /// empty frame that ends navigation.
    pub(crate) fn observe_trip_info(
        &mut self,
        payload: &[u8],
        source_at: DateTime<Utc>,
        notes: &mut Vec<String>,
    ) -> Result<NavigationOutcome> {
        if self
            .route
            .as_ref()
            .is_some_and(|current| source_at < current.source_at)
        {
            notes.push("skipped a route older than the current one".into());
            return Ok(unchanged("stale"));
        }
        let payload_hash = Sha256::digest(payload).to_vec();
        if let Some(current) = self.route.as_mut() {
            if current.payload_hash == payload_hash {
                // The vehicle sent the same route again: it is still navigating.
                current.source_at = source_at;
                self.alive_at = self.alive_at.max(Some(source_at));
                return Ok(NavigationOutcome {
                    changed: true,
                    transition: None,
                    summary: json!({ "navigation": "unchanged" }),
                });
            }
        }

        let info = TripInfo::decode(payload)?;
        let was_navigating = self.route.is_some();
        // The id names the route's content, so it never repeats for a
        // different route: a socket that was sent this id has this geometry,
        // whichever collector produced it.
        let id = hex::encode(&payload_hash[..8]);
        let Some(built) = build_route(info, id, source_at, notes) else {
            self.route = None;
            self.live_eta = None;
            self.progress_at = None;
            self.alive_at = None;
            return Ok(NavigationOutcome {
                // Published even when this tracker held no route, so a route
                // an earlier collector left in the live hub is cleared too.
                changed: true,
                transition: was_navigating.then_some(NavigationTransition::Ended),
                summary: json!({ "navigation": "ended" }),
            });
        };
        let summary = json!({
            "navigation": "route",
            "stops": built.route.stops.len(),
            "charging_stops": built
                .route
                .stops
                .iter()
                .filter(|stop| stop.kind == NavigationStopKind::Charging)
                .count(),
            "polyline_source": built.line.source,
            "polyline_precision": built.route.polyline_precision,
            "polyline_points": built.line.points,
        });
        self.route = Some(TrackedRoute {
            route: Arc::new(built.route),
            source_at,
            payload_hash,
            planned_eta: built.planned_eta,
            next_stop_is_destination: built.waypoints == 1,
        });
        // A live arrival time belongs to the route it was reported for.
        self.live_eta = None;
        self.progress_at = None;
        self.alive_at = Some(source_at);
        Ok(NavigationOutcome {
            changed: true,
            transition: (!was_navigating).then_some(NavigationTransition::Started),
            summary,
        })
    }

    /// Fold in a `trip_progress` frame. `fix_is_fresh` says its position fix
    /// is recent: the vehicle keeps re-sending its last progress after
    /// navigation ends, and only a fresh fix shows it is still driving the
    /// route.
    pub(crate) fn observe_trip_progress(
        &mut self,
        progress: &NavigationTripProgress,
        source_at: DateTime<Utc>,
        fix_is_fresh: bool,
    ) -> NavigationOutcome {
        let Some(tracked) = self.route.as_ref() else {
            return unchanged("no_route");
        };
        if !fix_is_fresh {
            return unchanged("stale_progress");
        }
        // Progress from before this route was planned describes the last one.
        if source_at < tracked.source_at || self.progress_at.is_some_and(|at| source_at < at) {
            return unchanged("old_progress");
        }
        let plausible = |at: &DateTime<Utc>| arrival_is_plausible(*at, source_at);
        // The final-destination time is missing while the vehicle recomputes
        // the route, so the last live value is kept. With one stop left the
        // next stop is the destination.
        let live_eta = timestamp(progress.final_destination_eta.as_ref())
            .filter(plausible)
            .or_else(|| {
                tracked
                    .next_stop_is_destination
                    .then(|| timestamp(progress.next_waypoint_eta.as_ref()))
                    .flatten()
                    .filter(plausible)
            });
        if live_eta.is_some() {
            self.live_eta = live_eta;
        }
        self.progress_at = Some(source_at);
        self.alive_at = self.alive_at.max(Some(source_at));
        NavigationOutcome {
            changed: true,
            transition: None,
            summary: json!({ "navigation": "progress", "live_arrival": live_eta.is_some() }),
        }
    }
}

fn unchanged(reason: &'static str) -> NavigationOutcome {
    NavigationOutcome {
        changed: false,
        transition: None,
        summary: json!({ "navigation": reason }),
    }
}

struct BuiltRoute {
    route: NavigationRoute,
    planned_eta: Option<DateTime<Utc>>,
    line: LineSummary,
    /// Stops the vehicle reported, including any dropped for lacking a position.
    waypoints: usize,
}

struct LineSummary {
    source: &'static str,
    points: usize,
}

/// A decoded stop and the point its route line must reach.
struct BuiltStop {
    stop: NavigationStop,
    route_end: (f64, f64),
}

/// Build the route from a frame, or `None` when it describes no trip (the
/// frame the vehicle sends once navigation ends).
fn build_route(
    info: TripInfo,
    id: String,
    source_at: DateTime<Utc>,
    notes: &mut Vec<String>,
) -> Option<BuiltRoute> {
    let trip = info.trip?;
    if trip.waypoints.is_empty() {
        return None;
    }
    let mut stops: Vec<Option<BuiltStop>> = trip
        .waypoints
        .iter()
        .map(|waypoint| build_stop(waypoint, source_at))
        .collect();
    // Without a destination there is nothing to lead the route to.
    let Some(destination) = stops.pop().flatten() else {
        notes.push("skipped a route whose destination has no position".into());
        return None;
    };
    let waypoint_count = stops.len() + 1;
    let mut stops: Vec<BuiltStop> = stops.into_iter().flatten().collect();
    if stops.len() + 1 < waypoint_count {
        notes.push("skipped navigation stops without a position".into());
    }
    if stops.len() + 1 > MAX_STOPS {
        notes.push("kept only the nearest navigation stops".into());
        stops.truncate(MAX_STOPS - 1);
    }
    let (polylines, precision, line) = route_line(&trip, destination.route_end, notes);
    let planned_eta = destination.stop.arrival_at;
    stops.push(destination);
    Some(BuiltRoute {
        route: NavigationRoute {
            id,
            polylines,
            polyline_precision: precision,
            stops: stops.into_iter().map(|built| built.stop).collect(),
        },
        planned_eta,
        line,
        waypoints: waypoint_count,
    })
}

fn build_stop(waypoint: &Waypoint, source_at: DateTime<Utc>) -> Option<BuiltStop> {
    let planned = |at: Option<&NavigationTimestamp>| {
        timestamp(at).filter(|at| arrival_is_plausible(*at, source_at))
    };
    if let Some(place) = &waypoint.place {
        let pin = coordinate(place.location.as_ref());
        let snapped = coordinate(place.snapped_location.as_ref());
        let (latitude, longitude) = pin.or(snapped)?;
        return Some(BuiltStop {
            stop: NavigationStop {
                kind: NavigationStopKind::Place,
                name: clean_name(place.name.as_deref()),
                latitude,
                longitude,
                arrival_at: planned(place.arrival.as_ref()),
            },
            route_end: snapped.or(pin)?,
        });
    }
    let charging = waypoint.charging_stop.as_ref()?;
    let (latitude, longitude) = coordinate(charging.location.as_ref())?;
    Some(BuiltStop {
        stop: NavigationStop {
            kind: NavigationStopKind::Charging,
            name: clean_name(charging.label.as_deref()),
            latitude,
            longitude,
            arrival_at: planned(charging.arrival_time.as_ref()),
        },
        route_end: (latitude, longitude),
    })
}

/// The route's encoded lines and the precision they decode at. The per-leg
/// lines follow the road closely; the whole-trip line is the fallback. A line
/// is used only when it decodes to a path ending at the destination, which
/// also settles whether it was encoded with five or six decimal digits.
fn route_line(
    trip: &Trip,
    destination: (f64, f64),
    notes: &mut Vec<String>,
) -> (Vec<String>, u8, LineSummary) {
    let leg_lines: Vec<&str> = trip
        .legs
        .iter()
        .filter_map(|leg| leg.polyline.as_deref())
        .filter(|line| !line.is_empty())
        .collect();
    let every_leg_has_a_line = !trip.legs.is_empty() && leg_lines.len() == trip.legs.len();
    let overview: Vec<&str> = trip
        .overview_polyline
        .as_deref()
        .filter(|line| !line.is_empty())
        .into_iter()
        .collect();
    let candidates = [
        (
            "legs",
            if every_leg_has_a_line {
                leg_lines
            } else {
                Vec::new()
            },
        ),
        ("overview", overview),
    ];
    let mut offered = false;
    for (source, lines) in candidates {
        if lines.is_empty() {
            continue;
        }
        offered = true;
        if lines.iter().map(|line| line.len()).sum::<usize>() > MAX_POLYLINE_BYTES {
            continue;
        }
        if let Some((precision, points)) = verified_precision(&lines, destination) {
            let lines = lines.into_iter().map(str::to_owned).collect();
            return (lines, precision, LineSummary { source, points });
        }
    }
    if offered {
        notes.push("dropped a route line that did not lead to the destination".into());
    }
    (
        Vec::new(),
        5,
        LineSummary {
            source: "none",
            points: 0,
        },
    )
}

/// The precision at which these lines decode to a path ending at
/// `destination`, with the number of points on it.
fn verified_precision(lines: &[&str], destination: (f64, f64)) -> Option<(u8, usize)> {
    [5_u8, 6].into_iter().find_map(|precision| {
        let mut points = 0;
        let mut end = None;
        for line in lines {
            let decoded = decode_polyline(line, precision)?;
            points += decoded.len();
            if points > MAX_POLYLINE_POINTS {
                return None;
            }
            end = decoded.last().copied().or(end);
        }
        let end = end?;
        (distance_meters(end, destination) <= DESTINATION_MATCH_METERS)
            .then_some((precision, points))
    })
}

/// Decode an encoded polyline into `(latitude, longitude)` points, or `None`
/// when it is malformed or leaves the globe.
fn decode_polyline(encoded: &str, precision: u8) -> Option<Vec<(f64, f64)>> {
    let factor = 10_f64.powi(i32::from(precision));
    let bytes = encoded.as_bytes();
    let mut index = 0;
    let (mut latitude, mut longitude) = (0_i64, 0_i64);
    let mut points = Vec::new();
    while index < bytes.len() {
        latitude = latitude.checked_add(next_delta(bytes, &mut index)?)?;
        longitude = longitude.checked_add(next_delta(bytes, &mut index)?)?;
        let point = (latitude as f64 / factor, longitude as f64 / factor);
        if !is_position(point) {
            return None;
        }
        points.push(point);
    }
    Some(points)
}

fn next_delta(bytes: &[u8], index: &mut usize) -> Option<i64> {
    let mut value = 0_i64;
    let mut shift = 0_u32;
    loop {
        let chunk = i64::from(*bytes.get(*index)?) - 63;
        *index += 1;
        if !(0..64).contains(&chunk) || shift > 55 {
            return None;
        }
        value |= (chunk & 0x1f) << shift;
        shift += 5;
        if chunk < 0x20 {
            break;
        }
    }
    Some(if value & 1 == 1 {
        !(value >> 1)
    } else {
        value >> 1
    })
}

fn coordinate(coordinate: Option<&NavigationCoordinate>) -> Option<(f64, f64)> {
    let coordinate = coordinate?;
    Some((coordinate.latitude?, coordinate.longitude?)).filter(|point| is_position(*point))
}

fn is_position((latitude, longitude): (f64, f64)) -> bool {
    latitude.is_finite()
        && longitude.is_finite()
        && (-90.0..=90.0).contains(&latitude)
        && (-180.0..=180.0).contains(&longitude)
        // Null Island is an unset coordinate, not a place a route leads to.
        && !(latitude == 0.0 && longitude == 0.0)
}

fn clean_name(name: Option<&str>) -> Option<String> {
    let name: String = name?
        .chars()
        .filter(|character| !character.is_control())
        .collect();
    let name = name.trim();
    (!name.is_empty()).then(|| name.chars().take(MAX_NAME_CHARS).collect())
}

fn timestamp(timestamp: Option<&NavigationTimestamp>) -> Option<DateTime<Utc>> {
    Utc.timestamp_opt(timestamp?.seconds?, 0).single()
}

fn arrival_is_plausible(arrival: DateTime<Utc>, reference: DateTime<Utc>) -> bool {
    arrival >= reference - ARRIVAL_MAX_PAST && arrival <= reference + ARRIVAL_MAX_AHEAD
}

/// Great-circle distance in meters.
fn distance_meters(a: (f64, f64), b: (f64, f64)) -> f64 {
    const EARTH_RADIUS_METERS: f64 = 6_371_000.0;
    let (lat_a, lat_b) = (a.0.to_radians(), b.0.to_radians());
    let half_lat = (lat_b - lat_a) / 2.0;
    let half_lng = (b.1 - a.1).to_radians() / 2.0;
    let h = half_lat.sin().powi(2) + lat_a.cos() * lat_b.cos() * half_lng.sin().powi(2);
    2.0 * EARTH_RADIUS_METERS * h.sqrt().asin()
}

#[cfg(test)]
mod tests;
