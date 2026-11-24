use super::*;
use chrono::TimeZone;

fn start() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 31, 2, 30, 0).unwrap()
}

fn at(seconds: i64) -> DateTime<Utc> {
    start() + Duration::seconds(seconds)
}

fn inputs<'a>(minutes: i64, is_dc: bool) -> CurveInputs<'a> {
    CurveInputs {
        started_at: Some(start()),
        ended_at: Some(start() + Duration::minutes(minutes)),
        is_dc,
        bucket_seconds: 60,
        default_capacity_kwh: Some(111.2),
        ..Default::default()
    }
}

/// Battery level as Rivian reports it on an 11 kW home charger: 0.1%
/// steps, two of them every ~74 seconds on average, at an uneven
/// 35-95 second cadence. Taken from the shape of a real session.
fn quantized_home_charge(minutes: i64) -> Vec<SocSample> {
    let gaps = [91, 55, 37, 74, 74, 36, 94, 56, 36, 74, 74, 35];
    let steps = [2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1];
    let mut samples = Vec::new();
    let mut t = 0_i64;
    let mut soc_tenths = 346_i64;
    let mut i = 0;
    while t <= minutes * 60 {
        samples.push(SocSample {
            ts: at(t),
            soc: soc_tenths as f64 / 10.0,
            capacity_kwh: Some(111.2),
        });
        t += gaps[i % gaps.len()];
        soc_tenths += steps[i % steps.len()];
        i += 1;
    }
    samples
}

#[test]
fn soc_estimate_does_not_spike_on_rounded_battery_levels() {
    let soc = quantized_home_charge(90);
    let curve = build_charge_curve(&CurveInputs {
        telemetry_soc: &soc,
        ..inputs(90, false)
    });
    // 20 tenths per 736 seconds of 111.2 kWh is 10.9 kW.
    let interior: Vec<&CurvePoint> = curve
        .iter()
        .filter(|p| p.minutes_elapsed > 6.0 && p.minutes_elapsed < 84.0)
        .collect();
    assert!(!interior.is_empty());
    for point in &interior {
        assert_eq!(point.power_method, "soc_delta");
        assert!(
            (point.charge_rate_kw - 10.9).abs() < 0.8,
            "{} kW at minute {}",
            point.charge_rate_kw,
            point.minutes_elapsed
        );
    }
    // The old one-minute difference read up to 16.7 kW on this shape.
    let peak = interior
        .iter()
        .map(|p| p.charge_rate_kw)
        .fold(0.0, f64::max);
    assert!(peak < 11.7, "peak {peak} kW");
}

#[test]
fn measured_power_wins_over_every_estimate() {
    let soc = quantized_home_charge(30);
    let measured: Vec<PowerSample> = (0..120)
        .map(|i| PowerSample {
            ts: at(i * 15),
            power_kw: 11.2,
        })
        .collect();
    let breakdown = vec![PowerSample {
        ts: at(30),
        power_kw: 9.0,
    }];
    let graph = vec![GraphPoint {
        ts: at(0),
        power_kw: Some(7.0),
        soc: Some(34.0),
        source: GraphSource::Parallax,
    }];
    let curve = build_charge_curve(&CurveInputs {
        telemetry_soc: &soc,
        session_power: &measured,
        breakdown_power: &breakdown,
        graph_points: &graph,
        ..inputs(30, false)
    });
    assert_eq!(curve.len(), 30);
    assert!(curve.iter().all(|p| p.power_method == "recorded"
        && p.sample_source == "parallax_session_power"
        && (p.charge_rate_kw - 11.2).abs() < 1e-9
        && matches!(p.soc_method, "measured" | "interpolated")));
}

