/** Shared chrome for the Ownership page: control sizing, info tooltips, section titles, and segmented toggles. */
import React from 'react';
import { Info } from 'lucide-react';
import { CardTitle, Tooltip } from '@riviamigo/ui/primitives';

/** Shared height for the toolbar controls: touch-sized on phones, compact from `sm`. */
export const CONTROL_HEIGHT = 'h-11 sm:h-9';

/** Rounded-rectangle chip shared by the comparison toggles. */
export const CHIP = 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base transition-colors sm:min-h-9';

export interface InfoItem {
  key: string;
  title: string;
  icon: React.ReactElement<{ className?: string }>;
  color: string;
  body: string;
}

/**
 * The layout every info tooltip on this page shares: a bold heading, then
 * items with a tinted icon and a bold title in the item's color. Two columns
 * from `sm`, one on phones, so it stays short enough to fit the screen.
 */
export function RichInfo({ title, items, footer }: { title: string; items: InfoItem[]; footer?: string }) {
  return (
    <>
      <span className="block text-base font-bold text-fg">{title}</span>
      <span className="mt-2 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {items.map((item) => (
          <span key={item.key} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: item.color, backgroundColor: `color-mix(in oklab, ${item.color} 16%, transparent)` }}
            >
              {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
            </span>
            <span className="min-w-0">
              <span className="block font-bold" style={{ color: item.color }}>
                {item.title}
              </span>
              <span className="mt-0.5 block text-fg-secondary">{item.body}</span>
            </span>
          </span>
        ))}
      </span>
      {footer ? <span className="mt-3 block border-t border-border pt-2 text-fg-secondary">{footer}</span> : null}
    </>
  );
}

export function SectionTitle({
  icon,
  info,
  infoLabel = 'About this section',
  infoWidth = 'w-80',
  children,
}: {
  icon: React.ReactElement<{ className?: string }>;
  info?: React.ReactNode;
  /** Accessible name of the info button; each one on the page should differ. */
  infoLabel?: string;
  infoWidth?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="text-accent">
        {React.cloneElement(icon, { className: 'h-5 w-5' })}
      </span>
      <CardTitle className="text-base font-bold text-fg">{children}</CardTitle>
      {info ? (
        <Tooltip content={info} align="start" contentClassName={`${infoWidth} px-3.5 py-3 text-sm leading-relaxed`}>
          <button
            type="button"
            aria-label={infoLabel}
            className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg-secondary transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-8 sm:min-w-8"
          >
            <Info className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function Dot({ color }: { color: string | undefined }) {
  return (
    <span
      aria-hidden
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${color ? '' : 'border border-border-strong'}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export function Segmented<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex shrink-0 rounded-lg border border-border bg-bg-elevated/50 p-0.5 ${CONTROL_HEIGHT}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={[
            'h-full rounded-md border px-3 text-base font-medium transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            // The selected option carries an accent border and tint so it reads at a glance.
            option.value === value
              ? 'border-accent bg-accent/10 font-semibold text-fg shadow-sm'
              : 'border-transparent text-fg-secondary hover:text-fg',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
