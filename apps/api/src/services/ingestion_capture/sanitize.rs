//! Redaction for capture records: identity, location, and credential keys are
//! removed at any depth before a record is stored or exported.

use serde_json::{Map, Value};

/// Keys that must never appear in a capture, at any depth.
const FORBIDDEN_KEYS: &[&str] = &[
    "vehicle_id",
    "vin",
    "latitude",
    "longitude",
    "lat",
    "lng",
    "lon",
    "altitude_m",
    "gnssLocation",
    "location",
    "name",
    "email",
    "token",
    "u-sess",
    "a-sess",
    "csrf",
    "password",
    "authorization",
];

fn is_forbidden_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    FORBIDDEN_KEYS
        .iter()
        .any(|forbidden| lower == forbidden.to_ascii_lowercase())
        || ["token", "secret", "password", "csrf"]
            .iter()
            .any(|needle| lower.contains(needle))
}

/// Remove identifying and location keys at any depth. Call sites already
/// avoid them; this is the backstop that keeps the file shareable.
pub fn sanitize(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(key, _)| !is_forbidden_key(key))
                .map(|(key, value)| (key, sanitize(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(sanitize).collect()),
        other => other,
    }
}

/// Non-null fields of a serialized value, without identity or location.
pub fn present_fields<T: serde::Serialize>(value: &T) -> Value {
    match serde_json::to_value(value) {
        Ok(Value::Object(map)) => sanitize(Value::Object(
            map.into_iter()
                .filter(|(_, value)| !value.is_null())
                .collect::<Map<_, _>>(),
        )),
        _ => Value::Null,
    }
}
