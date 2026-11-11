//! Ingestion-capture records for Rivian GraphQL polls.
//!
//! Capture files are meant to be shared, so a failed poll is recorded as a
//! coarse error class and never as error text: provider GraphQL messages and
//! our own error strings can name the vehicle or its Rivian id.

use anyhow::Result;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{
    transport::{AuthError, RequestError},
    CredentialsMissing, VehicleNotListed,
};
use crate::services::ingestion_capture::{self, Kind as CaptureKind};

/// Identifier-free class of a failed Rivian poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ErrorClass {
    AuthRequired,
    Transport,
    HttpStatus(u16),
    Graphql,
    NotFound,
    Other,
}

impl ErrorClass {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::AuthRequired => "auth_required",
            Self::Transport => "transport",
            Self::HttpStatus(_) => "http_status",
            Self::Graphql => "graphql",
            Self::NotFound => "not_found",
            Self::Other => "other",
        }
    }

    /// Classify by the typed errors in the chain; the first recognised cause
    /// wins. Message text is never inspected.
    pub(super) fn of(error: &anyhow::Error) -> Self {
        for cause in error.chain() {
            if cause.is::<AuthError>() || cause.is::<CredentialsMissing>() {
                return Self::AuthRequired;
            }
            if cause.is::<VehicleNotListed>() {
                return Self::NotFound;
            }
            if let Some(request) = cause.downcast_ref::<RequestError>() {
                return match request {
                    RequestError::Send { .. } | RequestError::Read { .. } => Self::Transport,
                    RequestError::HttpStatus { status, .. } => Self::HttpStatus(status.as_u16()),
                    RequestError::Graphql { .. } | RequestError::NoData { .. } => Self::Graphql,
                };
            }
            if cause.is::<reqwest::Error>() {
                return Self::Transport;
            }
        }
        Self::Other
    }
}

/// The capture fields for one GraphQL acquisition.
fn poll_fields<T>(operation: &str, result: &Result<T>, detail: Value) -> Value {
    match result {
        Ok(_) => json!({ "operation": operation, "outcome": "ok", "detail": detail }),
        Err(error) => {
            let class = ErrorClass::of(error);
            let mut fields = json!({
                "operation": operation,
                "outcome": if class == ErrorClass::AuthRequired { "auth_required" } else { "error" },
                "error_class": class.as_str(),
            });
            if let ErrorClass::HttpStatus(status) = class {
                fields["http_status"] = json!(status);
            }
            fields
        }
    }
}

/// Record one GraphQL acquisition in a running ingestion capture.
pub(super) fn capture_poll<T>(
    vehicle_id: Uuid,
    operation: &str,
    result: &Result<T>,
    detail: Value,
) {
    if !ingestion_capture::is_capturing(vehicle_id) {
        return;
    }
    ingestion_capture::record(
        vehicle_id,
        CaptureKind::Poll,
        poll_fields(operation, result, detail),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    fn fields_for(error: anyhow::Error) -> Value {
        poll_fields::<()>("vehicle_enrichment", &Err(error), Value::Null)
    }

    #[test]
    fn errors_that_name_the_vehicle_never_reach_the_record() {
        let vehicle_id = Uuid::new_v4();
        let rivian_vehicle_id = "01-234567890";
        let cases = [
            (
                anyhow::Error::new(CredentialsMissing { vehicle_id }),
                "auth_required",
            ),
            (
                anyhow::Error::new(VehicleNotListed {
                    rivian_vehicle_id: rivian_vehicle_id.into(),
                }),
                "not_found",
            ),
            (
                anyhow::Error::new(RequestError::Graphql {
                    operation: "getUserInfo".into(),
                    details: format!("vehicle {rivian_vehicle_id} is not accessible [FORBIDDEN]"),
                }),
                "graphql",
            ),
            (
                anyhow!("charge sync for {vehicle_id} / {rivian_vehicle_id} failed"),
                "other",
            ),
            (
                anyhow::Error::new(VehicleNotListed {
                    rivian_vehicle_id: rivian_vehicle_id.into(),
                })
                .context(format!("enrichment for {vehicle_id}")),
                "not_found",
            ),
        ];
        for (error, class) in cases {
            let fields = fields_for(error);
            let text = fields.to_string();
            assert!(!text.contains(&vehicle_id.to_string()), "{text}");
            assert!(!text.contains(rivian_vehicle_id), "{text}");
            assert_eq!(fields["error_class"], class, "{text}");
            assert!(fields.get("error").is_none(), "{text}");
        }
    }

    #[test]
    fn classes_follow_the_typed_transport_errors() {
        assert_eq!(
            ErrorClass::of(&anyhow!(AuthError)),
            ErrorClass::AuthRequired
        );
        assert_eq!(
            ErrorClass::of(&anyhow::Error::new(RequestError::HttpStatus {
                operation: "GetVehicleState".into(),
                status: reqwest::StatusCode::SERVICE_UNAVAILABLE,
            })),
            ErrorClass::HttpStatus(503)
        );
        assert_eq!(
            ErrorClass::of(&anyhow::Error::new(RequestError::NoData {
                operation: "GetVehicleState".into(),
            })),
            ErrorClass::Graphql
        );
        assert_eq!(
            ErrorClass::of(&anyhow::Error::new(RequestError::Read {
                operation: "GetVehicleState".into(),
                source: crate::errors::AppError::DependencyUnavailable("invalid JSON".into()),
            })),
            ErrorClass::Transport
        );
    }

    #[test]
    fn auth_and_http_failures_keep_their_outcome_and_status() {
        let auth = fields_for(anyhow!(AuthError));
        assert_eq!(auth["outcome"], "auth_required");
        let http = fields_for(anyhow::Error::new(RequestError::HttpStatus {
            operation: "getUserInfo".into(),
            status: reqwest::StatusCode::BAD_GATEWAY,
        }));
        assert_eq!(http["outcome"], "error");
        assert_eq!(http["error_class"], "http_status");
        assert_eq!(http["http_status"], 502);
        let ok = poll_fields::<u32>("charge_history", &Ok(3), json!({ "reconciled": 3 }));
        assert_eq!(
            ok,
            json!({ "operation": "charge_history", "outcome": "ok", "detail": { "reconciled": 3 } })
        );
    }
}
