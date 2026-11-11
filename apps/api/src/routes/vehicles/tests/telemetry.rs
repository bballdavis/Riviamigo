use super::*;
use futures::StreamExt;

/// HTTP consumers may poll a body again after EOF. `unfold` itself is
/// not safe to poll after completion, including on a header-only export.
#[tokio::test]
async fn capture_export_body_remains_complete_after_eof() {
    for page_count in [0, 1, 3] {
        let rows = futures::stream::unfold(0, move |page| async move {
            (page < page_count).then(|| {
                (
                    Ok::<_, std::io::Error>(axum::body::Bytes::from(format!(
                        "{{\"page\":{page}}}\n"
                    ))),
                    page + 1,
                )
            })
        });
        let mut body =
            capture_export_body("{\"kind\":\"header\"}\n".into(), rows).into_data_stream();
        let mut downloaded = Vec::new();
        while let Some(chunk) = body.next().await {
            downloaded.extend_from_slice(&chunk.expect("download chunk"));
        }
        let mut expected = "{\"kind\":\"header\"}\n".to_owned();
        for page in 0..page_count {
            expected.push_str(&format!("{{\"page\":{page}}}\n"));
        }
        assert_eq!(downloaded, expected.as_bytes());
        for _ in 0..3 {
            assert!(body.next().await.is_none());
        }
    }
}

#[tokio::test]
async fn capture_export_body_propagates_page_errors() {
    let rows = futures::stream::unfold(Some(()), |state| async move {
        state.map(|()| (Err(std::io::Error::other("page query failed")), None))
    });
    let mut body = capture_export_body("header\n".into(), rows).into_data_stream();
    assert_eq!(body.next().await.unwrap().unwrap(), "header\n");
    assert!(body.next().await.unwrap().is_err());
    for _ in 0..3 {
        assert!(body.next().await.is_none());
    }
}

#[test]
fn raw_telemetry_rejects_unknown_field_filters() {
    assert!(parse_raw_fields(Some("battery_level,not_a_telemetry_field")).is_err());
}

#[test]
fn raw_selectors_reject_control_and_oversized_input() {
    assert!(parse_raw_fields(Some("battery_level\n".repeat(300).as_str())).is_err());
    assert!(parse_telemetry_lanes(Some("battery\u{0000},drive")).is_err());
}

#[test]
fn raw_telemetry_selected_fields_are_bounded_to_known_columns() {
    let fields = parse_raw_fields(Some("battery_level,tire_fl_psi,battery_level"))
        .expect("known fields should parse");
    assert_eq!(fields, vec!["battery_level", "tire_fl_psi"]);

    let clause = raw_telemetry_where_clause(&fields, false);
    assert!(clause.contains("t.battery_level IS NOT NULL OR t.tire_fl_psi IS NOT NULL"));
    assert!(clause.contains("to_jsonb(t)::text ILIKE"));
}

#[test]
fn raw_telemetry_field_coverage_uses_typed_rows_not_wide_json() {
    let query = raw_field_coverage_query("t.vehicle_id = $1");

    assert_eq!(RAW_TELEMETRY_FIELDS.len(), 52);
    assert!(query.contains("unnest(ARRAY["));
    assert!(query.contains("AS field"));
    assert!(query.contains("AS sample_count"));
    assert!(!query.contains("jsonb_build_object"));
}

#[test]
fn telemetry_lane_queries_are_bounded_and_allowlisted() {
    let lanes = parse_telemetry_lanes(Some("battery,drive,battery")).expect("known lanes");
    assert_eq!(lanes, vec!["battery", "drive"]);
    assert!(parse_telemetry_lanes(Some("raw_payload")).is_err());

    let from = "2026-07-14T00:00:00Z".parse().expect("valid timestamp");
    let to = "2026-07-14T01:00:00Z".parse().expect("valid timestamp");
    assert_eq!(
        resolve_telemetry_resolution(Some("5m"), from, to, 256).unwrap(),
        300
    );
}

#[test]
fn telemetry_lane_runtime_query_aliases_every_row_field() {
    for field in [
        "latitude",
        "longitude",
        "altitude_m",
        "speed_mph",
        "battery_level",
        "battery_capacity_wh",
        "distance_to_empty_mi",
        "battery_limit",
        "time_to_end_of_charge_min",
        "cabin_temp_c",
        "driver_temp_c",
        "outside_temp_c",
        "power_kw",
        "regen_power_kw",
        "heading_deg",
        "odometer_miles",
        "tire_fl_psi",
        "tire_fr_psi",
        "tire_rl_psi",
        "tire_rr_psi",
    ] {
        assert!(
            TELEMETRY_LANES_QUERY.contains(&format!("AS {field}")),
            "telemetry lane query must alias {field}"
        );
    }
}

#[test]
fn raw_telemetry_rejects_inverted_time_bounds() {
    let from = "2026-07-14T00:00:00Z".parse().expect("valid timestamp");
    let to = "2026-07-13T00:00:00Z".parse().expect("valid timestamp");
    assert!(validate_raw_time_bounds(Some(from), Some(to)).is_err());
}
