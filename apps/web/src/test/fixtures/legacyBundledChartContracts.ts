/**
 * Immutable visual contract recovered from the hard-coded chart definitions
 * at dbd7ae58be996e6eb5a1b01582ab73f46fb388af (before the database-backed chart migration).
 *
 * Keep this fixture hand-authored and independent of defaults.json. If the
 * canonical seed changes, this oracle must fail before anyone can silently
 * change a bundled chart's established visual contract.
 */
export const LEGACY_BUNDLED_CHART_BASELINE_REVISION =
  'dbd7ae58be996e6eb5a1b01582ab73f46fb388af';
export const CURRENT_BUNDLED_BASELINE_REVISION = 5;

export type LegacyBundledChartContract = {
  source: string;
  renderer:
    | 'rich-time-series'
    | 'daily-charge-sessions'
    | 'daily-energy-bars'
    | 'efficiency-pill-bars'
    | 'phantom-drain'
    | 'tire-pressure-timeline';
  x: `${'time' | 'number' | 'category'}:${string}`;
  series: string[];
  axes: { yUnit: string; yDomain: string; y2Unit?: string };
  display: { legend: 'auto' | 'hide'; smoothness: 'gentle' | 'straight'; connectGaps: boolean };
  emptyTitle: string;
};

export const LEGACY_BUNDLED_CHART_CONTRACTS: Readonly<Record<string, LegacyBundledChartContract>> = {
  'battery-capacity-mileage': { source: 'battery_capacity_mileage', renderer: 'rich-time-series', x: 'time:timestamp', series: ['usable_kwh|Usable Capacity|line|fill|y|accent', 'odometer_miles|Mileage|line|no-fill|y2|emerald'], axes: { yUnit: 'kWh', yDomain: 'auto', y2Unit: 'mi' }, display: { legend: 'auto', smoothness: 'gentle', connectGaps: true }, emptyTitle: 'No battery capacity mileage data recorded yet' },
  'battery-degradation': { source: 'battery_degradation', renderer: 'rich-time-series', x: 'time:timestamp', series: ['capacity_pct|Battery Health|line|no-fill|y|accent'], axes: { yUnit: '%', yDomain: 'fixed:80:100' }, display: { legend: 'hide', smoothness: 'gentle', connectGaps: false }, emptyTitle: 'No battery health history recorded yet' },
  'charge-level': { source: 'soc_history', renderer: 'rich-time-series', x: 'time:timestamp', series: ['battery_level|State of Charge|step|fill|y|accent'], axes: { yUnit: '%', yDomain: 'fixed:0:100' }, display: { legend: 'hide', smoothness: 'gentle', connectGaps: false }, emptyTitle: 'No charge level data for this period' },
  'charging-curve-analysis': { source: 'charging_curve_analysis', renderer: 'rich-time-series', x: 'number:soc_pct', series: ['power_kw|Verified DC sessions|scatter|no-fill|y|accent'], axes: { yUnit: 'kW', yDomain: 'auto' }, display: { legend: 'hide', smoothness: 'straight', connectGaps: false }, emptyTitle: 'No charging curve history is available for this period' },
  'charging-sessions-energy': { source: 'charging_sessions_energy', renderer: 'daily-charge-sessions', x: 'time:day_start', series: ['total_energy_kwh|Energy Charged|bar|no-fill|y|accent'], axes: { yUnit: 'kWh', yDomain: 'auto:includeZero' }, display: { legend: 'hide', smoothness: 'straight', connectGaps: false }, emptyTitle: 'No charging sessions for this period' },
  'charging-weekly-energy': { source: 'charging_weekly_energy', renderer: 'daily-energy-bars', x: 'time:day_start', series: ['total_energy_kwh|Energy Charged|bar|no-fill|y|accent'], axes: { yUnit: 'kWh', yDomain: 'auto:includeZero' }, display: { legend: 'hide', smoothness: 'straight', connectGaps: false }, emptyTitle: 'No charging energy for this period' },
  'efficiency-mode': { source: 'efficiency_mode', renderer: 'efficiency-pill-bars', x: 'category:drive_mode', series: ['avg_efficiency_wh_mi|Efficiency|bar|no-fill|y|accent'], axes: { yUnit: 'Wh/mi', yDomain: 'auto:includeZero' }, display: { legend: 'hide', smoothness: 'straight', connectGaps: false }, emptyTitle: 'No drive mode efficiency data for this period' },
  'efficiency-tags': { source: 'efficiency_tags', renderer: 'efficiency-pill-bars', x: 'category:tag_name', series: ['avg_efficiency_wh_mi|Efficiency|bar|no-fill|y|accent'], axes: { yUnit: 'Wh/mi', yDomain: 'auto:includeZero' }, display: { legend: 'hide', smoothness: 'straight', connectGaps: false }, emptyTitle: 'No tagged trip efficiency data for this period' },
  'efficiency-temperature': { source: 'efficiency_temperature', renderer: 'efficiency-pill-bars', x: 'number:temp_c_low', series: ['avg_efficiency_wh_mi|Efficiency|scatter|no-fill|y|accent'], axes: { yUnit: 'Wh/mi', yDomain: 'auto' }, display: { legend: 'hide', smoothness: 'straight', connectGaps: false }, emptyTitle: 'No outside-temperature telemetry is available for this range yet' },
  'efficiency-trend': { source: 'efficiency_trend', renderer: 'rich-time-series', x: 'time:timestamp', series: ['trip_efficiency_wh_mi|Trip efficiency|scatter|no-fill|y|accent', 'rolling_24h_wh_mi|24-hour avg|line|no-fill|y|emerald'], axes: { yUnit: 'Wh/mi', yDomain: 'auto' }, display: { legend: 'auto', smoothness: 'gentle', connectGaps: false }, emptyTitle: 'No efficiency data for this period' },
  'phantom-drain': { source: 'phantom_drain', renderer: 'phantom-drain', x: 'time:day_start', series: ['soc_lost_pct|SoC Lost|bar|no-fill|y|accent'], axes: { yUnit: '% SoC lost', yDomain: 'auto:includeZero' }, display: { legend: 'hide', smoothness: 'straight', connectGaps: false }, emptyTitle: 'No phantom drain data for this period' },
  'projected-range-mileage': { source: 'projected_range_mileage', renderer: 'rich-time-series', x: 'time:timestamp', series: ['projected_max_range_mi|Projected Max Range|line|fill|y|amber', 'odometer_miles|Mileage|line|no-fill|y2|emerald'], axes: { yUnit: 'mi', yDomain: 'auto', y2Unit: 'mi' }, display: { legend: 'auto', smoothness: 'gentle', connectGaps: true }, emptyTitle: 'No projected range mileage data recorded yet' },
  'soc-history': { source: 'soc_history', renderer: 'rich-time-series', x: 'time:timestamp', series: ['battery_level|State of Charge|step|fill|y|accent'], axes: { yUnit: '%', yDomain: 'fixed:0:100' }, display: { legend: 'hide', smoothness: 'gentle', connectGaps: false }, emptyTitle: 'No state of charge history for this period' },
  'tire-pressure-trips': { source: 'tire_pressure_trips', renderer: 'tire-pressure-timeline', x: 'time:timestamp', series: ['front_left_psi|Front left|line|no-fill|y|accent', 'front_right_psi|Front right|line|no-fill|y|sky', 'rear_left_psi|Rear left|line|no-fill|y|emerald', 'rear_right_psi|Rear right|line|no-fill|y|amber'], axes: { yUnit: 'psi', yDomain: 'auto' }, display: { legend: 'auto', smoothness: 'gentle', connectGaps: false }, emptyTitle: 'No tire pressure or trip data for this period' },
};
