import { parse, stringify } from 'yaml';
import { v4 as uuidv4 } from 'uuid';
import { DashboardConfigSchema, SCHEMA_VERSION } from './schema';
import { sanitizeDashboardConfig } from './layout';
import type { DashboardConfig, DashboardExport } from './schema';

const YAML_HEADER = `# Riviamigo dashboard v${SCHEMA_VERSION}\n`;

export function exportDashboardYaml(config: DashboardConfig): string {
  const payload: DashboardExport = {
    schemaVersion: config.schemaVersion,
    slug: config.slug,
    name: config.name,
    description: config.description,
    controls: config.controls,
    widgets: config.widgets,
  };
  return YAML_HEADER + stringify(payload, { indent: 2 });
}

export function downloadDashboardYaml(config: DashboardConfig) {
  const yaml = exportDashboardYaml(config);
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${config.slug}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse YAML text → DashboardConfig ready to POST (new id, no owner). */
export function importDashboardYaml(text: string): DashboardConfig {
  const raw = parse(text) as unknown;
  const partial = raw as DashboardExport;

  const config: DashboardConfig = {
    ...partial,
    id: uuidv4(),
    isDefault: false,
    isLocked: false,
    ownerId: null,
  };

  return sanitizeDashboardConfig(DashboardConfigSchema.parse(config));
}
