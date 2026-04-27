use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Trip {
    pub id:                     Uuid,
    pub vehicle_id:             Uuid,
    pub started_at:             DateTime<Utc>,
    pub ended_at:               DateTime<Utc>,
    pub start_lat:              Option<f64>,
    pub start_lng:              Option<f64>,
    pub end_lat:                Option<f64>,
    pub end_lng:                Option<f64>,
    pub distance_miles:         Option<f64>,
    pub duration_seconds:       Option<i32>,
    pub soc_start:              Option<f64>,
    pub soc_end:                Option<f64>,
    pub efficiency_wh_per_mile: Option<f64>,
    pub max_speed_mph:          Option<f64>,
    pub drive_mode:             Option<String>,
    pub outside_temp_c:         Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct TripResponse {
    pub id:                     Uuid,
    pub started_at:             DateTime<Utc>,
    pub ended_at:               DateTime<Utc>,
    pub duration_seconds:       i32,
    pub distance_miles:         f64,
    pub efficiency_wh_per_mile: Option<f64>,
    pub max_speed_mph:          Option<f64>,
    pub drive_mode:             Option<String>,
    pub soc_start:              Option<f64>,
    pub soc_end:                Option<f64>,
    pub start_location:         Option<LatLng>,
    pub end_location:           Option<LatLng>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatLng {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TrackPoint {
    pub ts:         DateTime<Utc>,
    pub lat:        f64,
    pub lng:        f64,
    pub speed_mph:  Option<f64>,
    pub altitude_m: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct TripListParams {
    pub vehicle_id: Option<Uuid>,
    pub from:       Option<DateTime<Utc>>,
    pub to:         Option<DateTime<Utc>>,
    pub limit:      Option<i64>,
    pub offset:     Option<i64>,
}
