use super::*;
use axum::http::HeaderMap;
use uuid::Uuid;

use crate::{
    keys::generate_keys,
    middleware::auth::{issue_access_token, JwtKeys},
};

fn make_keys() -> JwtKeys {
    let k = generate_keys().expect("key generation");
    JwtKeys::new(&k.jwt_private_pem, &k.jwt_public_pem).expect("JwtKeys::new")
}

fn headers_with_proto(proto: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        "sec-websocket-protocol",
        proto.parse().expect("header value"),
    );
    h
}

#[test]
fn missing_proto_header_is_unauthorized() {
    let keys = make_keys();
    let result = extract_jwt_from_headers(&HeaderMap::new(), &keys);
    assert!(matches!(result, Err(AppError::Unauthorized)));
}

#[test]
fn proto_without_bearer_prefix_is_unauthorized() {
    let keys = make_keys();
    let result = extract_jwt_from_headers(&headers_with_proto("graphql-ws"), &keys);
    assert!(matches!(result, Err(AppError::Unauthorized)));
}

#[test]
fn malformed_jwt_is_unauthorized() {
    let keys = make_keys();
    let result = extract_jwt_from_headers(&headers_with_proto("bearer.notavalidtoken"), &keys);
    assert!(matches!(result, Err(AppError::Unauthorized)));
}

#[test]
fn jwt_signed_by_different_key_is_unauthorized() {
    let keys = make_keys();
    let other_keys = make_keys();
    let user_id = Uuid::new_v4();
    // Sign with `other_keys`, verify with `keys` → should fail
    let token = issue_access_token(user_id, None, &other_keys).expect("issue_access_token");
    let result = extract_jwt_from_headers(&headers_with_proto(&format!("bearer.{token}")), &keys);
    assert!(matches!(result, Err(AppError::Unauthorized)));
}

#[test]
fn valid_jwt_returns_correct_claims() {
    let keys = make_keys();
    let user_id = Uuid::new_v4();
    let vid = Uuid::new_v4();
    let token = issue_access_token(user_id, Some(vid), &keys).expect("issue_access_token");
    let claims = extract_jwt_from_headers(&headers_with_proto(&format!("bearer.{token}")), &keys)
        .expect("valid JWT should succeed");
    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.iss, "riviamigo.app");
    assert_eq!(claims.default_vehicle_id, Some(vid));
}

#[test]
fn websocket_auth_accepts_standard_access_tokens() {
    let keys = make_keys();
    let user_id = Uuid::new_v4();
    let token = issue_access_token(user_id, None, &keys).expect("issue_access_token");

    let claims = extract_jwt_from_headers(&headers_with_proto(&format!("bearer.{token}")), &keys)
        .expect("websocket auth should accept normal API access tokens");

    assert_eq!(claims.sub, user_id);
}

#[test]
fn bearer_with_surrounding_protocols_is_parsed() {
    let keys = make_keys();
    let user_id = Uuid::new_v4();
    let token = issue_access_token(user_id, None, &keys).expect("issue_access_token");
    // Browsers may send multiple subprotocols separated by commas
    let proto = format!("graphql-ws, bearer.{token}, some-other");
    let claims = extract_jwt_from_headers(&headers_with_proto(&proto), &keys)
        .expect("should find bearer. among multiple protocols");
    assert_eq!(claims.sub, user_id);
}

#[test]
fn recognizes_only_probe_control_messages() {
    assert!(is_live_probe(r#"{"type":"probe"}"#));
    assert!(is_live_probe(r#"{"type":"probe","request_id":"ignored"}"#));
    assert!(!is_live_probe(r#"{"type":"keepalive"}"#));
    assert!(!is_live_probe(r#"{"vehicle_id":"not-a-probe"}"#));
    assert!(!is_live_probe("not-json"));
}

#[test]
fn keepalive_message_contains_no_vehicle_data() {
    assert_eq!(LIVE_KEEPALIVE_MESSAGE, r#"{"type":"keepalive"}"#);
}

#[test]
fn live_session_response_returns_200_for_a_snapshot() {
    let response = live_session_response(Some(r#"{"power_kw":9.6}"#.to_string()));
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/json")
    );
}

#[test]
fn live_session_response_returns_204_without_a_snapshot() {
    let response = live_session_response(None);
    assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
}

#[test]
fn fresh_parallax_fields_override_legacy_individually() {
    let now = Utc::now();
    let merged = merge_live_session(
        Some(r#"{"power_kw":7.2,"energy_kwh":3.1,"ts":"2026-08-28T10:00:00Z"}"#.into()),
        Some(ActiveLiveSession {
            parallax_live_power_kw: Some(11.4),
            parallax_total_charged_kwh: None,
            parallax_pack_energy_kwh: Some(2.8),
            parallax_thermal_energy_kwh: None,
            parallax_time_remaining_minutes: Some(42),
            parallax_power_observed_at: Some(now),
            parallax_total_energy_observed_at: Some(now),
            parallax_pack_energy_observed_at: Some(now),
            parallax_thermal_energy_observed_at: None,
            parallax_time_observed_at: Some(now),
        }),
        now,
    )
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(&merged).unwrap();
    assert_eq!(value["power_kw"], 11.4);
    assert_eq!(value["energy_kwh"], 3.1);
    assert_eq!(value["pack_energy_kwh"], 2.8);
    assert_eq!(value["provenance"]["power_kw"]["source"], "parallax");
    assert_eq!(
        value["provenance"]["energy_kwh"]["source"],
        "legacy_charging_session"
    );
}

#[test]
fn stale_parallax_never_replaces_legacy_and_no_active_session_returns_none() {
    let now = Utc::now();
    let active = ActiveLiveSession {
        parallax_live_power_kw: Some(99.0),
        parallax_total_charged_kwh: None,
        parallax_pack_energy_kwh: None,
        parallax_thermal_energy_kwh: None,
        parallax_time_remaining_minutes: None,
        parallax_power_observed_at: Some(now - chrono::Duration::minutes(3)),
        parallax_total_energy_observed_at: None,
        parallax_pack_energy_observed_at: None,
        parallax_thermal_energy_observed_at: None,
        parallax_time_observed_at: None,
    };
    let merged = merge_live_session(Some(r#"{"power_kw":6.6}"#.into()), Some(active), now).unwrap();
    let value: serde_json::Value = serde_json::from_str(&merged).unwrap();
    assert_eq!(value["power_kw"], 6.6);
    assert!(merge_live_session(Some(r#"{"power_kw":6.6}"#.into()), None, now).is_none());
}
