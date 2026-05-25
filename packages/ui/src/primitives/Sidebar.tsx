import * as React from 'react';
import {
  LayoutDashboard, Battery, Route, Zap, TrendingUp,
  Heart, Menu, X, MoreVertical,
} from 'lucide-react';
import { cn } from '../lib/utils';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',  label: 'Overview',   href: '/',          icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'battery',    label: 'Battery',    href: '/battery',   icon: <Battery className="h-4 w-4" /> },
  { key: 'charging',   label: 'Charging',   href: '/charging',  icon: <Zap className="h-4 w-4" /> },
  { key: 'trips',      label: 'Trips',      href: '/trips',     icon: <Route className="h-4 w-4" /> },
  { key: 'efficiency', label: 'Efficiency', href: '/efficiency',icon: <TrendingUp className="h-4 w-4" /> },
  { key: 'health',     label: 'Health',     href: '/health',    icon: <Heart className="h-4 w-4" /> },
];

export interface SidebarProps {
  activeKey: string;
  onNavigate: (href: string) => void;
  items?: NavItem[];
  logo?: React.ReactNode;
  bottomSlot?: React.ReactNode | ((context: { collapsed: boolean }) => React.ReactNode);
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
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    const html = document.documentElement;
    return html.classList.contains('dark') || !html.classList.contains('light');
  });

  React.useEffect(() => {
    const html = document.documentElement;
    const updateTheme = () => {
      setIsDark(html.classList.contains('dark') || !html.classList.contains('light'));
    };

    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile header bar — full-width solid bar, stays on top while scrolling */}
      <div className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 border-b border-border bg-bg-surface px-4 lg:hidden">
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-elevated border border-border text-fg-secondary hover:text-fg transition-colors"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
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
      </div>

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
          'max-w-[85vw] pt-14 lg:pt-0',
          mobileOpen && '!flex',
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
        <nav className={cn('flex-1 py-3 overflow-y-auto', collapsed && 'flex flex-col items-center')}>
          {items.map((item) => {
            const isActive = item.key === activeKey;
            return (
              <button
                key={item.key}
                onClick={() => {
                  onNavigate(item.href);
                  setMobileOpen(false);
                }}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 mx-2 rounded-lg text-sm font-medium',
                  'transition-all duration-150',
                  collapsed ? 'justify-center w-10 mx-auto' : 'w-[calc(100%-16px)]',
                  isActive
                    ? 'bg-accent-muted text-accent'
                    : 'text-fg-secondary hover:text-fg hover:bg-bg-elevated'
                )}
              >
                <span className="shrink-0">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
                {isActive && !collapsed && (
                  <span className="ml-auto w-1 h-4 rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom slot (e.g. vehicle status, theme toggle) */}
        {bottomSlot && (
          <div className="shrink-0 border-t border-border p-3">
            {typeof bottomSlot === 'function' ? bottomSlot({ collapsed }) : bottomSlot}
          </div>
        )}
      </aside>
    </>
  );
}

export { DEFAULT_NAV_ITEMS };
