use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NominatimLane {
    InteractiveSearch,
    BackgroundReverseGeocode,
}

#[derive(Clone, Copy, Debug)]
pub struct NominatimSlot {
    pub lane: NominatimLane,
    pub queued_ms: u64,
    pub gate_wait_ms: u64,
    pub effective_interval_ms: u64,
}

#[derive(Debug)]
struct NominatimState {
    next_allowed: Instant,
    adaptive_extra_ms: u64,
}

#[derive(Debug)]
struct NominatimScheduler {
    state: tokio::sync::Mutex<NominatimState>,
    interactive_waiters: AtomicUsize,
    base_interval_ms: u64,
    max_adaptive_extra_ms: u64,
}

impl NominatimScheduler {
    fn new(base_interval_ms: u64, max_adaptive_extra_ms: u64) -> Self {
        Self {
            state: tokio::sync::Mutex::new(NominatimState {
                next_allowed: Instant::now(),
                adaptive_extra_ms: 0,
            }),
            interactive_waiters: AtomicUsize::new(0),
            base_interval_ms,
            max_adaptive_extra_ms,
        }
    }

    async fn acquire_slot(&self, lane: NominatimLane) -> NominatimSlot {
        if lane == NominatimLane::InteractiveSearch {
            self.interactive_waiters.fetch_add(1, Ordering::SeqCst);
        }

        let queued_start = Instant::now();
        let mut gate_wait = Duration::ZERO;

        loop {
            if lane == NominatimLane::BackgroundReverseGeocode
                && self.interactive_waiters.load(Ordering::SeqCst) > 0
            {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }

            let mut state = self.state.lock().await;
            let now = Instant::now();
            let effective_interval_ms = self.base_interval_ms + state.adaptive_extra_ms;
            let wait_for = state.next_allowed.saturating_duration_since(now);
            if wait_for.is_zero() {
                state.next_allowed = now + Duration::from_millis(effective_interval_ms);
                drop(state);

                if lane == NominatimLane::InteractiveSearch {
                    self.interactive_waiters.fetch_sub(1, Ordering::SeqCst);
                }

                return NominatimSlot {
                    lane,
                    queued_ms: queued_start.elapsed().as_millis() as u64,
                    gate_wait_ms: gate_wait.as_millis() as u64,
                    effective_interval_ms,
                };
            }
            drop(state);

            gate_wait += wait_for;
            tokio::time::sleep(wait_for).await;
        }
    }

    async fn report_outcome(&self, status: Option<u16>, retry_after: Option<Duration>) {
        let Some(status) = status else {
            return;
        };

        let mut state = self.state.lock().await;

        if status == 429 {
            if let Some(retry_after) = retry_after {
                let retry_ms = retry_after.as_millis() as u64;
                let required_extra = retry_ms.saturating_sub(self.base_interval_ms);
                state.adaptive_extra_ms = state.adaptive_extra_ms.max(required_extra);
            } else {
                let next = if state.adaptive_extra_ms == 0 {
                    500
                } else {
                    state.adaptive_extra_ms.saturating_mul(2)
                };
                state.adaptive_extra_ms = next;
            }
            state.adaptive_extra_ms = state.adaptive_extra_ms.min(self.max_adaptive_extra_ms);
            return;
        }

        if (200..300).contains(&status) {
            state.adaptive_extra_ms = state.adaptive_extra_ms.saturating_sub(200);
        }
    }

    async fn adaptive_extra_ms(&self) -> u64 {
        let state = self.state.lock().await;
        state.adaptive_extra_ms
    }
}

fn scheduler() -> &'static NominatimScheduler {
    static SCHEDULER: OnceLock<NominatimScheduler> = OnceLock::new();
    SCHEDULER.get_or_init(|| NominatimScheduler::new(1100, 15_000))
}

pub async fn acquire_slot(lane: NominatimLane) -> NominatimSlot {
    scheduler().acquire_slot(lane).await
}

pub async fn report_outcome(status: Option<u16>, retry_after: Option<Duration>) {
    scheduler().report_outcome(status, retry_after).await
}

pub async fn adaptive_extra_ms() -> u64 {
    scheduler().adaptive_extra_ms().await
}

pub fn retry_after_from_headers(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let value = headers.get(reqwest::header::RETRY_AFTER)?;
    let retry_after = value.to_str().ok()?.trim().parse::<u64>().ok()?;
    Some(Duration::from_secs(retry_after))
}
