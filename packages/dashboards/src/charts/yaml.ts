import { parse, stringify } from 'yaml';
import { ChartRecordSchema, PortableChartDocumentSchema } from './schema';
import type { ChartDefinitionV1, ChartRecord, PortableChartDocument } from '@riviamigo/types';

export const CHART_EXPORT_KIND = 'riviamigo-chart' as const;
export const CHART_EXPORT_VERSION = 1 as const;
export const MAX_CHART_EXPORT_BYTES = 256 * 1024;

export function exportChartYaml(record: ChartRecord): string {
  const payload: PortableChartDocument = {
    kind: CHART_EXPORT_KIND,
    version: CHART_EXPORT_VERSION,
    chart: {
      slug: record.slug,
      name: record.name,
      ...(record.description ? { description: record.description } : {}),
      enabled: record.isEnabled,
      definition: record.config,
    },
  };
  return stringify(payload, { indent: 2, sortMapEntries: false });
}

export function parseChartYaml(text: string): PortableChartDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_CHART_EXPORT_BYTES) {
    throw new Error('Chart export exceeds the 256 KiB portable file limit');
  }
  const parsed = PortableChartDocumentSchema.parse(parse(text));
  const chart: PortableChartDocument['chart'] = {
    slug: parsed.chart.slug,
    name: parsed.chart.name,
    enabled: parsed.chart.enabled,
    definition: parsed.chart.definition as unknown as ChartDefinitionV1,
  };
  if (parsed.chart.description !== undefined) chart.description = parsed.chart.description;
  return { kind: parsed.kind, version: parsed.version, chart };
}

export function importChartYaml(text: string): Omit<ChartRecord, 'id' | 'ownerId' | 'baselineRevision'> {
  const document = parseChartYaml(text);
  const record = {
    id: '00000000-0000-0000-0000-000000000000',
    ownerId: null,
    slug: document.chart.slug,
    name: document.chart.name,
    ...(document.chart.description ? { description: document.chart.description } : {}),
    isDefault: false,
    isLocked: false,
    isEnabled: document.chart.enabled,
    config: document.chart.definition as unknown as ChartDefinitionV1,
  } satisfies ChartRecord;
  const parsed = ChartRecordSchema.parse(record);
  const draft: Omit<ChartRecord, 'id' | 'ownerId' | 'baselineRevision'> = {
    slug: parsed.slug,
    name: parsed.name,
    isDefault: parsed.isDefault,
    isLocked: parsed.isLocked,
    isEnabled: parsed.isEnabled,
    config: parsed.config as unknown as ChartDefinitionV1,
  };
  if (parsed.description !== undefined) draft.description = parsed.description;
  return draft;
}

export function downloadChartYaml(record: ChartRecord) {
  const blob = new Blob([exportChartYaml(record)], { type: 'application/yaml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${record.slug}.riviamigo-chart.yaml`;
  anchor.click();
  URL.revokeObjectURL(url);
}
