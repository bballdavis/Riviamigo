import * as React from 'react';
import { cn } from '../lib/utils';

export interface AssistantWaveProps {
  /** What is loading, for screen readers. */
  label?: string;
  /**
   * `md` for picture-sized spots (40px tall, bold line); `sm` for small chips
   * and map markers (24px tall, finer line). Override the height or width
   * with `className` to fit the spot; the line keeps its weight either way.
   */
  size?: 'sm' | 'md';
  className?: string;
}

// Small spots are narrow, so they get fewer, longer ripples to stay readable.
const SIZES = {
  sm: { box: 'h-6', line: 2.5, glow: 6, wavelength: 110 },
  md: { box: 'h-10', line: 4, glow: 10, wavelength: 46 },
} as const;

const WIDTH = 400;
const HEIGHT = 40;
const BASELINE = HEIGHT / 2;
const POINTS = 120;
/** Peak height of the centre wave, in viewBox units. */
const AMPLITUDE = 15;
/** Radians per millisecond: how fast ripples travel out from the centre. */
const SPEED = 0.0075;
/** Rounds the meeting point of the two ripple trains, in viewBox units. */
const CENTRE_SOFTENING = 12;
/** How long the wave takes to grow from flat when it first appears. */
const GROW_MS = 450;

// Teal at the flat edges to gold at the tall centre, like the in-car assistant.
const GRADIENT_STOPS = [
  { offset: '0%', color: 'var(--rm-chart-teal)' },
  { offset: '28%', color: 'var(--rm-chart-emerald)' },
  { offset: '44%', color: 'var(--rm-chart-yellow)' },
  { offset: '50%', color: 'var(--rm-accent)' },
  { offset: '56%', color: 'var(--rm-chart-yellow)' },
  { offset: '72%', color: 'var(--rm-chart-emerald)' },
  { offset: '100%', color: 'var(--rm-chart-teal)' },
];

/**
 * Builds the waveform at a moment in time: ripples travel outward from the
 * centre, tallest in the middle and fading to a flat line at both edges.
 */
export function assistantWavePath(timeMs: number, grow = 1, wavelength: number = SIZES.md.wavelength): string {
  const waveNumber = (Math.PI * 2) / wavelength;
  const centre = WIDTH / 2;
  let path = '';
  for (let index = 0; index <= POINTS; index += 1) {
    const x = (index / POINTS) * WIDTH;
    const distance = Math.abs(x - centre) / centre; // 0 at the centre, 1 at the edges
    const envelope = Math.exp(-((distance / 0.42) ** 2)); // tall middle, flat edges
    // A softened |x - centre| keeps the centre rounded instead of pinched
    // where the ripples on either side meet.
    const radius = Math.hypot(x - centre, CENTRE_SOFTENING);
    const y = BASELINE - grow * AMPLITUDE * envelope
      * Math.sin(waveNumber * radius - SPEED * timeMs);
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(2)}`;
  }
  return path;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The sound wave Rivian's in-car assistant shows while it works, used as the
 * loading indicator for vehicle artwork. Ripples grow from the centre and
 * travel outward. It stays invisible for its first 250ms so quick loads never
 * flash it, and shows a still waveform when reduced motion is requested.
 */
export function AssistantWave({ label = 'Loading', size = 'md', className }: AssistantWaveProps) {
  const sizing = SIZES[size];
  const gradientId = `rm-assistant-wave-${React.useId().replace(/:/g, '')}`;
  const glowRef = React.useRef<SVGPathElement>(null);
  const lineRef = React.useRef<SVGPathElement>(null);
  const wavelength = sizing.wavelength;
  const stillPath = React.useMemo(() => assistantWavePath(0, 1, wavelength), [wavelength]);

  React.useEffect(() => {
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') return;
    let frame = 0;
    let start: number | null = null;
    const draw = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      const grow = Math.min(1, elapsed / GROW_MS);
      const path = assistantWavePath(elapsed, grow * (2 - grow), wavelength); // ease out
      glowRef.current?.setAttribute('d', path);
      lineRef.current?.setAttribute('d', path);
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [wavelength]);

  return (
    <div
      role="status"
      data-testid="assistant-wave"
      className={cn('relative w-full overflow-hidden animate-assistant-wave-in', sizing.box, className)}
    >
      <span className="sr-only">{label}</span>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2={WIDTH} y1="0" y2="0" gradientUnits="userSpaceOnUse">
            {GRADIENT_STOPS.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} style={{ stopColor: stop.color }} />
            ))}
          </linearGradient>
        </defs>
        <path
          ref={glowRef}
          d={stillPath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={sizing.glow}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.22}
          vectorEffect="non-scaling-stroke"
        />
        <path
          ref={lineRef}
          d={stillPath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={sizing.line}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
