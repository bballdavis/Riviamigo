import type { DateRange } from './api';

export type BoundedPresetKey = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d' | '1y';
export type PresetKey = BoundedPresetKey | 'lifetime';

export type DashboardTimeframe =
  | { kind: 'preset'; preset: BoundedPresetKey }
  | { kind: 'custom'; from: Date; to: Date }
  | { kind: 'lifetime' };

export type TimeframeScope = 'range' | 'current' | 'lifetime';
