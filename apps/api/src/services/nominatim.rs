use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::Value;
use sqlx::PgPool;

use crate::{errors::AppError, services::external_connections};

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

pub async fn search(
    pool: &PgPool,
    _client: &reqwest::Client,
    query: &str,
    limit: u8,
) -> Result<Vec<Value>, AppError> {
    let settings =
        external_connections::require_enabled(pool, external_connections::NOMINATIM).await?;
    let endpoint = endpoint(&settings, "search")?;
    let slot = acquire_slot(NominatimLane::InteractiveSearch).await;
    external_connections::record_attempt(pool, external_connections::NOMINATIM).await;
    let response = match safe_client()
        .get(endpoint)
        .header(reqwest::header::USER_AGENT, user_agent(&settings))
        .query(&[
            ("format", "jsonv2"),
            ("addressdetails", "1"),
            ("limit", &limit.clamp(1, 10).to_string()),
            ("q", query),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            external_connections::record_failure(
                pool,
                external_connections::NOMINATIM,
                "Address search request failed",
            )
            .await;
            return Err(AppError::DependencyUnavailable(
                "Address search request failed".into(),
            ));
        }
    };
    let status = response.status();
    let retry_after = retry_after_from_headers(response.headers());
    report_outcome(Some(status.as_u16()), retry_after).await;
    if !status.is_success() {
        external_connections::record_failure(
            pool,
            external_connections::NOMINATIM,
            &format!("HTTP {status}"),
        )
        .await;
        tracing::warn!(status = %status, lane = ?slot.lane, queued_ms = slot.queued_ms, gate_wait_ms = slot.gate_wait_ms, "nominatim.search_http_error");
        return Err(AppError::DependencyUnavailable(
            "Address provider returned an error".into(),
        ));
    }
    let rows = response.json::<Vec<Value>>().await.map_err(|_| {
        AppError::DependencyUnavailable("Address provider returned invalid data".into())
    })?;
    external_connections::record_success(pool, external_connections::NOMINATIM).await;
    Ok(rows)
}

pub async fn reverse(
    pool: &PgPool,
    _client: &reqwest::Client,
    lat: f64,
    lon: f64,
) -> Result<Option<Value>, AppError> {
    let settings =
        external_connections::require_enabled(pool, external_connections::NOMINATIM).await?;
    let endpoint = endpoint(&settings, "reverse")?;
    let slot = acquire_slot(NominatimLane::BackgroundReverseGeocode).await;
    external_connections::record_attempt(pool, external_connections::NOMINATIM).await;
    let response = match safe_client()
        .get(endpoint)
        .header(reqwest::header::USER_AGENT, user_agent(&settings))
        .query(&[
            ("format", "jsonv2"),
            ("addressdetails", "1"),
            ("lat", &lat.to_string()),
            ("lon", &lon.to_string()),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            external_connections::record_failure(
                pool,
                external_connections::NOMINATIM,
                "Reverse geocoding request failed",
            )
            .await;
            return Err(AppError::DependencyUnavailable(
                "Reverse geocoding request failed".into(),
            ));
        }
    };
    let status = response.status();
    let retry_after = retry_after_from_headers(response.headers());
    report_outcome(Some(status.as_u16()), retry_after).await;
    if !status.is_success() {
        external_connections::record_failure(
            pool,
            external_connections::NOMINATIM,
            &format!("HTTP {status}"),
        )
        .await;
        tracing::warn!(status = %status, lane = ?slot.lane, queued_ms = slot.queued_ms, gate_wait_ms = slot.gate_wait_ms, "nominatim.reverse_http_error");
        return Ok(None);
    }
    let value = response.json::<Value>().await.map_err(|_| {
        AppError::DependencyUnavailable("Address provider returned invalid data".into())
    })?;
    external_connections::record_success(pool, external_connections::NOMINATIM).await;
    Ok(Some(value))
}

fn endpoint(
    settings: &external_connections::ConnectionSettingsRow,
    path: &str,
) -> Result<url::Url, AppError> {
    let base = settings
        .base_url
        .as_deref()
        .ok_or_else(|| AppError::Validation("Nominatim endpoint missing".into()))?;
    let normalized = format!("{}/", base.trim_end_matches('/'));
    url::Url::parse(&normalized)
        .and_then(|url| url.join(path))
        .map_err(|_| AppError::Validation("Nominatim endpoint is invalid".into()))
}

fn user_agent(settings: &external_connections::ConnectionSettingsRow) -> String {
    settings
        .request_identifier
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Riviamigo (+https://github.com/bretterer/rivian-telemetry)".into())
}

fn safe_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("static Nominatim HTTP client should build")
    })
}
