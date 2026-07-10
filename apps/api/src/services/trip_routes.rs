//! Derived route geometry used by the timeframe trip map.
//!
//! Route previews are intentionally small and immutable once a trip closes.
//! The detailed trip endpoint still reads telemetry at an adaptive resolution.

const MAX_PREVIEW_POINTS: usize = 256;
const INITIAL_TOLERANCE_METERS: f64 = 5.0;
const METERS_PER_DEGREE_LAT: f64 = 110_540.0;
const METERS_PER_DEGREE_LNG: f64 = 111_320.0;

/// Build a compact `[longitude, latitude]` preview while retaining endpoints
/// and the meaningful bends in the original route.
pub fn build_route_preview(points: &[(f64, f64)]) -> Vec<[f64; 2]> {
    let mut cleaned = Vec::with_capacity(points.len());
    for &(lat, lng) in points {
        if !lat.is_finite() || !lng.is_finite() || (lat == 0.0 && lng == 0.0) {
            continue;
        }
        if cleaned
            .last()
            .is_some_and(|&(last_lat, last_lng)| last_lat == lat && last_lng == lng)
        {
            continue;
        }
        cleaned.push((lat, lng));
    }

    if cleaned.len() <= MAX_PREVIEW_POINTS {
        return cleaned.into_iter().map(|(lat, lng)| [lng, lat]).collect();
    }

    let origin_lat = cleaned.iter().map(|(lat, _)| *lat).sum::<f64>() / cleaned.len() as f64;
    let origin_lat_rad = origin_lat.to_radians();
    let project = |(lat, lng): (f64, f64)| {
        (
            lng * METERS_PER_DEGREE_LNG * origin_lat_rad.cos(),
            lat * METERS_PER_DEGREE_LAT,
        )
    };
    let projected: Vec<(f64, f64)> = cleaned.iter().copied().map(project).collect();

    let mut tolerance = INITIAL_TOLERANCE_METERS;
    while simplify_indices(&projected, tolerance).len() > MAX_PREVIEW_POINTS {
        tolerance *= 2.0;
    }

    let mut low = tolerance / 2.0;
    let mut high = tolerance;
    for _ in 0..12 {
        let mid = (low + high) / 2.0;
        if simplify_indices(&projected, mid).len() <= MAX_PREVIEW_POINTS {
            high = mid;
        } else {
            low = mid;
        }
    }

    simplify_indices(&projected, high)
        .into_iter()
        .map(|index| {
            let (lat, lng) = cleaned[index];
            [lng, lat]
        })
        .collect()
}

fn simplify_indices(points: &[(f64, f64)], tolerance_meters: f64) -> Vec<usize> {
    if points.len() <= 2 {
        return (0..points.len()).collect();
    }

    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    simplify_segment(
        points,
        0,
        points.len() - 1,
        tolerance_meters * tolerance_meters,
        &mut keep,
    );

    keep.into_iter()
        .enumerate()
        .filter_map(|(index, keep)| keep.then_some(index))
        .collect()
}

fn simplify_segment(
    points: &[(f64, f64)],
    start: usize,
    end: usize,
    tolerance_squared: f64,
    keep: &mut [bool],
) {
    if end <= start + 1 {
        return;
    }

    let mut furthest = 0.0;
    let mut furthest_index = None;
    for index in (start + 1)..end {
        let distance = squared_segment_distance(points[index], points[start], points[end]);
        if distance > furthest {
            furthest = distance;
            furthest_index = Some(index);
        }
    }

    if let Some(index) = furthest_index.filter(|_| furthest > tolerance_squared) {
        keep[index] = true;
        simplify_segment(points, start, index, tolerance_squared, keep);
        simplify_segment(points, index, end, tolerance_squared, keep);
    }
}

fn squared_segment_distance(point: (f64, f64), start: (f64, f64), end: (f64, f64)) -> f64 {
    let (dx, dy) = (end.0 - start.0, end.1 - start.1);
    if dx == 0.0 && dy == 0.0 {
        return (point.0 - start.0).powi(2) + (point.1 - start.1).powi(2);
    }

    let projection = ((point.0 - start.0) * dx + (point.1 - start.1) * dy) / (dx * dx + dy * dy);
    let projection = projection.clamp(0.0, 1.0);
    let closest = (start.0 + projection * dx, start.1 + projection * dy);
    (point.0 - closest.0).powi(2) + (point.1 - closest.1).powi(2)
}

#[cfg(test)]
mod tests {
    use super::build_route_preview;

    #[test]
    fn keeps_endpoints_and_removes_invalid_points() {
        let preview = build_route_preview(&[
            (0.0, 0.0),
            (40.0, -73.0),
            (40.0, -73.0),
            (40.001, -73.001),
            (f64::NAN, -73.2),
            (40.002, -73.002),
        ]);

        assert_eq!(preview.first(), Some(&[-73.0, 40.0]));
        assert_eq!(preview.last(), Some(&[-73.002, 40.002]));
        assert_eq!(preview.len(), 3);
    }

    #[test]
    fn caps_dense_routes_without_losing_order() {
        let points = (0..2_000)
            .map(|index| {
                (
                    40.0 + index as f64 * 0.00001,
                    -73.0 - index as f64 * 0.00001,
                )
            })
            .collect::<Vec<_>>();
        let preview = build_route_preview(&points);

        assert!(preview.len() <= 256);
        assert_eq!(preview.first(), Some(&[-73.0, 40.0]));
        assert_eq!(preview.last(), Some(&[-73.01999, 40.01999]));
    }
}
