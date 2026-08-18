//! Low-level GraphQL transport for the Rivian consumer APIs.
//!
//! This module owns request construction and response-envelope handling only.
//! Token refresh and vehicle-specific retry policy remain in the parent module.

use anyhow::{anyhow, Context, Result};
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

fn fmt_errors(errors: &[GqlError]) -> String {
    errors
        .iter()
        .map(|error| error.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Typed marker error for an explicit authentication failure from Rivian.
#[derive(Debug, thiserror::Error)]
#[error("Rivian API: authentication required")]
pub struct AuthError;

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

    let response = request.send().await.context("HTTP request failed")?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(anyhow!(AuthError));
    }
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("<unreadable body>"));
        return Err(anyhow!("Rivian API: HTTP {status} body={body} "));
    }

    let envelope = response
        .json::<GqlEnvelope<T>>()
        .await
        .context("failed to parse Rivian API response")?;

    if let Some(errors) = &envelope.errors {
        if !errors.is_empty() {
            if errors_indicate_auth(errors) {
                return Err(anyhow!(AuthError));
            }
            return Err(anyhow!("Rivian GQL errors: {}", fmt_errors(errors)));
        }
    }

    envelope
        .data
        .ok_or_else(|| anyhow!("Rivian API: empty data for {operation}"))
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
}
