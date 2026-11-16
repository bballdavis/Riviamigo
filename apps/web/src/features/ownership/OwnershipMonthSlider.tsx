/** The month slider on the chart's time axis: a native range input drawn as the Rivian mark. */
import { COST_TIMELINE_PLOT_INSET } from '@riviamigo/ui/charts';
import type { Ledger } from './model';
import { RivianMark } from './RivianMark';

/**
 * The month slider, laid on the chart's time axis: its track spans exactly
 * the plot area and the mark sits at the inspected month's instant, so it
 * lines up with the dashed cursor above. A native range input (in time
 * units, snapped to whole months) keeps keyboard and screen-reader support;
 * its thumb is invisible and the Rivian mark is drawn in its place.
 */
export function MonthSlider({
  ledger,
  value,
  onChange,
  valueText,
}: {
  ledger: Ledger;
  value: number;
  onChange: (value: number) => void;
  valueText: string;
}) {
  const last = Math.max(0, ledger.periods.length - 1);
  const span = Math.max(1, ledger.endMs - ledger.startMs);
  const at = ledger.periods[value]?.endMs ?? ledger.endMs;
  const share = Math.min(1, Math.max(0, (at - ledger.startMs) / span));
  const indexAt = (ms: number) => {
    const index = ledger.periods.findIndex((period) => period.endMs >= ms);
    return index === -1 ? last : index;
  };
  const step = (delta: number) => onChange(Math.min(last, Math.max(0, value + delta)));
  const half = SLIDER_THUMB_PX / 2;
  return (
    <div
      className="relative h-11"
      style={{ marginLeft: COST_TIMELINE_PLOT_INSET.left, marginRight: COST_TIMELINE_PLOT_INSET.right }}
    >
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
      {/* The input overhangs the track by half a thumb on each side, so the
          thumb's center travels exactly from the plot's left edge to its right. */}
      <input
        id="ownership-month-slider"
        type="range"
        min={ledger.startMs}
        max={ledger.endMs}
        step="any"
        value={at}
        onChange={(event) => onChange(indexAt(Number(event.target.value)))}
        onKeyDown={(event) => {
          const moves: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 };
          if (event.key in moves) step(moves[event.key] ?? 0);
          else if (event.key === 'Home') onChange(0);
          else if (event.key === 'End') onChange(last);
          else return;
          event.preventDefault();
        }}
        aria-valuetext={valueText}
        className={[
          'peer absolute top-0 h-full cursor-pointer appearance-none bg-transparent focus:outline-none',
          '[&::-webkit-slider-thumb]:h-10 [&::-webkit-slider-thumb]:w-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
          '[&::-moz-range-thumb]:h-10 [&::-moz-range-thumb]:w-10 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0',
        ].join(' ')}
        style={{ left: -half, width: `calc(100% + ${SLIDER_THUMB_PX}px)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
        style={{ left: `${share * 100}%` }}
      >
        {/* Just the mark; a halo in the page color keeps it clear of the filled track. */}
        <RivianMark className="h-10 w-10 [filter:drop-shadow(0_0_2px_var(--rm-bg-page))_drop-shadow(0_0_2px_var(--rm-bg-page))]" />
      </span>
    </div>
  );
}

/** Width of the slider's hit area, which the drawn mark is centered on. */
const SLIDER_THUMB_PX = 40;
