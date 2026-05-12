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
  if (normalized === 'unknown') return 'bg-slate-500/12 text-slate-500 border border-slate-500/20';
  if (normalized === 'winter' || normalized === 'snow') return 'bg-white/90 text-slate-700 border border-slate-300';
  if (normalized === 'sport') return 'bg-accent-muted text-accent border border-accent/20';
  if (normalized === 'everyday' || normalized === 'all_purpose') return 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20';
  if (normalized === 'conserve' || normalized === 'distance') return 'bg-sky-500/10 text-sky-500 border border-sky-500/20';
  if (normalized === 'off_road_auto' || normalized === 'all_terrain') return 'bg-cyan-500/10 text-cyan-500 border border-cyan-500/20';
  if (normalized === 'soft_sand' || normalized === 'off_road_sand') return 'bg-amber-500/10 text-amber-500 border border-amber-500/20';
  if (normalized === 'rock_crawl' || normalized === 'off_road_rocks') return 'bg-violet-500/10 text-violet-500 border border-violet-500/20';
  if (normalized === 'rally' || normalized === 'off_road_sport_auto') return 'bg-fuchsia-500/10 text-fuchsia-500 border border-fuchsia-500/20';
  if (normalized === 'drift' || normalized === 'off_road_sport_drift') return 'bg-rose-500/10 text-rose-500 border border-rose-500/20';
  if (normalized === 'towing') return 'bg-orange-500/10 text-orange-500 border border-orange-500/20';
  return 'bg-bg-elevated text-fg-secondary border border-border';
}

function normalizeDriveModeValue(value: string) {
  return value.toLowerCase().trim().replace(/[\s-]+/g, '_');
}
