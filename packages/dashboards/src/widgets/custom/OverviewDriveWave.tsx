import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { formatSpeedParts, getUnitPreferences } from '@riviamigo/ui/lib/utils';
import type { VehicleStatus } from '@riviamigo/types';
import {
  DRIVE_WAVE_HEIGHT,
  DRIVE_WAVE_NARROW_WIDTH,
  DRIVE_WAVE_STROKE,
  DRIVE_WAVE_TEXT_BOTTOM,
  layoutDriveWave,
  resolveDriveWaveState,
  type DriveWaveBox,
  type DriveWaveLayout,
  type DriveWaveState,
} from './overviewDriveWaveLayout';
import { useUnitPreferencesVersion } from './useOverviewStatData';

const EASE = 'cubic-bezier(.2,.8,.2,1)';
/** Blur applied to the copied band of map under the line. */
const GLASS_BLUR_PX = 8;
/** Extra map copied around the band so the blur has real pixels to sample at its edges. */
const GLASS_PAD_PX = 16;

/**
 * Hands each freshly drawn map frame to the drive wave.
 *
 * CSS `backdrop-filter` cannot be used for the glass: Chromium blurs the
 * element's whole bounding box regardless of `clip-path` or `mask`, which
 * would fog the map above the line. Instead the map publishes its canvas after
 * every frame and the wave blurs a copy of the band it covers, clipped to the
 * wave shape like any other content.
 */
export interface MapFrameSource {
  publish: (canvas: HTMLCanvasElement) => void;
  subscribe: (listener: (canvas: HTMLCanvasElement) => void) => () => void;
}

