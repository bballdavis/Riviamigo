//! Rivian authentication flow.

use crate::ingestion::session_store::RivianTokenBundle;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const DEFAULT_GATEWAY_URL: &str = "https://rivian.com/api/gql/gateway/graphql";
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RivianVehicleSummary {
    pub id: String,
    pub name: Option<String>,
    pub vin: Option<String>,
    pub model: Option<String>,
    pub model_year: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RivianVehicleImage {
    pub order_id: Option<String>,
    pub vehicle_id: Option<String>,
    pub url: String,
    pub extension: Option<String>,
    pub resolution: Option<String>,
    pub size: Option<String>,
    pub design: Option<String>,
    pub placement: Option<String>,
    pub overlays: serde_json::Value,
    pub source: String,
    pub vehicle_version: String,
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

// ── Token exchange (refresh) ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TokenExchangeResponse {
    data: Option<TokenExchangeData>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenExchangeData {
    token_exchange: Option<LoginPayload>,
}

/// Silently refresh Rivian tokens using the `tokenExchange` mutation.
///
/// A new CSRF session is created first (required by Rivian's API), then the
/// existing `refresh_token` is exchanged for a fresh set of credentials.
/// Returns a new [`RivianTokenBundle`] with `created_at` set to now.
pub async fn rivian_refresh_tokens(
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<RivianTokenBundle, RivianAuthError> {
    let session = create_csrf_session(client).await?;

    let query = r#"
      mutation TokenExchange($appSessionToken: String!, $refreshToken: String!) {
        tokenExchange(
          tokenType: USER
          appSessionToken: $appSessionToken
          refreshToken: $refreshToken
        ) {
          __typename
          ... on MobileLoginResponse {
            accessToken
            refreshToken
            userSessionToken
          }
        }
      }
    "#;

    let body = serde_json::json!({
        "operationName": "TokenExchange",
        "query": query,
        "variables": {
            "appSessionToken": session.app_session_token,
            "refreshToken": tokens.refresh_token,
        }
    });

    let req = client
        .post(gateway_url())
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Apollographql-Client-Name", APOLLO_CLIENT_NAME)
        .header("dc-cid", format!("m-ios-{}", Uuid::new_v4()))
        .header("Csrf-Token", &session.csrf_token)
        .header("A-Sess", &session.app_session_token)
        .json(&body);

    let response = req.send().await?;
    let http_status = response.status();
    if http_status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(RivianAuthError::InvalidCredentials);
    }

    let parsed = response.json::<TokenExchangeResponse>().await?;

    if let Some(errors) = parsed.errors {
        if !errors.is_empty() {
            return Err(RivianAuthError::UnexpectedResponse(format_gql_error(
                &errors,
            )));
        }
    }

    let payload = parsed
        .data
        .and_then(|d| d.token_exchange)
        .ok_or_else(|| {
            RivianAuthError::UnexpectedResponse("empty tokenExchange payload".into())
        })?;

    Ok(RivianTokenBundle {
        access_token: payload.access_token.unwrap_or_default(),
        refresh_token: payload.refresh_token.unwrap_or_default(),
        app_session_token: session.app_session_token,
        user_session_token: payload.user_session_token.unwrap_or_default(),
        csrf_token: session.csrf_token,
        created_at: chrono::Utc::now(),
    })
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

#[derive(Debug, Deserialize)]
struct UserInfoResponse {
    data: Option<UserInfoData>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserInfoData {
    current_user: Option<CurrentUser>,
}

#[derive(Debug, Deserialize)]
struct CurrentUser {
    vehicles: Option<Vec<UserVehicle>>,
}

#[derive(Debug, Deserialize)]
struct UserVehicle {
    id: String,
    vin: Option<String>,
    name: Option<String>,
    vehicle: Option<UserVehicleDetails>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserVehicleDetails {
    model_year: Option<i32>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleImagesResponse {
    data: Option<VehicleImagesData>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleImagesData {
    get_vehicle_order_mobile_images: Option<Vec<VehicleMobileImage>>,
    get_vehicle_mobile_images: Option<Vec<VehicleMobileImage>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleMobileImage {
    order_id: Option<String>,
    vehicle_id: Option<String>,
    url: String,
    extension: Option<String>,
    resolution: Option<String>,
    size: Option<String>,
    design: Option<String>,
    placement: Option<String>,
    overlays: Option<serde_json::Value>,
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

pub async fn rivian_user_vehicles(
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<Vec<RivianVehicleSummary>, RivianAuthError> {
    let query = r#"
      query getUserInfo {
        currentUser {
          vehicles {
            id
            vin
            name
            vehicle {
              modelYear
              model
            }
          }
        }
      }
    "#;

    let body = serde_json::json!({
        "operationName": "getUserInfo",
        "query": query,
        "variables": serde_json::Value::Null
    });

    let mut req = client
        .post(gateway_url())
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Apollographql-Client-Name", APOLLO_CLIENT_NAME)
        .header("dc-cid", format!("m-ios-{}", Uuid::new_v4()))
        .header("A-Sess", &tokens.app_session_token)
        .header("U-Sess", &tokens.user_session_token)
        .json(&body);

    if !tokens.csrf_token.is_empty() {
        req = req.header("Csrf-Token", &tokens.csrf_token);
    }
    if !tokens.access_token.is_empty() {
        req = req.bearer_auth(&tokens.access_token);
    }

    let response = req.send().await?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(RivianAuthError::InvalidCredentials);
    }

    let parsed = response.json::<UserInfoResponse>().await?;
    if let Some(errors) = parsed.errors {
        if !errors.is_empty() {
            return Err(RivianAuthError::UnexpectedResponse(format_gql_error(
                &errors,
            )));
        }
    }

    let vehicles = parsed
        .data
        .and_then(|d| d.current_user)
        .and_then(|u| u.vehicles)
        .unwrap_or_default()
        .into_iter()
        .map(|v| RivianVehicleSummary {
            id: v.id,
            name: v.name,
            vin: v.vin,
            model: v.vehicle.as_ref().and_then(|details| details.model.clone()),
            model_year: v.vehicle.and_then(|details| details.model_year),
        })
        .collect();

    Ok(vehicles)
}

pub async fn rivian_vehicle_images(
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<Vec<RivianVehicleImage>, RivianAuthError> {
    let query = r#"
      query getVehicleImages($extension: String, $resolution: String, $versionForVehicle: String, $versionForPreOrder: String) {
        getVehicleOrderMobileImages(resolution: $resolution, extension: $extension, version: $versionForPreOrder) {
          ...image
        }
        getVehicleMobileImages(resolution: $resolution, extension: $extension, version: $versionForVehicle) {
          ...image
        }
      }

      fragment image on VehicleMobileImage {
          orderId
          vehicleId
          url
          extension
          resolution
          size
          design
          placement
          overlays {
            url
            overlay
            zIndex
          }
      }
    "#;

    let mut images = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut app_session_token = tokens.app_session_token.clone();
    let mut refreshed_app_session = false;
    // Matches home-assistant-rivian: cel art uses version 3, photo art uses version 2.
    for (style, version) in [("photo", "2"), ("cel", "3")] {
        let mut attempt = 0;
        let status = loop {
            let body = serde_json::json!({
                "operationName": "getVehicleImages",
                "query": query,
                "variables": {
                    "extension": serde_json::Value::Null,
                    "resolution": "@3x",
                    "versionForVehicle": version,
                    "versionForPreOrder": version
                }
            });

            let req = client
                .post(gateway_url())
                .header("User-Agent", USER_AGENT)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("Apollographql-Client-Name", APOLLO_CLIENT_NAME)
                .header("dc-cid", format!("m-android-{}", Uuid::new_v4()))
                .header("A-Sess", &app_session_token)
                .header("U-Sess", &tokens.user_session_token)
                .json(&body);

            let status = req
                .send()
                .await?
                .error_for_status()
                .map_err(|e| {
                    if e.status() == Some(reqwest::StatusCode::UNAUTHORIZED) {
                        RivianAuthError::InvalidCredentials
                    } else {
                        RivianAuthError::Network(e)
                    }
                })?
                .json::<VehicleImagesResponse>()
                .await?;

            if status
                .errors
                .as_ref()
                .is_some_and(|errors| has_unauthenticated_error(errors))
                && !refreshed_app_session
                && attempt == 0
            {
                let session = create_csrf_session(client).await?;
                app_session_token = session.app_session_token;
                refreshed_app_session = true;
                attempt += 1;
                continue;
            }

            break status;
        };

        if let Some(errors) = status.errors {
            if !errors.is_empty() {
                tracing::warn!(
                    image_style = style,
                    vehicle_version = version,
                    error = %format_gql_error(&errors),
                    "rivian.vehicle_images.graphql_error"
                );
                continue;
            }
        }

        if let Some(data) = status.data {
            let order = data.get_vehicle_order_mobile_images.unwrap_or_default();
            let vehicle = data.get_vehicle_mobile_images.unwrap_or_default();
            for (source, entries) in [("order", order), ("vehicle", vehicle)] {
                for image in entries {
                    if !seen.insert(image.url.clone()) {
                        continue;
                    }
                    images.push(RivianVehicleImage {
                        order_id: image.order_id,
                        vehicle_id: image.vehicle_id,
                        url: image.url,
                        extension: image.extension,
                        resolution: image.resolution,
                        size: image.size,
                        design: image.design,
                        placement: image.placement,
                        overlays: image.overlays.unwrap_or_else(|| serde_json::json!([])),
                        source: format!("{source}:{style}"),
                        vehicle_version: version.to_string(),
                    });
                }
            }
        }
    }

    tracing::info!(image_count = images.len(), "rivian.vehicle_images.fetched");
    Ok(images)
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
        .post(gateway_url())
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

fn has_unauthenticated_error(errors: &[GqlError]) -> bool {
    errors.iter().any(|error| {
        error
            .extensions
            .as_ref()
            .and_then(|extensions| extensions.code.as_deref())
            == Some("UNAUTHENTICATED")
    })
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

fn gateway_url() -> String {
    std::env::var("RIVIAN_GRAPHQL_GATEWAY_URL").unwrap_or_else(|_| DEFAULT_GATEWAY_URL.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode},
        routing::post,
        Json, Router,
    };
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone)]
    struct RecordedRequest {
        operation_name: String,
        headers: HeaderMap,
        body: Value,
    }

    #[tokio::test]
    async fn login_and_otp_follow_current_rivian_graphql_shape() {
        let recorded = Arc::new(Mutex::new(Vec::<RecordedRequest>::new()));
        let app = Router::new()
            .route("/api/gql/gateway/graphql", post(mock_rivian_gateway))
            .with_state(recorded.clone());

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let _server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        std::env::set_var(
            "RIVIAN_GRAPHQL_GATEWAY_URL",
            format!("http://{addr}/api/gql/gateway/graphql"),
        );

        let client = reqwest::Client::new();
        let challenge = match rivian_login(&client, "driver@example.com", "secret")
            .await
            .unwrap()
        {
            LoginResult::OtpRequired(challenge) => challenge,
            LoginResult::Authenticated(_) => panic!("expected MFA challenge"),
        };

        assert_eq!(challenge.email, "driver@example.com");
        assert_eq!(challenge.otp_token, "otp-token");

        let tokens = rivian_login_otp(&client, &challenge, "123456")
            .await
            .unwrap();
        assert_eq!(tokens.access_token, "access-token");
        assert_eq!(tokens.refresh_token, "refresh-token");
        assert_eq!(tokens.user_session_token, "user-session-token");
        assert_eq!(tokens.app_session_token, "app-session-token");
        assert_eq!(tokens.csrf_token, "csrf-token");

        let vehicles = rivian_user_vehicles(&client, &tokens).await.unwrap();
        assert_eq!(
            vehicles,
            vec![RivianVehicleSummary {
                id: "vehicle-123".into(),
                name: Some("Compass Yellow".into()),
                vin: Some("7FCTGAAL0NN000001".into()),
                model: Some("R1T".into()),
                model_year: Some(2022),
            }]
        );

        let requests = recorded.lock().unwrap();
        assert_eq!(requests.len(), 4);
        assert_eq!(requests[0].operation_name, "CreateCSRFToken");
        assert!(requests[0].headers.get("csrf-token").is_none());
        assert!(requests[0].headers.get("a-sess").is_none());

        assert_eq!(requests[1].operation_name, "Login");
        assert_eq!(requests[1].headers["csrf-token"], "csrf-token");
        assert_eq!(requests[1].headers["a-sess"], "app-session-token");
        assert_eq!(
            requests[1].headers["apollographql-client-name"],
            APOLLO_CLIENT_NAME
        );
        assert_eq!(requests[1].body["variables"]["email"], "driver@example.com");
        assert_eq!(requests[1].body["variables"]["password"], "secret");

        assert_eq!(requests[2].operation_name, "LoginWithOTP");
        assert_eq!(requests[2].headers["csrf-token"], "csrf-token");
        assert_eq!(requests[2].headers["a-sess"], "app-session-token");
        assert_eq!(requests[2].body["variables"]["email"], "driver@example.com");
        assert_eq!(requests[2].body["variables"]["otpCode"], "123456");
        assert_eq!(requests[2].body["variables"]["otpToken"], "otp-token");

        assert_eq!(requests[3].operation_name, "getUserInfo");
        assert_eq!(requests[3].headers["csrf-token"], "csrf-token");
        assert_eq!(requests[3].headers["a-sess"], "app-session-token");
        assert_eq!(requests[3].headers["u-sess"], "user-session-token");
        assert_eq!(requests[3].headers["authorization"], "Bearer access-token");

        std::env::remove_var("RIVIAN_GRAPHQL_GATEWAY_URL");
    }

    async fn mock_rivian_gateway(
        State(recorded): State<Arc<Mutex<Vec<RecordedRequest>>>>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> (StatusCode, Json<Value>) {
        let operation_name = body["operationName"].as_str().unwrap_or("").to_string();
        recorded.lock().unwrap().push(RecordedRequest {
            operation_name: operation_name.clone(),
            headers,
            body,
        });

        let response = match operation_name.as_str() {
            "CreateCSRFToken" => json!({
                "data": {
                    "createCsrfToken": {
                        "__typename": "CreateCSRFTokenResponse",
                        "csrfToken": "csrf-token",
                        "appSessionToken": "app-session-token"
                    }
                }
            }),
            "Login" => json!({
                "data": {
                    "login": {
                        "__typename": "MobileMFALoginResponse",
                        "otpToken": "otp-token"
                    }
                }
            }),
            "LoginWithOTP" => json!({
                "data": {
                    "loginWithOTP": {
                        "__typename": "MobileLoginResponse",
                        "accessToken": "access-token",
                        "refreshToken": "refresh-token",
                        "userSessionToken": "user-session-token"
                    }
                }
            }),
            "getUserInfo" => json!({
                "data": {
                    "currentUser": {
                        "vehicles": [{
                            "id": "vehicle-123",
                            "vin": "7FCTGAAL0NN000001",
                            "name": "Compass Yellow",
                            "vehicle": {
                                "modelYear": 2022,
                                "model": "R1T"
                            }
                        }]
                    }
                }
            }),
            _ => json!({
                "errors": [{
                    "message": "unexpected operation",
                    "extensions": { "code": "BAD_REQUEST" }
                }]
            }),
        };

        (StatusCode::OK, Json(response))
    }
}
