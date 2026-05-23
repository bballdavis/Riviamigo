import { DashboardConfigSchema } from '../schema';
import type { DashboardConfig } from '../schema';
import dashboardJson from './dashboard.json';
import batteryJson from './battery.json';
import efficiencyJson from './efficiency.json';
import chargingJson from './charging.json';
import tripsJson from './trips.json';
import healthJson from './health.json';

function parse(raw: unknown): DashboardConfig {
  return DashboardConfigSchema.parse(raw);
}

export const DEFAULT_DASHBOARDS: DashboardConfig[] = [
  parse(dashboardJson),
  parse(batteryJson),
  parse(efficiencyJson),
  parse(chargingJson),
  parse(tripsJson),
  parse(healthJson),
];

export function getDefaultBySlug(slug: string): DashboardConfig | undefined {
  return DEFAULT_DASHBOARDS.find((d) => d.slug === slug);
}
