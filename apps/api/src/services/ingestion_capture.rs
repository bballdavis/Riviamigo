//! Owner-started ingestion captures.
//!
//! A capture records what the ingestion pipeline saw and decided for one
//! vehicle, so an owner can download one shareable file instead of reading
//! host logs. Each vehicle keeps only its most recent capture: starting a new
//! one replaces the previous capture's events.
//!
//! Recording is fire-and-forget. Hot paths check an in-memory registry and
//! hand records to one batch writer through a bounded channel, so ingestion
//! never waits on capture storage. Records never contain coordinates,
//! credentials, VINs, or the vehicle id. [`sanitize`] strips keys, not
//! values, so call sites must not record free text that can carry an
//! identifier: error strings and provider messages are recorded as coarse
//! classes or codes instead.

mod export;
mod lifecycle;
mod registry;
mod sanitize;
mod status;
mod writer;

pub use export::{export, export_filename, export_rows, Export};
pub use lifecycle::{init, start, stop};
pub use registry::{is_capturing, record};
pub use sanitize::{present_fields, sanitize};
pub use status::{status, CaptureStatus};

/// Captures stop on their own after this long.
pub const CAPTURE_DURATION: chrono::Duration = chrono::Duration::hours(1);
/// Finished captures are purged after this long.
pub const CAPTURE_RETENTION: chrono::Duration = chrono::Duration::hours(24);
/// Hard ceiling on stored events per capture.
pub const MAX_EVENTS_PER_CAPTURE: u64 = 50_000;
/// Version of the downloadable file format.
pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    ParallaxEnvelope,
    ParallaxConnection,
    LegacyFrame,
    LegacyConnection,
    Ingestion,
    Trip,
    Poll,
    CaptureStarted,
    CaptureStopped,
    Truncated,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ParallaxEnvelope => "parallax_envelope",
            Self::ParallaxConnection => "parallax_connection",
            Self::LegacyFrame => "legacy_frame",
            Self::LegacyConnection => "legacy_connection",
            Self::Ingestion => "ingestion",
            Self::Trip => "trip",
            Self::Poll => "poll",
            Self::CaptureStarted => "capture_started",
            Self::CaptureStopped => "capture_stopped",
            Self::Truncated => "truncated",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    User,
    Expired,
}

impl StopReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Expired => "expired",
        }
    }
}

#[cfg(test)]
mod tests;
