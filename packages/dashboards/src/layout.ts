import { DashboardConfigSchema } from './schema';
import type { DashboardConfig, WidgetInstance, WidgetLayout } from './schema';
import { getWidgetEditorMeta, getWidgetForInstance } from './registry';

const COLS = 12;

export function sanitizeDashboardConfig(input: DashboardConfig): DashboardConfig {
  const parsed = DashboardConfigSchema.parse(input);
  return {
    ...parsed,
    widgets: parsed.widgets.map(sanitizeWidgetInstance),
  };
}

export function sanitizeWidgetInstance(widget: WidgetInstance): WidgetInstance {
  const def = getWidgetForInstance(widget);
  const editor = getWidgetEditorMeta(def);
  const defaultSize = def?.defaultSize ?? { w: 3, h: 2 };
  const minSize = def?.minSize ?? { w: 1, h: 1 };
  const fixedSize = editor.fixedSize;
  const targetLayout = fixedSize
    ? { ...widget.layout, w: defaultSize.w, h: defaultSize.h }
    : widget.layout;
  const maxSize = fixedSize ? defaultSize : editor.maxSize;

  return {
    ...widget,
    layout: sanitizeWidgetLayout(
      targetLayout,
      maxSize ? { minSize, maxSize, fixedSize } : { minSize, fixedSize },
    ),
  };
}

export function sanitizeWidgetLayout(
  layout: WidgetLayout,
  options: {
    minSize?: Pick<WidgetLayout, 'w' | 'h'>;
    maxSize?: Pick<WidgetLayout, 'w' | 'h'>;
    fixedSize?: boolean;
  } = {},
): WidgetLayout {
  const minW = options.fixedSize ? layout.w : options.minSize?.w ?? 1;
  const minH = options.fixedSize ? layout.h : options.minSize?.h ?? 1;
  const maxW = options.fixedSize ? layout.w : options.maxSize?.w ?? COLS;
  const maxH = options.fixedSize ? layout.h : options.maxSize?.h ?? Number.MAX_SAFE_INTEGER;
  const w = clampInt(layout.w, minW, Math.min(maxW, COLS));
  const h = clampInt(layout.h, minH, maxH);
  const x = clampInt(layout.x, 0, Math.max(0, COLS - w));
  const y = Math.max(0, Math.round(Number.isFinite(layout.y) ? layout.y : 0));

  return { x, y, w, h };
}

function clampInt(value: number, min: number, max: number) {
  const rounded = Math.round(Number.isFinite(value) ? value : min);
  return Math.min(max, Math.max(min, rounded));
}
