//! Narrow, transactional startup repair for active-tail charging-session damage.
//!
//! This intentionally does not call the broad historical canonicalizer. Only an
//! open telemetry-backed row followed by one unambiguous, continuously charging
//! telemetry session is eligible for a restart-split merge.

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct RepairStats {
    pub merged: u64,
    pub closed: u64,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReconcileStats {
    pub scanned: u64,
    pub attached: u64,
    pub ambiguous: u64,
}

/// Attach previously unassociated Parallax graph points only when their source
/// timestamp belongs to exactly one closed canonical session. The persisted
/// cursor keeps startup work bounded and makes retries idempotent.
pub async fn reconcile_unassociated_parallax_samples(
    pool: &PgPool,
    vehicle_id: Uuid,
    limit: i64,
) -> Result<ReconcileStats> {
    let mut tx = pool.begin().await?;
    let cursor = sqlx::query_as::<_, (Option<chrono::DateTime<chrono::Utc>>, i32)>(
        "SELECT cursor_ts,cursor_segment_index FROM riviamigo.charge_session_repair_cursor WHERE vehicle_id=$1",
    )
    .bind(vehicle_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or((None, -1));
    let rows = sqlx::query_as::<_, (chrono::DateTime<chrono::Utc>, i32)>(
        r#"SELECT source_at,segment_index
           FROM timeseries.parallax_charge_curve_points
           WHERE vehicle_id=$1 AND charge_session_id IS NULL
             AND ((reconciliation_checked_at IS NULL
                   AND ($2::timestamptz IS NULL OR (source_at,segment_index)>($2,$3)))
                  OR reconciliation_checked_at<now()-interval '1 hour')
           ORDER BY reconciliation_checked_at NULLS FIRST,source_at,segment_index LIMIT $4"#,
    )
    .bind(vehicle_id)
    .bind(cursor.0)
    .bind(cursor.1)
    .bind(limit.clamp(1, 1000))
    .fetch_all(&mut *tx)
    .await?;

    let mut stats = ReconcileStats {
        scanned: rows.len() as u64,
        ..ReconcileStats::default()
    };
    for (source_at, segment_index) in &rows {
        let matches = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id FROM riviamigo.charge_sessions
               WHERE vehicle_id=$1 AND ended_at IS NOT NULL
                 AND started_at<=$2 AND ended_at>=$2
               ORDER BY started_at LIMIT 2"#,
        )
        .bind(vehicle_id)
        .bind(source_at)
        .fetch_all(&mut *tx)
        .await?;
        match matches.as_slice() {
            [session_id] => {
                stats.attached += sqlx::query(
                    r#"UPDATE timeseries.parallax_charge_curve_points
                       SET charge_session_id=$1
                       WHERE vehicle_id=$2 AND source_at=$3 AND segment_index=$4
                         AND charge_session_id IS NULL"#,
                )
                .bind(session_id)
                .bind(vehicle_id)
                .bind(source_at)
                .bind(segment_index)
                .execute(&mut *tx)
                .await?
                .rows_affected();
            }
            [_, ..] => stats.ambiguous += 1,
            [] => {}
        }
        sqlx::query(
            "UPDATE timeseries.parallax_charge_curve_points SET reconciliation_checked_at=now() WHERE vehicle_id=$1 AND source_at=$2 AND segment_index=$3",
        )
        .bind(vehicle_id)
        .bind(source_at)
        .bind(segment_index)
        .execute(&mut *tx)
        .await?;
    }
    if let Some((last_source_at, last_segment_index)) = rows.last() {
        sqlx::query(
            r#"INSERT INTO riviamigo.charge_session_repair_cursor(vehicle_id,cursor_ts,cursor_segment_index)
               VALUES($1,$2,$3) ON CONFLICT(vehicle_id) DO UPDATE SET
               cursor_ts=CASE WHEN riviamigo.charge_session_repair_cursor.cursor_ts IS NULL OR
                                   (riviamigo.charge_session_repair_cursor.cursor_ts,riviamigo.charge_session_repair_cursor.cursor_segment_index)
                                   <(EXCLUDED.cursor_ts,EXCLUDED.cursor_segment_index)
                              THEN EXCLUDED.cursor_ts ELSE riviamigo.charge_session_repair_cursor.cursor_ts END,
               cursor_segment_index=CASE WHEN riviamigo.charge_session_repair_cursor.cursor_ts IS NULL OR
                                              (riviamigo.charge_session_repair_cursor.cursor_ts,riviamigo.charge_session_repair_cursor.cursor_segment_index)
                                              <(EXCLUDED.cursor_ts,EXCLUDED.cursor_segment_index)
                                         THEN EXCLUDED.cursor_segment_index ELSE riviamigo.charge_session_repair_cursor.cursor_segment_index END,
               updated_at=now()"#,
        )
        .bind(vehicle_id)
        .bind(last_source_at)
        .bind(last_segment_index)
        .execute(&mut *tx)
        .await?;
    }
    if stats.ambiguous > 0 {
        sqlx::query(
            "UPDATE riviamigo.parallax_collector_state SET ambiguity_count=ambiguity_count+$2,updated_at=now() WHERE vehicle_id=$1",
        )
        .bind(vehicle_id)
        .bind(stats.ambiguous as i64)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(stats)
}

pub async fn rollback_repair(pool: &PgPool, journal_id: i64) -> Result<()> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query_as::<_, (serde_json::Value, serde_json::Value, serde_json::Value, Option<chrono::DateTime<chrono::Utc>>)>(
        "SELECT before_images,after_images,reference_mappings,reverted_at FROM riviamigo.charge_session_repair_journal WHERE id=$1 FOR UPDATE",
    ).bind(journal_id).fetch_optional(&mut *tx).await?
     .ok_or_else(|| anyhow::anyhow!("repair journal entry not found"))?;
    if row.3.is_some() {
        anyhow::bail!("repair has already been rolled back");
    }
    let survivor = parse_mapping_uuid(&row.2, "survivor_id")?;
    let duplicate = parse_mapping_uuid(&row.2, "duplicate_id")?;

    let unchanged: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM riviamigo.charge_sessions s WHERE s.id=$1
                 AND to_jsonb(s)=$2->'survivor')
            AND NOT EXISTS(SELECT 1 FROM riviamigo.charge_sessions WHERE id=$3)
            AND COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.user_id) FROM riviamigo.charge_session_user_annotations a WHERE a.charge_session_id=$1),'[]'::jsonb)=COALESCE($2->'annotations','[]'::jsonb)
            AND COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.external_id) FROM riviamigo.charge_session_external_aliases a WHERE a.charge_session_id=$1),'[]'::jsonb)=COALESCE($2->'aliases','[]'::jsonb)
            AND (SELECT count(*) FROM timeseries.telemetry t
                 WHERE t.vehicle_id=(SELECT vehicle_id FROM riviamigo.charge_sessions WHERE id=$1)
                   AND t.ts IN (SELECT value::timestamptz FROM jsonb_array_elements_text($4->'telemetry_ts'))
                   AND t.charge_session_id=$1)=jsonb_array_length(COALESCE($4->'telemetry_ts','[]'::jsonb))
            AND (SELECT count(*) FROM riviamigo.rivian_charge_curve_points p
                 WHERE p.ts IN (SELECT value::timestamptz FROM jsonb_array_elements_text($4->'rivian_curve_ts'))
                   AND p.charge_session_id=$1)=jsonb_array_length(COALESCE($4->'rivian_curve_ts','[]'::jsonb))
            AND (SELECT count(*) FROM riviamigo.rivian_charge_payloads p
                 WHERE p.id IN (SELECT value::uuid FROM jsonb_array_elements_text($4->'payload_ids'))
                   AND p.charge_session_id=$1)=jsonb_array_length(COALESCE($4->'payload_ids','[]'::jsonb))
            AND (SELECT count(*) FROM riviamigo.rivian_parallax_events p
                 WHERE p.id IN (SELECT value::uuid FROM jsonb_array_elements_text($4->'parallax_event_ids'))
                   AND p.charge_session_id=$1)=jsonb_array_length(COALESCE($4->'parallax_event_ids','[]'::jsonb))
            AND (SELECT count(*) FROM timeseries.parallax_charge_curve_points p
                 JOIN jsonb_to_recordset($4->'parallax_curve_keys') AS k(source_at timestamptz,segment_index integer)
                   ON p.source_at=k.source_at AND p.segment_index=k.segment_index
                 WHERE p.charge_session_id=$1)=jsonb_array_length(COALESCE($4->'parallax_curve_keys','[]'::jsonb))"#,
    )
    .bind(survivor)
    .bind(&row.1)
    .bind(duplicate)
    .bind(&row.2)
    .fetch_one(&mut *tx)
    .await?;
    if !unchanged {
        anyhow::bail!(
            "affected session, annotations, or aliases changed after repair; rollback refused"
        );
    }

    sqlx::query("INSERT INTO riviamigo.charge_sessions SELECT (jsonb_populate_record(NULL::riviamigo.charge_sessions,$1->'duplicate')).*")
        .bind(&row.0).execute(&mut *tx).await?;
    sqlx::query(
        r#"WITH original AS (SELECT (jsonb_populate_record(NULL::riviamigo.charge_sessions,$2->'survivor')).*)
           UPDATE riviamigo.charge_sessions s SET
             started_at=o.started_at,ended_at=o.ended_at,soc_start=o.soc_start,soc_end=o.soc_end,
             charge_limit=o.charge_limit,kwh_added=o.kwh_added,energy_added_wh=o.energy_added_wh,
             energy_used_wh=o.energy_used_wh,max_charge_rate_kw=o.max_charge_rate_kw,
             avg_charge_rate_kw=o.avg_charge_rate_kw,live_total_charged_kwh=o.live_total_charged_kwh,
             live_range_added_km=o.live_range_added_km,live_power_kw=o.live_power_kw,
             live_charge_rate_kph=o.live_charge_rate_kph,live_time_elapsed_seconds=o.live_time_elapsed_seconds,
             live_session_started_at=o.live_session_started_at,api_started_at=o.api_started_at,
             api_ended_at=o.api_ended_at,pack_energy_kwh=o.pack_energy_kwh,
             thermal_energy_kwh=o.thermal_energy_kwh,
             parallax_live_power_kw=o.parallax_live_power_kw,
             parallax_total_charged_kwh=o.parallax_total_charged_kwh,
             parallax_pack_energy_kwh=o.parallax_pack_energy_kwh,
             parallax_thermal_energy_kwh=o.parallax_thermal_energy_kwh,
             parallax_time_remaining_minutes=o.parallax_time_remaining_minutes,
             parallax_power_observed_at=o.parallax_power_observed_at,
             parallax_energy_observed_at=o.parallax_energy_observed_at,
             parallax_total_energy_observed_at=o.parallax_total_energy_observed_at,
             parallax_pack_energy_observed_at=o.parallax_pack_energy_observed_at,
             parallax_thermal_energy_observed_at=o.parallax_thermal_energy_observed_at,
             parallax_time_observed_at=o.parallax_time_observed_at,
             parallax_status_observed_at=o.parallax_status_observed_at,
             parallax_charger_status=o.parallax_charger_status,duration_minutes=o.duration_minutes,
             source=o.source,data_confidence=o.data_confidence,rivian_session_id=o.rivian_session_id
           FROM original o WHERE s.id=$1"#,
    ).bind(survivor).bind(&row.0).execute(&mut *tx).await?;

    sqlx::query("UPDATE timeseries.telemetry SET charge_session_id=$1 WHERE vehicle_id=(SELECT vehicle_id FROM riviamigo.charge_sessions WHERE id=$1) AND ts IN (SELECT value::timestamptz FROM jsonb_array_elements_text($2->'telemetry_ts'))")
        .bind(duplicate).bind(&row.2).execute(&mut *tx).await?;
    sqlx::query("UPDATE riviamigo.rivian_charge_curve_points SET charge_session_id=$1 WHERE ts IN (SELECT value::timestamptz FROM jsonb_array_elements_text($2->'rivian_curve_ts')) AND charge_session_id=$3")
        .bind(duplicate).bind(&row.2).bind(survivor).execute(&mut *tx).await?;
    sqlx::query("UPDATE riviamigo.rivian_charge_payloads SET charge_session_id=$1 WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text($2->'payload_ids')) AND charge_session_id=$3")
        .bind(duplicate).bind(&row.2).bind(survivor).execute(&mut *tx).await?;
    sqlx::query("UPDATE riviamigo.rivian_parallax_events SET charge_session_id=$1 WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text($2->'parallax_event_ids')) AND charge_session_id=$3")
        .bind(duplicate).bind(&row.2).bind(survivor).execute(&mut *tx).await?;
    sqlx::query(
        r#"UPDATE timeseries.parallax_charge_curve_points p SET charge_session_id=$1
           FROM jsonb_to_recordset($2->'parallax_curve_keys') AS k(source_at timestamptz,segment_index integer)
           WHERE p.source_at=k.source_at AND p.segment_index=k.segment_index AND p.charge_session_id=$3"#,
    ).bind(duplicate).bind(&row.2).bind(survivor).execute(&mut *tx).await?;

    sqlx::query(
        "DELETE FROM riviamigo.charge_session_user_annotations WHERE charge_session_id IN ($1,$2)",
    )
    .bind(survivor)
    .bind(duplicate)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO riviamigo.charge_session_user_annotations SELECT (jsonb_populate_recordset(NULL::riviamigo.charge_session_user_annotations,$1->'annotations')).*")
        .bind(&row.0).execute(&mut *tx).await?;
    sqlx::query(
        "DELETE FROM riviamigo.charge_session_external_aliases WHERE charge_session_id IN ($1,$2)",
    )
    .bind(survivor)
    .bind(duplicate)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO riviamigo.charge_session_external_aliases SELECT (jsonb_populate_recordset(NULL::riviamigo.charge_session_external_aliases,$1->'aliases')).*")
        .bind(&row.0).execute(&mut *tx).await?;
    sqlx::query("UPDATE riviamigo.charge_session_repair_journal SET reverted_at=now() WHERE id=$1")
        .bind(journal_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

fn parse_mapping_uuid(value: &serde_json::Value, key: &str) -> Result<Uuid> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("repair mapping is missing {key}"))?
        .parse()
        .map_err(Into::into)
}

