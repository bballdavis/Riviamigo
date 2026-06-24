-- Migration 0051: canonical charge-session metadata and external alias evidence

ALTER TABLE riviamigo.charge_sessions
    ADD COLUMN IF NOT EXISTS api_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS api_ended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS data_confidence TEXT;

UPDATE riviamigo.charge_sessions
SET source = 'telemetry'
WHERE source IS NULL;

UPDATE riviamigo.charge_sessions
SET api_started_at = COALESCE(api_started_at, CASE WHEN source IN ('rivian_api', 'telemetry+rivian_api') THEN started_at END),
    api_ended_at = COALESCE(api_ended_at, CASE WHEN source IN ('rivian_api', 'telemetry+rivian_api') THEN ended_at END),
    data_confidence = COALESCE(
        data_confidence,
        CASE
            WHEN source = 'telemetry+rivian_api' THEN 'telemetry_enriched'
            WHEN source = 'rivian_api' THEN 'api_only'
            ELSE 'telemetry'
        END
    );

CREATE TABLE IF NOT EXISTS riviamigo.charge_session_external_aliases (
    charge_session_id            UUID        NOT NULL REFERENCES riviamigo.charge_sessions(id) ON DELETE CASCADE,
    external_id                  TEXT        NOT NULL,
    alias_kind                   TEXT        NOT NULL,
    transaction_id_grouping_key  TEXT,
    first_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    latest_payload_id            UUID,
    latest_payload_captured_at   TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (charge_session_id, external_id)
);

CREATE INDEX IF NOT EXISTS charge_session_external_aliases_external_idx
    ON riviamigo.charge_session_external_aliases (external_id);

CREATE INDEX IF NOT EXISTS charge_session_external_aliases_grouping_idx
    ON riviamigo.charge_session_external_aliases (transaction_id_grouping_key)
    WHERE transaction_id_grouping_key IS NOT NULL;

INSERT INTO riviamigo.charge_session_external_aliases (
    charge_session_id,
    external_id,
    alias_kind,
    transaction_id_grouping_key,
    first_seen_at,
    last_seen_at
)
SELECT
    cs.id,
    cs.rivian_session_id,
    CASE
        WHEN cs.rivian_session_id LIKE 'USCPI%' THEN 'network_session'
        ELSE 'legacy'
    END,
    NULLIF(BTRIM(COALESCE(cs.rivian_meta -> 'meta' ->> 'transactionIdGroupingKey', '')), ''),
    cs.created_at,
    now()
FROM riviamigo.charge_sessions cs
WHERE cs.rivian_session_id IS NOT NULL
ON CONFLICT (charge_session_id, external_id) DO UPDATE
SET transaction_id_grouping_key = COALESCE(
        EXCLUDED.transaction_id_grouping_key,
        riviamigo.charge_session_external_aliases.transaction_id_grouping_key
    ),
    last_seen_at = GREATEST(
        riviamigo.charge_session_external_aliases.last_seen_at,
        EXCLUDED.last_seen_at
    ),
    updated_at = now();