#[test]
fn breakdown_power_then_graph_then_energy_fill_in_order() {
    // Breakdown power covers minutes 0-4; a graph point covers 5-14;
    // only the energy total covers minutes 15-29.
    let breakdown_power: Vec<PowerSample> = (0..10)
        .map(|i| PowerSample {
            ts: at(i * 30),
            power_kw: 10.8,
        })
        .collect();
    let graph = vec![GraphPoint {
        ts: at(300),
        power_kw: Some(10.5),
        soc: None,
        source: GraphSource::RivianApi,
    }];
    let energy: Vec<EnergySample> = (0..=60)
        .map(|i| EnergySample {
            ts: at(i * 30),
            total_kwh: (i as f64 * 30.0 / 3600.0 * 10.0 * 10.0).floor() / 10.0,
        })
        .collect();
    let curve = build_charge_curve(&CurveInputs {
        breakdown_power: &breakdown_power,
        breakdown_energy: &energy,
        graph_points: &graph,
        ..inputs(30, false)
    });
    let at_minute = |m: f64| {
        curve
            .iter()
            .find(|p| (p.minutes_elapsed - m).abs() < 0.01)
            .unwrap()
    };
    assert_eq!(at_minute(2.5).sample_source, "parallax_breakdown");
    assert_eq!(at_minute(2.5).power_method, "recorded");
    assert_eq!(at_minute(9.5).sample_source, "rivian_charge_curve_points");
    let estimated = at_minute(20.5);
    assert_eq!(estimated.power_method, "energy_delta");
    assert!(
        (estimated.charge_rate_kw - 10.0).abs() < 1.0,
        "{}",
        estimated.charge_rate_kw
    );
}

#[test]
fn a_falling_energy_total_gives_no_estimate() {
    let energy = vec![
        EnergySample {
            ts: at(0),
            total_kwh: 40.0,
        },
        EnergySample {
            ts: at(60),
            total_kwh: 40.1,
        },
        EnergySample {
            ts: at(120),
            total_kwh: 0.2,
        },
    ];
    assert!(centered_rate(&energy, at(60), 1.5, |s| (s.ts, s.total_kwh)).is_none());
}

#[test]
fn a_paused_charge_reads_zero_not_a_gap() {
    let soc: Vec<SocSample> = (0..20)
        .map(|i| SocSample {
            ts: at(i * 60),
            soc: 50.0,
            capacity_kwh: Some(111.2),
        })
        .collect();
    let curve = build_charge_curve(&CurveInputs {
        telemetry_soc: &soc,
        ..inputs(20, false)
    });
    assert!(!curve.is_empty());
    assert!(curve.iter().all(|p| p.charge_rate_kw == 0.0));
}

#[test]
fn measured_reading_is_held_briefly_then_dropped() {
    let measured = vec![PowerSample {
        ts: at(10),
        power_kw: 7.4,
    }];
    let curve = build_charge_curve(&CurveInputs {
        session_power: &measured,
        ..inputs(5, false)
    });
    // Minute 0 has the reading, minute 1 holds it, later minutes have none.
    assert_eq!(curve.len(), 2);
    assert!(curve.iter().all(|p| (p.charge_rate_kw - 7.4).abs() < 1e-9));
}

#[test]
fn graph_points_hold_until_the_next_point_and_at_most_ten_minutes() {
    let graph = vec![
        GraphPoint {
            ts: at(0),
            power_kw: Some(150.0),
            soc: Some(20.0),
            source: GraphSource::Parallax,
        },
        GraphPoint {
            ts: at(120),
            power_kw: Some(140.0),
            soc: Some(25.0),
            source: GraphSource::Parallax,
        },
    ];
    let curve = build_charge_curve(&CurveInputs {
        graph_points: &graph,
        ..inputs(30, true)
    });
    // 0-1 at 150 kW, 2-11 at 140 kW, nothing after ten minutes.
    assert_eq!(curve.len(), 12);
    assert!((curve[0].charge_rate_kw - 150.0).abs() < 1e-9);
    assert!((curve[5].charge_rate_kw - 140.0).abs() < 1e-9);
    // Battery level comes from the graph inside a bucket, else interpolates.
    assert_eq!(curve[0].soc, Some(20.0));
    assert_eq!(curve[0].soc_method, "measured");
    assert_eq!(curve[1].soc_method, "interpolated");
    assert!((curve[1].soc.unwrap() - 23.75).abs() < 1e-9);
}

