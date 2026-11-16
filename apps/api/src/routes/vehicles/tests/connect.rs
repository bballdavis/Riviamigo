use super::*;

#[test]
fn maps_rejected_rivian_credentials_to_an_actionable_error() {
    assert!(matches!(
        map_rivian_login_error(crate::ingestion::rivian_auth::RivianAuthError::InvalidCredentials),
        crate::errors::AppError::RivianCredentialsRejected
    ));
}

#[test]
fn maps_rejected_rivian_otp_to_an_actionable_error() {
    assert!(matches!(
        map_rivian_otp_error(crate::ingestion::rivian_auth::RivianAuthError::InvalidOtp),
        crate::errors::AppError::RivianOtpRejected
    ));
}

#[test]
fn requires_authorized_connected_runtime_before_reporting_refresh_ready() {
    assert!(vehicle_data_ready(Some("connected"), Some("authorized")));
    assert!(!vehicle_data_ready(Some("starting"), Some("authorized")));
    assert!(!vehicle_data_ready(Some("connected"), Some("needs_reauth")));
    assert!(!vehicle_data_ready(None, None));
}

#[tokio::test]
async fn paused_vehicle_refresh_never_starts_a_collector_or_waits_for_data() {
    // The no-op supervisor rejects every command and the pool is never
    // connected, so any start attempt reports SupervisorUnavailable at once.
    let state = make_helper_state("redis://127.0.0.1/".into());
    let vehicle_id = Uuid::new_v4();
    let started = std::time::Instant::now();
    assert_eq!(
        start_refreshed_vehicle_telemetry(&state, vehicle_id, true).await,
        CredentialRefreshTelemetry::Paused
    );
    assert_eq!(
        start_refreshed_vehicle_telemetry(&state, vehicle_id, false).await,
        CredentialRefreshTelemetry::SupervisorUnavailable
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
}

#[test]
fn credential_refresh_response_reports_paused_collection() {
    let vehicle_id = Uuid::new_v4();
    let paused = credential_refresh_response(vehicle_id, CredentialRefreshTelemetry::Paused);
    assert_eq!(paused["ok"], true);
    assert_eq!(paused["vehicle_saved"], true);
    assert_eq!(paused["vehicle_id"], vehicle_id.to_string());
    assert_eq!(paused["connection_status"], "paused");
    assert_eq!(paused["telemetry_status"], "paused");
    assert_eq!(paused["telemetry_error"], CREDENTIAL_REFRESH_PAUSED_MESSAGE);

    for (telemetry, connection, status, has_error) in [
        (
            CredentialRefreshTelemetry::Connected,
            "connected",
            "connected",
            false,
        ),
        (
            CredentialRefreshTelemetry::WaitingForVehicleData,
            "connected_waiting_for_vehicle_data",
            "waiting_for_vehicle_data",
            true,
        ),
        (
            CredentialRefreshTelemetry::SupervisorUnavailable,
            "connected_waiting_for_vehicle_data",
            "delayed",
            true,
        ),
    ] {
        let body = credential_refresh_response(vehicle_id, telemetry);
        assert_eq!(body["connection_status"], connection);
        assert_eq!(body["telemetry_status"], status);
        assert_eq!(body["telemetry_error"].is_string(), has_error);
    }
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn connect_requires_auth() {
    let app = make_app().await;
    let status = post_status(
        app,
        "/v1/vehicles/connect",
        serde_json::json!({"email": "a@b.com", "password": "x"}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "requires REDIS_URL"]
async fn encrypted_redis_round_trips_connect_tokens_without_plaintext_storage() {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/".into());
    let state = make_helper_state(redis_url);
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection");
    let key = format!("test:rivian:connect:{}", Uuid::new_v4());
    let tokens = crate::ingestion::session_store::RivianTokenBundle {
        access_token: "access-token".into(),
        refresh_token: "refresh-token".into(),
        app_session_token: "app-session-token".into(),
        user_session_token: "user-session-token".into(),
        csrf_token: "csrf-token".into(),
        created_at: chrono::Utc::now(),
    };

    store_encrypted_redis(&state, &mut conn, &key, &tokens, 60)
        .await
        .expect("store encrypted connect session");

    let raw: Vec<u8> = redis::AsyncCommands::get(&mut conn, &key)
        .await
        .expect("redis get ciphertext");
    assert_ne!(raw, serde_json::to_vec(&tokens).expect("plain json"));

    let round_trip = load_encrypted_redis::<crate::ingestion::session_store::RivianTokenBundle>(
        &state, &mut conn, &key,
    )
    .await
    .expect("load encrypted connect session")
    .expect("stored connect session");

    assert_eq!(round_trip.access_token, tokens.access_token);
    assert_eq!(round_trip.refresh_token, tokens.refresh_token);
    assert_eq!(round_trip.app_session_token, tokens.app_session_token);
    assert_eq!(round_trip.user_session_token, tokens.user_session_token);
    assert_eq!(round_trip.csrf_token, tokens.csrf_token);

    let _: () = redis::AsyncCommands::del(&mut conn, &key)
        .await
        .expect("cleanup redis key");
}

#[tokio::test]
#[ignore = "requires REDIS_URL"]
async fn connect_otp_rejects_challenges_staged_for_other_users() {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/".into());
    let state = make_helper_state(redis_url);
    let owner_id = Uuid::new_v4();
    let other_user_id = Uuid::new_v4();
    let challenge_id = Uuid::new_v4().to_string();
    let key = format!("rivian:otp:{challenge_id}");
    let pending = PendingOtpChallenge {
        email: "driver@example.com".into(),
        otp_token: "otp-token".into(),
        csrf_token: "csrf-token".into(),
        app_session_token: "app-session-token".into(),
        user_id: owner_id,
    };

    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection");
    store_encrypted_redis(&state, &mut conn, &key, &pending, 60)
        .await
        .expect("store encrypted otp challenge");
    drop(conn);

    let result = connect_otp(
        State(state.clone()),
        crate::middleware::auth::AuthUser {
            user_id: other_user_id,
            default_vehicle_id: None,
            api_access_level: None,
            api_vehicle_id: None,
        },
        Json(OtpBody {
            challenge_id: challenge_id.clone(),
            otp_code: "123456".into(),
        }),
    )
    .await;

    assert!(matches!(
        result,
        Err(crate::errors::AppError::RivianConnectSessionExpired)
    ));

    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection");
    let _: () = redis::AsyncCommands::del(&mut conn, &key)
        .await
        .expect("cleanup redis key");
}
