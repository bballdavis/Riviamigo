//! The charge curve: charging power and battery level over one session.
//!
//! Power comes from the most direct source available for each time bucket:
//!
//! 1. Power the vehicle measured and reported through Parallax:
//!    `charging.session.power` (about every five seconds, stored thinned), then
//!    the power in `charge_session_breakdown` (about every 30 seconds).
//! 2. Legacy telemetry `power_kw`, when a vehicle reports it while charging.
//! 3. The vehicle's own charging-graph points (Parallax `charging_graph_global`,
//!    or the Rivian API live-session history), held until the next powered
//!    point or measured reading, and at most ten minutes.
//! 4. The change in the vehicle's running energy total (breakdown `total_kwh`)
//!    over a window wide enough for its 0.1 kWh steps.
//! 5. The change in battery level over a window wide enough for its 0.1% steps.
//!
//! Sources 4 and 5 are estimates. Rivian reports battery level in 0.1% steps
//! roughly every 35 to 95 seconds, so a one-minute difference can only read
//! as a few fixed values: on an 11 kW charger it alternated between about
//! 6.7, 13.3 and 16.7 kW (issue #126). The estimates fit a least-squares slope
//! to every reading in a window that widens from two to ten minutes until it
//! spans fifteen reporting steps. Fast charging reaches that quickly; an 11 kW
//! charge on a large pack spans about eight steps in ten minutes, and slower
//! charging fewer, so its estimate is coarser.

use chrono::{DateTime, Duration, Utc};

/// Power cap for AC sessions. Even an 80 A / 240 V circuit tops out near
/// 19 kW, so this only removes impossible values.
pub const AC_CAP_KW: f64 = 22.0;
/// Power cap for DC sessions.
pub const DC_CAP_KW: f64 = 300.0;

