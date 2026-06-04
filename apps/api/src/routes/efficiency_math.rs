pub(crate) fn weighted_average_from_totals(
    total_distance_miles: Option<f64>,
    weighted_efficiency_wh_mi: Option<f64>,
) -> Option<f64> {
    let distance = total_distance_miles?;
    let weighted = weighted_efficiency_wh_mi?;
    if !distance.is_finite() || !weighted.is_finite() || distance <= 0.0 {
        return None;
    }
    Some(weighted / distance)
}

#[cfg(test)]
mod tests {
    use super::weighted_average_from_totals;

    #[test]
    fn uses_distance_weighting_instead_of_trip_count_weighting() {
        let short_trip = 1.0_f64 * 1000.0_f64;
        let long_trip = 100.0_f64 * 333.0_f64;
        let average = weighted_average_from_totals(Some(101.0), Some(short_trip + long_trip));

        assert!(average.is_some());
        let value = average.unwrap();
        assert!((value - 339.6039603960396).abs() < 1e-9, "unexpected weighted average: {value}");
    }

    #[test]
    fn ignores_missing_or_zero_distance_totals() {
        assert_eq!(weighted_average_from_totals(Some(0.0), Some(123.0)), None);
        assert_eq!(weighted_average_from_totals(None, Some(123.0)), None);
        assert_eq!(weighted_average_from_totals(Some(12.0), None), None);
    }
}
