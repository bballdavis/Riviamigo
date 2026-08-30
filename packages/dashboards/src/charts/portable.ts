import { ChartRecordSchema, PortableChartDocumentSchema } from './schema';
import type { ChartDefinitionV1, ChartRecord, PortableChartDocument } from '@riviamigo/types';

export const CHART_EXPORT_KIND = 'riviamigo-chart' as const;
export const CHART_EXPORT_VERSION = 1 as const;
export const MAX_CHART_EXPORT_BYTES = 256 * 1024;

function portableChartDocument(record: ChartRecord): PortableChartDocument {
  return {
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
}

export function exportChartJson(record: ChartRecord): string {
  return JSON.stringify(portableChartDocument(record), null, 2);
}

export function parseChartJson(text: string): PortableChartDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_CHART_EXPORT_BYTES) {
    throw new Error('Chart export exceeds the 256 KiB portable file limit');
  }
  const parsed = PortableChartDocumentSchema.parse(JSON.parse(text));
  const chart: PortableChartDocument['chart'] = {
    slug: parsed.chart.slug,
    name: parsed.chart.name,
    enabled: parsed.chart.enabled,
    definition: parsed.chart.definition as unknown as ChartDefinitionV1,
  };
  if (parsed.chart.description !== undefined) chart.description = parsed.chart.description;
  return { kind: parsed.kind, version: parsed.version, chart };
}

export function importChartJson(text: string): Omit<ChartRecord, 'id' | 'ownerId' | 'baselineRevision'> {
  const document = parseChartJson(text);
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

export function downloadChartJson(record: ChartRecord) {
  const blob = new Blob([exportChartJson(record)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${record.slug}.riviamigo-chart.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
