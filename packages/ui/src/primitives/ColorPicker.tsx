import * as React from 'react';
import { ArrowLeftRight, Copy, Palette } from 'lucide-react';
import type { ThemeColorPair } from '@riviamigo/themes';
import { canonicalColor, contrastRatio, hexToRgb, hslToRgb, oklchToHex, rgbToHex, rgbToHsl, rgbToOklch } from '../lib/color';
import { cn } from '../lib/utils';
import { Button } from './Button';
import { ResponsiveDialog } from './ResponsiveDialog';

export interface ColorPickerSwatch { id: string; label: string; light: string; dark: string }
export interface ColorPickerProps {
  open: boolean;
  value: ThemeColorPair;
  onApply: (value: ThemeColorPair) => void;
  onOpenChange: (open: boolean) => void;
  title?: string;
  swatches?: readonly ColorPickerSwatch[];
  contrastBackground?: ThemeColorPair;
  minimumContrast?: number;
}

type ColorMode = 'light' | 'dark';
type InputFormat = 'hex' | 'rgb' | 'hsl' | 'oklch';

const DEFAULT_SWATCHES: ColorPickerSwatch[] = Array.from({ length: 16 }, (_, index) => {
  const slot = String(index + 1).padStart(2, '0');
  return { id: `series-${slot}`, label: `Series ${index + 1}`, light: `var(--rm-series-${slot})`, dark: `var(--rm-series-${slot})` };
});

function concrete(value: string) {
  const variable = /^var\((--[^)]+)\)$/.exec(value)?.[1];
  if (variable && typeof window !== 'undefined') {
    return canonicalColor(window.getComputedStyle(document.documentElement).getPropertyValue(variable).trim());
  }
  return canonicalColor(value);
}

