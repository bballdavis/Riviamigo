//! Grafana SimpleJSON stub — returns 501 until v0.5.
use axum::{http::StatusCode, response::IntoResponse};

pub async fn query_stub() -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "Grafana endpoint not yet implemented")
}

pub async fn search_stub() -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "Grafana endpoint not yet implemented")
}
