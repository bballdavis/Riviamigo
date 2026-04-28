import * as React from 'react';
import { cn } from '../lib/utils';

export interface MetricTab {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

export interface MetricTabsProps {
  tabs: MetricTab[];
  active: string;
  onChange: (key: string) => void;
  /** Collapse to dropdown when tab count exceeds this. Default 5. */
  dropdownThreshold?: number;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function MetricTabs({
  tabs,
  active,
  onChange,
  dropdownThreshold = 5,
  title,
  subtitle,
  actions,
  children,
  className,
}: MetricTabsProps) {
  const useDropdown = tabs.length > dropdownThreshold;
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className={cn('bg-bg-surface border border-border rounded-xl', className)}>
      {/* Header row */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0 gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          {title && (
            <h2 className="text-sm font-medium text-fg-secondary uppercase tracking-wider">{title}</h2>
          )}
          {subtitle && <p className="mt-0.5 text-xs text-fg-tertiary">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-3">
          {/* Tab bar or dropdown */}
          {useDropdown ? (
            <select
              value={active}
              onChange={(e) => onChange(e.target.value)}
              className="text-xs bg-bg-elevated border border-border rounded-lg px-3 py-1.5 text-fg
                         focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
            >
              {tabs.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-0.5 bg-bg-elevated border border-border rounded-lg p-0.5">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onChange(t.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150',
                    t.key === active
                      ? 'bg-accent text-bg-page shadow-sm'
                      : 'text-fg-secondary hover:text-fg hover:bg-bg-overlay'
                  )}
                >
                  {t.icon && <span className="w-3.5 h-3.5">{t.icon}</span>}
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {actions}
        </div>
      </div>

      {/* Content */}
      <div className="p-5 pt-4">{children}</div>
    </div>
  );
}
