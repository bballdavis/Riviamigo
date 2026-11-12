//! In-memory registry of running captures. Hot paths read it to decide whether
//! to record, and hand accepted records to the batch writer through a bounded
//! channel.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock, RwLock,
    },
};

use chrono::{DateTime, Utc};
use serde_json::Value;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::{sanitize::sanitize, Kind};

#[derive(Debug)]
pub(super) struct Record {
    pub(super) vehicle_id: Uuid,
    pub(super) capture_id: Uuid,
    pub(super) recorded_at: DateTime<Utc>,
    pub(super) kind: Kind,
    pub(super) fields: Value,
}

#[derive(Debug, Clone)]
pub(super) struct Window {
    capture_id: Uuid,
    ends_at: DateTime<Utc>,
    pub(super) dropped: Arc<AtomicU64>,
}

struct Capture {
    windows: RwLock<HashMap<Uuid, Window>>,
    tx: mpsc::Sender<Record>,
}

static CAPTURE: OnceLock<Capture> = OnceLock::new();

fn active_window(vehicle_id: Uuid, now: DateTime<Utc>) -> Option<Window> {
    let capture = CAPTURE.get()?;
    let windows = capture.windows.read().ok()?;
    windows
        .get(&vehicle_id)
        .filter(|window| window.ends_at > now)
        .cloned()
}

/// Whether a capture is running for this vehicle. Cheap enough for hot paths;
/// callers use it to skip building records nobody will store.
pub fn is_capturing(vehicle_id: Uuid) -> bool {
    active_window(vehicle_id, Utc::now()).is_some()
}

/// Record one capture event. A no-op when no capture is running (or the
/// service was never started, as in tests and CLI binaries). Never blocks:
/// a full channel drops the record and counts it.
pub fn record(vehicle_id: Uuid, kind: Kind, fields: Value) {
    let now = Utc::now();
    let Some(window) = active_window(vehicle_id, now) else {
        return;
    };
    let Some(capture) = CAPTURE.get() else {
        return;
    };
    let record = Record {
        vehicle_id,
        capture_id: window.capture_id,
        recorded_at: now,
        kind,
        fields: sanitize(fields),
    };
    if capture.tx.try_send(record).is_err() {
        window.dropped.fetch_add(1, Ordering::Relaxed);
    }
}

pub(super) fn register(vehicle_id: Uuid, capture_id: Uuid, ends_at: DateTime<Utc>) {
    if let Some(capture) = CAPTURE.get() {
        if let Ok(mut windows) = capture.windows.write() {
            windows.insert(
                vehicle_id,
                Window {
                    capture_id,
                    ends_at,
                    dropped: Arc::new(AtomicU64::new(0)),
                },
            );
        }
    }
}

pub(super) fn unregister(vehicle_id: Uuid) -> Option<Window> {
    CAPTURE
        .get()
        .and_then(|capture| capture.windows.write().ok()?.remove(&vehicle_id))
}

/// Put back a window that [`unregister`] removed when its database change
/// failed, unless a newer capture has been registered meanwhile.
pub(super) fn restore(vehicle_id: Uuid, window: Window) {
    if let Some(capture) = CAPTURE.get() {
        if let Ok(mut windows) = capture.windows.write() {
            windows.entry(vehicle_id).or_insert(window);
        }
    }
}

/// The capture currently registered for a vehicle, expired or not.
#[cfg(test)]
pub(super) fn registered_capture(vehicle_id: Uuid) -> Option<Uuid> {
    CAPTURE
        .get()?
        .windows
        .read()
        .ok()?
        .get(&vehicle_id)
        .map(|window| window.capture_id)
}

/// Install the registry without a writer, for lifecycle tests. Records sent
/// to it are counted as dropped.
#[cfg(test)]
pub(super) fn install_for_tests() {
    let (tx, _rx) = mpsc::channel(1);
    let _ = install(tx);
}

/// Install the registry and the writer's channel. Returns false when the
/// service was already initialised.
pub(super) fn install(tx: mpsc::Sender<Record>) -> bool {
    CAPTURE
        .set(Capture {
            windows: RwLock::new(HashMap::new()),
            tx,
        })
        .is_ok()
}

/// Vehicles whose capture window has ended by `now`.
pub(super) fn expired(now: DateTime<Utc>) -> Vec<Uuid> {
    CAPTURE
        .get()
        .and_then(|capture| capture.windows.read().ok())
        .map(|windows| {
            windows
                .iter()
                .filter(|(_, window)| window.ends_at <= now)
                .map(|(vehicle_id, _)| *vehicle_id)
                .collect()
        })
        .unwrap_or_default()
}
