use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Vehicle {
    pub id: Uuid,
    pub user_id: Uuid,
    pub rivian_vehicle_id: String,
    pub vin: Option<String>,
    pub model: String,
    pub trim: Option<String>,
    pub color: Option<String>,
    pub battery_config: Option<String>,
    pub battery_capacity_wh: Option<f64>,
    // TODO: home_latitude/home_longitude are superseded by home_geofence_id
    // (riviamigo.geofences, added in migration 0008). These columns remain for
    // backward compat with existing add_vehicle callers but should be migrated
    // to use the geofence geometry and then dropped in a future release.
    pub home_latitude: Option<f64>,
    pub home_longitude: Option<f64>,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct VehicleRuntimeState {
    pub vehicle_id: Uuid,
    pub is_online: Option<bool>,
    pub last_event_at: Option<DateTime<Utc>>,
    pub worker_health: Option<String>,
    pub worker_health_msg: Option<String>,
    pub auth_state: Option<String>,
    pub auth_reason_code: Option<String>,
    pub updated_at: DateTime<Utc>,
}