/// A measured reading is held this long when a bucket has none of its own.
const MEASURED_HOLD_SECONDS: i64 = 60;
/// A charging-graph point covers time until the next point, at most this long.
const GRAPH_HOLD_SECONDS: i64 = 600;
/// An estimate's window grows until it spans this many reporting steps.
const ESTIMATE_STEPS: f64 = 15.0;
/// Reporting step of battery level (percent) and of the energy total (kWh).
const SOC_STEP_PCT: f64 = 0.1;
const ENERGY_STEP_KWH: f64 = 0.1;
/// Half-width limits of an estimate's window, in seconds.
const ESTIMATE_MIN_HALF_SECONDS: i64 = 60;
const ESTIMATE_MAX_HALF_SECONDS: i64 = 300;
/// An estimate needs at least this much time between its two readings.
const ESTIMATE_MIN_SPAN_SECONDS: i64 = 60;
/// Battery level is interpolated across gaps up to this long.
const SOC_INTERPOLATION_MAX_GAP_SECONDS: i64 = 900;
/// At the curve's ends, the nearest battery level within this many ms is used.
const SOC_NEAREST_MAX_MS: i64 = 120_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SocSample {
    pub ts: DateTime<Utc>,
    pub soc: f64,
    pub capacity_kwh: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PowerSample {
    pub ts: DateTime<Utc>,
    pub power_kw: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EnergySample {
    pub ts: DateTime<Utc>,
    pub total_kwh: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphSource {
    Parallax,
    RivianApi,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GraphPoint {
    pub ts: DateTime<Utc>,
    pub power_kw: Option<f64>,
    pub soc: Option<f64>,
    pub source: GraphSource,
}

/// Everything the curve is built from. Every slice is sorted by time.
#[derive(Debug, Clone, Default)]
pub struct CurveInputs<'a> {
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub is_dc: bool,
    pub bucket_seconds: i64,
    pub default_capacity_kwh: Option<f64>,
    /// Session start and end battery level, for points with no reading.
    pub soc_bounds: Option<(f64, f64)>,
    pub telemetry_soc: &'a [SocSample],
    pub telemetry_power: &'a [PowerSample],
    pub session_power: &'a [PowerSample],
    pub breakdown_power: &'a [PowerSample],
    pub breakdown_energy: &'a [EnergySample],
    pub graph_points: &'a [GraphPoint],
}

#[derive(Debug, Clone, PartialEq)]
pub struct CurvePoint {
    pub ts: DateTime<Utc>,
    pub minutes_elapsed: f64,
    pub charge_rate_kw: f64,
    pub soc: Option<f64>,
    /// `recorded`, `energy_delta` or `soc_delta`.
    pub power_method: &'static str,
    /// Where the power came from.
    pub sample_source: &'static str,
    /// `measured`, `interpolated`, `session_bounds` or `unknown`.
    pub soc_method: &'static str,
}

/// Build the curve, one point per bucket that has a power value.
pub fn build_charge_curve(inputs: &CurveInputs<'_>) -> Vec<CurvePoint> {
    let (Some(started_at), Some(ended_at)) = (inputs.started_at, inputs.ended_at) else {
        return vec![];
    };
    if ended_at <= started_at {
        return vec![];
    }
    let bucket = Duration::seconds(inputs.bucket_seconds.max(1));
    let cap_kw = if inputs.is_dc { DC_CAP_KW } else { AC_CAP_KW };
    let soc_series = SocSeries::new(inputs);

    let mut points = Vec::new();
    let mut bucket_start = started_at;
    while bucket_start < ended_at {
        let bucket_end = (bucket_start + bucket).min(ended_at);
        let mid = bucket_start + (bucket_end - bucket_start) / 2;
        if let Some((power_kw, power_method, sample_source)) =
            bucket_power(inputs, bucket_start, bucket_end, mid)
        {
            let (soc, soc_method) = soc_series.bucket_soc(bucket_start, bucket_end, mid);
            points.push(CurvePoint {
                ts: mid,
                minutes_elapsed: (mid - started_at).num_milliseconds() as f64 / 60_000.0,
                charge_rate_kw: power_kw.clamp(0.0, cap_kw),
                soc,
                power_method,
                sample_source,
                soc_method,
            });
        }
        bucket_start = bucket_end;
    }

    fill_soc_from_session_bounds(&mut points, inputs.soc_bounds);
    points
}

fn bucket_power(
    inputs: &CurveInputs<'_>,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    mid: DateTime<Utc>,
) -> Option<(f64, &'static str, &'static str)> {
    if let Some(kw) = measured_power(inputs.session_power, start, end) {
        return Some((kw, "recorded", "parallax_session_power"));
    }
    if let Some(kw) = measured_power(inputs.breakdown_power, start, end) {
        return Some((kw, "recorded", "parallax_breakdown"));
    }
    if let Some(kw) = mean_power_in(inputs.telemetry_power, start, end) {
        return Some((kw, "recorded", "telemetry"));
    }
    if let Some((kw, source)) = graph_power(inputs, mid) {
        return Some((kw, "recorded", source));
    }
    let energy_step = ENERGY_STEP_KWH * ESTIMATE_STEPS;
    if let Some(kw) = centered_rate(inputs.breakdown_energy, mid, energy_step, |s| {
        (s.ts, s.total_kwh)
    }) {
        return Some((kw, "energy_delta", "parallax_breakdown"));
    }
    soc_rate_kw(inputs, mid).map(|kw| (kw, "soc_delta", "telemetry"))
}

/// The mean of the readings in the bucket, or the last reading before it
/// when that is recent enough to still describe the bucket.
fn measured_power(
    samples: &[PowerSample],
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Option<f64> {
    if let Some(kw) = mean_power_in(samples, start, end) {
        return Some(kw);
    }
    let before = samples.partition_point(|s| s.ts < start);
    let previous = samples[..before].last()?;
    (start - previous.ts <= Duration::seconds(MEASURED_HOLD_SECONDS)).then_some(previous.power_kw)
}

fn mean_power_in(samples: &[PowerSample], start: DateTime<Utc>, end: DateTime<Utc>) -> Option<f64> {
    let from = samples.partition_point(|s| s.ts < start);
    let to = samples.partition_point(|s| s.ts < end);
    let inside = &samples[from..to];
    (!inside.is_empty())
        .then(|| inside.iter().map(|s| s.power_kw).sum::<f64>() / inside.len() as f64)
}

/// The graph point covering `at`: the latest powered point at or before it,
/// held until the next powered point or the next measured reading (which may
/// say power stopped), and at most ten minutes.
///
/// Parallax leaves a zero power off the wire, so a point without power is
/// ambiguous: mid-charge it often shares its timestamp with a powered segment.
/// Only after the session's last powered point does one mark that charging
/// stopped, and end the hold there.
fn graph_power(inputs: &CurveInputs<'_>, at: DateTime<Utc>) -> Option<(f64, &'static str)> {
    let points = inputs.graph_points;
    let powered: Vec<&GraphPoint> = points.iter().filter(|p| p.power_kw.is_some()).collect();
    let index = powered.partition_point(|p| p.ts <= at);
    let point = *powered.get(index.checked_sub(1)?)?;
    let power_kw = point.power_kw?;
    let mut hold_until = point.ts + Duration::seconds(GRAPH_HOLD_SECONDS);
    if let Some(next) = powered.get(index) {
        hold_until = hold_until.min(next.ts);
    } else if let Some(stopped) = points
        .iter()
        .find(|p| p.ts > point.ts && p.power_kw.is_none())
    {
        hold_until = hold_until.min(stopped.ts);
    }
    for measured in [inputs.session_power, inputs.breakdown_power] {
        let after = measured.partition_point(|s| s.ts <= point.ts);
        if let Some(next) = measured.get(after) {
            hold_until = hold_until.min(next.ts);
        }
    }
    if at >= hold_until {
        return None;
    }
    let source = match point.source {
        GraphSource::Parallax => "parallax_charge_curve_points",
        GraphSource::RivianApi => "rivian_charge_curve_points",
    };
    Some((power_kw, source))
}

/// Rate of change per hour around `mid`: the least-squares slope of every
/// reading in a centred window. The window starts at two minutes and widens
/// to ten until the readings in it span `min_change`, so each reading's
/// rounding step is small beside the change. A drop larger than
/// [`RESET_DROP`] inside the window (a counter reset) gives none.
fn centered_rate<T>(
    samples: &[T],
    mid: DateTime<Utc>,
    min_change: f64,
    read: impl Fn(&T) -> (DateTime<Utc>, f64),
) -> Option<f64> {
    if samples.len() < 2 {
        return None;
    }
    let mut half = ESTIMATE_MIN_HALF_SECONDS;
    let mut best = None;
    while half <= ESTIMATE_MAX_HALF_SECONDS {
        let window = Duration::seconds(half);
        let lo = samples.partition_point(|s| read(s).0 < mid - window);
        let hi = samples.partition_point(|s| read(s).0 <= mid + window);
        let inside: Vec<(DateTime<Utc>, f64)> = samples[lo..hi].iter().map(&read).collect();
        if let (Some(first), Some(last)) = (inside.first(), inside.last()) {
            if last.0 - first.0 >= Duration::seconds(ESTIMATE_MIN_SPAN_SECONDS) {
                if inside
                    .windows(2)
                    .any(|pair| pair[1].1 < pair[0].1 - RESET_DROP)
                {
                    return None;
                }
                best = least_squares_slope_per_hour(&inside).map(|slope| slope.max(0.0));
                let low = inside.iter().map(|(_, v)| *v).fold(f64::INFINITY, f64::min);
                let high = inside
                    .iter()
                    .map(|(_, v)| *v)
                    .fold(f64::NEG_INFINITY, f64::max);
                if high - low >= min_change {
                    return best;
                }
            }
        }
        half += 30;
    }
    best
}

/// A drop this large between two readings is a reset, not noise.
const RESET_DROP: f64 = 1.0;

fn least_squares_slope_per_hour(points: &[(DateTime<Utc>, f64)]) -> Option<f64> {
    let origin = points.first()?.0;
    let xs: Vec<f64> = points
        .iter()
        .map(|(ts, _)| (*ts - origin).num_milliseconds() as f64 / 3_600_000.0)
        .collect();
    let n = points.len() as f64;
    let mean_x = xs.iter().sum::<f64>() / n;
    let mean_y = points.iter().map(|(_, v)| *v).sum::<f64>() / n;
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for (x, (_, y)) in xs.iter().zip(points) {
        numerator += (x - mean_x) * (y - mean_y);
        denominator += (x - mean_x) * (x - mean_x);
    }
    (denominator > 0.0).then(|| numerator / denominator)
}

fn soc_rate_kw(inputs: &CurveInputs<'_>, mid: DateTime<Utc>) -> Option<f64> {
    let samples = inputs.telemetry_soc;
    let pct_per_hour = centered_rate(samples, mid, SOC_STEP_PCT * ESTIMATE_STEPS, |s| {
        (s.ts, s.soc)
    })?;
    let nearest = samples.partition_point(|s| s.ts <= mid);
    let capacity_kwh = samples
        .get(nearest.saturating_sub(1))
        .and_then(|s| s.capacity_kwh)
        .or(inputs.default_capacity_kwh)?;
    Some(pct_per_hour / 100.0 * capacity_kwh)
}

/// Battery-level readings, collected once per curve.
struct SocSeries<'a> {
    telemetry: &'a [SocSample],
    graph: Vec<(DateTime<Utc>, f64)>,
    /// Telemetry readings when there are any, otherwise the graph's.
    known: Vec<(DateTime<Utc>, f64)>,
}

impl<'a> SocSeries<'a> {
    fn new(inputs: &CurveInputs<'a>) -> Self {
        let graph: Vec<(DateTime<Utc>, f64)> = inputs
            .graph_points
            .iter()
            .filter_map(|p| p.soc.map(|soc| (p.ts, soc)))
            .collect();
        let known = if inputs.telemetry_soc.is_empty() {
            graph.clone()
        } else {
            inputs.telemetry_soc.iter().map(|s| (s.ts, s.soc)).collect()
        };
        Self {
            telemetry: inputs.telemetry_soc,
            graph,
            known,
        }
    }

    /// Battery level for a bucket: the mean reading inside it, else the
    /// graph's level inside it, else interpolated between the readings around
    /// it, else the nearest reading within two minutes.
    fn bucket_soc(
        &self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        mid: DateTime<Utc>,
    ) -> (Option<f64>, &'static str) {
        let from = self.telemetry.partition_point(|s| s.ts < start);
        let to = self.telemetry.partition_point(|s| s.ts < end);
        let inside = &self.telemetry[from..to];
        if !inside.is_empty() {
            let mean = inside.iter().map(|s| s.soc).sum::<f64>() / inside.len() as f64;
            return (Some(mean), "measured");
        }
        let first_graph = self.graph.partition_point(|(ts, _)| *ts < start);
        if let Some((ts, soc)) = self.graph.get(first_graph) {
            if *ts < end {
                return (Some(*soc), "measured");
            }
        }
        match interpolate(&self.known, mid).or_else(|| nearest_within(&self.known, mid)) {
            Some(soc) => (Some(soc), "interpolated"),
            None => (None, "unknown"),
        }
    }
}

/// The nearest reading within two minutes, for the curve's ends where there
/// is no reading on one side to interpolate towards.
fn nearest_within(known: &[(DateTime<Utc>, f64)], at: DateTime<Utc>) -> Option<f64> {
    let index = known.partition_point(|(ts, _)| *ts <= at);
    [index.checked_sub(1), Some(index)]
        .into_iter()
        .flatten()
        .filter_map(|i| known.get(i))
        .map(|(ts, soc)| ((*ts - at).num_milliseconds().abs(), *soc))
        .filter(|(distance_ms, _)| *distance_ms <= SOC_NEAREST_MAX_MS)
        .min_by_key(|(distance_ms, _)| *distance_ms)
        .map(|(_, soc)| soc)
}

fn interpolate(known: &[(DateTime<Utc>, f64)], at: DateTime<Utc>) -> Option<f64> {
    let index = known.partition_point(|(ts, _)| *ts <= at);
    let (before_ts, before) = *known.get(index.checked_sub(1)?)?;
    let (after_ts, after) = *known.get(index)?;
    let gap = after_ts - before_ts;
    if gap > Duration::seconds(SOC_INTERPOLATION_MAX_GAP_SECONDS) || gap <= Duration::zero() {
        return None;
    }
    let ratio = (at - before_ts).num_milliseconds() as f64 / gap.num_milliseconds() as f64;
    Some(before + (after - before) * ratio)
}

/// Points without any battery-level reading nearby take a straight line from
/// the session's start level to its end level, across the curve's own span.
fn fill_soc_from_session_bounds(points: &mut [CurvePoint], bounds: Option<(f64, f64)>) {
    let Some((soc_start, soc_end)) = bounds else {
        return;
    };
    let (Some(first), Some(last)) = (points.first().map(|p| p.ts), points.last().map(|p| p.ts))
    else {
        return;
    };
    let span = (last - first).num_milliseconds().max(1) as f64;
    for point in points.iter_mut().filter(|p| p.soc.is_none()) {
        let ratio = if first == last {
            0.5
        } else {
            ((point.ts - first).num_milliseconds() as f64 / span).clamp(0.0, 1.0)
        };
        point.soc = Some(soc_start + (soc_end - soc_start) * ratio);
        point.soc_method = "session_bounds";
    }
}

mod load;
pub use load::load_charge_curve;

#[cfg(test)]
mod tests;