export function ColorPicker({
  open,
  value,
  onApply,
  onOpenChange,
  title = 'Choose color',
  swatches = DEFAULT_SWATCHES,
  contrastBackground,
  minimumContrast = 3,
}: ColorPickerProps) {
  const titleId = React.useId();
  const [draft, setDraft] = React.useState<ThemeColorPair>(() => ({ light: canonicalColor(value.light), dark: canonicalColor(value.dark) }));
  const [mode, setMode] = React.useState<ColorMode>('dark');
  const [linked, setLinked] = React.useState(value.light === value.dark);
  const [format, setFormat] = React.useState<InputFormat>('hex');
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const next = { light: canonicalColor(value.light), dark: canonicalColor(value.dark) };
    setDraft(next);
    setLinked(next.light === next.dark);
    setError(null);
  }, [open, value.dark, value.light]);

  const active = draft[mode];
  const rgb = hexToRgb(active)!;
  const hsl = rgbToHsl(rgb);
  const oklch = rgbToOklch(rgb);

  React.useEffect(() => {
    const formatted = format === 'hex'
      ? active
      : format === 'rgb'
        ? `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`
        : format === 'hsl'
          ? `${hsl.h}, ${hsl.s}, ${hsl.l}`
          : `${oklch.l}, ${oklch.c}, ${oklch.h}`;
    setInput(formatted);
  }, [active, format, hsl.h, hsl.l, hsl.s, oklch.c, oklch.h, oklch.l, rgb.b, rgb.g, rgb.r]);

  if (!open) return null;

  const setColor = (next: string) => {
    const color = canonicalColor(next);
    setDraft((current) => linked ? { light: color, dark: color } : { ...current, [mode]: color });
    setError(null);
  };
  const setOklch = (patch: Partial<typeof oklch>) => setColor(oklchToHex({ ...oklch, ...patch }));
  const parseInput = () => {
    const numbers = input.split(/[\s,]+/).filter(Boolean).map(Number);
    let parsed: string | null = null;
    if (format === 'hex') parsed = /^#[0-9a-f]{3,6}$/i.test(input.trim()) ? canonicalColor(input) : null;
    if (format === 'rgb' && numbers.length === 3 && numbers.every(Number.isFinite)) parsed = rgbToHex({ r: numbers[0]!, g: numbers[1]!, b: numbers[2]! });
    if (format === 'hsl' && numbers.length === 3 && numbers.every(Number.isFinite)) parsed = rgbToHex(hslToRgb({ h: numbers[0]!, s: numbers[1]!, l: numbers[2]! }));
    if (format === 'oklch' && numbers.length === 3 && numbers.every(Number.isFinite)) parsed = oklchToHex({ l: numbers[0]!, c: numbers[1]!, h: numbers[2]! });
    if (!parsed) setError(`Enter a valid ${format.toUpperCase()} color.`); else setColor(parsed);
  };
  const background = contrastBackground ? concrete(contrastBackground[mode]) : null;
  const ratio = background ? contrastRatio(active, background) : null;

  return (
    <ResponsiveDialog titleId={titleId} onClose={() => onOpenChange(false)} className="sm:max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-fg">{title}</h2>
          <p className="mt-1 text-xs text-fg-tertiary">Pick from the theme, then tune perceptual lightness, chroma, and hue.</p>
        </div>
        <div className="flex rounded-lg border border-border bg-bg-elevated p-0.5" aria-label="Color mode">
          {(['light', 'dark'] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={cn('min-h-8 rounded-md px-3 text-xs font-medium capitalize', mode === item ? 'bg-bg-surface text-fg shadow-sm' : 'text-fg-secondary hover:text-fg')}>{item}</button>)}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="grid gap-5">
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-secondary">Theme colors</legend>
              <div role="radiogroup" aria-label="Theme colors" className="grid grid-cols-8 gap-2">
                {swatches.map((swatch, index) => {
                  const color = concrete(swatch[mode]);
                  const selected = color === active;
                  return <button key={swatch.id} type="button" role="radio" aria-checked={selected} aria-label={swatch.label} title={swatch.label} className={cn('aspect-square min-h-9 rounded-lg border outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page', selected ? 'border-fg ring-2 ring-accent' : 'border-border')} style={{ backgroundColor: color }} onClick={() => setColor(color)} onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? swatches.length - 1 : (index + direction + swatches.length) % swatches.length;
                    const nextButton = event.currentTarget.parentElement?.children[next] as HTMLElement | undefined;
                    setColor(concrete(swatches[next]![mode]));
                    nextButton?.focus();
                  }} />;
                })}
              </div>
            </fieldset>

            <fieldset className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-fg-secondary">OKLCH controls</legend>
              <ColorRange label="Lightness" value={oklch.l} min={0} max={100} step={0.1} onChange={(next) => setOklch({ l: next })} />
              <ColorRange label="Chroma" value={oklch.c} min={0} max={0.4} step={0.001} onChange={(next) => setOklch({ c: next })} />
              <ColorRange label="Hue" value={oklch.h} min={0} max={360} step={0.1} onChange={(next) => setOklch({ h: next })} />
            </fieldset>

            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                {(['hex', 'rgb', 'hsl', 'oklch'] as const).map((item) => <button key={item} type="button" onClick={() => setFormat(item)} className={cn('min-h-8 rounded-lg border px-3 text-xs font-medium uppercase', format === item ? 'border-accent bg-accent-muted text-fg' : 'border-border bg-bg-elevated text-fg-secondary hover:border-border-strong')}>{item}</button>)}
              </div>
              <div className="flex gap-2">
                <input aria-label={`${format.toUpperCase()} color`} value={input} onChange={(event) => setInput(event.target.value)} onBlur={parseInput} onKeyDown={(event) => { if (event.key === 'Enter') parseInput(); }} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated px-3 font-mono text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent sm:text-sm" />
                <Button type="button" variant="secondary" onClick={parseInput}>Set</Button>
              </div>
              {error ? <p className="text-xs text-status-danger" role="alert">{error}</p> : null}
            </div>
          </div>

          <aside className="grid content-start gap-3">
            <div className="grid min-h-40 place-items-center rounded-xl border border-border bg-bg-elevated p-4">
              <div className="h-24 w-24 rounded-2xl border border-border shadow-md" style={{ backgroundColor: active }} aria-label={`Preview ${active}`} />
            </div>
            <code className="rounded-lg bg-bg-elevated px-3 py-2 text-center text-sm text-fg">{active}</code>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 text-sm text-fg-secondary">
              Link light and dark
              <input type="checkbox" checked={linked} onChange={(event) => { setLinked(event.target.checked); if (event.target.checked) setDraft({ light: active, dark: active }); }} className="h-4 w-4 accent-[color:var(--rm-accent)]" />
            </label>
            {!linked ? <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant="secondary" iconLeft={<Copy className="h-3.5 w-3.5" />} onClick={() => setDraft((current) => ({ ...current, dark: current.light }))}>Light → dark</Button>
              <Button type="button" size="sm" variant="secondary" iconLeft={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => setDraft((current) => ({ ...current, light: current.dark }))}>Dark → light</Button>
            </div> : null}
            {ratio !== null ? <p className={cn('rounded-lg px-3 py-2 text-xs', ratio >= minimumContrast ? 'bg-status-positive/10 text-status-positive' : 'bg-status-warning/10 text-status-warning')} role="status">Contrast {ratio.toFixed(2)}:1 {ratio >= minimumContrast ? 'passes' : 'needs attention'}</p> : null}
          </aside>
        </div>
        <p className="sr-only" aria-live="polite">{mode} color {active}</p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-bg-elevated/40 px-4 py-3 sm:px-5">
        <span className="inline-flex items-center gap-2 text-xs text-fg-tertiary"><Palette className="h-4 w-4" /> Colors save as canonical sRGB hex.</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => { onApply(draft); onOpenChange(false); }}>Apply</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function ColorRange({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const id = React.useId();
  return <div className="grid grid-cols-[5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
    <label htmlFor={id} className="text-xs text-fg-secondary">{label}</label>
    <input id={id} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-[color:var(--rm-accent)]" />
    <input aria-label={`${label} value`} type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="h-9 rounded-lg border border-border bg-bg-surface px-2 text-right text-sm text-fg outline-none focus:border-accent" />
  </div>;
}
