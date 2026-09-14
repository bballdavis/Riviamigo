import * as React from 'react';
import { Pipette } from 'lucide-react';
import type { ChartColorDefinition, ChartColorToken } from '@riviamigo/types';
import type { ThemeColorPair } from '@riviamigo/themes';
import { ColorPicker, type ColorPickerSwatch } from '../primitives/ColorPicker';
import { SelectPicker } from '../primitives/SelectPicker';
import { useThemeRuntime } from '../lib/themeRuntime';
import { cn } from '../lib/utils';
import { CHART_SERIES_TOKENS, getChartColor } from './ChartProvider';

const SEMANTIC_COLORS: Array<{ token: ChartColorToken; label: string }> = [
  { token: 'accent', label: 'Accent' },
  { token: 'success', label: 'Success' },
  { token: 'warning', label: 'Warning' },
  { token: 'danger', label: 'Danger' },
  { token: 'muted', label: 'Muted' },
  { token: 'emerald', label: 'Emerald' },
  { token: 'amber', label: 'Amber' },
  { token: 'sky', label: 'Sky' },
  { token: 'teal', label: 'Teal' },
  { token: 'violet', label: 'Violet' },
  { token: 'rose', label: 'Rose' },
  { token: 'indigo', label: 'Indigo' },
];

type SeriesColorToken = Extract<ChartColorToken, `series-${string}`>;

const seriesLabel = (index: number) => `Accent ${String(index + 1).padStart(2, '0')}`;

function seriesSwatch(token: SeriesColorToken) {
  return <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border border-border" style={{ backgroundColor: getChartColor(token) }} />;
}

const pickerSwatches: ColorPickerSwatch[] = CHART_SERIES_TOKENS.map((token, index) => ({
  id: token,
  label: seriesLabel(index),
  light: getChartColor(token),
  dark: getChartColor(token),
}));

const seriesOptions: Array<{
  value: SeriesColorToken | '';
  label: string;
  description?: string;
  leading?: React.ReactNode;
  disabled?: boolean;
}> = [
  { value: '', label: 'Choose a theme accent', disabled: true },
  ...CHART_SERIES_TOKENS.map((token, index) => ({
    value: token,
    label: seriesLabel(index),
    description: token,
    leading: seriesSwatch(token),
  })),
];

export interface ChartColorFieldProps {
  value: ChartColorDefinition;
  onChange: (value: ChartColorDefinition) => void;
  label?: string;
  className?: string;
  automatic?: {
    active: boolean;
    color: string;
    onSelect: () => void;
    label?: string;
  };
}

export function ChartColorField({ value, onChange, label = 'Color', className, automatic }: ChartColorFieldProps) {
  const runtime = useThemeRuntime();
  const isDark = runtime.effectiveMode === 'dark';
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const automaticActive = automatic?.active === true;
  const current = automaticActive
    ? automatic.color
    : value.mode === 'token'
      ? getChartColor(value.token)
      : isDark
        ? value.dark
        : value.light;
  const customPair: ThemeColorPair = value.mode === 'custom'
    ? { light: value.light, dark: value.dark }
    : runtime.chartColorPairs[value.token] ?? { light: concreteToken(value.token, runtime.chartColors.accent!), dark: concreteToken(value.token, runtime.chartColors.accent!) };

  return <div className={cn('grid gap-2', className)}>
    <span className="text-xs font-medium text-fg-secondary">{label}</span>
    <div className="grid gap-2 rounded-xl border border-border bg-bg-elevated/30 p-3">
      {automatic ? (
        <fieldset>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">Color source</legend>
          <div className="grid gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={automatic.active}
              aria-label={automatic.label ?? 'Automatic'}
              title="Use the metric color assigned by the active theme"
              onClick={automatic.onSelect}
              className={cn(
                'inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent',
                automatic.active ? 'border-accent bg-accent-muted text-fg' : 'border-border bg-bg-surface text-fg-secondary hover:border-border-strong',
              )}
            >
              <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: automatic.color }} />
              <span>{automatic.label ?? 'Automatic'}</span>
              <span className="text-[11px] text-fg-tertiary">Theme default</span>
            </button>
            <ThemeSeriesPicker value={value} onChange={onChange} automaticActive={automaticActive} />
          </div>
        </fieldset>
      ) : null}
      {!automatic ? <ThemeSeriesPicker value={value} onChange={onChange} /> : null}
      <fieldset>
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">Semantic and status</legend>
        <div className="flex flex-wrap gap-1.5">
          {SEMANTIC_COLORS.map(({ token, label: itemLabel }) => <button key={token} type="button" onClick={() => onChange({ mode: 'token', token })} className={cn('inline-flex min-h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent', !automaticActive && value.mode === 'token' && value.token === token ? 'border-accent bg-accent-muted text-fg' : 'border-border bg-bg-surface text-fg-secondary hover:border-border-strong')}><span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: getChartColor(token) }} />{itemLabel}</button>)}
        </div>
      </fieldset>
      <button type="button" onClick={() => setPickerOpen(true)} className={cn('flex min-h-10 items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent', !automaticActive && value.mode === 'custom' ? 'border-accent bg-accent-muted' : 'border-border bg-bg-surface hover:border-border-strong')}>
        <span className="inline-flex items-center gap-2 text-fg"><Pipette className="h-4 w-4" />Custom color</span>
        <span className="inline-flex items-center gap-2 font-mono text-xs text-fg-secondary"><span className="h-4 w-4 rounded border border-border" style={{ backgroundColor: current }} />{value.mode === 'custom' ? (isDark ? value.dark : value.light) : 'Open picker'}</span>
      </button>
    </div>
    <ColorPicker open={pickerOpen} value={customPair} onOpenChange={setPickerOpen} onApply={(pair) => onChange({ mode: 'custom', light: pair.light, dark: pair.dark })} title="Custom chart color" swatches={pickerSwatches} />
  </div>;
}

function ThemeSeriesPicker({ value, onChange, automaticActive = false }: Pick<ChartColorFieldProps, 'value' | 'onChange'> & { automaticActive?: boolean }) {
  const selectedSeries = !automaticActive && value.mode === 'token' && isSeriesColorToken(value.token) ? value.token : '';

  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">Theme accents</span>
      <SelectPicker<SeriesColorToken | ''>
        value={selectedSeries}
        onChange={(token) => {
          if (token) onChange({ mode: 'token', token });
        }}
        aria-label="Theme accent color"
        className="w-full"
        size="sm"
        options={seriesOptions}
      />
    </div>
  );
}

function isSeriesColorToken(value: ChartColorToken): value is SeriesColorToken {
  return value.startsWith('series-');
}

function concreteToken(token: ChartColorToken, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const variable = getChartColor(token).match(/^var\((--[^)]+)\)$/)?.[1];
  if (!variable) return fallback;
  const root = document.documentElement;
  return window.getComputedStyle(root).getPropertyValue(variable).trim() || fallback;
}
