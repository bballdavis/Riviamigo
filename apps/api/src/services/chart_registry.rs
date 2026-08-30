use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

pub const BUNDLED_CHART_BASELINE_REVISION: i32 = 5;

const BUNDLED_CHART_DEFAULTS: &str = include_str!("../../charts/defaults.json");
const RETIRED_BUNDLED_CHART_SLUGS: &[&str] = &["charge-session-curve"];
const DELETE_RETIRED_BUNDLED_CHART_SQL: &str =
    "DELETE FROM riviamigo.charts WHERE owner_id IS NULL AND slug = $1";
const UPSERT_BUNDLED_CHART_SQL: &str =
    "INSERT INTO riviamigo.charts (owner_id,slug,name,description,is_default,is_locked,is_enabled,config,baseline_revision) VALUES (NULL,$1,$2,$3,TRUE,FALSE,$4,$5,$6) ON CONFLICT (slug) WHERE owner_id IS NULL DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,is_enabled=EXCLUDED.is_enabled,config=EXCLUDED.config,baseline_revision=EXCLUDED.baseline_revision,updated_at=NOW() WHERE COALESCE(riviamigo.charts.baseline_revision,0) < COALESCE(EXCLUDED.baseline_revision,0)";

/// Seed installation-wide chart rows without touching personal overrides.
/// The JSON file is generated from the canonical dashboard package defaults.
pub async fn seed_defaults(pool: &PgPool) -> anyhow::Result<()> {
    for slug in RETIRED_BUNDLED_CHART_SLUGS {
        sqlx::query(DELETE_RETIRED_BUNDLED_CHART_SQL)
            .bind(slug)
            .execute(pool)
            .await?;
    }

    let defaults: Vec<Value> = serde_json::from_str(BUNDLED_CHART_DEFAULTS)?;
    for chart in defaults {
        let slug = chart["slug"].as_str().unwrap_or_default();

        let name = chart["name"].as_str().unwrap_or("Chart");
        let description = chart["description"].as_str();
        let enabled = chart["enabled"].as_bool().unwrap_or(true);
        let config = chart["definition"].clone();
        sqlx::query(UPSERT_BUNDLED_CHART_SQL)
            .bind(slug)
            .bind(name)
            .bind(description)
            .bind(enabled)
            .bind(config)
            .bind(BUNDLED_CHART_BASELINE_REVISION)
            .execute(pool)
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn bundled_chart_baseline_advances_existing_system_rows_only() {
        assert_eq!(BUNDLED_CHART_BASELINE_REVISION, 5);
        assert!(UPSERT_BUNDLED_CHART_SQL.contains("VALUES (NULL"));
        assert!(UPSERT_BUNDLED_CHART_SQL.contains("ON CONFLICT (slug) WHERE owner_id IS NULL"));
        assert!(UPSERT_BUNDLED_CHART_SQL.contains(
            "COALESCE(riviamigo.charts.baseline_revision,0) < COALESCE(EXCLUDED.baseline_revision,0)"
        ));
        assert!(DELETE_RETIRED_BUNDLED_CHART_SQL.contains("owner_id IS NULL"));
        assert!(DELETE_RETIRED_BUNDLED_CHART_SQL.contains("slug = $1"));
    }

    #[test]
    fn embedded_baseline_contains_the_complete_renderer_compatible_inventory() {
        let defaults: Vec<Value> = serde_json::from_str(BUNDLED_CHART_DEFAULTS).unwrap();
        assert_eq!(defaults.len(), 14);
        let slugs = defaults
            .iter()
            .map(|chart| chart["slug"].as_str().unwrap())
            .collect::<HashSet<_>>();
        assert_eq!(slugs.len(), defaults.len());
        assert!(!slugs.contains("charge-session-curve"));
        assert_eq!(RETIRED_BUNDLED_CHART_SLUGS, ["charge-session-curve"]);
        assert!(defaults.iter().all(|chart| {
            chart["definition"]["schemaVersion"] == 1
                && chart["definition"]["series"]
                    .as_array()
                    .is_some_and(|series| !series.is_empty())
        }));

        let battery = defaults
            .iter()
            .find(|chart| chart["slug"] == "battery-capacity-mileage")
            .unwrap();
        let fields = battery["definition"]["series"]
            .as_array()
            .unwrap()
            .iter()
            .map(|series| series["y"]["field"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(fields, ["usable_kwh", "odometer_miles"]);
        assert_eq!(battery["definition"]["series"][0]["fill"], true);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChartRecord {
    pub id: Uuid,
    pub owner_id: Option<Uuid>,

    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub is_locked: bool,
    pub is_enabled: bool,
    pub config: Value,
    pub baseline_revision: Option<i32>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartPermissions {
    pub read: bool,
    pub edit: bool,

    pub duplicate: bool,
    pub reset: bool,
    pub restore: bool,
    pub delete: bool,
    pub lock: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartManagerEntry {
    pub effective: ChartRecord,
    pub system_base: Option<ChartRecord>,
    pub personal_override: Option<ChartRecord>,
    pub origin: String,
    pub permissions: ChartPermissions,
}

pub fn merge_entries(
    mut rows: Vec<ChartRecord>,
    user_id: Uuid,
    admin: bool,
) -> Vec<ChartManagerEntry> {
    rows.sort_by(|a, b| {
        a.slug
            .cmp(&b.slug)
            .then_with(|| a.owner_id.is_some().cmp(&b.owner_id.is_some()))
    });
    let mut entries = Vec::new();
    while let Some(row) = rows.pop() {
        let slug = row.slug.clone();
        let mut system_base = None;
        let mut personal_override = None;
        let mut effective = row;

        if effective.owner_id.is_none() {
            system_base = Some(effective.clone());
        } else {
            personal_override = Some(effective.clone());
        }
        while rows.last().is_some_and(|candidate| candidate.slug == slug) {
            let candidate = rows.pop().expect("row exists");
            if candidate.owner_id.is_none() {
                system_base = Some(candidate);
            } else if candidate.owner_id == Some(user_id) {
                personal_override = Some(candidate);
            }
        }
        if let Some(personal) = personal_override.clone() {
            effective = personal;
        } else if let Some(system) = system_base.clone() {
            effective = system;
        }
        let is_personal = effective.owner_id == Some(user_id);
        let has_system_base = system_base.is_some();
        let locked = effective.is_locked;
        entries.push(ChartManagerEntry {
            effective,
            system_base,

            personal_override,
            origin: if is_personal && has_system_base {
                "override"
            } else if is_personal {
                "personal"
            } else {
                "system"
            }
            .into(),
            permissions: ChartPermissions {
                read: true,
                edit: admin || is_personal && !locked,
                duplicate: true,
                reset: is_personal && has_system_base,
                restore: admin,
                delete: is_personal,

                lock: admin,
            },
        });
    }
    entries.sort_by(|a, b| a.effective.slug.cmp(&b.effective.slug));
    entries
}
