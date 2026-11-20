//! Which local vehicle a completed-session summary belongs to: upstream
//! vehicle classification, the sole-vehicle fallback for summaries without a
//! vehicle ID, and removal of stored API-only sessions that Rivian's evidence
//! places on another vehicle.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::ChargeSessionSummaryPayload;

/// How a completed-session summary's upstream `vehicleId` relates to the local
/// vehicle being synced. `getCompletedSessionSummaries` returns the whole
/// Rivian account's charging history, so every summary is classified before
/// it is stored or matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SummaryVehicleMatch {
    /// The summary names the target vehicle's Rivian ID exactly.
    Match,
    /// The summary names a different Rivian vehicle; it is never attributed.
    Foreign,
    /// The summary has no `vehicleId` and is a Rivian Wall Charger session
    /// that no vehicle reported: the charger's own transaction with no
    /// vehicle-side (`VTXN:`) record. A Wall Charger serves any EV, such as a
    /// household's non-Rivian car, so it is never attributed. Support for
    /// non-Rivian vehicles would route this class to its own vehicle.
    WallChargerOnly,
    /// Any other summary with a null or empty `vehicleId`.
    Unidentified,
}

impl ChargeSessionSummaryPayload {
    pub fn vehicle_match(&self, rivian_vehicle_id: &str) -> SummaryVehicleMatch {
        match self.vehicle_id.as_deref().map(str::trim) {
            None | Some("") if self.is_unreported_wall_charger_session() => {
                SummaryVehicleMatch::WallChargerOnly
            }
            None | Some("") => SummaryVehicleMatch::Unidentified,
            Some(_) if self.vehicle_id.as_deref() == Some(rivian_vehicle_id) => {
                SummaryVehicleMatch::Match
            }
            Some(_) => SummaryVehicleMatch::Foreign,
        }
    }

    /// A Rivian Wall Charger session (`chargerType` `WALLBOX`) without a
    /// vehicle-side `VTXN:` data source. A Rivian charging on its owner's Wall
    /// Charger reports its own transaction, which Rivian groups with the
    /// charger's and uses to name the vehicle.
    fn is_unreported_wall_charger_session(&self) -> bool {
        let wall_charger = self
            .charger_type
            .as_deref()
            .is_some_and(|charger_type| charger_type.trim().eq_ignore_ascii_case("WALLBOX"));
        let vehicle_reported = self
            .meta
            .as_ref()
            .and_then(|meta| meta.data_sources.as_deref())
            .is_some_and(|sources| {
                sources
                    .iter()
                    .any(|source| source.trim_start().starts_with("VTXN:"))
            });
        wall_charger && !vehicle_reported
    }
}

/// Per-run tally of account-wide summaries that were filtered by vehicle.
/// Only counts are logged; the other vehicle's Rivian ID is never recorded.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SummaryAttributionCounts {
    pub skipped_foreign: u64,
    pub skipped_wall_charger: u64,
    pub skipped_unidentified: u64,
    pub accepted_unidentified: u64,
}

