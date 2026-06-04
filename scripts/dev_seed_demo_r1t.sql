-- Seed a demo vehicle for local QA using packaged app assets.
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

  INSERT INTO riviamigo.vehicle_latest_status
    (vehicle_id, ts, battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit, power_state, charger_state, charger_status, time_to_end_of_charge_min, charge_port_open, updated_at)
  VALUES
    (v_vehicle_id, now(), 64, v_battery_capacity_wh, v_range_mi, 85, 'charging', 'Charging', 'chrgr_sts_connected_charging', 95, TRUE, now())
  ON CONFLICT (vehicle_id) DO UPDATE
  SET ts = EXCLUDED.ts,
      battery_level = EXCLUDED.battery_level,
      battery_capacity_wh = EXCLUDED.battery_capacity_wh,
      distance_to_empty_mi = EXCLUDED.distance_to_empty_mi,
      battery_limit = EXCLUDED.battery_limit,
      power_state = EXCLUDED.power_state,
      charger_state = EXCLUDED.charger_state,
      charger_status = EXCLUDED.charger_status,
      time_to_end_of_charge_min = EXCLUDED.time_to_end_of_charge_min,
      charge_port_open = EXCLUDED.charge_port_open,
      updated_at = now();

  INSERT INTO riviamigo.vehicle_runtime_state
    (vehicle_id, is_online, last_event_at, worker_health, worker_health_msg, updated_at)
  VALUES
    (v_vehicle_id, TRUE, now(), 'connected', 'Demo vehicle seeded', now())
  ON CONFLICT (vehicle_id) DO UPDATE
  SET is_online = EXCLUDED.is_online,
      last_event_at = EXCLUDED.last_event_at,
      worker_health = EXCLUDED.worker_health,
      worker_health_msg = EXCLUDED.worker_health_msg,
      updated_at = now();

  DELETE FROM riviamigo.vehicle_images
  WHERE vehicle_id = v_vehicle_id;

  IF v_model = 'R1T' THEN
    INSERT INTO riviamigo.vehicle_images
      (vehicle_id, placement, design, size, resolution, url, overlays, metadata)
    VALUES
      (v_vehicle_id, 'front', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_front_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'front', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_front_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'overhead', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_overhead_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'overhead', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_overhead_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'rear', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_rear_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'rear', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_rear_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side-charging', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side-charging_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side-charging', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1t/r1t_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side-charging_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true))
    ON CONFLICT (vehicle_id, url) DO UPDATE
    SET placement = EXCLUDED.placement,
        design = EXCLUDED.design,
        size = EXCLUDED.size,
        resolution = EXCLUDED.resolution,
        overlays = EXCLUDED.overlays,
        metadata = EXCLUDED.metadata,
        updated_at = now();
  ELSIF v_model = 'R1S' THEN
    INSERT INTO riviamigo.vehicle_images
      (vehicle_id, placement, design, size, resolution, url, overlays, metadata)
    VALUES
      (v_vehicle_id, 'front', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_front_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'front', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_front_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'overhead', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_overhead_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'overhead', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_overhead_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'rear', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_rear_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'rear', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_rear_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side-charging', 'dark', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side-charging_dark_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true)),
      (v_vehicle_id, 'side-charging', 'light', 'large', 'hdpi', '/vehicle-images/fixtures/r1s/r1s_2021_adventure_ext_el-cap-granite_20ad1-brit-at_side-charging_light_large_hdpi.webp', '[]'::jsonb, jsonb_build_object('source', 'rivian-mobile-static', 'model', v_model, 'packaged', true))
    ON CONFLICT (vehicle_id, url) DO UPDATE
    SET placement = EXCLUDED.placement,
        design = EXCLUDED.design,
        size = EXCLUDED.size,
        resolution = EXCLUDED.resolution,
        overlays = EXCLUDED.overlays,
        metadata = EXCLUDED.metadata,
        updated_at = now();
  ELSE
    RAISE EXCEPTION 'R2S fixture pack has not been exported yet. Use the fixture export script once an exact cached R2S image set is available.';
  END IF;

  INSERT INTO timeseries.telemetry
    (ts, vehicle_id, battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit, speed_mph, power_state, charger_state, drive_mode, odometer_miles, is_online)
  VALUES
    (now() - interval '90 minutes', v_vehicle_id, 60, v_battery_capacity_wh, v_range_mi - 10, 85, 0, 'charging', 'Connected', 'all_purpose', 15000, TRUE),
    (now() - interval '60 minutes', v_vehicle_id, 62, v_battery_capacity_wh, v_range_mi - 8, 85, 0, 'charging', 'Charging', 'all_purpose', 15000, TRUE),
    (now() - interval '30 minutes', v_vehicle_id, 64, v_battery_capacity_wh, v_range_mi - 6, 85, 0, 'charging', 'Charging', 'all_purpose', 15000, TRUE)
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

