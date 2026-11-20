//! Live navigation shown on the Vehicle Overview map.
//!
//! While the vehicle is navigating it reports its planned route, stops, and
//! arrival time. That state is held here in process memory only, for the live
//! socket to read: it is never written to the database, Redis, telemetry
//! history, backups, or ingestion captures, and it is gone on restart.
//!
//! The Parallax collector publishes the latest state per vehicle and each
//! live socket subscribes to it, so a client that connects mid-drive gets the
//! current route at once.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::watch;
use uuid::Uuid;

/// Navigation is shown only while the vehicle keeps confirming it. The
/// vehicle clears its route when navigation ends; this window covers a route
/// that was never cleared because the vehicle went offline or to sleep.
pub const LIVE_WINDOW: Duration = Duration::minutes(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NavigationStopKind {
    /// A destination the driver chose, including a charger they picked.
    Place,
    /// A charging stop the route planner added.
    Charging,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NavigationStop {
    pub kind: NavigationStopKind,
    pub name: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
    /// The arrival time planned when the route was computed.
    pub arrival_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NavigationRoute {
    /// Changes whenever the vehicle sends a different route.
    pub id: String,
    /// Encoded polylines in driving order, one per leg (or one for the trip).
    pub polylines: Vec<String>,
    /// Decimal digits the polylines are encoded with, verified on decode.
    pub polyline_precision: u8,
    /// Remaining stops in order; the last one is the destination.
    pub stops: Vec<NavigationStop>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LiveNavigation {
    pub route: Arc<NavigationRoute>,
    /// The vehicle's live arrival time at the destination, falling back to
    /// the planned one.
    pub destination_eta: Option<DateTime<Utc>>,
    /// When the vehicle last confirmed it is navigating this route.
    pub alive_at: DateTime<Utc>,
}

impl LiveNavigation {
    pub fn is_alive(&self, now: DateTime<Utc>) -> bool {
        now - self.alive_at <= LIVE_WINDOW
    }
}

type Shared = Option<Arc<LiveNavigation>>;

fn hub() -> &'static Mutex<HashMap<Uuid, watch::Sender<Shared>>> {
    static HUB: OnceLock<Mutex<HashMap<Uuid, watch::Sender<Shared>>>> = OnceLock::new();
    HUB.get_or_init(Mutex::default)
}

fn sender(vehicle_id: Uuid) -> watch::Sender<Shared> {
    let mut vehicles = hub()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    vehicles
        .entry(vehicle_id)
        .or_insert_with(|| watch::channel(None).0)
        .clone()
}

/// Replace a vehicle's live navigation; `None` means it is not navigating.
pub fn publish(vehicle_id: Uuid, navigation: Option<LiveNavigation>) {
    sender(vehicle_id).send_replace(navigation.map(Arc::new));
}

/// Follow a vehicle's live navigation, starting from its current state.
pub fn subscribe(vehicle_id: Uuid) -> watch::Receiver<Shared> {
    sender(vehicle_id).subscribe()
}

/// What one live socket has already been told, so an unchanged route (the
/// large part of the state) is sent once rather than with every update.
#[derive(Debug, Default)]
pub struct NavigationCursor {
    sent: Option<SentNavigation>,
}

#[derive(Debug, PartialEq)]
enum SentNavigation {
    Inactive,
    Active {
        route_id: String,
        destination_eta: Option<DateTime<Utc>>,
    },
}

impl NavigationCursor {
    /// The next message for this socket, or `None` when nothing it was told
    /// has changed. A state the vehicle stopped confirming is sent as
    /// inactive.
    pub fn next_message(
        &mut self,
        navigation: Option<&LiveNavigation>,
        now: DateTime<Utc>,
    ) -> Option<String> {
        let Some(navigation) = navigation.filter(|navigation| navigation.is_alive(now)) else {
            if self.sent == Some(SentNavigation::Inactive) {
                return None;
            }
            self.sent = Some(SentNavigation::Inactive);
            return Some(message(now, json!({ "active": false })));
        };
        let next = SentNavigation::Active {
            route_id: navigation.route.id.clone(),
            destination_eta: navigation.destination_eta,
        };
        if self.sent.as_ref() == Some(&next) {
            return None;
        }
        let route_known = matches!(
            &self.sent,
            Some(SentNavigation::Active { route_id, .. }) if *route_id == navigation.route.id
        );
        let mut body = json!({
            "active": true,
            "route_id": navigation.route.id,
            "destination_eta": navigation.destination_eta,
        });
        if !route_known {
            body["route"] = json!(navigation.route.as_ref());
        }
        self.sent = Some(next);
        Some(message(now, body))
    }
}

/// Navigation frames carry no `data` key, so a client that predates them
/// treats one as a control frame instead of a vehicle status update.
fn message(now: DateTime<Utc>, navigation: Value) -> String {
    json!({ "type": "navigation", "ts": now, "navigation": navigation }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn navigation(route_id: &str, eta_minute: u32, alive_at: DateTime<Utc>) -> LiveNavigation {
        LiveNavigation {
            route: Arc::new(NavigationRoute {
                id: route_id.into(),
                polylines: vec!["_p~iF~ps|U_ulLnnqC".into()],
                polyline_precision: 5,
                stops: vec![NavigationStop {
                    kind: NavigationStopKind::Place,
                    name: Some("Trailhead".into()),
                    latitude: 40.7,
                    longitude: -120.95,
                    arrival_at: None,
                }],
            }),
            destination_eta: Some(
                "2026-11-19T16:00:00Z".parse::<DateTime<Utc>>().unwrap()
                    + Duration::minutes(i64::from(eta_minute)),
            ),
            alive_at,
        }
    }

    fn parsed(message: Option<String>) -> Value {
        serde_json::from_str(&message.expect("a message")).unwrap()
    }

    #[test]
    fn cursor_sends_the_route_once_and_then_only_what_changed() {
        let now = Utc::now();
        let mut cursor = NavigationCursor::default();

        let first = parsed(cursor.next_message(Some(&navigation("1", 12, now)), now));
        assert_eq!(first["type"], "navigation");
        assert!(first.get("data").is_none());
        assert_eq!(first["navigation"]["active"], true);
        assert_eq!(
            first["navigation"]["route"]["stops"][0]["name"],
            "Trailhead"
        );
        assert_eq!(first["navigation"]["route"]["stops"][0]["kind"], "place");

        // Nothing changed: no frame.
        assert!(cursor
            .next_message(Some(&navigation("1", 12, now)), now)
            .is_none());

        // A new arrival time on the same route leaves the route out.
        let eta = parsed(cursor.next_message(Some(&navigation("1", 14, now)), now));
        assert!(eta["navigation"].get("route").is_none());
        assert_eq!(eta["navigation"]["route_id"], "1");
        assert_eq!(eta["navigation"]["destination_eta"], "2026-11-19T16:14:00Z");

        // A different route is sent in full again.
        let rerouted = parsed(cursor.next_message(Some(&navigation("2", 14, now)), now));
        assert_eq!(rerouted["navigation"]["route"]["id"], "2");
    }

    #[test]
    fn cursor_reports_inactive_once_when_navigation_ends_or_goes_quiet() {
        let now = Utc::now();
        let mut cursor = NavigationCursor::default();

        // A new socket is always told the current state, even when idle.
        let idle = parsed(cursor.next_message(None, now));
        assert_eq!(idle["navigation"], json!({ "active": false }));
        assert!(cursor.next_message(None, now).is_none());

        let live = navigation("1", 12, now);
        assert!(cursor.next_message(Some(&live), now).is_some());

        // The vehicle stopped confirming the route: it is no longer shown.
        let later = now + LIVE_WINDOW + Duration::seconds(1);
        let quiet = parsed(cursor.next_message(Some(&live), later));
        assert_eq!(quiet["navigation"], json!({ "active": false }));
        assert!(cursor.next_message(Some(&live), later).is_none());

        // Confirmed again: the route is sent in full, since inactive cleared it.
        let resumed = navigation("1", 12, later);
        let message = parsed(cursor.next_message(Some(&resumed), later));
        assert_eq!(message["navigation"]["route"]["id"], "1");
    }

    #[test]
    fn hub_hands_the_current_state_to_a_late_subscriber() {
        let vehicle_id = Uuid::new_v4();
        let now = Utc::now();
        publish(vehicle_id, Some(navigation("7", 1, now)));

        let receiver = subscribe(vehicle_id);
        assert_eq!(receiver.borrow().as_ref().unwrap().route.id, "7");

        publish(vehicle_id, None);
        assert!(receiver.borrow().is_none());
        assert!(receiver.has_changed().unwrap());
    }
}