impl SummaryAttributionCounts {
    /// Applies the attribution rule and returns whether the summary may be
    /// stored or replayed for the target vehicle. Unidentified summaries are
    /// accepted only when `allow_unidentified` is set, which callers derive
    /// from [`vehicles_accepting_unidentified_summaries`]; Wall Charger
    /// sessions without a vehicle record never are.
    pub fn admit(&mut self, classification: SummaryVehicleMatch, allow_unidentified: bool) -> bool {
        match classification {
            SummaryVehicleMatch::Match => true,
            SummaryVehicleMatch::Foreign => {
                self.skipped_foreign += 1;
                false
            }
            SummaryVehicleMatch::WallChargerOnly => {
                self.skipped_wall_charger += 1;
                false
            }
            SummaryVehicleMatch::Unidentified if allow_unidentified => {
                self.accepted_unidentified += 1;
                true
            }
            SummaryVehicleMatch::Unidentified => {
                self.skipped_unidentified += 1;
                false
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub fn log(&self, vehicle_id: Option<Uuid>, context: &'static str) {
        if self.is_empty() {
            return;
        }
        // Recurs on every sync that sees the same foreign summaries, so this is
        // a decision trail rather than an operator summary.
        tracing::debug!(
            vehicle_id = vehicle_id.map(|id| id.to_string()),
            context,
            skipped_foreign = self.skipped_foreign,
            skipped_wall_charger = self.skipped_wall_charger,
            skipped_unidentified = self.skipped_unidentified,
            accepted_unidentified = self.accepted_unidentified,
            "charge history summaries filtered by upstream vehicle identity"
        );
    }
}

#[derive(Debug, FromRow)]
struct VehicleOwnershipRow {
    id: Uuid,
    user_id: Uuid,
    rivian_vehicle_id: String,
    has_foreign_payloads: bool,
}

/// Returns the local vehicles that may receive completed-session summaries
/// whose upstream `vehicleId` is missing: a vehicle qualifies only when it is
/// the sole non-demo vehicle owned (`vehicles.user_id`) by its user and none
/// of its retained summaries names another upstream vehicle. Credentials are
/// stored per vehicle, so a sole local vehicle can still share its Rivian
/// account with vehicles that are untracked or owned by another user; any
/// foreign summary proves that and disables the fallback. Live sync also
/// refuses when the current response contains a foreign summary. When
/// `vehicle_id` is set, only that vehicle's owner is considered.
pub async fn vehicles_accepting_unidentified_summaries(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<HashSet<Uuid>> {
    let rows = sqlx::query_as::<_, VehicleOwnershipRow>(
        r#"
        SELECT v.id, v.user_id, v.rivian_vehicle_id,
               EXISTS (
                   SELECT 1 FROM riviamigo.rivian_charge_payloads p
                   WHERE p.vehicle_id = v.id
                     AND p.operation = 'getCompletedSessionSummaries'
                     AND p.rivian_vehicle_id IS NOT NULL
                     AND btrim(p.rivian_vehicle_id) <> ''
                     AND p.rivian_vehicle_id <> v.rivian_vehicle_id
               ) AS has_foreign_payloads
        FROM riviamigo.vehicles v
        WHERE $1::uuid IS NULL
           OR v.user_id = (SELECT target.user_id FROM riviamigo.vehicles target WHERE target.id = $1)
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut real_vehicles_by_user = HashMap::<Uuid, Vec<(Uuid, bool)>>::new();
    for row in rows {
        if !crate::db::vehicles::is_demo_vehicle_key(&row.rivian_vehicle_id) {
            real_vehicles_by_user
                .entry(row.user_id)
                .or_default()
                .push((row.id, row.has_foreign_payloads));
        }
    }

    Ok(real_vehicles_by_user
        .into_values()
        .filter_map(|vehicles| match vehicles.as_slice() {
            [(only, false)] => Some(*only),
            _ => None,
        })
        .collect())
}

/// Outcome of [`remove_other_vehicle_api_sessions`]: sessions removed, and how
/// many of them carried a manual cost or location correction.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct OtherVehicleSessionRemoval {
    pub removed: u64,
    pub corrected: u64,
}

/// SQL condition on an API-only session `cs` joined to its vehicle `v` that
/// holds when Rivian's own evidence puts the session on another vehicle: the
/// summary that created it named a Rivian none of the user's vehicles is, or
/// it is a Wall Charger session no vehicle reported
/// ([`SummaryVehicleMatch::WallChargerOnly`]). `rivian_meta` keeps the
/// creating summary after its retained payload expires, so the second case
/// stays detectable; a stored summary without a `vehicleId` key is not
/// evidence, and a `vtxn` alias, which outlives payload retention, shows a
/// vehicle-reported summary was merged into the row. Other sessions without
/// a vehicle ID are kept. Rows naming one of the user's other vehicles are
/// left to [`super::reassign_misattributed_api_sessions`]. A row is also
/// spared when a retained summary linked to it names its own vehicle, or when
/// its vehicle's telemetry or charge-curve samples reference it.
pub(super) const OTHER_VEHICLE_API_SESSION_CONDITION: &str = r#"
    cs.source = 'rivian_api'
    AND (
        -- Rivian named a vehicle that is not one of this user's.
        (btrim(COALESCE(cs.rivian_vehicle_id, '')) <> ''
         AND cs.rivian_vehicle_id <> v.rivian_vehicle_id
         AND NOT EXISTS (
             SELECT 1 FROM riviamigo.vehicles owner
             WHERE owner.user_id = v.user_id
               AND owner.rivian_vehicle_id = cs.rivian_vehicle_id
         ))
        -- A Wall Charger session no vehicle reported, such as a non-Rivian
        -- EV sharing the charger.
        OR (btrim(COALESCE(cs.rivian_vehicle_id, '')) = ''
            AND jsonb_typeof(cs.rivian_meta) = 'object'
            AND cs.rivian_meta ? 'vehicleId'
            AND btrim(COALESCE(cs.rivian_meta->>'vehicleId', '')) = ''
            AND upper(btrim(COALESCE(cs.rivian_meta->>'chargerType', ''))) = 'WALLBOX'
            AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(cs.rivian_meta->'meta'->'dataSources') = 'array'
                         THEN cs.rivian_meta->'meta'->'dataSources'
                         ELSE '[]'::jsonb
                    END
                ) AS source(value)
                WHERE ltrim(source.value) LIKE 'VTXN:%'
            )
            -- Nor was a vehicle-reported summary merged into it later.
            AND NOT EXISTS (
                SELECT 1 FROM riviamigo.charge_session_external_aliases a
                WHERE a.charge_session_id = cs.id
                  AND a.alias_kind = 'vtxn'
            ))
    )
    AND NOT EXISTS (
        SELECT 1 FROM riviamigo.rivian_charge_payloads p
        WHERE p.vehicle_id = cs.vehicle_id
          AND p.charge_session_id = cs.id
          AND p.operation = 'getCompletedSessionSummaries'
          AND p.rivian_vehicle_id = v.rivian_vehicle_id
    )
    AND NOT EXISTS (
        SELECT 1 FROM timeseries.telemetry t WHERE t.charge_session_id = cs.id
    )
    AND NOT EXISTS (
        SELECT 1 FROM riviamigo.rivian_charge_curve_points p WHERE p.charge_session_id = cs.id
    )
    AND NOT EXISTS (
        SELECT 1 FROM timeseries.parallax_charge_curve_points p WHERE p.charge_session_id = cs.id
    )
"#;

/// Removes a vehicle's API-only charge sessions that Rivian's evidence places
/// on another vehicle (see [`OTHER_VEHICLE_API_SESSION_CONDITION`]): a Rivian
/// the user does not have in Riviamigo, or a Wall Charger session no vehicle
/// reported, such as a non-Rivian EV sharing the charger. Sync and replay no
/// longer attribute those summaries; this clears rows stored before that
/// rule. Rows owned by one of the user's other vehicles are moved by
/// [`super::reassign_misattributed_api_sessions`] instead.
///
/// Only the charging history backfill runs this, inside its full fetch: while
/// it holds the vehicle's charge-history lock, after Rivian has returned a
/// non-empty history, and right before applying it. Older releases could merge
/// the vehicle's own summary into a row created by another vehicle's summary,
/// and once that summary's retained payload expires nothing local shows it;
/// applying Rivian's history re-creates such a session. Canonicalization and
/// replay, which see only local evidence, never run this removal.
///
/// Aliases, annotations, and manual cost or location corrections are deleted
/// with the row; corrected rows are counted. Retained payloads are kept and
/// unlinked. Telemetry-backed rows are never removed. The removal runs in one
/// transaction.
pub async fn remove_other_vehicle_api_sessions(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<OtherVehicleSessionRemoval> {
    let mut transaction = pool.begin().await?;
    let removed = sqlx::query_as::<_, (Uuid, bool)>(sqlx::AssertSqlSafe(format!(
        r#"
        DELETE FROM riviamigo.charge_sessions cs
        USING riviamigo.vehicles v
        WHERE v.id = cs.vehicle_id
          AND cs.vehicle_id = $1
          AND {OTHER_VEHICLE_API_SESSION_CONDITION}
        RETURNING cs.id,
                  cs.cost_override_mode <> 'automatic'
                      OR cs.location_override_mode <> 'automatic'
        "#
    )))
    .bind(vehicle_id)
    .fetch_all(&mut *transaction)
    .await?;

    let session_ids = removed.iter().map(|(id, _)| *id).collect::<Vec<_>>();
    if !session_ids.is_empty() {
        sqlx::query(
            "UPDATE riviamigo.rivian_charge_payloads
             SET charge_session_id = NULL
             WHERE charge_session_id = ANY($1)",
        )
        .bind(&session_ids)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;

    let removal = OtherVehicleSessionRemoval {
        removed: removed.len() as u64,
        corrected: removed.iter().filter(|(_, corrected)| *corrected).count() as u64,
    };
    if removal.removed > 0 {
        tracing::info!(
            vehicle_id = %vehicle_id,
            removed = removal.removed,
            corrected = removal.corrected,
            "removed API-only charge sessions that belong to other vehicles"
        );
    }
    Ok(removal)
}
