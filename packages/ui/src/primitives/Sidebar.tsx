import * as React from 'react';
import {
  BatteryFull, TrendingUp,
  Heart, Menu, X, MoreVertical,
} from 'lucide-react';
import { TbCarSuv } from 'react-icons/tb';
import { FaChargingStation } from 'react-icons/fa6';
import { BiTrip } from 'react-icons/bi';
import { cn } from '../lib/utils';
import { useDocumentTheme } from '../hooks/useDocumentTheme';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  children?: NavItem[];
  pinToBottom?: boolean;
}

const NAV_ICON_CLASS = 'h-[1.125rem] w-[1.125rem]';

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',  label: 'Overview',   href: '/',          icon: <TbCarSuv className={NAV_ICON_CLASS} /> },
  { key: 'battery',    label: 'Battery',    href: '/battery',   icon: <BatteryFull className={NAV_ICON_CLASS} data-nav-icon="battery-full" /> },
  { key: 'charging',   label: 'Charging',   href: '/charging',  icon: <FaChargingStation className={NAV_ICON_CLASS} /> },
  { key: 'trips',      label: 'Trips',      href: '/trips',     icon: <BiTrip className={NAV_ICON_CLASS} /> },
  { key: 'efficiency', label: 'Efficiency', href: '/efficiency',icon: <TrendingUp className={NAV_ICON_CLASS} /> },
  { key: 'health',     label: 'Health',     href: '/health',    icon: <Heart className={NAV_ICON_CLASS} /> },
];

export interface SidebarProps {
  activeKey: string;
  onNavigate: (href: string) => void;
  items?: NavItem[];
  logo?: React.ReactNode;
  mobileHeaderSlot?: React.ReactNode;
  bottomSlot?: React.ReactNode | ((context: {
    collapsed: boolean;
    mobile: boolean;
    closeMobileNavigation: (restoreFocus?: boolean) => void;
  }) => React.ReactNode);
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

export function Sidebar({
  activeKey,
  onNavigate,
  items = DEFAULT_NAV_ITEMS,
  logo,
  mobileHeaderSlot,
  bottomSlot,
  defaultCollapsed = false,
  collapsed: collapsedProp,
  onCollapsedChange,
  className,
}: SidebarProps) {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = React.useState(defaultCollapsed);
  const collapsed = collapsedProp ?? uncontrolledCollapsed;
  const setCollapsed = React.useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const nextValue = typeof next === 'function' ? next(collapsed) : next;
      if (collapsedProp === undefined) {
        setUncontrolledCollapsed(nextValue);
      }
      onCollapsedChange?.(nextValue);
    },
    [collapsed, collapsedProp, onCollapsedChange]
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const mobileMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = React.useRef<HTMLButtonElement>(null);
  const lastMobileFocusRef = React.useRef<HTMLElement | null>(null);
  const restoreFocusOnCloseRef = React.useRef(true);
  const isDark = useDocumentTheme();

  const closeMobileNavigation = React.useCallback((restoreFocus = true) => {
    restoreFocusOnCloseRef.current = restoreFocus;
    setMobileOpen(false);
  }, []);

  const openMobileNavigation = React.useCallback(() => {
    lastMobileFocusRef.current = mobileMenuButtonRef.current ?? document.activeElement as HTMLElement | null;
    restoreFocusOnCloseRef.current = true;
    setMobileOpen(true);
  }, []);

