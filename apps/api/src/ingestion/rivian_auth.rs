//! Rivian authentication flow.

use serde::{Deserialize, Serialize};
use crate::ingestion::session_store::RivianTokenBundle;

const GATEWAY_URL: &str = "https://rivian.com/api/gql/gateway/graphql";

#[derive(Debug, thiserror::Error)]
pub enum RivianAuthError {
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("Invalid OTP")]
    InvalidOtp,
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Unexpected response: {0}")]
    UnexpectedResponse(String),
}

#[derive(Debug, Clone)]
pub struct RivianOtpChallenge {
    pub otp_token:  String,
    pub session_id: String,
}

pub enum LoginResult {
    Authenticated(RivianTokenBundle),
    OtpRequired(RivianOtpChallenge),
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
    data: Option<LoginData>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginData {
    login: Option<LoginPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginPayload {
    #[serde(rename = "__typename")]
    typename: Option<String>,
    mobile_session_token: Option<String>,
    user_session_token: Option<String>,
    csrf_token: Option<String>,
    otp_token: Option<String>,
    session_id: Option<String>,
    is_valid: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GqlError {
    message: String,
}

pub async fn rivian_login(
    client:   &reqwest::Client,
    email:    &str,
    password: &str,
) -> Result<LoginResult, RivianAuthError> {
    let query = r#"
      mutation Login($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          __typename
          ... on MobileLoginResponse {
            mobileSessionToken
            userSessionToken
            csrfToken
          }
          ... on MobileLoginOTPResponse {
            otpToken
            sessionId
          }
        }
      }
    "#;

    let body = serde_json::json!({
        "query": query,
        "variables": { "email": email, "password": password }
    });

    let resp: LoginResponse = client
        .post(GATEWAY_URL)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;

    if let Some(errors) = resp.errors {
        if !errors.is_empty() {
            let msg = errors[0].message.clone();
            if msg.to_lowercase().contains("invalid") {
                return Err(RivianAuthError::InvalidCredentials);
            }
            return Err(RivianAuthError::UnexpectedResponse(msg));
        }
    }

    let payload = resp
        .data.and_then(|d| d.login)
        .ok_or_else(|| RivianAuthError::UnexpectedResponse("empty login payload".into()))?;

    match payload.typename.as_deref() {
        Some("MobileLoginOTPResponse") => {
            Ok(LoginResult::OtpRequired(RivianOtpChallenge {
                otp_token:  payload.otp_token.unwrap_or_default(),
                session_id: payload.session_id.unwrap_or_default(),
            }))
        }
        _ => {
            Ok(LoginResult::Authenticated(RivianTokenBundle {
                a_sess:     payload.mobile_session_token.unwrap_or_default(),
                u_sess:     payload.user_session_token.unwrap_or_default(),
                csrf_token: payload.csrf_token.unwrap_or_default(),
                created_at: chrono::Utc::now(),
            }))
        }
    }
}

pub async fn rivian_login_otp(
    client:    &reqwest::Client,
    challenge: &RivianOtpChallenge,
    otp_code:  &str,
) -> Result<RivianTokenBundle, RivianAuthError> {
    let query = r#"
      mutation LoginOtp($otpCode: String!, $otpToken: String!) {
        loginWithOTP(otpCode: $otpCode, otpToken: $otpToken) {
          __typename
          ... on MobileLoginResponse {
            mobileSessionToken
            userSessionToken
            csrfToken
          }
        }
      }
    "#;

    let body = serde_json::json!({
        "query": query,
        "variables": {
            "otpCode":  otp_code,
            "otpToken": challenge.otp_token
        }
    });

    let resp: LoginResponse = client
        .post(GATEWAY_URL)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;

    if let Some(errors) = resp.errors {
        if !errors.is_empty() {
            return Err(RivianAuthError::InvalidOtp);
        }
    }

    let payload = resp
        .data.and_then(|d| d.login)
        .ok_or_else(|| RivianAuthError::UnexpectedResponse("empty OTP payload".into()))?;

    Ok(RivianTokenBundle {
        a_sess:     payload.mobile_session_token.unwrap_or_default(),
        u_sess:     payload.user_session_token.unwrap_or_default(),
        csrf_token: payload.csrf_token.unwrap_or_default(),
        created_at: chrono::Utc::now(),
    })
}
