-- Keep the one-minute telemetry aggregate fresh enough for dashboard history
-- while avoiding a background refresh every five minutes. The view remains a
-- real-time aggregate, so its unmaterialized tail is read from telemetry.
DO $$
DECLARE
  telemetry_job_id integer;
BEGIN
  SELECT job_id
    INTO telemetry_job_id
    FROM timescaledb_information.jobs
   WHERE proc_name = 'policy_refresh_continuous_aggregate'
     AND hypertable_schema = 'timeseries'
     AND hypertable_name = 'telemetry_1min';

  IF telemetry_job_id IS NULL THEN
    RAISE EXCEPTION
      'telemetry_1min continuous-aggregate refresh policy is missing';
  END IF;

  PERFORM alter_job(
    telemetry_job_id,
    schedule_interval => INTERVAL '1 hour'
  );
END
$$;

-- Fail migration startup instead of silently losing the real-time guarantee
-- or changing a different Timescale job.
DO $$
DECLARE
  configured_interval interval;
  is_materialized_only boolean;
BEGIN
  SELECT schedule_interval
    INTO configured_interval
    FROM timescaledb_information.jobs
   WHERE proc_name = 'policy_refresh_continuous_aggregate'
     AND hypertable_schema = 'timeseries'
     AND hypertable_name = 'telemetry_1min';

  SELECT materialized_only
    INTO is_materialized_only
    FROM timescaledb_information.continuous_aggregates
   WHERE view_schema = 'timeseries'
     AND view_name = 'telemetry_1min';

  IF configured_interval IS DISTINCT FROM INTERVAL '1 hour' THEN
    RAISE EXCEPTION
      'telemetry_1min refresh policy expected 1 hour, found %', configured_interval;
  END IF;

  IF is_materialized_only IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION
      'telemetry_1min must remain a real-time continuous aggregate';
  END IF;
END
$$;
