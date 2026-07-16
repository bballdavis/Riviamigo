import { z } from 'zod';

export const LayoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1),
});

export const ComponentTypeSchema = z.enum(['custom', 'sensor', 'chart', 'battery', 'charging', 'table']);

export const DashboardVisibilityRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('vehicle-connection'),
    value: z.enum(['plugged', 'unplugged']),
  }),
]);

export const WidgetInstanceSchema = z.object({
  id: z.string().uuid(),
  componentType: ComponentTypeSchema,
  definitionId: z.string().min(1),
  title: z.string().optional(),
  layout: LayoutSchema,
  options: z.record(z.unknown()).optional(),
  visibility: z.array(DashboardVisibilityRuleSchema).optional(),
});

export const DashboardControlsSchema = z.object({
  dateRange: z.boolean(),
});

export const DashboardConfigSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  isDefault: z.boolean(),
  isLocked: z.boolean(),
  ownerId: z.string().uuid().nullable(),
  /** Whether the dashboard title exposes the page-level edit button. */
  showEditButton: z.boolean().optional(),
  controls: DashboardControlsSchema,
  widgets: z.array(WidgetInstanceSchema),
});

export type WidgetLayout = z.infer<typeof LayoutSchema>;
export type DashboardComponentType = z.infer<typeof ComponentTypeSchema>;
export type DashboardVisibilityRule = z.infer<typeof DashboardVisibilityRuleSchema>;
export type DashboardVisibilityRuleType = DashboardVisibilityRule['type'];
export type VehicleConnectionVisibilityValue = Extract<DashboardVisibilityRule, { type: 'vehicle-connection' }>['value'];
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;
export type DashboardControls = z.infer<typeof DashboardControlsSchema>;
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

/** Strip server-managed fields for export/import transfer. */
export type DashboardExport = Omit<DashboardConfig, 'id' | 'ownerId' | 'isDefault' | 'isLocked'>;

export const SCHEMA_VERSION = 2 as const;
