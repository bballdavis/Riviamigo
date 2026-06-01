-- Local/dev helper: create or refresh an admin-scoped demo vehicle with compact sample data.
-- Usage: psql "$DATABASE_URL" -v user_id='<uuid>' -v model='R1T' -f scripts/dev_seed_demo_r1t.sql

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_user_id uuid := NULLIF(:'user_id', '')::uuid;
  v_model text := upper(COALESCE(NULLIF(:'model', ''), 'R1T'));
  v_demo_key text;
  v_display_name text;
  v_vin text;
  v_battery_config text;
  v_battery_capacity_wh float8;
  v_range_mi float8;
  v_vehicle_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Pass -v user_id=<uuid>';
  END IF;
  IF v_model NOT IN ('R1T', 'R1S', 'R2S') THEN
    RAISE EXCEPTION 'model must be one of R1T, R1S, R2S';
  END IF;

  v_demo_key := format('demo-%s-local', lower(v_model));
  v_display_name := format('Demo %s', v_model);
  v_vin := format('DEMO-%s-LOCAL-0001', v_model);
  IF v_model = 'R2S' THEN
    v_battery_config := 'r2s';
    v_battery_capacity_wh := 82000;
    v_range_mi := 300;
  ELSE
    v_battery_config := 'r1_large_g1';
    v_battery_capacity_wh := 135000;
    v_range_mi := CASE WHEN v_model = 'R1S' THEN 260 ELSE 248 END;
  END IF;

  SELECT v.id INTO v_vehicle_id
  FROM riviamigo.vehicles v
  JOIN riviamigo.vehicle_memberships vm ON vm.vehicle_id = v.id
  WHERE vm.user_id = v_user_id
    AND v.rivian_vehicle_id = v_demo_key
  LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    INSERT INTO riviamigo.vehicles (user_id, rivian_vehicle_id, model, trim, vin, color, battery_config, battery_capacity_wh, name)
    VALUES (v_user_id, v_demo_key, v_model, 'Adventure', v_vin, 'Limestone', v_battery_config, v_battery_capacity_wh, v_display_name)
    RETURNING id INTO v_vehicle_id;
  END IF;

  INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
  VALUES (v_vehicle_id, v_user_id, 'owner', FALSE)
  ON CONFLICT (vehicle_id, user_id) DO UPDATE
  SET role = EXCLUDED.role,
      updated_at = now();

  INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id, display_name)
  VALUES (v_vehicle_id, v_user_id, v_display_name)
  ON CONFLICT (vehicle_id, user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      updated_at = now();

  INSERT INTO riviamigo.vehicle_images (vehicle_id, placement, design, size, resolution, url, overlays, metadata)
  VALUES
    (v_vehicle_id, 'side', 'light', 'xl', '2048x1024', '/vehicle-images/r1s-side-charging-light.png', '[]'::jsonb, '{"demo":true}'::jsonb),
    (v_vehicle_id, 'side', 'dark',  'xl', '2048x1024', '/vehicle-images/r1s-side-charging-light.png', '[]'::jsonb, '{"demo":true}'::jsonb),
    (v_vehicle_id, 'overhead', 'light', 'xl', '2048x1024', '/vehicle-images/r1s-side-charging-light.png', '[]'::jsonb, '{"demo":true}'::jsonb),
    (v_vehicle_id, 'overhead', 'dark',  'xl', '2048x1024', '/vehicle-images/r1s-side-charging-light.png', '[]'::jsonb, '{"demo":true}'::jsonb)
  ON CONFLICT (vehicle_id, url) DO NOTHING;

  INSERT INTO riviamigo.vehicle_latest_status
    (vehicle_id, ts, battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit, power_state, charger_state, is_online, updated_at)
  VALUES
    (v_vehicle_id, now(), 78, v_battery_capacity_wh, v_range_mi, 85, 'ready', 'Disconnected', TRUE, now())
  ON CONFLICT (vehicle_id) DO UPDATE
  SET ts = EXCLUDED.ts,
      battery_level = EXCLUDED.battery_level,
      battery_capacity_wh = EXCLUDED.battery_capacity_wh,
      distance_to_empty_mi = EXCLUDED.distance_to_empty_mi,
      battery_limit = EXCLUDED.battery_limit,
      power_state = EXCLUDED.power_state,
      charger_state = EXCLUDED.charger_state,
      is_online = EXCLUDED.is_online,
      updated_at = now();

  INSERT INTO timeseries.telemetry
    (ts, vehicle_id, battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit, speed_mph, power_state, charger_state, drive_mode, odometer_miles, is_online)
  VALUES
    (now() - interval '90 minutes', v_vehicle_id, 80, v_battery_capacity_wh, v_range_mi + 4, 85, 0, 'ready', 'Disconnected', 'all_purpose', 15000, TRUE),
    (now() - interval '60 minutes', v_vehicle_id, 79, v_battery_capacity_wh, v_range_mi + 2, 85, 18, 'drive', 'Disconnected', 'all_purpose', 15006, TRUE),
    (now() - interval '30 minutes', v_vehicle_id, 78, v_battery_capacity_wh, v_range_mi, 85, 0, 'ready', 'Disconnected', 'all_purpose', 15010, TRUE)
  ON CONFLICT DO NOTHING;

  INSERT INTO riviamigo.trips
    (vehicle_id, started_at, ended_at, distance_miles, duration_seconds, soc_start, soc_end, efficiency_wh_per_mile, max_speed_mph, drive_mode, outside_temp_c)
  VALUES
    (v_vehicle_id, now() - interval '70 minutes', now() - interval '50 minutes', 6.2, 1200, 80, 79, 420, 52, 'all_purpose', 19)
  ON CONFLICT DO NOTHING;

  INSERT INTO riviamigo.charge_sessions
    (vehicle_id, started_at, ended_at, charger_type, kwh_added, soc_start, soc_end, max_charge_rate_kw, duration_minutes, cost_usd, currency_code)
  VALUES
    (v_vehicle_id, now() - interval '10 days', now() - interval '10 days' + interval '42 minutes', 'ac', 12.4, 51, 63, 10.8, 42, 2.48, 'USD')
  ON CONFLICT DO NOTHING;
END
$$;
