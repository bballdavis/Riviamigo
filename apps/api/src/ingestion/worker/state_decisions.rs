//! Pure decisions derived from WebSocket control messages.
//!
//! Keeping these mappings separate from database writers makes protocol-state
//! changes directly testable without constructing a worker or database pool.

use crate::ingestion::ws_client::WsInboundEvent;

pub(super) fn is_synthetic_control(message_type: Option<&str>) -> bool {
    matches!(
        message_type,
        Some(
            "connection_open"
                | "connection_init"
                | "subscribe"
                | "reconnect"
                | "ws_handshake_rejected"
                | "ws_schema_rejected"
                | "ws_schema_degraded"
                | "ws_no_active_subscriptions"
        )
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RuntimeHealthUpdate {
    pub(super) online: bool,
    pub(super) worker_health: &'static str,
    pub(super) worker_health_msg: String,
    pub(super) auth_state: &'static str,
    pub(super) auth_reason_code: Option<&'static str>,
}

pub(super) fn runtime_health_update_for_ws_control(
    inbound: &WsInboundEvent,
) -> Option<RuntimeHealthUpdate> {
    match inbound.message_type.as_deref() {
        Some("connection_open") => Some(RuntimeHealthUpdate {
            online: true,
            worker_health: "connected",
            worker_health_msg: String::new(),
            auth_state: "authorized",
            auth_reason_code: None,
        }),
        Some("reconnect") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "degraded",
            worker_health_msg: "Rivian telemetry connection interrupted; reconnecting".into(),
            auth_state: "authorized",
            auth_reason_code: None,
        }),
        Some("ws_handshake_rejected") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "error",
            worker_health_msg: read_ws_detail_message(&inbound.raw)
                .unwrap_or_else(|| "Rivian WS handshake rejected".into()),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_handshake_rejected"),
        }),
        Some("ws_schema_rejected") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "degraded",
            worker_health_msg: read_ws_detail_message(&inbound.raw)
                .unwrap_or_else(|| "Rivian WS VehicleState schema rejected".into()),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_schema_rejected"),
        }),
        Some("ws_schema_degraded") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "degraded",
            worker_health_msg: "Rivian WS subscription degraded to recover from schema drift"
                .into(),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_schema_rejected"),
        }),
        Some("ws_no_active_subscriptions") => Some(RuntimeHealthUpdate {
            online: false,
            worker_health: "degraded",
            worker_health_msg: read_ws_detail_message(&inbound.raw).unwrap_or_else(|| {
                "Rivian WS reported no active subscriptions; reconnecting".into()
            }),
            auth_state: "authorized",
            auth_reason_code: Some("rivian_ws_no_active_subscriptions"),
        }),
        _ => None,
    }
}

fn read_ws_detail_message(raw: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    value
        .get("reason")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingestion::ws_client::WsInboundKind;
    use chrono::Utc;

    fn control(message_type: &str, raw: serde_json::Value) -> WsInboundEvent {
        WsInboundEvent {
            kind: WsInboundKind::Control,
            received_at: Utc::now(),
            raw: raw.to_string(),
            message_type: Some(message_type.into()),
            telemetry: None,
        }
    }

    #[test]
    fn synthetic_control_allowlist_is_explicit() {
        assert!(is_synthetic_control(Some("connection_open")));
        assert!(is_synthetic_control(Some("ws_schema_degraded")));
        assert!(!is_synthetic_control(Some("vehicle_state")));
        assert!(!is_synthetic_control(None));
    }

    #[test]
    fn invalid_detail_payload_uses_stable_fallback() {
        let inbound = control("ws_handshake_rejected", serde_json::Value::Null);
        let update = runtime_health_update_for_ws_control(&inbound).expect("health update");

        assert_eq!(update.worker_health, "error");
        assert_eq!(update.worker_health_msg, "Rivian WS handshake rejected");
        assert_eq!(update.auth_state, "authorized");
    }

    #[test]
    fn reconnect_is_non_healthy_until_connection_reopens() {
        let reconnect = control("reconnect", serde_json::json!({"backoff_seconds": 5}));
        let reconnect_update =
            runtime_health_update_for_ws_control(&reconnect).expect("reconnect health update");
        assert!(!reconnect_update.online);
        assert_eq!(reconnect_update.worker_health, "degraded");

        let opened = control("connection_open", serde_json::Value::Null);
        let opened_update =
            runtime_health_update_for_ws_control(&opened).expect("connection health update");
        assert!(opened_update.online);
        assert_eq!(opened_update.worker_health, "connected");
    }
}
