import React from 'react';
import { useParkedEnergy } from '@riviamigo/hooks';
import type { ParkedEnergySample, ParkedEnergyWindow } from '@riviamigo/types';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@riviamigo/ui/primitives';
import { formatAppDateTime } from '@riviamigo/ui/lib/dateTime';

const WINDOWS: Array<{ value: ParkedEnergyWindow; label: string }> = [
  { value: 'since_parked', label: 'Since parked' },
  { value: '8h', label: '8 hours' },
  { value: '24h', label: '24 hours' },
];

const CATEGORIES = [
  { key: 'vehicle_systems_kwh', label: 'Vehicle systems', color: 'bg-accent' },
  { key: 'climate_kwh', label: 'Climate', color: 'bg-status-warning' },
  { key: 'gear_guard_kwh', label: 'Gear Guard', color: 'bg-status-positive' },
  { key: 'outlets_kwh', label: 'Outlets', color: 'bg-fg-tertiary' },
] as const;

export function ParkedEnergyPanel({
  vehicleId,
  from,
  to,
}: {
  vehicleId: string | null;
  from: string | null;
  to: string | null;
}) {
  const { data, isLoading } = useParkedEnergy(vehicleId, from, to);
  const samples = data?.samples ?? [];
  const preferred = chooseDefaultWindow(samples);
  const [window, setWindow] = React.useState<ParkedEnergyWindow>(preferred);

  React.useEffect(() => {
    if (!samples.some((sample) => sample.window === window)) setWindow(preferred);
  }, [preferred, samples, window]);

  const sample = samples.find((candidate) => candidate.window === window) ?? null;
  const categoryTotal = CATEGORIES.reduce(
    (sum, category) => sum + Math.max(0, sample?.[category.key] ?? 0),
    0,
  );

  return (
    <Card data-testid="parked-energy-panel">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Parked Energy</CardTitle>
            <Badge variant="accent">Rivian reported</Badge>
          </div>
          <p className="mt-1 text-xs text-fg-tertiary">
            Vehicle-reported energy use by system. This is separate from Riviamigo&apos;s battery-change estimate below.
          </p>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-bg-elevated p-1">
          {WINDOWS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setWindow(option.value)}
              disabled={!samples.some((candidate) => candidate.window === option.value)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-35 ${
                window === option.value
                  ? 'bg-accent text-fg-on-accent'
                  : 'text-fg-secondary hover:bg-bg-surface hover:text-fg'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : !sample ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-sm text-fg-secondary">
            Start the optional Parallax collector to populate Rivian&apos;s parked-energy breakdown.
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-3" data-testid="parked-energy-metrics">
              <Metric label="Energy used" value={formatEnergy(sample.total_kwh)} />
              <Metric label="Duration" value={formatDuration(sample.duration_minutes)} />
              <Metric label="Range impact" value={formatRange(sample.total_range_impact_km)} />
            </div>

            <div>
              <div className="flex h-4 overflow-hidden rounded-full bg-bg-elevated" aria-label="Parked energy category breakdown">
                {CATEGORIES.map((category) => {
                  const value = Math.max(0, sample[category.key] ?? 0);
                  const width = categoryTotal > 0 ? (value / categoryTotal) * 100 : 0;
                  return (
                    <div
                      key={category.key}
                      className={category.color}
                      style={{ width: `${width}%` }}
                      title={`${category.label}: ${formatEnergy(value)}`}
                    />
                  );
                })}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {CATEGORIES.map((category) => (
                  <div key={category.key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-fg-secondary">
                      <span className={`h-2.5 w-2.5 rounded-full ${category.color}`} />
                      {category.label}
                    </span>
                    <span className="font-medium text-fg">{formatEnergy(sample[category.key])}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-fg-tertiary">
              Updated {formatAppDateTime(sample.source_at)}
              {sample.parked_started_at ? ` · Parked since ${formatAppDateTime(sample.parked_started_at)}` : ''}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function chooseDefaultWindow(samples: ParkedEnergySample[]): ParkedEnergyWindow {
  const sinceParked = samples.find((sample) => sample.window === 'since_parked');
  if (
    sinceParked &&
    Date.now() - new Date(sinceParked.received_at).getTime() <= 6 * 60 * 60 * 1000
  ) {
    return 'since_parked';
  }
  if (samples.some((sample) => sample.window === '24h')) return '24h';
  return samples[0]?.window ?? 'since_parked';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/40 p-3">
      <p className="text-xs text-fg-tertiary">{label}</p>
      <p className="mt-1 text-xl font-semibold text-fg">{value}</p>
    </div>
  );
}

function formatEnergy(value: number | null) {
  return value == null ? '—' : `${value.toFixed(2)} kWh`;
}

function formatRange(value: number | null) {
  return value == null ? '—' : `${(value * 0.621371).toFixed(1)} mi`;
}

function formatDuration(value: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${value} min`;
  return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)} h`;
}
