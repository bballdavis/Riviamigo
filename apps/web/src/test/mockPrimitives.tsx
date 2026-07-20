/**
 * Explicit stub for @riviamigo/ui/primitives used in page-level tests.
 * Avoids loading the real package (which has framer-motion / complex deps)
 * inside jsdom, while still exercising page logic + tab switching.
 */
import React from 'react';

export const PageLayout = ({ children, title, titleAction, subtitle, actions }: {
  children: React.ReactNode; title: string; titleAction?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode;
}) => (
  <div data-testid="page-layout">
    <div>
      {titleAction}
      <h1>{title}</h1>
    </div>
    {subtitle && <div>{subtitle}</div>}
    {actions}
    {children}
  </div>
);

export const StatCardGrid = ({ children }: { children: React.ReactNode }) => (
  <div data-testid="stat-card-grid">{children}</div>
);

export const StatCard = ({ label, value, unit, detail }: {
  label: string; value: React.ReactNode; unit?: string; detail?: string; accent?: boolean; icon?: React.ReactNode;
}) => (
  <div data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
    <span>{label}</span>
    <span>{value}</span>
    {unit && <span>{unit}</span>}
    {detail && <span>{detail}</span>}
  </div>
);

export const StatCardSkeleton = () => <div data-testid="stat-skeleton" />;

export const ChartSection = ({ children, title, subtitle }: {
  children: React.ReactNode; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode;
}) => (
  <div data-testid={`chart-${title.toLowerCase().replace(/\s+/g, '-')}`}>
    <span>{title}</span>
    {subtitle && <span>{subtitle}</span>}
    {children}
  </div>
);

export const MetricTabs = ({
  tabs, active, onChange, title, subtitle, children, dropdownThreshold = 5, actions,
}: {
  tabs: { key: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (k: string) => void;
  title?: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  dropdownThreshold?: number;
  actions?: React.ReactNode;
}) => {
  const useDropdown = tabs.length > dropdownThreshold;
  return (
    <div data-testid="metric-tabs">
      {title && <span>{title}</span>}
      {subtitle && <span>{subtitle}</span>}
      {useDropdown ? (
        <select
          value={active}
          onChange={(e) => onChange(e.target.value)}
          aria-label="metric selector"
        >
          {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      ) : (
        <div>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={t.key === active ? 'bg-accent' : ''}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {actions}
      {children}
    </div>
  );
};

export const ChartPicker = ({
  value,
  options,
  onChange,
  searchValue,
  onSearchChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}) => (
  <div data-testid="chart-picker">
    <input
      aria-label="Search charts"
      value={searchValue}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Search charts"
    />
    <select aria-label="Chart" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </div>
);

export const SelectPicker = ({
  value,
  options,
  onChange,
  id,
  'aria-label': ariaLabel,
  disabled,
  className,
}: {
  value: string;
  options: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>;
  onChange: (value: string) => void;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
}) => (
  <select
    id={id}
    aria-label={ariaLabel}
    className={className}
    value={value}
    disabled={disabled}
    onChange={(event) => onChange(event.target.value)}
  >
    {options.map((option) => (
      <option key={option.value} value={option.value} disabled={option.disabled}>
        {option.label}
      </option>
    ))}
  </select>
);

export const Tooltip = ({ children }: { children: React.ReactNode; content?: React.ReactNode; contentClassName?: string }) => <>{children}</>;

export const DateRangePicker = ({ onChange }: {
  timeframe?: unknown; onChange?: (timeframe: unknown) => void;
}) => <div data-testid="date-range-picker" />;

export function presetToRange(_preset: string) {
  return { from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-01-31T23:59:59Z') };
}

export const EmptyState = ({ title, description, action, icon }: {
  title: string; description?: string;
  action?: { label: string; onClick: () => void };
  icon?: React.ReactNode;
}) => (
  <div data-testid="empty-state">
    <p>{title}</p>
    {description && <p>{description}</p>}
    {action && <button onClick={action.onClick}>{action.label}</button>}
  </div>
);

export const Card = ({ children, ...p }: { children: React.ReactNode; [k: string]: unknown }) =>
  <div data-testid="card" {...(p as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;

export const CardHeader = ({ children }: { children: React.ReactNode }) =>
  <div data-testid="card-header">{children}</div>;

export const CardTitle = ({ children }: { children: React.ReactNode }) =>
  <h3>{children}</h3>;

export const CardContent = ({ children }: { children: React.ReactNode }) =>
  <div>{children}</div>;

export const Button = ({ children, onClick, iconLeft, loading, ...p }: {
  children: React.ReactNode; onClick?: () => void; iconLeft?: React.ReactNode;
  variant?: string; size?: string; type?: 'button' | 'submit' | 'reset';
  loading?: boolean;
  [k: string]: unknown;
}) => (
  <button onClick={onClick} type={(p as { type?: 'button' | 'submit' | 'reset' }).type ?? 'button'} {...p}>
    {iconLeft}{children}
  </button>
);

export const Badge = ({ children, dot }: { children: React.ReactNode; variant?: string; dot?: boolean }) =>
  <span data-testid="badge">{children}</span>;

export const ThemeToggle = ({ label, showLabel }: { label?: string; showLabel?: boolean; [k: string]: unknown }) =>
  <button data-testid="theme-toggle">{showLabel ? (label ?? 'Theme') : 'Toggle theme'}</button>;

export const Input = ({ label, error, id, ...props }: {
  label?: string; error?: string; id?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) => {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div>
      {label && <label htmlFor={inputId}>{label}</label>}
      <input id={inputId} {...props} />
      {error && <p>{error}</p>}
    </div>
  );
};

export const Skeleton = ({ className }: { className?: string }) => <div className={className} />;
export const ChartSkeleton = ({ className }: { className?: string }) => <div className={className} />;

