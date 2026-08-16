-- Additive security control-plane state. Existing binaries ignore these
-- nullable/defaulted columns, preserving previous-image rollback compatibility.

ALTER TABLE riviamigo.security_events
    ADD COLUMN target text,
    ADD COLUMN request_id uuid,
    ADD COLUMN outcome text NOT NULL DEFAULT 'success',
    ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT security_events_outcome_check
        CHECK (outcome IN ('success', 'failure'));

CREATE INDEX security_events_created_at_idx
    ON riviamigo.security_events (created_at DESC);

ALTER TABLE riviamigo.api_keys
    ADD COLUMN rotated_from_id uuid REFERENCES riviamigo.api_keys(id) ON DELETE SET NULL;

-- New integrations are deliberately read-only. Keep the three legacy values
-- in the constraint so existing records remain loadable and visibly marked
-- for migration by the API compatibility facade.
ALTER TABLE riviamigo.api_keys
    DROP CONSTRAINT api_keys_access_level_check,
    ADD CONSTRAINT api_keys_access_level_check
        CHECK (access_level IN ('read', 'view', 'edit', 'admin'));

CREATE INDEX api_keys_rotated_from_id_idx
    ON riviamigo.api_keys (rotated_from_id)
    WHERE rotated_from_id IS NOT NULL;

CREATE INDEX security_events_target_created_at_idx
    ON riviamigo.security_events (target, created_at DESC)
    WHERE target IS NOT NULL;

ALTER TABLE riviamigo.external_connection_settings
    ADD COLUMN private_network_allowlist cidr[] NOT NULL DEFAULT '{}'::cidr[],
    ADD COLUMN private_network_policy_state text NOT NULL DEFAULT 'restricted',
    ADD CONSTRAINT external_connection_private_network_policy_state_check
        CHECK (private_network_policy_state IN ('restricted', 'configured', 'migration_required'));

UPDATE riviamigo.external_connection_settings
SET private_network_policy_state = 'migration_required'
WHERE allow_private_network = TRUE;
