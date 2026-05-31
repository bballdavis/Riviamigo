use std::sync::Arc;

use axum::{middleware, routing::get, Router};
use http::{
    header::{
        CONTENT_SECURITY_POLICY, REFERRER_POLICY, STRICT_TRANSPORT_SECURITY,
        X_CONTENT_TYPE_OPTIONS, X_FRAME_OPTIONS,
    },
    HeaderValue, StatusCode,
};
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, SetRequestIdLayer},
    set_header::SetResponseHeaderLayer,
    trace::{DefaultMakeSpan, DefaultOnFailure, TraceLayer},
};

use crate::middleware::auth::AppState;

pub mod api_keys;
pub mod auth;
pub mod backfill;
pub mod backups;
pub mod battery;
pub mod charging;
pub mod cost_profiles;
pub mod dashboards;
pub mod efficiency;
pub mod grafana;
pub mod health;
pub mod idle_drain;
pub mod live;
pub mod locations;
pub mod metrics;
pub mod overview;
pub mod places;
mod range_normalization;
pub mod rivian_stewardship;
pub mod schedules;
pub mod state_timeline;
pub mod trips;
pub mod users;
pub mod vehicles;

async fn log_server_errors(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let mut response = next.run(req).await;

    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        // Mark API-originated throttles so clients can differentiate from edge (nginx) limits.
        if !response
            .headers()
            .contains_key("x-riviamigo-ratelimit-source")
        {
            response.headers_mut().insert(
                "x-riviamigo-ratelimit-source",
                HeaderValue::from_static("api"),
            );
        }
        if !response.headers().contains_key(http::header::RETRY_AFTER) {
            response
                .headers_mut()
                .insert(http::header::RETRY_AFTER, HeaderValue::from_static("1"));
        }

        tracing::warn!(%method, %path, status = %response.status(), limiter_source = "api", "request rate limited");
    }

    if response.status().is_server_error() {
        tracing::error!(%method, %path, status = %response.status(), "request returned server error");
    }

    response
}

pub fn build_router(state: AppState) -> Router {
    let allowed_origins: Vec<HeaderValue> = state
        .config
        .allowed_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed_origins))
        .allow_methods(AllowMethods::list([
            http::Method::GET,
            http::Method::POST,
            http::Method::PUT,
            http::Method::PATCH,
            http::Method::DELETE,
        ]))
        .allow_headers(AllowHeaders::list([
            http::header::AUTHORIZATION,
            http::header::CONTENT_TYPE,
            http::header::ACCEPT,
        ]))
        .allow_credentials(true);

    // Rate-limit configs
    // Auth routes: strict limit to prevent brute-force attacks on login/OTP
    let auth_config = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(6)
            .burst_size(10)
            .finish()
            .unwrap(),
    );
    // Protected data routes: allow a higher burst for dashboard pages that fan
    // out many concurrent widget queries, while still capping sustained abuse.
    let data_config = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(120)
            .burst_size(240)
            .finish()
            .unwrap(),
    );

    // Inject decoding key into request extensions so AuthUser extractor can find it.
    let decoding_key = state.jwt_keys.decoding.clone();

    let protected = Router::new()
        .merge(auth::protected_router())
        .merge(api_keys::router())
        .merge(backups::router())
        .merge(backfill::router())
        .merge(vehicles::router())
        .merge(battery::router())
        .merge(trips::router())
        .merge(charging::router())
        .merge(efficiency::router())
        .merge(metrics::router())
        .merge(live::router())
        .merge(dashboards::router())
        .merge(cost_profiles::router())
        .merge(places::router())
        .merge(rivian_stewardship::router())
        .merge(schedules::router())
        .merge(overview::router())
        .merge(state_timeline::router())
        .merge(health::router())
        .merge(idle_drain::router())
        .merge(locations::router())
        .merge(grafana::router())
        .merge(users::router())
        .layer(middleware::from_fn(
            move |mut req: axum::extract::Request, next: axum::middleware::Next| {
                let key = decoding_key.clone();
                async move {
                    req.extensions_mut().insert(key);
                    next.run(req).await
                }
            },
        ))
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .layer(GovernorLayer {
            config: data_config,
        });

    // Public auth routes with strict rate limiting
    let auth_public = auth::router().layer(GovernorLayer {
        config: auth_config,
    });

    Router::new()
        .route("/health", get(health))
        .nest("/v1", Router::new().merge(auth_public).merge(protected))
        .layer(middleware::from_fn(log_server_errors))
        .layer(cors)
        .layer(CompressionLayer::new())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().include_headers(false))
                .on_failure(DefaultOnFailure::new()),
        )
        .layer(SetResponseHeaderLayer::overriding(
            STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(
                "default-src 'self'; img-src 'self' data: https://*.basemaps.cartocdn.com; \
                 style-src 'self' 'unsafe-inline'; script-src 'self'; \
                 connect-src 'self' wss:; font-src 'self' data:; frame-ancestors 'none'",
            ),
        ))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
