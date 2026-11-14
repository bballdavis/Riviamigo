import React from 'react';
import { cn } from '@riviamigo/ui/lib/utils';
import { Card } from '@riviamigo/ui/primitives';
import {
  MiniSparkline,
  type CurveSmoothness,
  type MiniSparklineType,
  type MiniSparklineYDomain,
  type TimeFilterWindow,
} from '@riviamigo/ui/charts';
import { AppIcon } from '../../icons/AppIcon';
import { resolveIconId } from '../../editor/iconMigration';

type SpritePoint = { ts?: string; value: number | null | undefined };

export interface SensorChipSprite {
  data: SpritePoint[];
  type: MiniSparklineType;
  color: string;
  timeFilter?: TimeFilterWindow;
  smoothness?: CurveSmoothness;
  yDomain?: MiniSparklineYDomain;
}

export interface SensorChipCardProps {
  title: string;
  labelSuffix?: string;
  /** Inline controls after the title, such as a help tooltip or a scope badge. */
  titleAddons?: React.ReactNode;
  subtitle?: string;
  /** Iconify id or legacy short key; falls back to `lucide:activity`. */
  icon: string | undefined;
  /** Metric color for the icon; without it the icon uses the accent. */
  iconColor?: string;
  /** Status tone class that overrides the icon color. */
  iconToneClass?: string;
  accentBorder: boolean;
  accentColor?: string;
  sprite?: SensorChipSprite;
  /** The value, usually a `SensorChipValue`. */
  value: React.ReactNode;
  inlineSecondary?: string;
  /** Small line under the value, such as a selection or last-updated label. */
  footnote?: React.ReactNode;
  secondary?: React.ReactNode;
  /** Vertically centre the content; chips with a sprite keep it at the top. */
  centered?: boolean;
}

/**
 * The single sensor chip body. Dashboard sensor widgets and page headline
 * chips both render through it, so every chip in the app shares one frame,
 * icon placement, value styling, and sparkline layer.
 */
export function SensorChipCard({
  title,
  labelSuffix,
  titleAddons,
  subtitle,
  icon,
  iconColor,
  iconToneClass,
  accentBorder,
  accentColor,
  sprite,
  value,
  inlineSecondary,
  footnote,
  secondary,
  centered = !sprite,
}: SensorChipCardProps) {
  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        accentBorder ? 'shadow-[inset_0_0_0_1px_var(--rm-border-accent)]' : 'border-border',
      )}
      style={accentBorder && accentColor ? { borderColor: accentColor } : undefined}
      data-testid="sensor-chip"
    >
      {sprite ? (
        <div
          className="pointer-events-none absolute h-9"
          style={{ left: 0, right: 0, bottom: 0, zIndex: 0, opacity: 0.82 }}
          data-testid="sensor-sprite-layer"
        >
          <MiniSparkline
            data={sprite.data}
            type={sprite.type}
            height={36}
            color={sprite.color}
            showFallback
            {...(sprite.timeFilter ? { timeFilter: sprite.timeFilter } : {})}
            {...(sprite.smoothness ? { smoothness: sprite.smoothness } : {})}
            {...(sprite.yDomain ? { yDomain: sprite.yDomain } : {})}
          />
          <div
            className="absolute inset-x-0 bottom-[2px] h-px"
            style={{ backgroundColor: sprite.color, opacity: 0.35 }}
            aria-hidden="true"
          />
        </div>
      ) : null}

      <div className={cn('relative z-10 flex flex-col', centered && 'flex-1 justify-center')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">
                {title}
                {labelSuffix ? (
                  <span className="ml-1 text-[10px] font-normal normal-case tracking-normal">
                    ({labelSuffix})
                  </span>
                ) : null}
              </p>
              {titleAddons}
            </div>
            {subtitle ? <p className="mt-1 truncate text-xs text-fg-tertiary">{subtitle}</p> : null}
          </div>
          <AppIcon
            icon={resolveIconId(icon)}
            aria-hidden="true"
            data-testid="sensor-chip-icon"
            className={cn('h-4 w-4 shrink-0', iconToneClass ?? (iconColor ? 'text-fg' : 'text-accent'))}
            style={iconColor && !iconToneClass ? { color: iconColor } : undefined}
          />
        </div>

        <div className="mt-1.5 flex items-baseline gap-1">
          {value}
          {inlineSecondary ? (
            <span className="font-mono text-sm tabular-nums text-fg-tertiary">{inlineSecondary}</span>
          ) : null}
        </div>
        {footnote}
        {secondary ? <p className="mt-0.5 truncate text-xs text-fg-tertiary">{secondary}</p> : null}
      </div>
    </Card>
  );
}

export interface SensorChipValueProps {
  children: React.ReactNode;
  toneClass: string;
  style?: React.CSSProperties;
  size?: 'sm' | 'md' | 'lg';
}

/** The chip's headline value text. */
export function SensorChipValue({ children, toneClass, style, size = 'md' }: SensorChipValueProps) {
  return (
    <span
      className={cn(
        'font-mono font-semibold tabular-nums tracking-tight',
        toneClass,
        size === 'sm' ? 'text-xl' : size === 'lg' ? 'text-3xl' : 'text-2xl',
      )}
      style={{ textShadow: 'var(--rm-value-halo)', ...style }}
    >
      {children}
    </span>
  );
}
