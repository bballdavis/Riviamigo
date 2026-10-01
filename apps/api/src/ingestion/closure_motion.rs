//! Live opening/closing state for closures.
//!
//! Parallax reports a closure in motion as AJAR, OPENING, or CLOSING. The
//! stored closure fields only say "closed" or "not closed", so this tracker
//! keeps the motion separately for the live status stream. AJAR carries no
//! direction: a closure that was last seen closed is opening, and one that
//! was last seen open is closing. Nothing here is persisted.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::models::telemetry::{ClosureTransition, TelemetryEvent};

/// Motion that never settles (for example a missed final frame) stops
/// showing after this long.
const MOTION_TTL: Duration = Duration::seconds(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClosureMotion {
    Opening,
    Closing,
}

pub type ClosureMotionMap = BTreeMap<String, ClosureMotion>;

#[derive(Debug, Default)]
pub struct ClosureMotionTracker {
    settled_closed: BTreeMap<String, bool>,
    motion: BTreeMap<String, (ClosureMotion, DateTime<Utc>)>,
}

impl ClosureMotionTracker {
    /// Fold in one sample from any source. Returns the full motion map when
    /// it changed, so the status stream can replace the previous one.
    pub fn observe(
        &mut self,
        event: &TelemetryEvent,
        now: DateTime<Utc>,
    ) -> Option<ClosureMotionMap> {
        let before = self.current();
        let transitions = event.closure_transitions.clone().unwrap_or_default();

        for (field, closed) in closure_values(event) {
            let Some(closed) = closed else {
                continue;
            };
            if transitions.contains_key(field) {
                continue;
            }
            self.settled_closed.insert(field.to_owned(), closed);
            // A settled reading ends the movement it completes. Legacy can
            // lag Parallax by a second or two, so a late reading of the
            // starting state does not cancel the movement.
            if let Some((motion, _)) = self.motion.get(field) {
                let completes = match motion {
                    ClosureMotion::Opening => !closed,
                    ClosureMotion::Closing => closed,
                };
                if completes {
                    self.motion.remove(field);
                }
            }
        }

        for (field, transition) in transitions {
            let motion = match transition {
                ClosureTransition::Opening => Some(ClosureMotion::Opening),
                ClosureTransition::Closing => Some(ClosureMotion::Closing),
                ClosureTransition::Ajar => match self.settled_closed.get(&field) {
                    Some(true) => Some(ClosureMotion::Opening),
                    Some(false) => Some(ClosureMotion::Closing),
                    // No settled state yet: keep any direction already known.
                    None => self.motion.get(&field).map(|(motion, _)| *motion),
                },
            };
            if let Some(motion) = motion {
                self.motion.insert(field, (motion, now));
            }
        }

        self.motion.retain(|_, (_, at)| now - *at < MOTION_TTL);
        let after = self.current();
        (after != before).then_some(after)
    }

    fn current(&self) -> ClosureMotionMap {
        self.motion
            .iter()
            .map(|(field, (motion, _))| (field.clone(), *motion))
            .collect()
    }
}

/// Every closure field that can be in motion, keyed as Parallax reports it.
fn closure_values(event: &TelemetryEvent) -> [(&'static str, Option<bool>); 14] {
    [
        ("door_front_left_closed", event.door_front_left_closed),
        ("door_front_right_closed", event.door_front_right_closed),
        ("door_rear_left_closed", event.door_rear_left_closed),
        ("door_rear_right_closed", event.door_rear_right_closed),
        ("closure_frunk_closed", event.closure_frunk_closed),
        ("closure_tailgate_closed", event.closure_tailgate_closed),
        ("closure_liftgate_closed", event.closure_liftgate_closed),
        ("tonneau_closed", event.tonneau_closed),
        ("side_bin_left_closed", event.side_bin_left_closed),
        ("side_bin_right_closed", event.side_bin_right_closed),
        ("window_fl_closed", event.window_fl_closed),
        ("window_fr_closed", event.window_fr_closed),
        ("window_rl_closed", event.window_rl_closed),
        ("window_rr_closed", event.window_rr_closed),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn at(seconds: i64) -> DateTime<Utc> {
        "2026-10-01T02:15:00Z".parse::<DateTime<Utc>>().unwrap() + Duration::seconds(seconds)
    }

    fn frunk(closed: bool, transition: Option<ClosureTransition>) -> TelemetryEvent {
        let mut event = TelemetryEvent::empty(Uuid::nil(), at(0));
        event.closure_frunk_closed = Some(closed);
        if let Some(transition) = transition {
            event.closure_transitions = Some(BTreeMap::from([(
                "closure_frunk_closed".to_owned(),
                transition,
            )]));
        }
        event
    }

    fn only(field: &str, motion: ClosureMotion) -> Option<ClosureMotionMap> {
        Some(BTreeMap::from([(field.to_owned(), motion)]))
    }

    #[test]
    fn ajar_after_open_is_closing_until_it_latches() {
        // Observed R1S frunk close: open, AJAR, then CLOSE.
        let mut tracker = ClosureMotionTracker::default();
        assert_eq!(tracker.observe(&frunk(false, None), at(0)), None);
        assert_eq!(
            tracker.observe(&frunk(false, Some(ClosureTransition::Ajar)), at(1)),
            only("closure_frunk_closed", ClosureMotion::Closing)
        );
        assert_eq!(
            tracker.observe(&frunk(true, None), at(2)),
            Some(BTreeMap::new())
        );
    }

    #[test]
    fn ajar_after_closed_is_opening() {
        let mut tracker = ClosureMotionTracker::default();
        tracker.observe(&frunk(true, None), at(0));
        assert_eq!(
            tracker.observe(&frunk(false, Some(ClosureTransition::Ajar)), at(1)),
            only("closure_frunk_closed", ClosureMotion::Opening)
        );
        // A lagging legacy "closed" does not cancel the opening.
        assert_eq!(tracker.observe(&frunk(true, None), at(2)), None);
        assert_eq!(
            tracker.observe(&frunk(false, None), at(3)),
            Some(BTreeMap::new())
        );
    }

    #[test]
    fn explicit_opening_and_closing_need_no_history() {
        let mut tracker = ClosureMotionTracker::default();
        assert_eq!(
            tracker.observe(&frunk(false, Some(ClosureTransition::Closing)), at(0)),
            only("closure_frunk_closed", ClosureMotion::Closing)
        );
        let mut fresh = ClosureMotionTracker::default();
        assert_eq!(
            fresh.observe(&frunk(false, Some(ClosureTransition::Opening)), at(0)),
            only("closure_frunk_closed", ClosureMotion::Opening)
        );
    }

    #[test]
    fn ajar_without_history_shows_nothing() {
        let mut tracker = ClosureMotionTracker::default();
        assert_eq!(
            tracker.observe(&frunk(false, Some(ClosureTransition::Ajar)), at(0)),
            None
        );
    }

    #[test]
    fn motion_that_never_settles_expires() {
        let mut tracker = ClosureMotionTracker::default();
        tracker.observe(&frunk(false, Some(ClosureTransition::Closing)), at(0));
        let unrelated = TelemetryEvent::empty(Uuid::nil(), at(31));
        assert_eq!(tracker.observe(&unrelated, at(31)), Some(BTreeMap::new()));
    }
}
