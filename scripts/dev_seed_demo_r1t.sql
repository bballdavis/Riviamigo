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
    (vehicle_id, ts, battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
     power_state, charger_state, charger_state_ts, charger_status, time_to_end_of_charge_min,
     drive_mode, gear_status, altitude_m, speed_mph, cabin_temp_c, driver_temp_c, outside_temp_c,
     heading_deg, odometer_miles,
     tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
     tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
     tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
     door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
     door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
     closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
     closure_tailgate_locked, closure_tailgate_closed,
     ota_current_version, ota_available_version, ota_status, ota_current_status,
     hv_thermal_event, twelve_volt_health,
     charge_port_open, charger_derate_active, cabin_precon_status, cabin_precon_type,
     pet_mode_active, pet_mode_temp_ok, defrost_active, steering_wheel_heat,
     seat_fl_heat, seat_fr_heat, seat_rl_heat, seat_rr_heat, seat_fl_vent, seat_fr_vent,
     tonneau_locked, tonneau_closed, side_bin_left_locked, side_bin_right_locked,
     side_bin_left_closed, side_bin_right_closed,
     window_fl_closed, window_fr_closed, window_rl_closed, window_rr_closed,
     gear_guard_locked, gear_guard_video_status, wiper_fluid_low, brake_fluid_low,
     alarm_active, service_mode, updated_at)
  VALUES
    (v_vehicle_id, now(), 78, v_battery_capacity_wh, v_range_mi, 85,
     'charging', 'Charging', now(), 'chrgr_sts_connected_charging', 95,
     'all_purpose', 'park', -8.2, 0, 22.8, 21.7, 18.9,
     132, 15018,
     48, 48, 50, 50,
     'normal', 'normal', 'normal', 'normal',
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE,
     '2026.18.0', NULL, 'idle', 'up_to_date',
     'none', 'normal',
     TRUE, FALSE, 'off', 'none',
     FALSE, TRUE, FALSE, 0,
     0, 0, 0, 0, 0, 0,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, 'idle', FALSE, FALSE,
     FALSE, FALSE, now())
  ON CONFLICT (vehicle_id) DO UPDATE
  SET (ts, battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
       power_state, charger_state, charger_state_ts, charger_status, time_to_end_of_charge_min,
       drive_mode, gear_status, altitude_m, speed_mph, cabin_temp_c, driver_temp_c, outside_temp_c,
       heading_deg, odometer_miles,
       tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
       tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
       tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
       door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
       door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
       closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
       closure_tailgate_locked, closure_tailgate_closed,
       ota_current_version, ota_available_version, ota_status, ota_current_status,
       hv_thermal_event, twelve_volt_health,
       charge_port_open, charger_derate_active, cabin_precon_status, cabin_precon_type,
       pet_mode_active, pet_mode_temp_ok, defrost_active, steering_wheel_heat,
       seat_fl_heat, seat_fr_heat, seat_rl_heat, seat_rr_heat, seat_fl_vent, seat_fr_vent,
       tonneau_locked, tonneau_closed, side_bin_left_locked, side_bin_right_locked,
       side_bin_left_closed, side_bin_right_closed,
       window_fl_closed, window_fr_closed, window_rl_closed, window_rr_closed,
       gear_guard_locked, gear_guard_video_status, wiper_fluid_low, brake_fluid_low,
       alarm_active, service_mode, updated_at) =
      (EXCLUDED.ts, EXCLUDED.battery_level, EXCLUDED.battery_capacity_wh, EXCLUDED.distance_to_empty_mi, EXCLUDED.battery_limit,
       EXCLUDED.power_state, EXCLUDED.charger_state, EXCLUDED.charger_state_ts, EXCLUDED.charger_status, EXCLUDED.time_to_end_of_charge_min,
       EXCLUDED.drive_mode, EXCLUDED.gear_status, EXCLUDED.altitude_m, EXCLUDED.speed_mph, EXCLUDED.cabin_temp_c, EXCLUDED.driver_temp_c, EXCLUDED.outside_temp_c,
       EXCLUDED.heading_deg, EXCLUDED.odometer_miles,
       EXCLUDED.tire_fl_psi, EXCLUDED.tire_fr_psi, EXCLUDED.tire_rl_psi, EXCLUDED.tire_rr_psi,
       EXCLUDED.tire_fl_status, EXCLUDED.tire_fr_status, EXCLUDED.tire_rl_status, EXCLUDED.tire_rr_status,
       EXCLUDED.tire_fl_valid, EXCLUDED.tire_fr_valid, EXCLUDED.tire_rl_valid, EXCLUDED.tire_rr_valid,
       EXCLUDED.door_front_left_locked, EXCLUDED.door_front_right_locked, EXCLUDED.door_rear_left_locked, EXCLUDED.door_rear_right_locked,
       EXCLUDED.door_front_left_closed, EXCLUDED.door_front_right_closed, EXCLUDED.door_rear_left_closed, EXCLUDED.door_rear_right_closed,
       EXCLUDED.closure_frunk_locked, EXCLUDED.closure_frunk_closed, EXCLUDED.closure_liftgate_locked, EXCLUDED.closure_liftgate_closed,
       EXCLUDED.closure_tailgate_locked, EXCLUDED.closure_tailgate_closed,
       EXCLUDED.ota_current_version, EXCLUDED.ota_available_version, EXCLUDED.ota_status, EXCLUDED.ota_current_status,
       EXCLUDED.hv_thermal_event, EXCLUDED.twelve_volt_health,
       EXCLUDED.charge_port_open, EXCLUDED.charger_derate_active, EXCLUDED.cabin_precon_status, EXCLUDED.cabin_precon_type,
       EXCLUDED.pet_mode_active, EXCLUDED.pet_mode_temp_ok, EXCLUDED.defrost_active, EXCLUDED.steering_wheel_heat,
       EXCLUDED.seat_fl_heat, EXCLUDED.seat_fr_heat, EXCLUDED.seat_rl_heat, EXCLUDED.seat_rr_heat, EXCLUDED.seat_fl_vent, EXCLUDED.seat_fr_vent,
       EXCLUDED.tonneau_locked, EXCLUDED.tonneau_closed, EXCLUDED.side_bin_left_locked, EXCLUDED.side_bin_right_locked,
       EXCLUDED.side_bin_left_closed, EXCLUDED.side_bin_right_closed,
       EXCLUDED.window_fl_closed, EXCLUDED.window_fr_closed, EXCLUDED.window_rl_closed, EXCLUDED.window_rr_closed,
       EXCLUDED.gear_guard_locked, EXCLUDED.gear_guard_video_status, EXCLUDED.wiper_fluid_low, EXCLUDED.brake_fluid_low,
       EXCLUDED.alarm_active, EXCLUDED.service_mode, now());

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

  DELETE FROM riviamigo.software_versions
  WHERE vehicle_id = v_vehicle_id;

  INSERT INTO riviamigo.software_versions (vehicle_id, version, installed_at, observed_until)
  VALUES
    (v_vehicle_id, '2026.14.0', now() - interval '45 days', now() - interval '14 days'),
    (v_vehicle_id, '2026.18.0', now() - interval '14 days', NULL);

  INSERT INTO timeseries.telemetry
    (ts, vehicle_id, battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
     speed_mph, altitude_m, power_state, charger_state, charger_status, time_to_end_of_charge_min,
     drive_mode, gear_status, cabin_temp_c, driver_temp_c, outside_temp_c, odometer_miles,
     tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
     tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
     tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
     door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
     closure_frunk_closed, closure_liftgate_closed, closure_tailgate_closed,
     ota_current_version, ota_available_version, ota_status, ota_current_status,
     hv_thermal_event, twelve_volt_health,
     charge_port_open, charger_derate_active, cabin_precon_status, cabin_precon_type,
     pet_mode_active, pet_mode_temp_ok, defrost_active,
     tonneau_locked, tonneau_closed, side_bin_left_closed, side_bin_right_closed, is_online)
  VALUES
    (now() - interval '90 minutes', v_vehicle_id, 74, v_battery_capacity_wh, v_range_mi - 12, 85,
     0, -8.7, 'charging', 'Connected', 'chrgr_sts_connected_no_chrg', 110,
     'all_purpose', 'park', 22.1, 21.2, 18.1, 15018,
     47.8, 47.9, 49.7, 49.8,
     'normal', 'normal', 'normal', 'normal',
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE,
     '2026.18.0', NULL, 'idle', 'up_to_date',
     'none', 'normal',
     TRUE, FALSE, 'off', 'none',
     FALSE, TRUE, FALSE,
     TRUE, TRUE, TRUE, TRUE, TRUE),
    (now() - interval '60 minutes', v_vehicle_id, 76, v_battery_capacity_wh, v_range_mi - 9, 85,
     0, -8.5, 'charging', 'Charging', 'chrgr_sts_connected_charging', 102,
     'all_purpose', 'park', 22.4, 21.4, 18.5, 15018,
     47.9, 48.0, 49.9, 50.0,
     'normal', 'normal', 'normal', 'normal',
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE,
     '2026.18.0', NULL, 'idle', 'up_to_date',
     'none', 'normal',
     TRUE, FALSE, 'off', 'none',
     FALSE, TRUE, FALSE,
     TRUE, TRUE, TRUE, TRUE, TRUE),
    (now() - interval '30 minutes', v_vehicle_id, 78, v_battery_capacity_wh, v_range_mi - 6, 85,
     0, -8.2, 'charging', 'Charging', 'chrgr_sts_connected_charging', 95,
     'all_purpose', 'park', 22.8, 21.7, 18.9, 15018,
     48.0, 48.0, 50.0, 50.0,
     'normal', 'normal', 'normal', 'normal',
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE, TRUE,
     TRUE, TRUE, TRUE,
     '2026.18.0', NULL, 'idle', 'up_to_date',
     'none', 'normal',
     TRUE, FALSE, 'off', 'none',
     FALSE, TRUE, FALSE,
     TRUE, TRUE, TRUE, TRUE, TRUE)
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

