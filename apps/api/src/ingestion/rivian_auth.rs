//! Rivian authentication flow.

use crate::ingestion::session_store::RivianTokenBundle;
use serde::Deserialize;
use uuid::Uuid;

const GATEWAY_URL: &str = "https://rivian.com/api/gql/gateway/graphql";
const APOLLO_CLIENT_NAME: &str = "com.rivian.ios.consumer-apollo-ios";
const USER_AGENT: &str = "RivianApp/707 CFNetwork/1237 Darwin/20.4.0";

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
    pub email: String,
    pub otp_token: String,
    pub csrf_token: String,
    pub app_session_token: String,
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
    #[serde(rename = "loginWithOTP")]
    login_with_otp: Option<LoginPayload>,
    #[serde(rename = "createCsrfToken")]
    create_csrf_token: Option<CreateCsrfTokenPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginPayload {
    #[serde(rename = "__typename")]
    typename: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    user_session_token: Option<String>,
    otp_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GqlError {
    message: String,
    extensions: Option<GqlErrorExtensions>,
}

#[derive(Debug, Deserialize)]
struct GqlErrorExtensions {
    code: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCsrfTokenPayload {
    csrf_token: String,
    app_session_token: String,
}

struct CsrfSession {
    csrf_token: String,
    app_session_token: String,
}

pub async fn rivian_login(
    client: &reqwest::Client,
    email: &str,
    password: &str,
) -> Result<LoginResult, RivianAuthError> {
    let session = create_csrf_session(client).await?;
    let query = r#"
      mutation Login($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          __typename
          ... on MobileLoginResponse {
            accessToken
            refreshToken
            userSessionToken
          }
          ... on MobileMFALoginResponse {
            otpToken
          }
        }
      }
    "#;

    let resp = post_graphql(
        client,
        serde_json::json!({
            "operationName": "Login",
            "query": query,
            "variables": { "email": email, "password": password }
        }),
        Some(&session),
    )
    .await?;

    if let Some(errors) = resp.errors {
        if !errors.is_empty() {
            return Err(map_login_errors(errors));
        }
    }

    let payload = resp
        .data
        .and_then(|d| d.login)
        .ok_or_else(|| RivianAuthError::UnexpectedResponse("empty login payload".into()))?;

    match payload.typename.as_deref() {
        Some("MobileMFALoginResponse") => Ok(LoginResult::OtpRequired(RivianOtpChallenge {
            email: email.to_string(),
            otp_token: payload.otp_token.unwrap_or_default(),
            csrf_token: session.csrf_token,
            app_session_token: session.app_session_token,
        })),
        _ => Ok(LoginResult::Authenticated(RivianTokenBundle {
            access_token: payload.access_token.unwrap_or_default(),
            refresh_token: payload.refresh_token.unwrap_or_default(),
            app_session_token: session.app_session_token,
            user_session_token: payload.user_session_token.unwrap_or_default(),
            csrf_token: session.csrf_token,
            created_at: chrono::Utc::now(),
        })),
    }
}

pub async fn rivian_login_otp(
    client: &reqwest::Client,
    challenge: &RivianOtpChallenge,
    otp_code: &str,
) -> Result<RivianTokenBundle, RivianAuthError> {
    let session = CsrfSession {
        csrf_token: challenge.csrf_token.clone(),
        app_session_token: challenge.app_session_token.clone(),
    };

    let query = r#"
      mutation LoginWithOTP($email: String!, $otpCode: String!, $otpToken: String!) {
        loginWithOTP(email: $email, otpCode: $otpCode, otpToken: $otpToken) {
          __typename
          ... on MobileLoginResponse {
            accessToken
            refreshToken
            userSessionToken
          }
        }
      }
    "#;

    let resp = post_graphql(
        client,
        serde_json::json!({
            "operationName": "LoginWithOTP",
            "query": query,
            "variables": {
                "email": challenge.email,
                "otpCode": otp_code,
                "otpToken": challenge.otp_token
            }
        }),
        Some(&session),
    )
    .await?;

    if let Some(errors) = resp.errors {
        if !errors.is_empty() {
            return Err(map_otp_errors(errors));
        }
    }

    let payload = resp
        .data
        .and_then(|d| d.login_with_otp)
        .ok_or_else(|| RivianAuthError::UnexpectedResponse("empty OTP payload".into()))?;

    Ok(RivianTokenBundle {
        access_token: payload.access_token.unwrap_or_default(),
        refresh_token: payload.refresh_token.unwrap_or_default(),
        app_session_token: challenge.app_session_token.clone(),
        user_session_token: payload.user_session_token.unwrap_or_default(),
        csrf_token: challenge.csrf_token.clone(),
        created_at: chrono::Utc::now(),
    })
}

async fn create_csrf_session(client: &reqwest::Client) -> Result<CsrfSession, RivianAuthError> {
    let query = r#"
      mutation CreateCSRFToken {
        createCsrfToken {
          __typename
          csrfToken
          appSessionToken
        }
      }
    "#;

    let resp = post_graphql(
        client,
        serde_json::json!({
            "operationName": "CreateCSRFToken",
            "query": query,
            "variables": serde_json::Value::Null
        }),
        None,
    )
    .await?;

    if let Some(errors) = resp.errors {
        return Err(RivianAuthError::UnexpectedResponse(format_gql_error(
            &errors,
        )));
    }

    let payload = resp
        .data
        .and_then(|d| d.create_csrf_token)
        .ok_or_else(|| RivianAuthError::UnexpectedResponse("empty CSRF payload".into()))?;

    Ok(CsrfSession {
        csrf_token: payload.csrf_token,
        app_session_token: payload.app_session_token,
    })
}

async fn post_graphql(
    client: &reqwest::Client,
    body: serde_json::Value,
    session: Option<&CsrfSession>,
) -> Result<LoginResponse, RivianAuthError> {
    let mut req = client
        .post(GATEWAY_URL)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Apollographql-Client-Name", APOLLO_CLIENT_NAME)
        .header("dc-cid", format!("m-ios-{}", Uuid::new_v4()))
        .json(&body);

    if let Some(session) = session {
        req = req
            .header("Csrf-Token", &session.csrf_token)
            .header("A-Sess", &session.app_session_token);
    }

    let response = req.send().await?;
    let status = response.status();
    let parsed = response.json::<LoginResponse>().await?;

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(RivianAuthError::InvalidCredentials);
    }

    Ok(parsed)
}