#[test]
fn session_bounds_fill_battery_level_when_nothing_was_reported() {
    let graph = vec![
        GraphPoint {
            ts: at(240),
            power_kw: Some(176.0),
            soc: None,
            source: GraphSource::RivianApi,
        },
        GraphPoint {
            ts: at(840),
            power_kw: Some(118.0),
            soc: None,
            source: GraphSource::RivianApi,
        },
    ];
    let curve = build_charge_curve(&CurveInputs {
        soc_bounds: Some((18.0, 78.0)),
        graph_points: &graph,
        ..inputs(24, true)
    });
    assert!(!curve.is_empty());
    assert!(curve.iter().all(|p| p.soc_method == "session_bounds"));
    assert!((curve.first().unwrap().soc.unwrap() - 18.0).abs() < 1e-9);
    assert!((curve.last().unwrap().soc.unwrap() - 78.0).abs() < 1e-9);
}

#[test]
fn power_is_capped_by_charger_type() {
    let measured = vec![PowerSample {
        ts: at(5),
        power_kw: 40.0,
    }];
    let ac = build_charge_curve(&CurveInputs {
        session_power: &measured,
        ..inputs(1, false)
    });
    assert_eq!(ac[0].charge_rate_kw, AC_CAP_KW);
    let dc = build_charge_curve(&CurveInputs {
        session_power: &measured,
        ..inputs(1, true)
    });
    assert_eq!(dc[0].charge_rate_kw, 40.0);
}

#[test]
fn an_empty_or_inverted_window_has_no_curve() {
    assert!(build_charge_curve(&CurveInputs::default()).is_empty());
    let mut inverted = inputs(5, false);
    inverted.ended_at = Some(start() - Duration::minutes(1));
    assert!(build_charge_curve(&inverted).is_empty());
}

#[test]
fn a_graph_point_does_not_outlast_a_stop() {
    // Measured 11 kW until the vehicle reports power stopped at 600 s (the
    // collector writes a zero then). A graph point two minutes before the stop
    // must not carry 11 kW past it.
    let mut measured: Vec<PowerSample> = (0..40)
        .map(|i| PowerSample {
            ts: at(i * 15),
            power_kw: 11.0,
        })
        .collect();
    measured.push(PowerSample {
        ts: at(600),
        power_kw: 0.0,
    });
    let graph = vec![GraphPoint {
        ts: at(480),
        power_kw: Some(11.0),
        soc: Some(60.0),
        source: GraphSource::Parallax,
    }];
    let curve = build_charge_curve(&CurveInputs {
        session_power: &measured,
        graph_points: &graph,
        ..inputs(30, false)
    });
    assert!(
        curve
            .iter()
            .filter(|p| p.minutes_elapsed > 10.0)
            .all(|p| p.charge_rate_kw == 0.0),
        "{curve:?}"
    );
    assert!(curve
        .iter()
        .filter(|p| p.minutes_elapsed < 10.0)
        .all(|p| (p.charge_rate_kw - 11.0).abs() < 1e-9));
}

#[test]
fn only_a_trailing_powerless_graph_point_ends_the_hold() {
    // Parallax leaves zero power off the wire. Mid-charge a power-less point
    // is ignored; after the last powered point it marks the stop.
    let graph = vec![
        GraphPoint {
            ts: at(0),
            power_kw: Some(11.0),
            soc: None,
            source: GraphSource::RivianApi,
        },
        GraphPoint {
            ts: at(120),
            power_kw: None,
            soc: Some(60.0),
            source: GraphSource::Parallax,
        },
        GraphPoint {
            ts: at(240),
            power_kw: Some(10.0),
            soc: None,
            source: GraphSource::Parallax,
        },
        GraphPoint {
            ts: at(420),
            power_kw: None,
            soc: Some(70.0),
            source: GraphSource::Parallax,
        },
    ];
    let curve = build_charge_curve(&CurveInputs {
        graph_points: &graph,
        ..inputs(30, false)
    });
    let kw: Vec<f64> = curve.iter().map(|p| p.charge_rate_kw).collect();
    // Minutes 0-3 at 11 kW, 4-6 at 10 kW, nothing after the trailing point.
    assert_eq!(kw, vec![11.0, 11.0, 11.0, 11.0, 10.0, 10.0, 10.0]);
}
