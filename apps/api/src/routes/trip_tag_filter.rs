use serde::Deserialize;
use uuid::Uuid;

use crate::errors::AppError;

/// The tag filters shared by trip history and the trip-derived dashboards.
/// Keeping parsing here prevents equivalent endpoints from slowly diverging.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TripTagMatch {
    All,
    Any,
}

#[derive(Debug, Clone)]
pub struct TripTagFilter {
    pub tag_ids: Option<Vec<Uuid>>,
    pub match_all: bool,
    pub untagged: bool,
}

impl Default for TripTagFilter {
    fn default() -> Self {
        Self {
            tag_ids: None,
            match_all: true,
            untagged: false,
        }
    }
}

impl TripTagFilter {
    pub fn is_active(&self) -> bool {
        self.tag_ids.is_some() || self.untagged
    }
}

pub fn parse_tag_filter(
    raw_tag_ids: Option<&str>,
    tag_match: Option<TripTagMatch>,
    raw_untagged: Option<bool>,
) -> Result<TripTagFilter, AppError> {
    let mut tag_ids = raw_tag_ids
        .map(|value| {
            value
                .split(',')
                .filter(|part| !part.trim().is_empty())
                .map(|part| {
                    Uuid::parse_str(part.trim()).map_err(|_| {
                        AppError::Validation(
                            "tag_ids must be a comma-separated list of UUIDs".into(),
                        )
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .filter(|ids| !ids.is_empty());

    if let Some(ids) = tag_ids.as_mut() {
        ids.sort_unstable();
        if ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(AppError::Validation(
                "tag_ids must not contain duplicates".into(),
            ));
        }
        if ids.len() > 50 {
            return Err(AppError::Validation(
                "tag_ids may contain at most 50 IDs".into(),
            ));
        }
    }

    let untagged = raw_untagged.unwrap_or(false);
    if untagged && tag_ids.is_some() {
        return Err(AppError::Validation(
            "untagged cannot be combined with tag_ids".into(),
        ));
    }

    Ok(TripTagFilter {
        tag_ids,
        match_all: !matches!(tag_match, Some(TripTagMatch::Any)),
        untagged,
    })
}

pub async fn require_known_vehicle_tags(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    filter: &TripTagFilter,
) -> Result<(), AppError> {
    let Some(tag_ids) = filter.tag_ids.as_deref() else {
        return Ok(());
    };
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM riviamigo.trip_tags WHERE vehicle_id=$1 AND id=ANY($2)",
    )
    .bind(vehicle_id)
    .bind(tag_ids)
    .fetch_one(pool)
    .await?;
    if count != tag_ids.len() as i64 {
        return Err(AppError::Validation(
            "tag_ids must belong to the selected vehicle".into(),
        ));
    }
    Ok(())
}

/// A static-query-compatible predicate. `alias` is supplied only by route code,
/// while parameter indices are explicit to make SQL binding reviewable.
pub fn sql_predicate(
    alias: &str,
    tag_ids_param: usize,
    match_all_param: usize,
    untagged_param: usize,
) -> String {
    format!(
        " AND (${tag_ids_param}::uuid[] IS NULL OR CASE WHEN ${match_all_param} THEN \
         (SELECT COUNT(DISTINCT tta.tag_id) FROM riviamigo.trip_tag_assignments tta \
          WHERE tta.trip_id={alias}.id AND tta.tag_id=ANY(${tag_ids_param})) = cardinality(${tag_ids_param}) \
         ELSE EXISTS (SELECT 1 FROM riviamigo.trip_tag_assignments tta \
                      WHERE tta.trip_id={alias}.id AND tta.tag_id=ANY(${tag_ids_param})) END) \
         AND (NOT ${untagged_param} OR NOT EXISTS (SELECT 1 FROM riviamigo.trip_tag_assignments tta \
                                                   WHERE tta.trip_id={alias}.id))"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_defaults_to_all_and_rejects_untagged_combination() {
        let tag = Uuid::new_v4();
        let filter = parse_tag_filter(Some(&tag.to_string()), None, None).unwrap();
        assert!(filter.match_all);
        assert_eq!(filter.tag_ids, Some(vec![tag]));
        assert!(parse_tag_filter(Some(&tag.to_string()), None, Some(true)).is_err());
    }

    #[test]
    fn predicate_uses_the_requested_bind_positions_and_trip_alias() {
        let predicate = sql_predicate("t", 4, 5, 6);
        assert!(predicate.contains("$4::uuid[]"));
        assert!(predicate.contains("CASE WHEN $5"));
        assert!(predicate.contains("NOT $6"));
        assert!(predicate.contains("tta.trip_id=t.id"));
    }
}