fn map_login_errors(errors: Vec<GqlError>) -> RivianAuthError {
    let msg = format_gql_error(&errors);
    for error in &errors {
        let low_msg = error.message.to_lowercase();
        if low_msg.contains("invalid") {
            return RivianAuthError::InvalidCredentials;
        }
        if let Some(ext) = &error.extensions {
            if ext.code.as_deref() == Some("UNAUTHENTICATED")
                || ext.reason.as_deref() == Some("BAD_CURRENT_PASSWORD")
            {
                return RivianAuthError::InvalidCredentials;
            }
        }
    }
    RivianAuthError::UnexpectedResponse(msg)
}

fn map_otp_errors(errors: Vec<GqlError>) -> RivianAuthError {
    for error in &errors {
        if let Some(ext) = &error.extensions {
            if matches!(
                (ext.code.as_deref(), ext.reason.as_deref()),
                (Some("BAD_USER_INPUT"), Some("INVALID_OTP"))
                    | (Some("UNAUTHENTICATED"), Some("OTP_TOKEN_EXPIRED"))
            ) {
                return RivianAuthError::InvalidOtp;
            }
        }
    }
    RivianAuthError::UnexpectedResponse(format_gql_error(&errors))
}

fn format_gql_error(errors: &[GqlError]) -> String {
    errors
        .first()
        .map(|e| {
            let mut msg = e.message.clone();
            if let Some(ext) = &e.extensions {
                if let Some(code) = &ext.code {
                    msg.push_str(&format!(" ({code}"));
                    if let Some(reason) = &ext.reason {
                        msg.push_str(&format!(": {reason}"));
                    }
                    msg.push(')');
                }
            }
            msg
        })
        .unwrap_or_else(|| "unknown Rivian GraphQL error".into())
}
