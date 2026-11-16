use crate::routes::range_normalization::normalize_remaining_range_miles;

#[test]
fn leaves_plausible_miles_untouched() {
    let value = normalize_remaining_range_miles(Some(227.0), Some(71.0), Some(135_000.0), None);
    assert_eq!(value, Some(227.0));
}

#[test]
fn converts_implausible_km_value_to_miles() {
    let value = normalize_remaining_range_miles(Some(380.0), Some(71.0), Some(135_000.0), None);
    assert_eq!(
        value.map(|miles| (miles * 10.0).round() / 10.0),
        Some(236.1)
    );
}

#[test]
fn leaves_high_but_plausible_miles_untouched() {
    let value = normalize_remaining_range_miles(Some(227.0), Some(71.0), Some(105_000.0), None);
    assert_eq!(value, Some(227.0));
}
