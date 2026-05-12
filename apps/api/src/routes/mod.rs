use axum::{middleware, routing::get, Router};
use http::{
    header::{
        CONTENT_SECURITY_POLICY, REFERRER_POLICY, STRICT_TRANSPORT_SECURITY,
        X_CONTENT_TYPE_OPTIONS, X_FRAME_OPTIONS,
    },
    HeaderValue,
};
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer},
    request_id::{MakeRequestUuid, SetRequestIdLayer},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

use crate::middleware::auth::AppState;

pub mod api_keys;
pub mod auth;
pub mod backups;
pub mod battery;
pub mod charging;
pub mod cost_profiles;
pub mod dashboards;
pub mod data_quality;
pub mod efficiency;
pub mod geofences;
pub mod grafana;
pub mod health;
pub mod idle_drain;
pub mod live;
pub mod locations;
pub mod metrics;
pub mod overview;
pub mod places;
pub mod rivian_stewardship;
pub mod state_timeline;
pub mod stats;
pub mod trips;
pub mod vehicles;

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
        .allow_headers(AllowHeaders::mirror_request())
        .allow_credentials(true);

    // Inject decoding key into request extensions so AuthUser extractor can find it
    let decoding_key = state.jwt_keys.decoding.clone();

    let protected = Router::new()
        .merge(auth::protected_router())
        .merge(api_keys::router())
        .merge(backups::router())
        .merge(vehicles::router())
        .merge(battery::router())
        .merge(trips::router())
        .merge(charging::router())
        .merge(efficiency::router())
        .merge(stats::router())
        .merge(metrics::router())
        .merge(live::router())
        .merge(dashboards::router())
        .merge(cost_profiles::router())
        .merge(geofences::router())
        .merge(places::router())
        .merge(rivian_stewardship::router())
        .merge(overview::router())
        .merge(state_timeline::router())
        .merge(health::router())
        .merge(idle_drain::router())
        .merge(locations::router())
        .merge(data_quality::router())
        .layer(middleware::from_fn(
            move |mut req: axum::extract::Request, next: axum::middleware::Next| {
                let key = decoding_key.clone();
                async move {
                    req.extensions_mut().insert(key);
                    next.run(req).await
                }
            },
        ));

    Router::new()
        .route("/health", get(health))
        .nest("/v1", Router::new().merge(auth::router()).merge(protected))
        .route("/grafana/query", axum::routing::post(grafana::query_stub))
        .route("/grafana/search", axum::routing::post(grafana::search_stub))
        .layer(cors)
        .layer(CompressionLayer::new())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
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