export function createMapFrameSource(): MapFrameSource {
  const listeners = new Set<(canvas: HTMLCanvasElement) => void>();
  return {
    publish: (canvas) => listeners.forEach((listener) => listener(canvas)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Drive wave along the bottom of the overview location map.
 *
 * A single line runs flat along the map's bottom edge and lifts into humps
 * around the values: one large hump for the speed with a smaller one beside it
 * for the gear, or a single low hump around "Parked". Everything under the
 * line is a tinted glass over a blur of the map, and the map stays sharp
 * everywhere above it.
 */
export function OverviewDriveWave({ status, mapFrames }: { status: VehicleStatus | null | undefined; mapFrames?: MapFrameSource | undefined }) {
  useUnitPreferencesVersion();
  const state = resolveDriveWaveState(status);
  const gradientId = `drive-wave-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const [containerRef, containerBox] = useBoxSize<HTMLDivElement>();
  const [centerRef, centerBox] = useBoxSize<HTMLDivElement>();
  const [gearRef, gearBox] = useBoxSize<HTMLSpanElement>();
  const width = containerBox.width;
  const narrow = width > 0 && width <= DRIVE_WAVE_NARROW_WIDTH;
  const glassRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [hasGlass, setHasGlass] = useState(false);
  // Animate only once the first layout is on screen, so values do not slide in from the corner on mount.
  const [animate, setAnimate] = useState(false);
  const laidOut = width > 0 && centerBox.width > 0;
  useEffect(() => {
    if (!laidOut || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [laidOut, animate]);

  useEffect(() => {
    if (!mapFrames) return;
    return mapFrames.subscribe((source) => {
      const target = glassRef.current;
      const box = boxRef.current;
      if (!target || !box) return;
      if (copyBand(source, target, box)) setHasGlass(true);
    });
  }, [mapFrames]);

  if (!state) return null;

  const moving = state.kind === 'moving';
  const showGear = moving && state.gear !== null;
  const reversing = moving && state.gear === 'R';
  const layout = width > 0 && centerBox.width > 0
    ? layoutDriveWave(width, centerBox, showGear && gearBox.width > 0 ? gearBox : null)
    : null;
  const speed = moving ? formatSpeed(state.speedMph) : null;
  const speedSize = narrow ? 22 : width >= 400 ? 30 : 26;

  return (
    <div
      ref={(element) => {
        boxRef.current = element;
        containerRef(element);
      }}
      data-testid="overview-drive-wave"
      data-state={moving ? `moving-${state.gear ?? 'unknown'}` : 'parked'}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
      style={{ height: DRIVE_WAVE_HEIGHT }}
    >
      <span className="sr-only">{describe(state, speed)}</span>
      {layout ? (
        <>
          <div
            aria-hidden="true"
            className={`absolute inset-0 overflow-hidden ${animate ? 'motion-safe:transition-[clip-path] motion-safe:duration-500' : ''}`}
            style={{ clipPath: `path('${layout.fill}')`, transitionTimingFunction: EASE }}
          >
            <canvas
              ref={glassRef}
              className={`absolute ${hasGlass ? '' : 'hidden'}`}
              style={{
                left: -GLASS_PAD_PX,
                top: -GLASS_PAD_PX,
                width: width + GLASS_PAD_PX * 2,
                height: DRIVE_WAVE_HEIGHT + GLASS_PAD_PX * 2,
                filter: `blur(${GLASS_BLUR_PX}px)`,
              }}
            />
            {/* Without map frames yet (still loading, or no location), the tint alone keeps values readable. */}
            <div className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--rm-bg-surface) ${hasGlass ? 68 : 82}%, transparent)` }} />
          </div>
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${width} ${DRIVE_WAVE_HEIGHT}`}>
            <defs>{!reversing ? <WaveGradient id={gradientId} width={width} layout={layout} hasGear={showGear} /> : null}</defs>
            <path
              d={layout.line}
              fill="none"
              stroke={reversing ? 'var(--rm-status-warning)' : `url(#${gradientId})`}
              strokeWidth={DRIVE_WAVE_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={animate ? 'motion-safe:transition-[d] motion-safe:duration-500' : undefined}
              // Chromium animates the CSS `d` property; other engines use the attribute.
              style={{ d: `path('${layout.line}')`, transitionTimingFunction: EASE } as React.CSSProperties}
            />
          </svg>
        </>
      ) : null}
      <div aria-hidden="true" className={layout ? undefined : 'invisible'}>
        <span
          ref={gearRef}
          className={`absolute -translate-x-1/2 font-display text-sm font-bold leading-none ${animate ? 'transition-[left,opacity] duration-500 motion-reduce:transition-none' : ''} ${reversing ? 'text-status-warning' : 'text-fg'} ${showGear ? 'opacity-100' : 'opacity-0'}`}
          style={{ left: layout?.gear.x ?? 0, bottom: DRIVE_WAVE_TEXT_BOTTOM, transitionTimingFunction: EASE }}
        >
          {moving ? state.gear ?? '' : ''}
        </span>
        <div
          ref={centerRef}
          className={`absolute -translate-x-1/2 whitespace-nowrap ${animate ? 'transition-[left] duration-500 motion-reduce:transition-none' : ''}`}
          style={{ left: layout?.center.x ?? 0, bottom: DRIVE_WAVE_TEXT_BOTTOM, transitionTimingFunction: EASE }}
        >
          {speed ? (
            <div className="flex flex-col items-center gap-px font-display tabular-nums">
              <span className="font-semibold leading-none tracking-tight text-fg" style={{ fontSize: speedSize }}>{speed.value}</span>
              <span className="text-[9px] font-semibold leading-none tracking-[0.08em] text-fg-secondary">{speed.unit}</span>
            </div>
          ) : (
            <span className="font-display text-[13px] font-semibold leading-none text-fg">Parked</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Teal along the line, warming to gold over the center hump (the speed, or "Parked"). */
function WaveGradient({ id, width, layout, hasGear }: { id: string; width: number; layout: DriveWaveLayout; hasGear: boolean }) {
  const at = (x: number) => Math.min(1, Math.max(0, x / width));
  const { center, gear } = layout;
  const blend = 'color-mix(in oklab, var(--rm-drive-wave-line), var(--rm-drive-wave-crest))';
  const stops: Array<[number, string]> = [
    [0, 'var(--rm-drive-wave-line)'],
    [at(hasGear ? gear.x : center.a), 'var(--rm-drive-wave-line)'],
    [at(center.a + center.s * 0.4), blend],
    [at(center.a + center.s), 'var(--rm-drive-wave-crest)'],
    [at(center.b - center.s), 'var(--rm-drive-wave-crest)'],
    [at(center.b - center.s * 0.4), blend],
    [at(center.b + center.s * 0.5), 'var(--rm-drive-wave-line)'],
    [1, 'var(--rm-drive-wave-line)'],
  ];
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} x2={width} y1={0} y2={0}>
      {stops.map(([offset, color], index) => <stop key={index} offset={offset} stopColor={color} />)}
    </linearGradient>
  );
}

/**
 * Copies the part of the map under the wave (plus padding for the blur) into
 * the glass canvas. Returns false when the map has no size yet.
 */
function copyBand(source: HTMLCanvasElement, target: HTMLCanvasElement, box: HTMLElement): boolean {
  const from = source.getBoundingClientRect();
  const to = box.getBoundingClientRect();
  if (!from.width || !from.height || !to.width) return false;
  const scaleX = source.width / from.width;
  const scaleY = source.height / from.height;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const cssWidth = to.width + GLASS_PAD_PX * 2;
  const cssHeight = to.height + GLASS_PAD_PX * 2;
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);
  if (target.width !== pixelWidth) target.width = pixelWidth;
  if (target.height !== pixelHeight) target.height = pixelHeight;
  const context = target.getContext('2d');
  if (!context) return false;
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  const left = to.left - GLASS_PAD_PX - from.left;
  const top = to.top - GLASS_PAD_PX - from.top;
  context.drawImage(source, left * scaleX, top * scaleY, cssWidth * scaleX, cssHeight * scaleY, 0, 0, pixelWidth, pixelHeight);
  return true;
}

/** Speed in the user's unit from Settings > Units (Custom included), with a dash when the car reports none. */
function formatSpeed(speedMph: number | null): { value: string; unit: string } {
  return formatSpeedParts(speedMph) ?? { value: '–', unit: getUnitPreferences().speed_unit === 'kmh' ? 'km/h' : 'mph' };
}

function describe(state: DriveWaveState, speed: { value: string; unit: string } | null): string {
  if (state.kind === 'parked') return 'Parked';
  const gear = state.gear === 'D' ? 'Drive' : state.gear === 'R' ? 'Reverse' : state.gear === 'N' ? 'Neutral' : null;
  const pace = speed && speed.value !== '–' ? `${speed.value} ${speed.unit}` : null;
  return [gear, pace].filter(Boolean).join(', ') || 'Moving';
}

/**
 * Tracks an element's layout size. Values change size when web fonts load or
 * the speed gains a digit, so each measured element is observed directly.
 */
function useBoxSize<T extends HTMLElement>(): [(element: T | null) => void, DriveWaveBox] {
  const [element, setElement] = useState<T | null>(null);
  const [box, setBox] = useState<DriveWaveBox>({ width: 0, height: 0 });
  const last = useRef(box);
  const measure = (target: T) => {
    const next = { width: target.offsetWidth, height: target.offsetHeight };
    if (next.width === last.current.width && next.height === last.current.height) return;
    last.current = next;
    setBox(next);
  };
  useLayoutEffect(() => {
    if (element) measure(element);
  });
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, box];
}
