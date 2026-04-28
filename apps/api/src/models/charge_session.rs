use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ChargeSession {
    pub id: Uuid,
    pub vehicle_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub is_home: Option<bool>,
    pub charger_type: Option<String>,
    pub kwh_added: Option<f64>,
    pub soc_start: Option<f64>,
    pub soc_end: Option<f64>,
    pub charge_limit: Option<f64>,
    pub max_charge_rate_kw: Option<f64>,
    pub duration_minutes: Option<i32>,
    pub cost_usd: Option<f64>,
    pub rivian_session_id: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ChargeCurvePoint {
    pub minutes_elapsed: f64,
    pub charge_rate_kw: f64,
    pub soc: f64,
}

#[derive(Debug, Deserialize)]
pub struct SessionListParams {
    pub vehicle_id: Option<Uuid>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub rate_per_kwh: Option<f64>,
}
