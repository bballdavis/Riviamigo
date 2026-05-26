export function formatDriveMode(value: string) {
  const labels: Record<string, string> = {
    everyday: 'All-Purpose',
    all_purpose: 'All-Purpose',
    sport: 'Sport',
    distance: 'Conserve',
    conserve: 'Conserve',
    winter: 'Snow',
    snow: 'Snow',
    off_road_auto: 'All-Terrain',
    all_terrain: 'All-Terrain',
    off_road_sand: 'Soft Sand',
    soft_sand: 'Soft Sand',
    off_road_rocks: 'Rock Crawl',
    rock_crawl: 'Rock Crawl',
    off_road_sport_auto: 'Rally',
    rally: 'Rally',
    off_road_sport_drift: 'Drift',
    drift: 'Drift',
    towing: 'Towing',
  };
  const normalized = normalizeDriveModeValue(value);
  return labels[normalized] ?? normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getDriveModeBadgeClass(value: string) {
  const normalized = normalizeDriveModeValue(value);
  if (normalized === 'unknown') return 'bg-dm-unknown/10 text-dm-unknown border border-dm-unknown/20';
  // Snow — neutral white-ish; use fg/border tokens to stay theme-safe
  if (normalized === 'winter' || normalized === 'snow') return 'bg-bg-elevated text-fg border border-border-strong';
  if (normalized === 'sport') return 'bg-accent-muted text-accent border border-accent/20';
  if (normalized === 'everyday' || normalized === 'all_purpose') return 'bg-dm-everyday/10 text-dm-everyday border border-dm-everyday/20';
  if (normalized === 'conserve' || normalized === 'distance') return 'bg-dm-conserve/10 text-dm-conserve border border-dm-conserve/20';
  if (normalized === 'off_road_auto' || normalized === 'all_terrain') return 'bg-dm-terrain/10 text-dm-terrain border border-dm-terrain/20';
  if (normalized === 'soft_sand' || normalized === 'off_road_sand') return 'bg-dm-sand/10 text-dm-sand border border-dm-sand/20';
  if (normalized === 'rock_crawl' || normalized === 'off_road_rocks') return 'bg-dm-rock/10 text-dm-rock border border-dm-rock/20';
  if (normalized === 'rally' || normalized === 'off_road_sport_auto') return 'bg-dm-rally/10 text-dm-rally border border-dm-rally/20';
  if (normalized === 'drift' || normalized === 'off_road_sport_drift') return 'bg-dm-drift/10 text-dm-drift border border-dm-drift/20';
  if (normalized === 'towing') return 'bg-dm-towing/10 text-dm-towing border border-dm-towing/20';
  return 'bg-bg-elevated text-fg-secondary border border-border';
}

function normalizeDriveModeValue(value: string) {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

  const aliases: Record<string, string> = {
    allpurpose: 'all_purpose',
    allterrain: 'all_terrain',
    softsand: 'soft_sand',
    rockcrawl: 'rock_crawl',
    offroadauto: 'off_road_auto',
    offroadsand: 'off_road_sand',
    offroadrocks: 'off_road_rocks',
    offroadsportauto: 'off_road_sport_auto',
    offroadsportdrift: 'off_road_sport_drift',
  };

  return aliases[normalized] ?? normalized;
}
