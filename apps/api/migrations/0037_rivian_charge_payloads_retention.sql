-- Add a 90-day retention policy for raw Rivian charge event payloads.
-- If conversion is not possible (for example due legacy uniqueness constraints),
-- keep startup non-fatal and skip retention policy creation.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM timescaledb_information.hypertables
		WHERE hypertable_schema = 'riviamigo'
			AND hypertable_name = 'rivian_charge_payloads'
	) THEN
		PERFORM add_retention_policy(
			'riviamigo.rivian_charge_payloads',
			INTERVAL '90 days',
			if_not_exists => TRUE
		);
		RETURN;
	END IF;

	BEGIN
		PERFORM create_hypertable(
			'riviamigo.rivian_charge_payloads',
			'captured_at',
			if_not_exists => TRUE,
			migrate_data => TRUE
		);

		PERFORM add_retention_policy(
			'riviamigo.rivian_charge_payloads',
			INTERVAL '90 days',
			if_not_exists => TRUE
		);
	EXCEPTION
		WHEN OTHERS THEN
			RAISE NOTICE 'Skipping rivian_charge_payloads retention policy setup: %', SQLERRM;
	END;
END $$;
