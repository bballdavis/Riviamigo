import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, Laptop, Moon, Sun } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  applyThemeMode,
  getStoredThemeMode,
  resolveThemeMode,
  type ThemeMode,
} from '../lib/theme';

export interface ThemeToggleProps {
  className?: string;
  label?: string;
  showLabel?: boolean;
  ariaLabel?: string;
  align?: 'start' | 'end';
  variant?: 'solid' | 'ghost';
}

type Position = {
  top: number;
  left: number;
  visibility: 'hidden' | 'visible';
};

const THEME_OPTIONS: Array<{
  mode: ThemeMode;
  label: string;
  description: string;
  icon: React.ComponentType<any>;
}> = [
  {
    mode: 'light',
    label: 'Light',
    description: 'Always use the light palette',
    icon: Sun,
  },
  {
    mode: 'dark',
    label: 'Dark',
    description: 'Always use the dark palette',
    icon: Moon,
  },
  {
    mode: 'system',
    label: 'System',
    description: 'Follow your device appearance',
    icon: Laptop,
  },
];

function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(max-width: 639px)').matches;
}

function getModeLabel(mode: ThemeMode) {
  return mode === 'system' ? 'System' : `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
}

export function ThemeToggle({
  className,
  label = 'Theme',
  showLabel = false,
  ariaLabel,
  align = 'end',
  variant = 'solid',
}: ThemeToggleProps) {
  const [mode, setMode] = React.useState<ThemeMode>(() => getStoredThemeMode());
  const [open, setOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(isMobileViewport);
  const [position, setPosition] = React.useState<Position>({
    top: 0,
    left: 0,
    visibility: 'hidden',
  });
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const ModeIcon = mode === 'system' ? Laptop : resolveThemeMode(mode) === 'dark' ? Moon : Sun;
  const modeLabel = getModeLabel(mode);
  const triggerAriaLabel = ariaLabel ?? (showLabel ? undefined : 'Theme options');

  React.useEffect(() => {
    const syncMode = () => setMode(getStoredThemeMode());
    syncMode();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'rm-theme' || event.key === null) {
        syncMode();
      }
    };

    const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 639px)')
      : null;
    const handleViewportChange = () => setIsMobile(mediaQuery ? mediaQuery.matches : false);

    window.addEventListener('storage', handleStorage);
    mediaQuery?.addEventListener?.('change', handleViewportChange);
    mediaQuery?.addListener?.(handleViewportChange);

    return () => {
      window.removeEventListener('storage', handleStorage);
      mediaQuery?.removeEventListener?.('change', handleViewportChange);
      mediaQuery?.removeListener?.(handleViewportChange);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || isMobile) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;

      if (!trigger || !menu) return;

      const gap = 8;
      const padding = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = triggerRect.bottom + gap;
      if (top + menuRect.height > viewportHeight - padding) {
        top = triggerRect.top - menuRect.height - gap;
      }
      top = Math.min(
        Math.max(top, padding),
        Math.max(padding, viewportHeight - padding - menuRect.height),
      );

      let left = align === 'start'
        ? triggerRect.left
        : triggerRect.right - menuRect.width;

      left = Math.min(
        Math.max(left, padding),
        Math.max(padding, viewportWidth - padding - menuRect.width),
      );

      setPosition({
        top,
        left,
        visibility: 'visible',
      });
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, isMobile, open]);

  function setThemeMode(next: ThemeMode) {
    applyThemeMode(next);
    setMode(next);
    setOpen(false);
  }

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen((current) => !current)}
      aria-label={triggerAriaLabel}
      aria-haspopup="menu"
      aria-expanded={open}
      className={cn(
        variant === 'ghost'
          ? 'group inline-flex items-center gap-2 rounded-lg text-fg-tertiary transition-colors duration-150 hover:text-fg hover:bg-bg-elevated'
          : 'group inline-flex items-center gap-2 rounded-lg border border-border bg-bg-elevated text-fg-secondary transition-colors duration-150 hover:border-border-strong hover:text-fg hover:bg-bg-elevated/80',
        showLabel ? 'h-9 px-3 text-sm font-medium' : 'h-8 w-8 justify-center',
        className
      )}
    >
      <span className="inline-flex shrink-0 items-center justify-center h-4 w-4">
        <ModeIcon className="h-4 w-4" />
      </span>
      {showLabel && (
        <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg">
          {label}
        </span>
      )}
      {showLabel && (
        <span className="shrink-0 text-xs font-medium text-fg-tertiary">
          {modeLabel}
        </span>
      )}
    </button>
  );

  const panel = open ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Theme options"
      className={cn(
        'fixed z-50 overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-xl',
        isMobile
          ? 'inset-x-2 bottom-2 max-h-[calc(100vh-1rem)] w-auto'
          : 'w-72 max-w-[calc(100vw-1rem)]'
      )}
      style={isMobile ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' } : { top: position.top, left: position.left, visibility: position.visibility }}
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium text-fg">Theme</p>
        <p className="mt-0.5 text-xs text-fg-tertiary">Choose light, dark, or follow your device</p>
      </div>

      <div className="max-h-[min(22rem,calc(100vh-6rem))] overflow-y-auto p-2">
        {THEME_OPTIONS.map((option) => {
          const active = option.mode === mode;
          const Icon = option.icon;

          return (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => setThemeMode(option.mode)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                active
                  ? 'bg-accent-muted text-accent'
                  : 'text-fg-secondary hover:bg-bg-elevated hover:text-fg'
              )}
            >
              <span
                className={cn(
                  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
                  active ? 'border-accent/30 bg-accent/10' : 'border-border bg-bg-elevated'
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-fg-tertiary">{option.description}</span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <>
      {trigger}
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </>
  );
}
