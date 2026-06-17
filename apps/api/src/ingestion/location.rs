pub fn valid_location_pair(lat: Option<f64>, lng: Option<f64>) -> Option<(f64, f64)> {
    let (Some(lat), Some(lng)) = (lat, lng) else {
        return None;
    };

    if !lat.is_finite() || !lng.is_finite() {
        return None;
    }

    if lat == 0.0 && lng == 0.0 {
        return None;
    }

    Some((lat, lng))
}
