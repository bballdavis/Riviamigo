import * as React from 'react';
import {
  LayoutDashboard, Battery, Route, Zap, TrendingUp,
  Menu, X, MoreVertical,
} from 'lucide-react';
import { cn } from '../lib/utils';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',  label: 'Dashboard',  href: '/',          icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'battery',    label: 'Battery',    href: '/battery',   icon: <Battery className="h-4 w-4" /> },
  { key: 'trips',      label: 'Trips',      href: '/trips',     icon: <Route className="h-4 w-4" /> },
  { key: 'charging',   label: 'Charging',   href: '/charging',  icon: <Zap className="h-4 w-4" /> },
  { key: 'efficiency', label: 'Efficiency', href: '/efficiency',icon: <TrendingUp className="h-4 w-4" /> },
];

export interface SidebarProps {
  activeKey: string;
  onNavigate: (href: string) => void;
  items?: NavItem[];
  logo?: React.ReactNode;
  bottomSlot?: React.ReactNode | ((context: { collapsed: boolean }) => React.ReactNode);
  className?: string;
}

export function Sidebar({
  activeKey,
  onNavigate,
  items = DEFAULT_NAV_ITEMS,
  logo,
  bottomSlot,
  className,
}: SidebarProps) {
  const [collapsed, setCollapsed] = React.useState(false);
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

      {/* Mobile toggle button */}
      <button
        className="fixed top-4 left-4 z-50 flex items-center justify-center w-8 h-8 rounded-lg bg-bg-elevated border border-border text-fg-secondary hover:text-fg transition-colors lg:hidden"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label="Toggle navigation"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full flex flex-col',
          'bg-bg-surface border-r border-border',
          'transition-all duration-200 ease-out',
          // Desktop
          'hidden lg:flex',
          collapsed ? 'w-[72px]' : 'w-64',
          // Mobile drawer
          mobileOpen && '!flex w-64',
          className
        )}
      >
        {/* Logo / brand */}
        <div className={cn(
          'flex items-center h-14 px-4 border-b border-border shrink-0',
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
                    className="block h-[20%] w-auto max-w-[calc(200%-2.25rem)] object-contain"
                    style={{ transform: 'translateY(18%)' }}
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
