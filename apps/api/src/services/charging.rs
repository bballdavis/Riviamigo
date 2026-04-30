//! Charging computation helpers used by the ingestion worker and routes.

/// Compute energy drawn from grid (Wh) by integrating |power_kw| × Δt samples.
///
/// `samples` is an ordered sequence of `(timestamp_seconds, power_kw)` where
/// power_kw is the AC draw (positive or negative depending on sign convention;
/// this function takes the absolute value).
pub fn compute_energy_used_wh(samples: &[(f64, f64)]) -> f64 {
    samples.windows(2).fold(0.0, |acc, w| {
        let (t0, kw0) = w[0];
        let (t1, _kw1) = w[1];
        let dt_hours = (t1 - t0) / 3_600.0;
        // Use left-endpoint rule; take |kw| to be sign-convention agnostic
        acc + kw0.abs() * 1_000.0 * dt_hours
    })
}

/// Classify charger type by peak observed power.
pub fn classify_charger_type(peak_kw: f64) -> &'static str {
    if peak_kw < 12.0 {
        "ac"
    } else if peak_kw < 50.0 {
        "ac_l2"
    } else {
        "dc"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_energy_1kw_for_1hr() {
        // 1 kW for exactly 1 hour = 1 000 Wh
        let samples = vec![(0.0_f64, 1.0_f64), (3600.0, 1.0)];
        let wh = compute_energy_used_wh(&samples);
        assert!((wh - 1_000.0).abs() < 0.01);
    }

    #[test]
    fn compute_energy_handles_negative_sign() {
        // −11 kW for 30 min = 5 500 Wh (sign convention: negative = grid intake)
        let samples = vec![(0.0_f64, -11.0_f64), (1800.0, -11.0)];
        let wh = compute_energy_used_wh(&samples);
        assert!((wh - 5_500.0).abs() < 1.0);
    }

    #[test]
    fn classify_charger() {
        assert_eq!(classify_charger_type(7.2), "ac");
        assert_eq!(classify_charger_type(19.2), "ac_l2");
        assert_eq!(classify_charger_type(150.0), "dc");
    }
}