  React.useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileNavigation();
      }
    };
    const focusTimer = window.setTimeout(() => mobileCloseButtonRef.current?.focus(), 0);

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);

      if (restoreFocusOnCloseRef.current) {
        window.setTimeout(() => (mobileMenuButtonRef.current ?? lastMobileFocusRef.current)?.focus(), 0);
      }
    };
  }, [closeMobileNavigation, mobileOpen]);

  function isItemActive(item: NavItem) {
    if (item.key === activeKey) return true;
    return (item.children ?? []).some((child) => child.key === activeKey);
  }

  const pinnedItems = items.filter((item) => item.pinToBottom);
  const regularItems = items.filter((item) => !item.pinToBottom);

  function renderItem(item: NavItem, mobile = false) {
    const isActive = isItemActive(item);
    const activeChildKey = (item.children ?? []).find((child) => child.key === activeKey)?.key;
    return (
      <div key={item.key} className={cn('w-full', !mobile && collapsed && 'flex justify-center')}>
        <button
          onClick={() => {
            onNavigate(item.href);
            closeMobileNavigation(false);
          }}
          title={!mobile && collapsed ? item.label : undefined}
          aria-current={isActive ? 'page' : undefined}
          data-mobile-nav-item={mobile ? item.key : undefined}
          className={cn(
            'w-full flex items-center gap-3 rounded-lg font-medium',
            'transition-all duration-150',
            mobile
              ? 'min-h-14 px-4 text-base'
              : collapsed
              ? 'justify-center w-10 mx-auto px-3 py-2 text-sm'
              : 'w-[calc(100%-16px)] mx-2 px-3 py-2 text-sm',
            isActive
              ? 'bg-accent-muted text-accent'
              : 'text-fg-secondary hover:text-fg hover:bg-bg-elevated'
          )}
        >
          <span className={cn(
            'shrink-0 inline-flex items-center justify-center leading-none',
            mobile ? 'h-6 w-6 [&>svg]:!h-6 [&>svg]:!w-6' : 'h-5 w-5',
          )}>{item.icon}</span>
          {(mobile || !collapsed) && <span className="leading-none">{item.label}</span>}
          {isActive && (mobile || !collapsed) && (
            <span className={cn('ml-auto w-1 rounded-full bg-accent', mobile ? 'h-6' : 'h-4')} />
          )}
        </button>

        {(mobile || !collapsed) && item.children && item.children.length > 0 && (
          <div className={cn(
            'mt-1 mb-1 border-l border-border',
            mobile ? 'ml-7 pl-3' : 'ml-5 mr-2 pl-2',
          )}>
            {item.children.map((child) => {
              const childIsActive = child.key === activeChildKey;
              return (
                <button
                  key={child.key}
                  onClick={() => {
                    onNavigate(child.href);
                    closeMobileNavigation(false);
                  }}
                  aria-current={childIsActive ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg font-medium transition-colors',
                    mobile ? 'min-h-12 px-3 text-sm' : 'px-2 py-1.5 text-xs',
                    childIsActive
                      ? 'bg-accent-muted text-accent'
                      : 'text-fg-tertiary hover:bg-bg-elevated hover:text-fg-secondary'
                  )}
                >
                  <span className={cn('shrink-0', mobile && '[&>svg]:!h-5 [&>svg]:!w-5')}>{child.icon}</span>
                  <span>{child.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Mobile header bar — full-width solid bar, stays on top while scrolling */}
      {!mobileOpen && <div className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 border-b border-border bg-bg-surface px-4 lg:hidden">
        <button
          ref={mobileMenuButtonRef}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-fg-secondary transition-colors hover:text-fg"
          onClick={openMobileNavigation}
          aria-label="Toggle navigation"
          aria-controls="mobile-navigation"
          aria-expanded={mobileOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center"
          aria-label="Go to home"
        >
          <img
            src={isDark ? '/text_white.svg' : '/text_black.svg'}
            alt="Riviamigo"
            className="h-[1.5625rem] w-auto"
            style={{ transform: 'translateY(10%)' }}
          />
        </button>
        {mobileHeaderSlot && <div className="ml-auto flex items-center gap-2">{mobileHeaderSlot}</div>}
      </div>}

      {mobileOpen && (
        <aside
          id="mobile-navigation"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          data-mobile-navigation="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeMobileNavigation();
          }}
          className="fixed inset-0 z-[60] flex min-h-[100dvh] flex-col bg-bg-surface pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden"
        >
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
            <button
              ref={mobileCloseButtonRef}
              type="button"
              onClick={() => closeMobileNavigation()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-fg-secondary transition-colors hover:text-fg"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                onNavigate('/');
                closeMobileNavigation(false);
              }}
              className="flex items-center"
              aria-label="Go to home"
            >
              <img
                src={isDark ? '/text_white.svg' : '/text_black.svg'}
                alt="Riviamigo"
                className="h-[1.5625rem] w-auto"
                style={{ transform: 'translateY(10%)' }}
              />
            </button>
            {mobileHeaderSlot && <div className="ml-auto flex items-center gap-2">{mobileHeaderSlot}</div>}
          </div>

          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4" aria-label="Primary navigation">
            <div className="w-full space-y-1">
              {regularItems.map((item) => renderItem(item, true))}
            </div>
            {pinnedItems.length > 0 && (
              <div className="mt-auto w-full space-y-1 pt-4">
                {pinnedItems.map((item) => renderItem(item, true))}
              </div>
            )}
          </nav>

          {bottomSlot && (
            <div className="shrink-0 border-t border-border px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
              {typeof bottomSlot === 'function'
                ? bottomSlot({ collapsed: false, mobile: true, closeMobileNavigation })
                : bottomSlot}
            </div>
          )}
        </aside>
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full flex flex-col',
          'bg-bg-surface border-r border-border',
          'transition-all duration-200 ease-out',
          // Desktop
          'hidden lg:flex',
          collapsed ? 'w-[72px]' : 'w-64',
          // Mobile drawer — capped at 85vw; pt-14 clears the fixed mobile header bar
          className
        )}
      >
        {/* Logo / brand — desktop only; mobile uses the fixed header bar above */}
        <div className={cn(
          'items-center h-14 px-4 border-b border-border shrink-0',
          'hidden lg:flex',
          collapsed ? 'justify-center' : 'justify-start relative'
        )}>
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="h-full w-full flex items-center justify-center"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <img
                src="/logo_color_lighter.svg"
                alt="Riviamigo logo"
                className="h-[80%] w-auto"
              />
            </button>
          ) : (
            <>
              {logo ?? (
                <div className="flex h-full min-w-0 items-center justify-start pl-1 overflow-hidden">
                  <img
                    src={isDark ? '/text_white.svg' : '/text_black.svg'}
                    alt="Riviamigo"
                    className="block h-[62%] w-auto max-w-[calc(100%-2.25rem)] object-contain"
                    style={{ transform: 'translateY(15%)' }}
                  />
                </div>
              )}
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="hidden lg:flex absolute right-3 top-1/2 -translate-y-1/2 items-center justify-center w-12 h-6 rounded-md text-accent hover:bg-bg-elevated transition-colors"
                aria-label="Collapse sidebar"
              >
                <MoreVertical className="h-5 w-5" />
              </button>
            </>
          )}
        </div>

        {/* Nav items */}
        <nav className={cn('flex-1 py-3 overflow-y-auto flex flex-col', collapsed && 'items-center')}>
          <div className={cn('w-full', collapsed && 'flex flex-col items-center')}>
            {regularItems.map((item) => renderItem(item))}
          </div>
          {pinnedItems.length > 0 && (
            <div className="mt-auto w-full pt-3">
              <div className={cn('w-full', collapsed && 'flex flex-col items-center')}>
                {pinnedItems.map((item) => renderItem(item))}
              </div>
            </div>
          )}
        </nav>

        {/* Bottom slot (e.g. vehicle status, theme toggle) */}
        {bottomSlot && (
          <div className="shrink-0 border-t border-border p-3">
            {typeof bottomSlot === 'function'
              ? bottomSlot({ collapsed, mobile: false, closeMobileNavigation })
              : bottomSlot}
          </div>
        )}
      </aside>
    </>
  );
}

export { DEFAULT_NAV_ITEMS };
