use std::collections::HashSet;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartDefinitionV1 {
    pub schema_version: u8,
    pub placements: Vec<ChartPlacement>,
    pub timeframe: ChartTimeframePolicy,
    pub sources: Vec<ChartSourceBinding>,
    pub x: ChartFieldEncoding,
    pub series: Vec<ChartSeriesDefinition>,
    pub axes: ChartAxesDefinition,
    pub display: ChartDisplayDefaults,
    pub interaction: ChartInteractionDefaults,
    pub annotations: Option<Vec<ChartAnnotationDefinition>>,
    pub renderer_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartPlacement {
    pub dashboard_slug: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum ChartTimeframePolicy {
    #[serde(rename = "dashboard")]
    Dashboard,
    #[serde(rename = "relative")]
    Relative { preset: String },
    #[serde(rename = "lifetime")]
    Lifetime,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSourceBinding {
    pub id: String,
    pub source_id: String,
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
    #[serde(default)]
    pub filters: Vec<ChartSourceFilter>,
    pub inherit: ChartInheritance,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartInheritance {
    pub vehicle: bool,
    pub timeframe: bool,
    pub trip_tags: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSourceFilter {
    pub field: String,
    pub operator: String,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartFieldEncoding {
    pub field: ChartFieldRef,
    pub kind: String,
    pub label: Option<String>,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartFieldRef {
    pub source_binding_id: String,
    pub field: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSeriesDefinition {
    pub id: String,
    pub label: String,
    pub y: ChartFieldRef,
    pub x: Option<ChartFieldRef>,
    pub mark: String,
    pub y_axis: String,
    pub color: ChartColorDefinition,
    pub stroke_width: Option<f64>,
    pub point_size: Option<f64>,
    pub stack_id: Option<String>,
    pub connect_gaps: Option<bool>,
    pub visible_in_legend: Option<bool>,
    #[serde(default)]
    pub transforms: Vec<ChartTransformDefinition>,
    pub value_format: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum ChartColorDefinition {
    #[serde(rename = "token")]
    Token { token: String },
    #[serde(rename = "custom")]
    Custom { light: String, dark: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ChartTransformDefinition {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "scale")]
    Scale { factor: f64 },
    #[serde(rename = "offset")]
    Offset { amount: f64 },
    #[serde(rename = "delta")]
    Delta,
    #[serde(rename = "cumulative")]
    Cumulative,
    #[serde(rename = "rolling_average")]
    RollingAverage { window: u32 },
    #[serde(rename = "rolling_median")]
    RollingMedian { window: u32 },
    #[serde(rename = "fixed_time_bin")]
    FixedTimeBin { milliseconds: u64 },
    #[serde(rename = "histogram_bin")]
    HistogramBin { size: f64 },
    #[serde(rename = "expression")]
    Expression { formula: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartAxesDefinition {
    pub x: ChartAxisDefinition,
    pub y: ChartAxisDefinition,
    pub y2: Option<ChartAxisDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartAxisDefinition {
    pub label: Option<String>,
    pub unit: Option<String>,
    pub scale: String,
    pub domain: ChartAxisDomain,
    pub tick_format: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum ChartAxisDomain {
    #[serde(rename = "auto")]
    Auto {
        include_zero: Option<bool>,
        padding: Option<f64>,
    },
    #[serde(rename = "fixed")]
    Fixed { min: f64, max: f64 },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartDisplayDefaults {
    pub legend: String,
    pub grid: bool,
    pub tooltip: bool,
    pub time_filter: String,
    pub curve_smoothness: String,
    pub data_smoothing: Option<ChartSmoothing>,
    pub show_points: Option<bool>,
    pub empty_title: Option<String>,
    pub empty_description: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSmoothing {
    pub kind: String,
    pub window: u32,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartInteractionDefaults {
    pub pan_zoom: bool,
    pub touch_explore: bool,
    pub connect_gaps: bool,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartAnnotationDefinition {
    pub kind: String,
    pub value: f64,
    pub label: Option<String>,
    pub color: ChartColorDefinition,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChartValidationError {
    pub path: String,
    pub message: String,
}

const SOURCE_IDS: &[&str] = &[
    "metrics.series",
    "battery.mileage",
    "battery.degradation",
    "battery.idle-drain",
    "charging.sessions",
    "charging.charge-curve",
    "charging.curve-analysis",
    "efficiency.trend",
    "efficiency.temperature",
    "efficiency.drive-mode",
    "efficiency.trip-tags",
    "trips.tire-pressure-timeline",
];
const FORBIDDEN_KEYS: &[&str] = &[
    "url",
    "remoteurl",
    "sql",
    "javascript",
    "script",
    "templatehtml",
    "css",
];

fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
        })
}
fn finite(value: f64) -> bool {
    value.is_finite()
}

pub fn parse_and_validate(value: &Value) -> Result<ChartDefinitionV1, Vec<ChartValidationError>> {
    let mut errors = Vec::new();
    find_forbidden(value, "config", &mut errors);
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        errors.push(error(
            "config.schemaVersion",
            "Only schemaVersion 1 is supported",
        ));
    }
    let definition = match serde_json::from_value::<ChartDefinitionV1>(value.clone()) {
        Ok(definition) => definition,
        Err(error) => {
            errors.push(ChartValidationError {
                path: "config".into(),
                message: error.to_string(),
            });
            return Err(errors);
        }
    };
    if definition.schema_version != 1 {
        errors.push(error(
            "config.schemaVersion",
            "Only schemaVersion 1 is supported",
        ));
    }
    if definition.placements.len() > 20 {
        errors.push(error(
            "config.placements",
            "At most 20 placements are allowed",
        ));
    }
    if definition.sources.is_empty() || definition.sources.len() > 4 {
        errors.push(error(
            "config.sources",
            "Between 1 and 4 source bindings are required",
        ));
    }
    if definition.series.is_empty() || definition.series.len() > 12 {
        errors.push(error(
            "config.series",
            "Between 1 and 12 series are required",
        ));
    }
    if let ChartTimeframePolicy::Relative { preset } = &definition.timeframe {
        if !["1h", "6h", "24h", "7d", "30d", "90d", "1y"].contains(&preset.as_str()) {
            errors.push(error(
                "config.timeframe.preset",
                "Unsupported relative timeframe",
            ));
        }
    }
    let source_ids: HashSet<_> = definition
        .sources
        .iter()
        .map(|source| source.id.as_str())
        .collect();
    if source_ids.len() != definition.sources.len() {
        errors.push(error("config.sources", "Source binding IDs must be unique"));
    }
    let series_ids: HashSet<_> = definition
        .series
        .iter()
        .map(|series| series.id.as_str())
        .collect();
    if series_ids.len() != definition.series.len() {
        errors.push(error("config.series", "Series IDs must be unique"));
    }
    for placement in &definition.placements {
        if !id(&placement.dashboard_slug) {
            errors.push(error(
                "config.placements",
                "Invalid dashboard placement slug",
            ));
        }
    }
    for source in &definition.sources {
        if !id(&source.id) || !id(&source.source_id) {
            errors.push(error("config.sources", "Invalid source binding identifier"));
        }
        if !SOURCE_IDS.contains(&source.source_id.as_str()) {
            errors.push(error(
                &format!("config.sources.{}.sourceId", source.id),
                "Unknown chart source ID",
            ));
        }
        if source.source_id == "metrics.series"
            && source
                .params
                .get("metric")
                .and_then(Value::as_str)
                .is_none()
        {
            errors.push(error(
                &format!("config.sources.{}.params.metric", source.id),
                "Metric series requires an allowlisted metric parameter",
            ));
        }
        for filter in &source.filters {
            if !id(&filter.field)
                || ![
                    "eq",
                    "neq",
                    "gt",
                    "gte",
                    "lt",
                    "lte",
                    "in",
                    "not_in",
                    "is_null",
                    "is_not_null",
                ]
                .contains(&filter.operator.as_str())
            {
                errors.push(error(
                    "config.sources.filters",
                    "Invalid filter field or operator",
                ));
            }
            if !filter_fields(&source.source_id).contains(&filter.field.as_str()) {
                errors.push(error(
                    "config.sources.filters.field",
                    "Filter field is not supported by this source",
                ));
            }
            let no_value = matches!(filter.operator.as_str(), "is_null" | "is_not_null");
            if no_value != filter.value.is_none() {
                errors.push(error(
                    "config.sources.filters.value",
                    "Null checks require no value; other operators require one",
                ));
            }
            if let Some(value) = &filter.value {
                if !valid_filter_value(value) {
                    errors.push(error(
                        "config.sources.filters.value",
                        "Filter values must be scalar or a string/number array",
                    ));
                }
            }
        }
    }
    validate_ref(
        &definition.x.field,
        &source_ids,
        "config.x.field",
        &mut errors,
    );
    validate_source_field(
        &definition.x.field,
        &definition.sources,
        "config.x.field",
        &mut errors,
    );
    for (index, series) in definition.series.iter().enumerate() {
        validate_ref(
            &series.y,
            &source_ids,
            &format!("config.series.{index}.y"),
            &mut errors,
        );
        validate_source_field(
            &series.y,
            &definition.sources,
            &format!("config.series.{index}.y"),
            &mut errors,
        );
        if let Some(x) = &series.x {
            validate_ref(
                x,
                &source_ids,
                &format!("config.series.{index}.x"),
                &mut errors,
            );
            validate_source_field(
                x,
                &definition.sources,
                &format!("config.series.{index}.x"),
                &mut errors,
            );
        }
        if let Some(binding) = definition
            .sources
            .iter()
            .find(|binding| binding.id == series.y.source_binding_id)
        {
            let mark = match series.mark.as_str() {
                "step" => "line",
                "histogram" => "bar",
                other => other,
            };
            if !marks_for_source(&binding.source_id).contains(&mark) {
                errors.push(error(
                    &format!("config.series.{index}.mark"),
                    "Mark is not supported by the selected source",
                ));
            }
        }
        if !finite_options(series.stroke_width, 0.5, 12.0)
            || !finite_options(series.point_size, 1.0, 24.0)
        {
            errors.push(error(
                "config.series",
                "Series dimensions must be finite and within bounds",
            ));
        }
        if series.y_axis == "y2" && definition.axes.y2.is_none() {
            errors.push(error("config.axes.y2", "A right-axis series requires y2"));
        }
        for transform in &series.transforms {
            validate_transform(transform, &mut errors);
        }
    }
    let transform_count: usize = definition
        .series
        .iter()
        .map(|series| series.transforms.len())
        .sum();
    if transform_count > 12 {
        errors.push(error(
            "config.series.transforms",
            "At most 12 transforms are allowed",
        ));
    }
    for axis in [&definition.axes.x, &definition.axes.y] {
        validate_axis(axis, &mut errors);
    }
    if let Some(axis) = definition.axes.y2.as_ref() {
        validate_axis(axis, &mut errors);
    }
    if let Some(smoothing) = &definition.display.data_smoothing {
        if !["rolling_average", "rolling_median"].contains(&smoothing.kind.as_str())
            || !(2..=1000).contains(&smoothing.window)
        {
            errors.push(error(
                "config.display.dataSmoothing",
                "Invalid smoothing definition",
            ));
        }
    }
    if errors.is_empty() {
        Ok(definition)
    } else {
        Err(errors)
    }
}

fn error(path: &str, message: &str) -> ChartValidationError {
    ChartValidationError {
        path: path.into(),
        message: message.into(),
    }
}
fn validate_ref(
    reference: &ChartFieldRef,
    ids: &HashSet<&str>,
    path: &str,
    errors: &mut Vec<ChartValidationError>,
) {
    if !ids.contains(reference.source_binding_id.as_str()) || !id(&reference.field) {
        errors.push(error(
            path,
            "Unknown source binding or invalid field identifier",
        ));
    }
}

fn validate_source_field(
    reference: &ChartFieldRef,
    sources: &[ChartSourceBinding],
    path: &str,
    errors: &mut Vec<ChartValidationError>,
) {
    if let Some(source) = sources
        .iter()
        .find(|source| source.id == reference.source_binding_id)
    {
        if !source_fields(&source.source_id).contains(&reference.field.as_str()) {
            errors.push(error(
                path,
                "Field is not available from the selected source",
            ));
        }
    }
}

fn source_fields(source_id: &str) -> &'static [&'static str] {
    match source_id {
        "metrics.series" => &[
            "timestamp",
            "battery_level",
            "range_miles",
            "odometer_miles",
            "power_kw",
            "outside_temp_c",
            "speed_mph",
        ],
        "battery.mileage" => &[
            "timestamp",
            "odometer_miles",
            "usable_kwh",
            "range_mi",
            "projected_max_range_mi",
            "degradation_pct",
        ],
        "battery.degradation" => &["timestamp", "capacity_pct", "degradation_pct"],
        "battery.idle-drain" => &[
            "day_start",
            "soc_lost_pct",
            "parked_hours",
            "drain_rate_pct_per_hour",
        ],
        "charging.sessions" => &[
            "day_start",
            "total_energy_kwh",
            "session_count",
            "ac_energy_kwh",
            "dc_energy_kwh",
        ],
        "charging.charge-curve" => &[
            "timestamp",
            "elapsed_minutes",
            "soc_pct",
            "power_kw",
            "energy_kwh",
        ],
        "charging.curve-analysis" => &["soc_pct", "power_kw", "trend_kw"],
        "efficiency.trend" => &["timestamp", "trip_efficiency_wh_mi", "rolling_24h_wh_mi"],
        "efficiency.temperature" => &[
            "temp_c_low",
            "temp_c_high",
            "avg_efficiency_wh_mi",
            "total_miles",
            "avg_speed_mph",
        ],
        "efficiency.drive-mode" => &["drive_mode", "avg_efficiency_wh_mi", "trip_count"],
        "efficiency.trip-tags" => &[
            "tag_name",
            "tag_id",
            "avg_efficiency_wh_mi",
            "trip_count",
            "total_miles",
            "coverage",
        ],
        "trips.tire-pressure-timeline" => &[
            "timestamp",
            "front_left_psi",
            "front_right_psi",
            "rear_left_psi",
            "rear_right_psi",
        ],
        _ => &[],
    }
}

fn filter_fields(source_id: &str) -> &'static [&'static str] {
    match source_id {
        "metrics.series" => &["metric"],
        "efficiency.trend" | "efficiency.temperature" => &["trip_tag_id"],
        "efficiency.drive-mode" => &["drive_mode"],
        "efficiency.trip-tags" | "trips.tire-pressure-timeline" => &["tag_id", "trip_tag_id"],
        _ => &[],
    }
}

fn marks_for_source(source_id: &str) -> &'static [&'static str] {
    match source_id {
        "metrics.series" => &["line", "area", "step", "bar", "scatter", "histogram"],
        "battery.mileage" | "battery.degradation" => &["line", "area", "step", "scatter"],
        "battery.idle-drain" => &["line", "area", "bar", "scatter"],
        "charging.sessions" => &["bar", "line", "area", "scatter"],
        "charging.charge-curve" => &["line", "area", "step", "scatter"],
        "charging.curve-analysis" => &["scatter", "line", "area"],
        "efficiency.trend" => &["line", "area", "step", "scatter"],
        "efficiency.temperature" => &["scatter", "bar", "line"],
        "efficiency.drive-mode" | "efficiency.trip-tags" => &["bar"],
        "trips.tire-pressure-timeline" => &["line", "area", "step", "scatter"],
        _ => &[],
    }
}
fn finite_options(value: Option<f64>, min: f64, max: f64) -> bool {
    value
        .map(|v| finite(v) && v >= min && v <= max)
        .unwrap_or(true)
}
fn valid_filter_value(value: &Value) -> bool {
    match value {
        Value::String(s) => s.len() <= 160,
        Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
        Value::Bool(_) | Value::Null => true,
        Value::Array(items) => {
            items.len() <= 100
                && items.iter().all(|item| match item {
                    Value::String(s) => s.len() <= 160,
                    Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
                    _ => false,
                })
        }
        _ => false,
    }
}
fn validate_transform(
    transform: &ChartTransformDefinition,
    errors: &mut Vec<ChartValidationError>,
) {
    match transform {
        ChartTransformDefinition::Scale { factor }
        | ChartTransformDefinition::HistogramBin { size: factor }
            if !finite(*factor) || *factor <= 0.0 =>
        {
            errors.push(error(
                "config.series.transforms",
                "Transform numeric values must be finite and positive",
            ))
        }
        ChartTransformDefinition::Offset { amount } if !finite(*amount) => errors.push(error(
            "config.series.transforms",
            "Transform numeric values must be finite",
        )),
        ChartTransformDefinition::RollingAverage { window }
        | ChartTransformDefinition::RollingMedian { window }
            if !(2..=1000).contains(window) =>
        {
            errors.push(error(
                "config.series.transforms",
                "Transform windows must be between 2 and 1000",
            ))
        }
        ChartTransformDefinition::FixedTimeBin { milliseconds }
            if *milliseconds == 0 || *milliseconds > 31_536_000_000 =>
        {
            errors.push(error(
                "config.series.transforms",
                "Transform bin is out of bounds",
            ))
        }
        ChartTransformDefinition::Expression { formula }
            if formula.trim().is_empty() || formula.len() > 512 =>
        {
            errors.push(error(
                "config.series.transforms.formula",
                "Expression is empty or too long",
            ))
        }
        _ => {}
    }
}
fn validate_axis(axis: &ChartAxisDefinition, errors: &mut Vec<ChartValidationError>) {
    if !["linear", "log"].contains(&axis.scale.as_str()) {
        errors.push(error("config.axes", "Unsupported axis scale"));
    }
    if let ChartAxisDomain::Fixed { min, max } = axis.domain {
        if !finite(min)
            || !finite(max)
            || min >= max
            || (axis.scale == "log" && (min <= 0.0 || max <= 0.0))
        {
            errors.push(error("config.axes.domain", "Invalid fixed axis range"));
        }
    }
}
fn find_forbidden(value: &Value, path: &str, errors: &mut Vec<ChartValidationError>) {
    match value {
        Value::Array(items) => items
            .iter()
            .enumerate()
            .for_each(|(i, v)| find_forbidden(v, &format!("{path}.{i}"), errors)),
        Value::Object(object) => {
            for (key, child) in object {
                if FORBIDDEN_KEYS.contains(&key.replace('_', "").to_ascii_lowercase().as_str()) {
                    errors.push(error(
                        &format!("{path}.{key}"),
                        "Executable, remote, SQL, HTML, or CSS fields are not allowed",
                    ));
                }
                find_forbidden(child, &format!("{path}.{key}"), errors);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn valid() -> Value {
        serde_json::json!({"schemaVersion":1,"placements":[{"dashboardSlug":"overview"}],"timeframe":{"mode":"dashboard"},"sources":[{"id":"main","sourceId":"metrics.series","params":{"metric":"battery_level"},"filters":[],"inherit":{"vehicle":true,"timeframe":true}}],"x":{"field":{"sourceBindingId":"main","field":"timestamp"},"kind":"time"},"series":[{"id":"soc","label":"SoC","y":{"sourceBindingId":"main","field":"battery_level"},"mark":"line","yAxis":"y","color":{"mode":"token","token":"accent"},"transforms":[]}],"axes":{"x":{"scale":"linear","domain":{"mode":"auto"}},"y":{"scale":"linear","domain":{"mode":"auto"}}},"display":{"legend":"auto","grid":true,"tooltip":true,"timeFilter":"raw","curveSmoothness":"straight"},"interaction":{"panZoom":true,"touchExplore":true,"connectGaps":true}})
    }
    #[test]
    fn accepts_valid_definition() {
        assert!(parse_and_validate(&valid()).is_ok());
    }
    #[test]
    fn rejects_unknown_schema_and_forbidden_keys() {
        let mut value = valid();
        value["schemaVersion"] = 2.into();
        value["url"] = "https://example.invalid".into();
        let errors = parse_and_validate(&value).expect_err("invalid");
        assert!(errors.iter().any(|e| e.path.contains("schemaVersion")));
        assert!(errors.iter().any(|e| e.path.contains("url")));
    }
    #[test]
    fn rejects_unknown_source_and_bad_axis() {
        let mut value = valid();
        value["sources"][0]["sourceId"] = "unknown.source".into();
        value["axes"]["y"]["domain"] = serde_json::json!({"mode":"fixed","min":2,"max":1});
        assert!(parse_and_validate(&value).is_err());
    }
}
