import React, { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useMetricCatalog } from '@riviamigo/hooks';
import { CHART_COLOR_OPTIONS, getChartColor, type ChartColorKey } from '@riviamigo/ui/charts';
import { getWidgetForInstance } from '../registry';
import type { WidgetInstance } from '../schema';
import { getChartDefinitions, type DashboardChartPage } from '../charts/catalog';
import { SENSOR_DEFINITIONS } from '../widgets/sensor/sensorDefinitions';
import { IconPicker } from './IconPicker';
import { resolveIconId } from './iconMigration';

const DEFAULT_CURVE_SMOOTHING = 0.45;
const MIN_CURVE_SMOOTHING = 0.05;
const DEFAULT_WINDOW_DAYS = 30;

/** Drawer background color — matches EditorDrawer's --rm-bg. Fields stack on top. */
const FIELD_BG = 'bg-bg-elevated';
const SECTION_BG = 'bg-white/[0.03]';

interface WidgetEditFormProps {
  widget: WidgetInstance;
  onChange: (next: WidgetInstance) => void;
  onClose: () => void;
}

export function WidgetEditForm({ widget, onChange, onClose }: WidgetEditFormProps) {
  const def = getWidgetForInstance(widget);
  const { data: catalog = [] } = useMetricCatalog();

  const sensorMode = widget.componentType === 'sensor';
  const chartMode = widget.componentType === 'chart';
  const customMode = widget.componentType === 'custom';

  const options = (widget.options ?? {}) as Record<string, unknown>;
  const title = widget.title ?? '';
  const metric = typeof options.metric === 'string' ? options.metric : 'total_miles';
  const chartType = typeof options.chartType === 'string' ? options.chartType : 'line';
  const curveColor = isChartColorKey(options.curveColor) ? options.curveColor : 'accent';
  const curveSmoothing = normalizeCurveSmoothing(options.curveSmoothing, chartType);
  const curveSmoothingSupported = supportsCurveSmoothing(chartType);
  const curveSmoothingOn = curveSmoothingSupported && curveSmoothing > 0;
  const valueSize = typeof options.valueSize === 'string' ? options.valueSize : 'md';
  const valueMode = typeof options.valueMode === 'string' ? options.valueMode : 'latest';
  const iconId = resolveIconId(typeof options.icon === 'string' ? options.icon : undefined);
  const showSprite = options.showSprite !== false;
  const accentBorder = options.accentBorder === true;
  const showSubtitle = options.showSubtitle === true;
  const subtitle = typeof options.subtitle === 'string' ? options.subtitle : '';
  const windowDays =
    typeof options.windowDays === 'number' && Number.isFinite(options.windowDays)
      ? Math.max(1, Math.min(365, Math.round(options.windowDays)))
      : DEFAULT_WINDOW_DAYS;

  const chartPage = isDashboardChartPage(options.page) ? options.page : undefined;
  const chartDefinitions = getChartDefinitions(chartPage);
  const configuredChartIds = Array.isArray(options.chartIds)
    ? options.chartIds.filter(
        (id): id is string =>
          typeof id === 'string' && chartDefinitions.some((d) => d.id === id)
      )
    : [];
  const selectedChartIds =
    configuredChartIds.length > 0 ? configuredChartIds : chartDefinitions.map((d) => d.id);
  const selectedChartIdSet = new Set(selectedChartIds);
  const selectedChartId =
    typeof options.chartId === 'string' && selectedChartIdSet.has(options.chartId)
      ? options.chartId
      : selectedChartIds[0] ?? chartDefinitions[0]?.id ?? '';
  const showPicker = options.showPicker !== false;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedText, setAdvancedText] = useState(() => JSON.stringify(options, null, 2));
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  const formId = useMemo(() => widget.id, [widget.id]);
  useEffect(() => {
    setAdvancedText(JSON.stringify(options, null, 2));
    setAdvancedError(null);
  }, [formId]);

  useEffect(() => {
    if (!advancedOpen) {
      setAdvancedText(JSON.stringify(options, null, 2));
      setAdvancedError(null);
    }
  }, [advancedOpen, options]);

  function patch(patchOptions: Record<string, unknown>) {
    onChange({ ...widget, options: { ...options, ...patchOptions } });
  }

  function patchTitle(next: string) {
    onChange({ ...widget, title: next.trim() ? next : undefined });
  }

  function applyAdvanced() {
    try {
      const parsed = JSON.parse(advancedText || '{}') as Record<string, unknown>;
      onChange({ ...widget, options: parsed });
      setAdvancedError(null);
    } catch (error) {
      setAdvancedError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  }

  function handleChartTypeChange(nextType: string) {
    patch({
      chartType: nextType,
      curveSmoothing: supportsCurveSmoothing(nextType)
        ? supportsCurveSmoothing(chartType)
          ? curveSmoothing
          : DEFAULT_CURVE_SMOOTHING
        : 0,
    });
  }

  function toggleChartDefinition(id: string) {
    const nextIds = selectedChartIdSet.has(id)
      ? selectedChartIds.filter((cid) => cid !== id)
      : [...selectedChartIds, id];
    const safeIds = nextIds.length > 0 ? nextIds : [id];
    patch({
      chartIds: safeIds,
      chartId: safeIds.includes(selectedChartId) ? selectedChartId : safeIds[0],
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
            Editing
          </p>
          <h2 className="truncate text-sm font-semibold text-fg">
            {def?.title ?? `${widget.componentType}/${widget.definitionId}`}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Done"
          className="flex shrink-0 items-center justify-center rounded-lg border border-accent/60 bg-accent/15 p-2 text-accent transition-colors hover:bg-accent/25"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <Section title="Identity">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => patchTitle(e.target.value)}
              placeholder={def?.title ?? ''}
              className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
            />
          </Field>
          {sensorMode ? (
            <Field label="Icon">
              <IconPicker value={iconId} onChange={(next) => patch({ icon: next })} />
            </Field>
          ) : null}
          {sensorMode ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Value size">
                <select
                  value={valueSize}
                  onChange={(e) => patch({ valueSize: e.target.value })}
                  className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
                >
                  <option value="sm">Small</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
              </Field>
              <ToggleSwitch
                label="Show subtitle"
                checked={showSubtitle}
                onChange={(c) => patch({ showSubtitle: c })}
              />
            </div>
          ) : null}
          {sensorMode && showSubtitle ? (
            <Field label="Subtitle">
              <input
                value={subtitle}
                onChange={(e) => patch({ subtitle: e.target.value })}
                className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
              />
            </Field>
          ) : null}
        </Section>

        {sensorMode ? (
          <Section title="Sensor">
            <Field label="Metric">
              <select
                value={metric}
                onChange={(e) => patch({ metric: e.target.value })}
                className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
              >
                {catalog.length > 0
                  ? catalog.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))
                  : SENSOR_DEFINITIONS.map((entry) => (
                      <option key={entry.id} value={entry.metric}>
                        {entry.title}
                      </option>
                    ))}
              </select>
            </Field>
            <Field label="Aggregation">
              <select
                value={valueMode}
                onChange={(e) => patch({ valueMode: e.target.value })}
                className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
              >
                <option value="latest">Latest</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="count">Count</option>
              </select>
            </Field>
          </Section>
        ) : null}

        {sensorMode ? (
          <Section title="Background Graph">
            <ToggleSwitch
              label="Enable background graph"
              checked={showSprite}
              onChange={(c) => patch({ showSprite: c })}
            />
            {showSprite ? (
              <div className="grid gap-2">
                <Field label="Graph type">
                  <select
                    value={chartType}
                    onChange={(e) => handleChartTypeChange(e.target.value)}
                    className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
                  >
                    <option value="none">None</option>
                    <option value="line">Line</option>
                    <option value="area">Area</option>
                    <option value="bar">Bar</option>
                    <option value="daily_delta">Daily delta (per-day change)</option>
                  </select>
                </Field>
                {chartType === 'daily_delta' ? (
                  <Field label={`Show last ${windowDays} day${windowDays === 1 ? '' : 's'}`}>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={windowDays}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (Number.isFinite(next)) {
                          patch({ windowDays: Math.max(1, Math.min(365, Math.round(next))) });
                        }
                      }}
                      className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
                    />
                  </Field>
                ) : null}
                {curveSmoothingSupported ? (
                    <ToggleSwitch
                    label="Smooth curves"
                    checked={curveSmoothingOn}
                    onChange={(checked) =>
                      patch({
                        curveSmoothing: checked
                          ? curveSmoothing > 0
                            ? curveSmoothing
                            : MIN_CURVE_SMOOTHING
                          : 0,
                      })
                    }
                  />
                ) : null}
                {curveSmoothingOn ? (
                  <Field label={`Curve smoothing - ${Math.round(curveSmoothing * 100)}%`}>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={curveSmoothing}
                      onChange={(e) => patch({ curveSmoothing: Number(e.target.value) })}
                      className="rm-accent-range w-full"
                    />
                  </Field>
                ) : null}
                <Field label="Color">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-4 w-4 shrink-0 rounded border border-border"
                      style={{ backgroundColor: getChartColor(curveColor) }}
                    />
                    <select
                      value={curveColor}
                      onChange={(e) => patch({ curveColor: e.target.value })}
                      className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
                    >
                      {CHART_COLOR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
              </div>
            ) : null}
          </Section>
        ) : null}

        {sensorMode ? (
          <Section title="Appearance">
            <ToggleSwitch
              label="Orange accent border"
              checked={accentBorder}
              onChange={(c) => patch({ accentBorder: c })}
            />
          </Section>
        ) : null}

        {chartMode ? (
          <Section title="Chart">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Group">
                <select
                  value={chartPage ?? ''}
                  onChange={(e) =>
                    patch({ page: e.target.value || undefined, chartIds: undefined })
                  }
                  className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
                >
                  <option value="">All charts</option>
                  <option value="overview">Overview</option>
                  <option value="battery">Battery</option>
                  <option value="charging">Charging</option>
                  <option value="efficiency">Efficiency</option>
                  <option value="trips">Trips</option>
                </select>
              </Field>
              <Field label="Default chart">
                <select
                  value={selectedChartId}
                  onChange={(e) => patch({ chartId: e.target.value })}
                  className={`w-full rounded-lg border border-border ${FIELD_BG} px-3 py-2 text-sm text-fg outline-none focus:border-accent`}
                >
                  {chartDefinitions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <ToggleSwitch
              label="Show chart dropdown inside widget"
              checked={showPicker}
              onChange={(c) => patch({ showPicker: c })}
            />
            <div className={`rounded-lg border border-border ${FIELD_BG} p-2`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-fg-secondary">Available charts</span>
                <span className="text-[10px] text-fg-tertiary">
                  {selectedChartIds.length} selected
                </span>
              </div>
              <div className="grid max-h-44 gap-1 overflow-y-auto pr-1">
                {chartDefinitions.map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 text-xs text-fg-secondary hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChartIdSet.has(d.id)}
                      onChange={() => toggleChartDefinition(d.id)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--rm-accent)]"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium text-fg">{d.title}</span>
                      {d.description ? (
                        <span className="text-[11px] text-fg-tertiary">{d.description}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </Section>
        ) : null}

        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          className={`rounded-lg border border-border ${FIELD_BG}`}
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-fg-tertiary hover:text-fg-secondary">
            {customMode ? 'Custom Config (JSON)' : 'Advanced (raw JSON)'}
          </summary>
          <div className="grid gap-2 p-3 pt-0">
            <textarea
              value={advancedText}
              onChange={(e) => setAdvancedText(e.target.value)}
              rows={customMode ? 14 : 8}
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
            />
            {advancedError ? <p className="text-xs text-red-400">{advancedError}</p> : null}
            <button
              type="button"
              onClick={applyAdvanced}
              className="self-end rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
            >
              Apply JSON
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`grid gap-2 rounded-xl border border-border ${SECTION_BG} p-3`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">{title}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-fg-secondary">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
        checked
          ? 'border-accent/50 bg-accent/10 text-fg'
          : 'border-border bg-transparent text-fg-secondary hover:border-border-strong hover:text-fg'
      }`}
    >
      <span>{label}</span>
      {/* Pill track */}
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-all duration-150 ${
          checked
            ? 'border-accent bg-accent shadow-[0_0_0_1px_var(--rm-accent)]'
            : 'border-border-strong bg-bg-elevated'
        }`}
      >
        {/* Thumb */}
        <span
          className={`h-4 w-4 rounded-full border bg-white shadow-sm ${
            checked ? 'border-accent' : 'border-border-strong'
          }`}
          style={{ transition: 'transform 150ms', transform: checked ? 'translateX(20px)' : 'translateX(0px)' }}
        />
      </span>
    </button>
  );
}

/* ── Helpers ── */

function isDashboardChartPage(value: unknown): value is DashboardChartPage {
  return (
    value === 'overview' ||
    value === 'battery' ||
    value === 'charging' ||
    value === 'efficiency' ||
    value === 'trips'
  );
}

function isChartColorKey(value: unknown): value is ChartColorKey {
  return typeof value === 'string' && CHART_COLOR_OPTIONS.some((opt) => opt.value === value);
}

function supportsCurveSmoothing(chartType: string) {
  return chartType === 'line' || chartType === 'area';
}

function normalizeCurveSmoothing(value: unknown, chartType: string) {
  const fallback = supportsCurveSmoothing(chartType) ? DEFAULT_CURVE_SMOOTHING : 0;
  if (typeof value === 'boolean') return value ? fallback : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  return fallback;
}
