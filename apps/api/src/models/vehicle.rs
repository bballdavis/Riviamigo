use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(crate) fn model_year_from_vin(vin: &str) -> Option<i32> {
    let vin = vin.trim().to_ascii_uppercase();
    if vin.len() != 17
        || !vin
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() && !matches!(c, b'I' | b'O' | b'Q'))
        || !vin.as_bytes()[6].is_ascii_alphabetic()
    {
        return None;
    }

    // An alphabetic seventh position disambiguates the 2010-2039 VIN year cycle.
    b"ABCDEFGHJKLMNPRSTVWXY123456789"
        .iter()
        .position(|&code| code == vin.as_bytes()[9])
        .map(|offset| 2010 + offset as i32)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Vehicle {
    pub id: Uuid,
    pub user_id: Uuid,
    pub rivian_vehicle_id: String,
    pub vin: Option<String>,
    pub model: String,
    pub model_year: Option<i32>,
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

#[cfg(test)]
mod tests {
    use super::model_year_from_vin;

    #[test]
    fn decodes_modern_vin_model_year_without_optional_graphql_fields() {
        for (code, year) in [
            ('N', 2022),
            ('P', 2023),
            ('R', 2024),
            ('S', 2025),
            ('T', 2026),
        ] {
            let vin = format!("7FCTGAAL0{code}N000001");
            assert_eq!(model_year_from_vin(&vin), Some(year));
            assert_eq!(model_year_from_vin(&vin.to_lowercase()), Some(year));
        }
    }

    #[test]
    fn rejects_missing_invalid_and_ambiguous_vin_years() {
        for vin in [
            "",
            "7FCTGAAL0SN00000",
            "7FCTGAAL0SN0000011",
            "7FCTGAAL0ZN000001",
            "7FCTGAAL0IN000001",
            "7FCTGAAL0SN00000Q",
            "7FCTGA1L0SN000001",
            "7FCTGAAL0SN00000!",
            "7FCTGAAL0SN0000é",
        ] {
            assert_eq!(model_year_from_vin(vin), None);
        }
    }
}
