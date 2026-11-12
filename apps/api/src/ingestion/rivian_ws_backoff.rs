//! Reconnect policy shared by the two Rivian subscription sockets.
//!
//! Riviamigo opens two sockets per vehicle with the same Rivian session: the
//! canonical vehicle-state socket (`ws_client`) and the Parallax companion
//! (`parallax`). Rivian rate-limits and rejects credentials per session, so a
//! hold that one socket learns about must also stop the other one from
//! reconnecting. Each socket keeps its own exponential retry delay for
//! ordinary errors; only the hold below is shared.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use rand::Rng;
use sha2::{Digest, Sha256};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;

/// Close reasons Rivian sends instead of a dedicated close code.
pub(crate) const RATE_LIMITED_REASON: &str = "Rate limited";
pub(crate) const UNAUTHENTICATED_REASON: &str = "Unauthenticated";

const HOLD_MIN_SECONDS: u64 = 30;
const HOLD_MAX_SECONDS: u64 = 900;
/// Rejected credentials only recover after a token refresh or reauthorization,
/// so retrying sooner just repeats the rejection.
const UNAUTHENTICATED_MIN_SECONDS: u64 = 300;
/// A session whose hold ended this long ago is forgotten, so rotated session
/// tokens do not accumulate. Its next hold starts from the shortest delay.
const HOLD_STATE_TTL: Duration = Duration::from_secs(60 * 60);

/// Why reconnecting is being held off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HoldReason {
    RateLimited,
    Unauthenticated,
    NotAcknowledged,
}

impl HoldReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::RateLimited => "rate_limited",
            Self::Unauthenticated => "unauthenticated",
            Self::NotAcknowledged => "not_acknowledged",
        }
    }
}

/// Classify a Rivian close frame that must hold off both sockets.
pub(crate) fn hold_reason_for_close(frame: Option<&CloseFrame>) -> Option<HoldReason> {
    let reason = frame?.reason.as_str().trim();
    if reason.eq_ignore_ascii_case(RATE_LIMITED_REASON) {
        Some(HoldReason::RateLimited)
    } else if reason.eq_ignore_ascii_case(UNAUTHENTICATED_REASON) {
        Some(HoldReason::Unauthenticated)
    } else {
        None
    }
}

/// Key for one Rivian user session. Hashed so no token is retained here.
pub(crate) fn session_key(user_session_token: &str) -> [u8; 16] {
    let digest = Sha256::digest(user_session_token.as_bytes());
    let mut key = [0u8; 16];
    key.copy_from_slice(&digest[..16]);
    key
}

#[derive(Debug, Default, Clone, Copy)]
struct HoldState {
    attempt: u32,
    retry_at: Option<Instant>,
    reason: Option<HoldReason>,
}

static HOLDS: LazyLock<Mutex<HashMap<[u8; 16], HoldState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_holds<T>(f: impl FnOnce(&mut HashMap<[u8; 16], HoldState>) -> T) -> T {
    let mut holds = HOLDS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut holds)
}

/// Drop sessions whose last hold ended at least [`HOLD_STATE_TTL`] before `now`.
fn prune_stale_holds(holds: &mut HashMap<[u8; 16], HoldState>, now: Instant) {
    holds.retain(|_, state| {
        state
            .retry_at
            .is_some_and(|retry_at| now.saturating_duration_since(retry_at) < HOLD_STATE_TTL)
    });
}

/// The delay for the `attempt`-th consecutive hold, before the shared state
/// decides whether an existing longer hold wins.
fn hold_delay(reason: HoldReason, attempt: u32) -> Duration {
    let base = HOLD_MIN_SECONDS.saturating_mul(1u64 << attempt.min(10));
    let jitter = rand::thread_rng().gen_range(0..=HOLD_MIN_SECONDS);
    let mut seconds = base.saturating_add(jitter).min(HOLD_MAX_SECONDS);
    if reason == HoldReason::Unauthenticated {
        seconds = seconds.max(UNAUTHENTICATED_MIN_SECONDS);
    }
    Duration::from_secs(seconds)
}

/// Record a hold for every socket using this session and return how long the
/// session now waits. A shorter hold never cuts a longer one short.
pub(crate) fn start_hold(key: [u8; 16], reason: HoldReason) -> Duration {
    let now = Instant::now();
    with_holds(|holds| {
        prune_stale_holds(holds, now);
        let state = holds.entry(key).or_default();
        // Both sockets see the same incident (Rivian closes each of them):
        // while a hold is already running, a second report neither grows the
        // next delay nor shortens this one. Only a credential rejection may
        // lengthen it to its own minimum.
        if let Some(current) = state.retry_at.filter(|at| *at > now) {
            if reason == HoldReason::Unauthenticated
                && state.reason != Some(HoldReason::Unauthenticated)
            {
                let retry_at = now + hold_delay(reason, state.attempt.saturating_sub(1));
                if retry_at > current {
                    state.retry_at = Some(retry_at);
                    state.reason = Some(reason);
                }
            }
            return state
                .retry_at
                .map_or(Duration::ZERO, |at| at.saturating_duration_since(now));
        }
        let delay = hold_delay(reason, state.attempt);
        state.attempt = state.attempt.saturating_add(1);
        let retry_at = now + delay;
        if state.retry_at.is_none_or(|current| retry_at > current) {
            state.retry_at = Some(retry_at);
            state.reason = Some(reason);
        }
        state
            .retry_at
            .map_or(Duration::ZERO, |at| at.saturating_duration_since(now))
    })
}

