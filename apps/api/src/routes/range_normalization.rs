const PLAUSIBLE_MAX_MI_PER_KWH: f64 = 3.4;
// The R2 is more efficient than R1 vehicles: Rivian's own R2 range estimates
// imply more than 3.6 mi/kWh, while a kilometre value misread as miles implies
// roughly 5.9 mi/kWh.
const R2_PLAUSIBLE_MAX_MI_PER_KWH: f64 = 4.5;

fn plausible_max_mi_per_kwh(model: Option<&str>) -> f64 {
    match model {
        Some(model) if model.trim().eq_ignore_ascii_case("R2") => R2_PLAUSIBLE_MAX_MI_PER_KWH,
        _ => PLAUSIBLE_MAX_MI_PER_KWH,
    }
}

fn normalize_capacity_kwh(battery_capacity_wh: Option<f64>) -> Option<f64> {
    battery_capacity_wh
        .filter(|value| value.is_finite())
        .map(|wh| if wh > 1000.0 { wh / 1000.0 } else { wh })
        .filter(|value| *value > 0.0)
}

fn plausible_max_range_miles(battery_capacity_wh: Option<f64>, model: Option<&str>) -> Option<f64> {
    normalize_capacity_kwh(battery_capacity_wh).map(|kwh| kwh * plausible_max_mi_per_kwh(model))
}

fn normalize_remaining_range_miles_with_policy(
    raw_range_mi: Option<f64>,
    battery_level_pct: Option<f64>,
    battery_capacity_wh: Option<f64>,
    model: Option<&str>,
    keep_implausible: bool,
) -> Option<f64> {
    let raw_range_mi = raw_range_mi.filter(|value| value.is_finite())?;
    let battery_level_pct = battery_level_pct.filter(|value| value.is_finite())?;
    if battery_level_pct <= 0.0 {
        return Some(raw_range_mi);
    }

    let Some(plausible_max_range) = plausible_max_range_miles(battery_capacity_wh, model) else {
        return Some(raw_range_mi);
    };

    let raw_max_range = raw_range_mi / battery_level_pct * 100.0;
    if raw_max_range <= plausible_max_range {
        return Some(raw_range_mi);
    }

    let converted_from_km = raw_range_mi / 1.609_344;
    let converted_max_range = converted_from_km / battery_level_pct * 100.0;
    if converted_max_range <= plausible_max_range {
        return Some(converted_from_km);
    }

    keep_implausible.then_some(raw_range_mi)
}

pub fn normalize_remaining_range_miles(
    raw_range_mi: Option<f64>,
    battery_level_pct: Option<f64>,
    battery_capacity_wh: Option<f64>,
    model: Option<&str>,
) -> Option<f64> {
    normalize_remaining_range_miles_with_policy(
        raw_range_mi,
        battery_level_pct,
        battery_capacity_wh,
        model,
        true,
    )
}

pub fn normalize_remaining_range_miles_strict(
    raw_range_mi: Option<f64>,
    battery_level_pct: Option<f64>,
    battery_capacity_wh: Option<f64>,
    model: Option<&str>,
) -> Option<f64> {
    normalize_remaining_range_miles_with_policy(
        raw_range_mi,
        battery_level_pct,
        battery_capacity_wh,
        model,
        false,
    )
}

pub fn projected_full_charge_range_miles(
    remaining_range_mi: Option<f64>,
    battery_level_pct: Option<f64>,
) -> Option<f64> {
    let remaining_range_mi = remaining_range_mi.filter(|value| value.is_finite())?;
    let battery_level_pct = battery_level_pct.filter(|value| value.is_finite())?;
    if battery_level_pct <= 0.0 {
        return None;
    }
    Some(remaining_range_mi / battery_level_pct * 100.0)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_remaining_range_miles, normalize_remaining_range_miles_strict,
        projected_full_charge_range_miles,
    };

    #[test]
    fn keeps_plausible_miles() {
        let value = normalize_remaining_range_miles(Some(227.0), Some(71.0), Some(135_000.0), None);
        assert_eq!(value, Some(227.0));
    }

    #[test]
    fn converts_km_to_miles_when_plausible_after_conversion() {
        let value = normalize_remaining_range_miles(Some(380.0), Some(71.0), Some(135_000.0), None);
        assert_eq!(
            value.map(|miles| (miles * 10.0).round() / 10.0),
            Some(236.1)
        );
    }

    #[test]
    fn strict_mode_drops_impossible_readings() {
        let value =
            normalize_remaining_range_miles_strict(Some(520.0), Some(65.0), Some(135_000.0), None);
        assert_eq!(value, None);
    }

    #[test]
    fn keeps_efficient_r2_miles() {
        let value =
            normalize_remaining_range_miles(Some(208.16), Some(62.1), Some(91_585.0), Some("R2"));
        assert_eq!(value, Some(208.16));
    }

    #[test]
    fn converts_r2_km_value_to_miles() {
        let value =
            normalize_remaining_range_miles(Some(335.0), Some(62.1), Some(91_585.0), Some("R2"));
        assert_eq!(
            value.map(|miles| (miles * 10.0).round() / 10.0),
            Some(208.2)
        );
    }

    #[test]
    fn projects_full_charge_range_from_soc() {
        let value = projected_full_charge_range_miles(Some(210.0), Some(70.0));
        assert_eq!(value, Some(300.0));
    }
}
