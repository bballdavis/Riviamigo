//! Low-level GraphQL transport for the Rivian consumer APIs.
//!
//! This module owns request construction and response-envelope handling only.
//! Token refresh and vehicle-specific retry policy remain in the parent module.

use anyhow::{anyhow, Result};
use serde::Deserialize;
use uuid::Uuid;

use crate::ingestion::session_store::RivianTokenBundle;

const APOLLO_CLIENT_NAME: &str = "com.rivian.ios.consumer-apollo-ios";
const USER_AGENT: &str = "RivianApp/707 CFNetwork/1237 Darwin/20.4.0";

#[derive(Debug, Deserialize)]
struct GqlEnvelope<T> {
    data: Option<T>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Debug, Deserialize)]
struct GqlError {
    message: String,
    #[serde(default)]
    extensions: Option<GqlErrorExtensions>,
}

#[derive(Debug, Deserialize)]
struct GqlErrorExtensions {
    code: Option<String>,
}

/// Messages in source order, each followed by its `extensions.code` when
/// Rivian sends one, so a log line shows whether an error was classified.
fn fmt_errors(errors: &[GqlError]) -> String {
    errors
        .iter()
        .map(|error| {
            match error
                .extensions
                .as_ref()
                .and_then(|value| value.code.as_deref())
            {
                Some(code) => format!("{} [{code}]", error.message),
                None => error.message.clone(),
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Typed marker error for an explicit authentication failure from Rivian.
#[derive(Debug, thiserror::Error)]
#[error("Rivian API: authentication required")]
pub struct AuthError;

/// Typed failures of one Rivian GraphQL request, so callers can tell a
/// network failure, an HTTP status, and a GraphQL error apart without parsing
/// messages. The messages are for logs only: GraphQL error text is provider
/// output and may name the vehicle.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    #[error("Rivian {operation} request could not be sent")]
    Send {
        operation: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("Rivian {operation} request failed: HTTP {status}")]
    HttpStatus {
        operation: String,
        status: reqwest::StatusCode,
    },
    #[error("Rivian {operation} response could not be read")]
    Read {
        operation: String,
        #[source]
        source: crate::errors::AppError,
    },
    #[error("Rivian {operation} request returned errors: {details}")]
    Graphql { operation: String, details: String },
    #[error("Rivian {operation} request returned no data")]
    NoData { operation: String },
}

fn errors_indicate_auth(errors: &[GqlError]) -> bool {
    errors.iter().any(|error| {
        error
            .extensions
            .as_ref()
            .and_then(|value| value.code.as_deref())
            == Some("UNAUTHENTICATED")
    })
}

/// Send one GraphQL request and deserialize its `data` object.
pub async fn gql_request<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    tokens: &RivianTokenBundle,
    operation: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T> {
    let body = serde_json::json!({
        "operationName": operation,
        "query": query,
        "variables": variables,
    });

    let mut request = client
        .post(url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Apollographql-Client-Name", APOLLO_CLIENT_NAME)
        .header("dc-cid", format!("m-ios-{}", Uuid::new_v4()))
        .header("A-Sess", &tokens.app_session_token)
        .header("U-Sess", &tokens.user_session_token)
        .json(&body);

    if !tokens.csrf_token.is_empty() {
        request = request.header("Csrf-Token", &tokens.csrf_token);
    }
    if !tokens.access_token.is_empty() {
        request = request.bearer_auth(&tokens.access_token);
    }

    let response = request.send().await.map_err(|source| RequestError::Send {
        operation: operation.to_owned(),
        source,
    })?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(anyhow!(AuthError));
    }
    if !status.is_success() {
        return Err(RequestError::HttpStatus {
            operation: operation.to_owned(),
            status,
        }
        .into());
    }

    let envelope: GqlEnvelope<T> = crate::services::outbound::read_json(
        response,
        crate::services::outbound::operator_security()?.rivian_max_response_bytes,
        "Rivian provider",
    )
    .await
    .map_err(|source| RequestError::Read {
        operation: operation.to_owned(),
        source,
    })?;

    if let Some(errors) = &envelope.errors {
        if !errors.is_empty() {
            if errors_indicate_auth(errors) {
                return Err(anyhow!(AuthError));
            }
            return Err(RequestError::Graphql {
                operation: operation.to_owned(),
                details: fmt_errors(errors),
            }
            .into());
        }
    }

    envelope.data.ok_or_else(|| {
        RequestError::NoData {
            operation: operation.to_owned(),
        }
        .into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_only_explicit_unauthenticated_graphql_codes() {
        let auth = GqlError {
            message: "session expired".into(),
            extensions: Some(GqlErrorExtensions {
                code: Some("UNAUTHENTICATED".into()),
            }),
        };
        let ordinary = GqlError {
            message: "authentication text in an ordinary error".into(),
            extensions: Some(GqlErrorExtensions {
                code: Some("BAD_USER_INPUT".into()),
            }),
        };

        assert!(errors_indicate_auth(&[auth]));
        assert!(!errors_indicate_auth(&[ordinary]));
    }

    #[test]
    fn formats_multiple_graphql_errors_in_source_order() {
        let errors = vec![
            GqlError {
                message: "first".into(),
                extensions: None,
            },
            GqlError {
                message: "second".into(),
                extensions: None,
            },
        ];

        assert_eq!(fmt_errors(&errors), "first; second");
    }

    #[test]
    fn formats_graphql_error_codes_when_present() {
        let errors = vec![GqlError {
            message: "User is unauthenticated".into(),
            extensions: Some(GqlErrorExtensions {
                code: Some("FORBIDDEN".into()),
            }),
        }];

        assert_eq!(fmt_errors(&errors), "User is unauthenticated [FORBIDDEN]");
    }
}