/// The remaining shared hold, if any.
pub(crate) fn remaining_hold(key: [u8; 16]) -> Option<(Duration, HoldReason)> {
    let now = Instant::now();
    with_holds(|holds| {
        let state = holds.get(&key)?;
        let remaining = state.retry_at?.saturating_duration_since(now);
        (!remaining.is_zero()).then_some((remaining, state.reason?))
    })
}

/// A socket received vehicle data: the session is healthy, so the next hold
/// starts from the shortest delay again. An active hold is left in place.
pub(crate) fn mark_healthy(key: [u8; 16]) {
    with_holds(|holds| {
        if let Some(state) = holds.get_mut(&key) {
            state.attempt = 0;
        }
    });
}

/// A connection ended in a way that holds off every socket for the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SessionHold(pub HoldReason);

impl std::fmt::Display for SessionHold {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.0 {
            HoldReason::RateLimited => f.write_str("Rivian rate limited the subscription socket"),
            HoldReason::Unauthenticated => {
                f.write_str("Rivian rejected the subscription credentials")
            }
            HoldReason::NotAcknowledged => {
                f.write_str("Rivian did not acknowledge the subscription socket")
            }
        }
    }
}

impl std::error::Error for SessionHold {}

/// Wait out any shared hold before connecting. Re-checks after each wait,
/// because the other socket may have extended it. Returns false on shutdown.
pub(crate) async fn wait_for_hold(
    key: [u8; 16],
    shutdown: &mut tokio::sync::broadcast::Receiver<()>,
) -> bool {
    while let Some((remaining, _)) = remaining_hold(key) {
        tokio::select! {
            _ = tokio::time::sleep(remaining) => {}
            _ = shutdown.recv() => return false,
        }
    }
    true
}

/// Ordinary reconnect delay with up to 25% random jitter, so the two sockets
/// (and several vehicles) do not retry in lockstep.
pub(crate) fn jittered_secs(base: u64) -> u64 {
    if base <= 1 {
        return 1;
    }
    base + rand::thread_rng().gen_range(0..=base / 4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

    fn frame(code: u16, reason: &str) -> CloseFrame {
        CloseFrame {
            code: CloseCode::Library(code),
            reason: reason.into(),
        }
    }

    #[test]
    fn classifies_rate_limit_and_auth_closes_by_reason() {
        assert_eq!(
            hold_reason_for_close(Some(&frame(4429, "Rate limited"))),
            Some(HoldReason::RateLimited)
        );
        assert_eq!(
            hold_reason_for_close(Some(&frame(4401, "Unauthenticated"))),
            Some(HoldReason::Unauthenticated)
        );
        assert_eq!(
            hold_reason_for_close(Some(&frame(4420, "Connection TTL expired"))),
            None
        );
        assert_eq!(hold_reason_for_close(None), None);
    }

    #[tokio::test(start_paused = true)]
    async fn holds_are_shared_grow_and_never_shorten() {
        let key = session_key("shared-hold-test");
        assert!(remaining_hold(key).is_none());
        let first = start_hold(key, HoldReason::RateLimited);
        assert!((30..=60).contains(&first.as_secs()));
        let (remaining, reason) = remaining_hold(key).unwrap();
        assert_eq!(reason, HoldReason::RateLimited);
        assert!(remaining <= first);

        // The other socket reports the same incident: one hold, not two.
        let same = start_hold(key, HoldReason::RateLimited);
        assert_eq!(same, remaining);

        // The next incident after the hold ends doubles the delay.
        tokio::time::advance(first + Duration::from_secs(1)).await;
        assert!(remaining_hold(key).is_none());
        let second = start_hold(key, HoldReason::RateLimited);
        assert!((60..=90).contains(&second.as_secs()));

        // Healthy data resets the growth but keeps the current hold.
        mark_healthy(key);
        assert!(remaining_hold(key).is_some());
        tokio::time::advance(Duration::from_secs(HOLD_MAX_SECONDS + 1)).await;
        assert!(remaining_hold(key).is_none());
        let reset = start_hold(key, HoldReason::NotAcknowledged);
        assert!((30..=60).contains(&reset.as_secs()));
    }

    #[test]
    fn stale_session_holds_are_forgotten() {
        let now = Instant::now();
        let hold = |retry_at| HoldState {
            attempt: 3,
            retry_at: Some(retry_at),
            reason: Some(HoldReason::RateLimited),
        };
        let mut holds = HashMap::from([
            ([1u8; 16], hold(now + Duration::from_secs(30))),
            ([2u8; 16], hold(now - Duration::from_secs(60))),
            (
                [3u8; 16],
                hold(now - HOLD_STATE_TTL - Duration::from_secs(1)),
            ),
            ([4u8; 16], HoldState::default()),
        ]);
        prune_stale_holds(&mut holds, now);
        let mut kept: Vec<u8> = holds.keys().map(|key| key[0]).collect();
        kept.sort_unstable();
        assert_eq!(kept, vec![1, 2]);
    }

    #[test]
    fn unauthenticated_waits_for_a_credential_refresh() {
        assert!(
            hold_delay(HoldReason::Unauthenticated, 0)
                >= Duration::from_secs(UNAUTHENTICATED_MIN_SECONDS)
        );
        assert!(hold_delay(HoldReason::RateLimited, 30) <= Duration::from_secs(HOLD_MAX_SECONDS));
    }

    #[test]
    fn jitter_stays_within_a_quarter() {
        for _ in 0..100 {
            let value = jittered_secs(100);
            assert!((100..=125).contains(&value));
        }
        assert_eq!(jittered_secs(0), 1);
    }
}