pub async fn heal_active_tail(pool: &PgPool, vehicle_id: Uuid) -> Result<RepairStats> {
    let mut tx = pool.begin().await?;
    let candidates = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        WITH ordered AS (
            SELECT charge_session_id AS right_id,
                   lag(charge_session_id) OVER (ORDER BY ts) AS left_id,
                   ts AS right_ts, lag(ts) OVER (ORDER BY ts) AS left_ts
            FROM timeseries.telemetry
            WHERE vehicle_id = $1 AND charge_session_id IS NOT NULL
        ), eligible AS (
            SELECT DISTINCT o.left_id, o.right_id
            FROM ordered o
            JOIN riviamigo.charge_sessions ls ON ls.id = o.left_id
                AND ls.vehicle_id = $1 AND ls.ended_at IS NULL
            JOIN riviamigo.charge_sessions rs ON rs.id = o.right_id
                AND rs.vehicle_id = $1
            WHERE o.left_id IS NOT NULL AND o.left_id <> o.right_id
              AND o.left_ts IS NOT NULL
              AND o.right_ts - o.left_ts <= interval '15 minutes'
              AND rs.started_at >= ls.started_at
              AND EXISTS (
                  SELECT 1 FROM timeseries.telemetry t
                  WHERE t.vehicle_id = $1 AND t.charge_session_id = o.left_id
                    AND (t.power_kw > 0.1 OR lower(coalesce(t.charger_state, '')) = 'charging'
                         OR t.charger_status = 'chrgr_sts_connected_charging'))
              AND EXISTS (
                  SELECT 1 FROM timeseries.telemetry t
                  WHERE t.vehicle_id = $1 AND t.charge_session_id = o.right_id
                    AND (t.power_kw > 0.1 OR lower(coalesce(t.charger_state, '')) = 'charging'
                         OR t.charger_status = 'chrgr_sts_connected_charging'))
              AND NOT EXISTS (
                  SELECT 1 FROM timeseries.telemetry t
                  WHERE t.vehicle_id = $1 AND t.ts >= o.left_ts AND t.ts <= o.right_ts
                    AND (lower(coalesce(t.charger_state, '')) IN ('done', 'disconnected')
                         OR t.charger_status = 'chrgr_sts_not_connected'
                         OR (t.charger_status = 'chrgr_sts_connected_no_chrg'
                             AND t.time_to_end_of_charge_min IS NULL)
                         OR lower(coalesce(t.gear_status, '')) IN ('drive', 'reverse')))
              AND NOT (ls.rivian_session_id IS NOT NULL AND rs.rivian_session_id IS NOT NULL
                       AND ls.rivian_session_id <> rs.rivian_session_id)
              AND NOT (
                  EXISTS (SELECT 1 FROM riviamigo.charge_session_external_aliases WHERE charge_session_id=o.left_id)
                  AND EXISTS (SELECT 1 FROM riviamigo.charge_session_external_aliases WHERE charge_session_id=o.right_id)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM riviamigo.charge_session_external_aliases la
                      JOIN riviamigo.charge_session_external_aliases ra
                        ON ra.charge_session_id=o.right_id
                       AND (ra.external_id=la.external_id
                            OR (la.transaction_id_grouping_key IS NOT NULL
                                AND ra.transaction_id_grouping_key=la.transaction_id_grouping_key))
                      WHERE la.charge_session_id=o.left_id))
        ), unambiguous AS (
            SELECT left_id, right_id,
                   count(*) OVER (PARTITION BY left_id) AS rights,
                   count(*) OVER (PARTITION BY right_id) AS lefts
            FROM eligible)
        SELECT left_id, right_id FROM unambiguous
        WHERE rights = 1 AND lefts = 1 ORDER BY left_id, right_id
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(&mut *tx)
    .await?;

    let mut stats = RepairStats::default();
    for (survivor, duplicate) in candidates {
        let repair_key = format!("active-tail-merge:{survivor}:{duplicate}");
        let journaled = sqlx::query_scalar::<_, bool>(
            r#"
            INSERT INTO riviamigo.charge_session_repair_journal
                (vehicle_id, repair_key, reason, revision, before_images, reference_mappings)
            SELECT $1, $2, 'telemetry_proven_restart_split', 'startup-v2',
                   jsonb_build_object(
                       'survivor', to_jsonb(s), 'duplicate', to_jsonb(d),
                       'annotations', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.charge_session_id,a.user_id) FROM riviamigo.charge_session_user_annotations a WHERE a.charge_session_id IN (s.id,d.id)),'[]'::jsonb),
                       'aliases', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.charge_session_id,a.external_id) FROM riviamigo.charge_session_external_aliases a WHERE a.charge_session_id IN (s.id,d.id)),'[]'::jsonb)),
                   jsonb_build_object(
                       'survivor_id', s.id, 'duplicate_id', d.id,
                       'telemetry_ts', COALESCE((SELECT jsonb_agg(ts ORDER BY ts) FROM timeseries.telemetry WHERE charge_session_id=d.id),'[]'::jsonb),
                       'rivian_curve_ts', COALESCE((SELECT jsonb_agg(ts ORDER BY ts) FROM riviamigo.rivian_charge_curve_points WHERE charge_session_id=d.id),'[]'::jsonb),
                       'payload_ids', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM riviamigo.rivian_charge_payloads WHERE charge_session_id=d.id),'[]'::jsonb),
                       'parallax_event_ids', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM riviamigo.rivian_parallax_events WHERE charge_session_id=d.id),'[]'::jsonb),
                       'parallax_curve_keys', COALESCE((SELECT jsonb_agg(jsonb_build_object('source_at',source_at,'segment_index',segment_index) ORDER BY source_at,segment_index) FROM timeseries.parallax_charge_curve_points WHERE charge_session_id=d.id),'[]'::jsonb))
            FROM riviamigo.charge_sessions s
            JOIN riviamigo.charge_sessions d ON d.id = $4
            WHERE s.id = $3 AND s.vehicle_id = $1 AND d.vehicle_id = $1
            ON CONFLICT (vehicle_id, repair_key) DO NOTHING
            RETURNING true
            "#,
        )
        .bind(vehicle_id).bind(&repair_key).bind(survivor).bind(duplicate)
        .fetch_optional(&mut *tx).await?.unwrap_or(false);
        if !journaled {
            continue;
        }

        for statement in [
            "UPDATE timeseries.telemetry SET charge_session_id=$1 WHERE vehicle_id=$2 AND charge_session_id=$3",
            "UPDATE riviamigo.rivian_charge_curve_points SET charge_session_id=$1 WHERE vehicle_id=$2 AND charge_session_id=$3",
            "UPDATE riviamigo.rivian_charge_payloads SET charge_session_id=$1 WHERE vehicle_id=$2 AND charge_session_id=$3",
            "UPDATE riviamigo.rivian_parallax_events SET charge_session_id=$1 WHERE vehicle_id=$2 AND charge_session_id=$3",
            "UPDATE timeseries.parallax_charge_curve_points SET charge_session_id=$1 WHERE vehicle_id=$2 AND charge_session_id=$3",
        ] {
            sqlx::query(statement).bind(survivor).bind(vehicle_id).bind(duplicate)
                .execute(&mut *tx).await?;
        }

        sqlx::query(
            r#"INSERT INTO riviamigo.charge_session_user_annotations (
                   charge_session_id,user_id,geofence_id,address_id,is_home,cost_profile_id,
                   cost_method,cost_usd,currency_code,computed_at)
               SELECT $1,user_id,geofence_id,address_id,is_home,cost_profile_id,
                      cost_method,cost_usd,currency_code,computed_at
               FROM riviamigo.charge_session_user_annotations WHERE charge_session_id=$2
               ON CONFLICT (charge_session_id,user_id) DO UPDATE SET
                   geofence_id=COALESCE(riviamigo.charge_session_user_annotations.geofence_id,EXCLUDED.geofence_id),
                   address_id=COALESCE(riviamigo.charge_session_user_annotations.address_id,EXCLUDED.address_id),
                   is_home=COALESCE(riviamigo.charge_session_user_annotations.is_home,EXCLUDED.is_home),
                   cost_profile_id=COALESCE(riviamigo.charge_session_user_annotations.cost_profile_id,EXCLUDED.cost_profile_id),
                   cost_method=COALESCE(riviamigo.charge_session_user_annotations.cost_method,EXCLUDED.cost_method),
                   cost_usd=COALESCE(riviamigo.charge_session_user_annotations.cost_usd,EXCLUDED.cost_usd),
                   currency_code=COALESCE(riviamigo.charge_session_user_annotations.currency_code,EXCLUDED.currency_code),
                   computed_at=COALESCE(riviamigo.charge_session_user_annotations.computed_at,EXCLUDED.computed_at),
                   updated_at=now()"#,
        ).bind(survivor).bind(duplicate).execute(&mut *tx).await?;

        sqlx::query(
            r#"INSERT INTO riviamigo.charge_session_external_aliases (
                   charge_session_id,external_id,alias_kind,transaction_id_grouping_key,
                   first_seen_at,last_seen_at,latest_payload_id,latest_payload_captured_at)
               SELECT $1,external_id,alias_kind,transaction_id_grouping_key,
                      first_seen_at,last_seen_at,latest_payload_id,latest_payload_captured_at
               FROM riviamigo.charge_session_external_aliases WHERE charge_session_id=$2
               ON CONFLICT (charge_session_id,external_id) DO UPDATE SET
                   transaction_id_grouping_key=COALESCE(EXCLUDED.transaction_id_grouping_key,riviamigo.charge_session_external_aliases.transaction_id_grouping_key),
                   first_seen_at=LEAST(riviamigo.charge_session_external_aliases.first_seen_at,EXCLUDED.first_seen_at),
                   last_seen_at=GREATEST(riviamigo.charge_session_external_aliases.last_seen_at,EXCLUDED.last_seen_at),
                   latest_payload_id=COALESCE(EXCLUDED.latest_payload_id,riviamigo.charge_session_external_aliases.latest_payload_id),
                   latest_payload_captured_at=COALESCE(EXCLUDED.latest_payload_captured_at,riviamigo.charge_session_external_aliases.latest_payload_captured_at),
                   updated_at=now()"#,
        ).bind(survivor).bind(duplicate).execute(&mut *tx).await?;

        sqlx::query(
            "DELETE FROM riviamigo.charge_session_user_annotations WHERE charge_session_id=$1",
        )
        .bind(duplicate)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "DELETE FROM riviamigo.charge_session_external_aliases WHERE charge_session_id=$1",
        )
        .bind(duplicate)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"UPDATE riviamigo.charge_sessions s SET
                   started_at=LEAST(s.started_at,d.started_at), ended_at=d.ended_at,
                   soc_start=COALESCE(s.soc_start,d.soc_start), soc_end=COALESCE(d.soc_end,s.soc_end),
                   charge_limit=COALESCE(d.charge_limit,s.charge_limit),
                   kwh_added=GREATEST(COALESCE(s.kwh_added,0),COALESCE(d.kwh_added,0)),
                   energy_added_wh=GREATEST(COALESCE(s.energy_added_wh,0),COALESCE(d.energy_added_wh,0)),
                   energy_used_wh=GREATEST(COALESCE(s.energy_used_wh,0),COALESCE(d.energy_used_wh,0)),
                   max_charge_rate_kw=GREATEST(COALESCE(s.max_charge_rate_kw,0),COALESCE(d.max_charge_rate_kw,0)),
                   avg_charge_rate_kw=COALESCE(d.avg_charge_rate_kw,s.avg_charge_rate_kw),
                   live_total_charged_kwh=COALESCE(d.live_total_charged_kwh,s.live_total_charged_kwh),
                   live_range_added_km=COALESCE(d.live_range_added_km,s.live_range_added_km),
                   live_power_kw=COALESCE(d.live_power_kw,s.live_power_kw),
                   live_charge_rate_kph=COALESCE(d.live_charge_rate_kph,s.live_charge_rate_kph),
                   live_time_elapsed_seconds=COALESCE(d.live_time_elapsed_seconds,s.live_time_elapsed_seconds),
                   live_session_started_at=COALESCE(s.live_session_started_at,d.live_session_started_at),
                   api_started_at=COALESCE(LEAST(s.api_started_at,d.api_started_at),s.api_started_at,d.api_started_at),
                   api_ended_at=COALESCE(d.api_ended_at,s.api_ended_at),
                   pack_energy_kwh=COALESCE(d.pack_energy_kwh,s.pack_energy_kwh),
                   thermal_energy_kwh=COALESCE(d.thermal_energy_kwh,s.thermal_energy_kwh),
                   parallax_live_power_kw=COALESCE(d.parallax_live_power_kw,s.parallax_live_power_kw),
                   parallax_total_charged_kwh=COALESCE(d.parallax_total_charged_kwh,s.parallax_total_charged_kwh),
                   parallax_pack_energy_kwh=COALESCE(d.parallax_pack_energy_kwh,s.parallax_pack_energy_kwh),
                   parallax_thermal_energy_kwh=COALESCE(d.parallax_thermal_energy_kwh,s.parallax_thermal_energy_kwh),
                   parallax_time_remaining_minutes=COALESCE(d.parallax_time_remaining_minutes,s.parallax_time_remaining_minutes),
                   parallax_power_observed_at=GREATEST(s.parallax_power_observed_at,d.parallax_power_observed_at),
                   parallax_energy_observed_at=GREATEST(s.parallax_energy_observed_at,d.parallax_energy_observed_at),
                   parallax_total_energy_observed_at=GREATEST(s.parallax_total_energy_observed_at,d.parallax_total_energy_observed_at),
                   parallax_pack_energy_observed_at=GREATEST(s.parallax_pack_energy_observed_at,d.parallax_pack_energy_observed_at),
                   parallax_thermal_energy_observed_at=GREATEST(s.parallax_thermal_energy_observed_at,d.parallax_thermal_energy_observed_at),
                   parallax_time_observed_at=GREATEST(s.parallax_time_observed_at,d.parallax_time_observed_at),
                   parallax_status_observed_at=GREATEST(s.parallax_status_observed_at,d.parallax_status_observed_at),
                   parallax_charger_status=COALESCE(d.parallax_charger_status,s.parallax_charger_status),
                   duration_minutes=CASE WHEN d.ended_at IS NOT NULL THEN
                       (EXTRACT(EPOCH FROM (d.ended_at-LEAST(s.started_at,d.started_at)))/60)::integer ELSE NULL END,
                   source=CASE WHEN s.source='rivian_api' THEN d.source ELSE s.source END,
                   data_confidence=COALESCE(d.data_confidence,s.data_confidence),
                   rivian_session_id=COALESCE(s.rivian_session_id,d.rivian_session_id)
               FROM riviamigo.charge_sessions d WHERE s.id=$1 AND d.id=$2"#,
        ).bind(survivor).bind(duplicate).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM riviamigo.charge_sessions WHERE id=$1")
            .bind(duplicate)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"UPDATE riviamigo.charge_session_repair_journal j SET after_images=jsonb_build_object(
                   'survivor',(SELECT to_jsonb(s) FROM riviamigo.charge_sessions s WHERE s.id=$2),
                   'annotations',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.user_id) FROM riviamigo.charge_session_user_annotations a WHERE a.charge_session_id=$2),'[]'::jsonb),
                   'aliases',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.external_id) FROM riviamigo.charge_session_external_aliases a WHERE a.charge_session_id=$2),'[]'::jsonb))
               WHERE j.vehicle_id=$1 AND j.repair_key=$3"#,
        ).bind(vehicle_id).bind(survivor).bind(&repair_key).execute(&mut *tx).await?;
        stats.merged += 1;
    }

    let closed = sqlx::query_as::<_, (Uuid, chrono::DateTime<chrono::Utc>)>(
        r#"SELECT s.id, stop.ts
           FROM riviamigo.charge_sessions s
           CROSS JOIN LATERAL (
               SELECT t.ts FROM timeseries.telemetry t
               WHERE t.vehicle_id=s.vehicle_id
                 AND t.ts>COALESCE((SELECT max(linked.ts) FROM timeseries.telemetry linked WHERE linked.charge_session_id=s.id),s.started_at)
                 AND (lower(coalesce(t.charger_state,'')) IN ('done','disconnected')
                      OR t.charger_status='chrgr_sts_not_connected')
               ORDER BY t.ts LIMIT 1) stop
           WHERE s.vehicle_id=$1 AND s.ended_at IS NULL"#,
    ).bind(vehicle_id).fetch_all(&mut *tx).await?;
    for (session_id, ended_at) in closed {
        let repair_key = format!("definitive-tail-close:{session_id}:{ended_at}");
        let applied = sqlx::query_scalar::<_, bool>(
            r#"INSERT INTO riviamigo.charge_session_repair_journal
                   (vehicle_id,repair_key,reason,revision,before_images,reference_mappings)
               SELECT $1,$2,'first_definitive_terminal_event','startup-v2',
                      jsonb_build_object('survivor',to_jsonb(s)),
                      jsonb_build_object('session_id',s.id,'ended_at',$4::timestamptz)
               FROM riviamigo.charge_sessions s WHERE s.id=$3 AND s.vehicle_id=$1
               ON CONFLICT (vehicle_id,repair_key) DO NOTHING RETURNING true"#,
        )
        .bind(vehicle_id)
        .bind(&repair_key)
        .bind(session_id)
        .bind(ended_at)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(false);
        if applied {
            sqlx::query("UPDATE riviamigo.charge_sessions SET ended_at=$2,duration_minutes=(EXTRACT(EPOCH FROM ($2-started_at))/60)::integer WHERE id=$1 AND ended_at IS NULL")
                .bind(session_id).bind(ended_at).execute(&mut *tx).await?;
            stats.closed += 1;
        }
    }

    tx.commit().await?;
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Utc};
    use sqlx::{postgres::PgPoolOptions, Executor};

    #[tokio::test]
    #[ignore = "requires a disposable TimescaleDB DATABASE_URL with CREATEDB permission"]
    async fn restart_split_merge_is_complete_and_idempotent() {
        let base = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let admin_url = replace_database_name(&base, "postgres");
        let name = format!("riviamigo_repair_test_{}", Uuid::new_v4().simple());
        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect(&admin_url)
            .await
            .unwrap();
        admin
            .execute(sqlx::AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
            .await
            .unwrap();
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect(&replace_database_name(&base, &name))
            .await
            .unwrap();
        crate::db::migrations::run_current_migrations(&pool)
            .await
            .unwrap();

        let user: Uuid = sqlx::query_scalar(
            "INSERT INTO riviamigo.users(email,password_hash) VALUES($1,'test') RETURNING id",
        )
        .bind(format!("repair-{}@example.test", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .unwrap();
        let vehicle: Uuid = sqlx::query_scalar(
            "INSERT INTO riviamigo.vehicles(user_id,rivian_vehicle_id,model,name) VALUES($1,$2,'R1T','Repair') RETURNING id",
        ).bind(user).bind(format!("repair-{}", Uuid::new_v4())).fetch_one(&pool).await.unwrap();
        let survivor = Uuid::new_v4();
        let duplicate = Uuid::new_v4();
        sqlx::query("INSERT INTO riviamigo.charge_sessions(id,vehicle_id,started_at,source,soc_start) VALUES($1,$2,'2026-08-28T10:00:00Z','telemetry',20),($3,$2,'2026-08-28T10:10:00Z','telemetry',21)")
            .bind(survivor).bind(vehicle).bind(duplicate).execute(&pool).await.unwrap();
        sqlx::query("UPDATE riviamigo.charge_sessions SET ended_at='2026-08-28T11:00:00Z',soc_end=60 WHERE id=$1")
            .bind(duplicate).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO timeseries.telemetry(ts,vehicle_id,charger_state,charger_status,power_kw,charge_session_id) VALUES('2026-08-28T10:09:00Z',$1,'charging','chrgr_sts_connected_charging',11,$2),('2026-08-28T10:10:00Z',$1,'charging','chrgr_sts_connected_charging',11,$3)")
            .bind(vehicle).bind(survivor).bind(duplicate).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO riviamigo.rivian_charge_curve_points(vehicle_id,charge_session_id,ts,power_kw) VALUES($1,$2,'2026-08-28T10:10:00Z',11)")
            .bind(vehicle).bind(duplicate).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO riviamigo.rivian_charge_payloads(vehicle_id,charge_session_id,operation,payload) VALUES($1,$2,'test','{}')")
            .bind(vehicle).bind(duplicate).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO riviamigo.charge_session_external_aliases(charge_session_id,external_id,alias_kind) VALUES($1,'external-repair','test')")
            .bind(duplicate).execute(&pool).await.unwrap();

        assert_eq!(heal_active_tail(&pool, vehicle).await.unwrap().merged, 1);
        let survivor_row: (Option<chrono::DateTime<chrono::Utc>>, Option<f64>) =
            sqlx::query_as("SELECT ended_at,soc_end FROM riviamigo.charge_sessions WHERE id=$1")
                .bind(survivor)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(survivor_row.0.is_some());
        assert_eq!(survivor_row.1, Some(60.0));
        assert!(!sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM riviamigo.charge_sessions WHERE id=$1)"
        )
        .bind(duplicate)
        .fetch_one(&pool)
        .await
        .unwrap());
        for (table, count) in [
            ("timeseries.telemetry", sqlx::query_scalar::<_, i64>("SELECT count(*) FROM timeseries.telemetry WHERE charge_session_id=$1").bind(survivor).fetch_one(&pool).await.unwrap()),
            ("riviamigo.rivian_charge_curve_points", sqlx::query_scalar::<_, i64>("SELECT count(*) FROM riviamigo.rivian_charge_curve_points WHERE charge_session_id=$1").bind(survivor).fetch_one(&pool).await.unwrap()),
            ("riviamigo.rivian_charge_payloads", sqlx::query_scalar::<_, i64>("SELECT count(*) FROM riviamigo.rivian_charge_payloads WHERE charge_session_id=$1").bind(survivor).fetch_one(&pool).await.unwrap()),
        ] {
            assert!(count > 0, "{table} was not restamped");
        }
        let journal_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM riviamigo.charge_session_repair_journal WHERE vehicle_id=$1",
        )
        .bind(vehicle)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(journal_count, 1);
        assert_eq!(
            heal_active_tail(&pool, vehicle).await.unwrap(),
            RepairStats::default()
        );
        let journal_id: i64 = sqlx::query_scalar(
            "SELECT id FROM riviamigo.charge_session_repair_journal WHERE vehicle_id=$1",
        )
        .bind(vehicle)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE riviamigo.rivian_charge_payloads SET charge_session_id=NULL WHERE charge_session_id=$1")
            .bind(survivor).execute(&pool).await.unwrap();
        assert!(rollback_repair(&pool, journal_id).await.is_err());
        sqlx::query("UPDATE riviamigo.rivian_charge_payloads SET charge_session_id=$1 WHERE charge_session_id IS NULL AND vehicle_id=$2")
            .bind(survivor).bind(vehicle).execute(&pool).await.unwrap();
        rollback_repair(&pool, journal_id).await.unwrap();
        assert!(sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM riviamigo.charge_sessions WHERE id=$1)"
        )
        .bind(duplicate)
        .fetch_one(&pool)
        .await
        .unwrap());
        let restored_payloads: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM riviamigo.rivian_charge_payloads WHERE charge_session_id=$1",
        )
        .bind(duplicate)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(restored_payloads, 1);
        assert!(sqlx::query_scalar::<_, bool>("SELECT reverted_at IS NOT NULL FROM riviamigo.charge_session_repair_journal WHERE id=$1")
            .bind(journal_id).fetch_one(&pool).await.unwrap());

        let terminal_left = Uuid::new_v4();
        let terminal_right = Uuid::new_v4();
        sqlx::query("INSERT INTO riviamigo.charge_sessions(id,vehicle_id,started_at,source) VALUES($1,$2,'2026-08-28T12:00:00Z','telemetry'),($3,$2,'2026-08-28T12:05:00Z','telemetry')")
            .bind(terminal_left).bind(vehicle).bind(terminal_right).execute(&pool).await.unwrap();
        sqlx::query(
            "UPDATE riviamigo.charge_sessions SET ended_at='2026-08-28T12:30:00Z' WHERE id=$1",
        )
        .bind(terminal_right)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO timeseries.telemetry(ts,vehicle_id,charger_state,charger_status,power_kw,charge_session_id,time_to_end_of_charge_min) VALUES('2026-08-28T12:04:00Z',$1,'charging','chrgr_sts_connected_no_chrg',11,$2,NULL),('2026-08-28T12:05:00Z',$1,'charging','chrgr_sts_connected_charging',11,$3,20)")
            .bind(vehicle).bind(terminal_left).bind(terminal_right).execute(&pool).await.unwrap();
        assert_eq!(heal_active_tail(&pool, vehicle).await.unwrap().merged, 0);

        let overlap_a = Uuid::new_v4();
        let overlap_b = Uuid::new_v4();
        let unique = Uuid::new_v4();
        sqlx::query("INSERT INTO riviamigo.charge_sessions(id,vehicle_id,started_at,ended_at,source) VALUES($1,$4,'2026-08-28T13:00:00Z','2026-08-28T14:00:00Z','telemetry'),($2,$4,'2026-08-28T13:30:00Z','2026-08-28T14:30:00Z','telemetry'),($3,$4,'2026-08-28T15:00:00Z','2026-08-28T16:00:00Z','telemetry')")
            .bind(overlap_a).bind(overlap_b).bind(unique).bind(vehicle).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO timeseries.parallax_charge_curve_points(vehicle_id,source_at,segment_index,power_kw) VALUES($1,'2026-08-28T13:45:00Z',0,11),($1,'2026-08-28T15:15:00Z',0,11)")
            .bind(vehicle).execute(&pool).await.unwrap();
        let reconciliation = reconcile_unassociated_parallax_samples(&pool, vehicle, 10)
            .await
            .unwrap();
        assert_eq!(reconciliation.scanned, 2);
        assert_eq!(reconciliation.attached, 1);
        assert_eq!(reconciliation.ambiguous, 1);
        assert_eq!(sqlx::query_scalar::<_, Option<Uuid>>("SELECT charge_session_id FROM timeseries.parallax_charge_curve_points WHERE vehicle_id=$1 AND source_at='2026-08-28T15:15:00Z'")
            .bind(vehicle).fetch_one(&pool).await.unwrap(), Some(unique));

        sqlx::query("INSERT INTO timeseries.parallax_charge_curve_points(vehicle_id,source_at,segment_index,power_kw) VALUES($1,'2026-08-28T15:20:00Z',0,10),($1,'2026-08-28T15:20:00Z',1,9)")
            .bind(vehicle).execute(&pool).await.unwrap();
        assert_eq!(
            reconcile_unassociated_parallax_samples(&pool, vehicle, 1)
                .await
                .unwrap()
                .attached,
            1
        );
        assert_eq!(
            reconcile_unassociated_parallax_samples(&pool, vehicle, 1)
                .await
                .unwrap()
                .attached,
            1
        );
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM timeseries.parallax_charge_curve_points WHERE vehicle_id=$1 AND source_at='2026-08-28T15:20:00Z' AND charge_session_id=$2")
            .bind(vehicle).bind(unique).fetch_one(&pool).await.unwrap(), 2);

        sqlx::query("INSERT INTO timeseries.parallax_charge_curve_points(vehicle_id,source_at,segment_index,power_kw) VALUES($1,'2026-08-28T17:15:00Z',0,8)")
            .bind(vehicle).execute(&pool).await.unwrap();
        assert_eq!(
            reconcile_unassociated_parallax_samples(&pool, vehicle, 10)
                .await
                .unwrap()
                .attached,
            0
        );
        let later_session = Uuid::new_v4();
        sqlx::query("INSERT INTO riviamigo.charge_sessions(id,vehicle_id,started_at,ended_at,source) VALUES($1,$2,'2026-08-28T17:00:00Z','2026-08-28T18:00:00Z','telemetry')")
            .bind(later_session).bind(vehicle).execute(&pool).await.unwrap();
        sqlx::query("UPDATE timeseries.parallax_charge_curve_points SET reconciliation_checked_at=now()-interval '2 hours' WHERE vehicle_id=$1 AND source_at='2026-08-28T17:15:00Z'")
            .bind(vehicle).execute(&pool).await.unwrap();
        assert_eq!(
            reconcile_unassociated_parallax_samples(&pool, vehicle, 10)
                .await
                .unwrap()
                .attached,
            1
        );

        let newer_observed_at: DateTime<Utc> =
            "2026-08-28T19:00:00Z".parse().expect("newer timestamp");
        let older_observed_at: DateTime<Utc> =
            "2026-08-28T18:59:00Z".parse().expect("older timestamp");
        assert_eq!(
            crate::parallax::update_parallax_power(
                &pool,
                vehicle,
                survivor,
                42.0,
                newer_observed_at,
            )
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            crate::parallax::update_parallax_power(
                &pool,
                vehicle,
                survivor,
                9.0,
                older_observed_at,
            )
            .await
            .unwrap(),
            0
        );
        let retained_power: (Option<f64>, Option<DateTime<Utc>>) = sqlx::query_as(
            "SELECT parallax_live_power_kw,parallax_power_observed_at FROM riviamigo.charge_sessions WHERE id=$1",
        )
        .bind(survivor)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(retained_power, (Some(42.0), Some(newer_observed_at)));

        let owner_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO riviamigo.parallax_collector_state(vehicle_id,status,schema_version,owner_kind,owner_instance_id) VALUES($1,'connected',1,'in_process',$2)",
        )
        .bind(vehicle)
        .bind(owner_id)
        .execute(&pool)
        .await
        .unwrap();
        crate::parallax::release_in_process_lease(&pool, vehicle, Uuid::new_v4())
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, Option<Uuid>>(
                "SELECT owner_instance_id FROM riviamigo.parallax_collector_state WHERE vehicle_id=$1",
            )
            .bind(vehicle)
            .fetch_one(&pool)
            .await
            .unwrap(),
            Some(owner_id)
        );
        crate::parallax::release_in_process_lease(&pool, vehicle, owner_id)
            .await
            .unwrap();
        let released_lease: (String, Option<Uuid>) = sqlx::query_as(
            "SELECT status,owner_instance_id FROM riviamigo.parallax_collector_state WHERE vehicle_id=$1",
        )
        .bind(vehicle)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(released_lease, ("disconnected".to_string(), None));

        pool.close().await;
        admin
            .execute(sqlx::AssertSqlSafe(format!("DROP DATABASE \"{name}\"")))
            .await
            .unwrap();
        admin.close().await;
    }

    fn replace_database_name(url: &str, name: &str) -> String {
        let (prefix, _) = url.rsplit_once('/').expect("database name");
        format!("{prefix}/{name}")
    }
}
