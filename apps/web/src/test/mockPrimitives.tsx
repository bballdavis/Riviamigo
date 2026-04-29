/**
 * Explicit stub for @riviamigo/ui/primitives used in page-level tests.
 * Avoids loading the real package (which has framer-motion / complex deps)
 * inside jsdom, while still exercising page logic + tab switching.
 */
import React from 'react';

export const PageLayout = ({ children, title, subtitle, actions }: {
  children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode;
}) => (
  <div data-testid="page-layout">
    <h1>{title}</h1>
    {subtitle && <p>{subtitle}</p>}
    {actions}
    {children}
  </div>
);

export const StatCardGrid = ({ children }: { children: React.ReactNode }) => (
  <div data-testid="stat-card-grid">{children}</div>
);

export const StatCard = ({ label, value, unit }: {
  label: string; value: React.ReactNode; unit?: string; accent?: boolean; icon?: React.ReactNode;
}) => (
  <div data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
    <span>{label}</span>
    <span>{value}</span>
    {unit && <span>{unit}</span>}
  </div>
);

export const StatCardSkeleton = () => <div data-testid="stat-skeleton" />;

export const ChartSection = ({ children, title, subtitle }: {
  children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode;
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
  subtitle?: string;
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

export const DateRangePicker = ({ onChange }: {
  value?: unknown; preset?: string; onChange?: (r: unknown, p?: string) => void;
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

export const Button = ({ children, onClick, iconLeft, ...p }: {
  children: React.ReactNode; onClick?: () => void; iconLeft?: React.ReactNode;
  variant?: string; size?: string; type?: 'button' | 'submit' | 'reset';
}) => (
  <button onClick={onClick} type={(p as { type?: 'button' | 'submit' | 'reset' }).type ?? 'button'}>
    {iconLeft}{children}
  </button>
);

export const Badge = ({ children, dot }: { children: React.ReactNode; variant?: string; dot?: boolean }) =>
  <span data-testid="badge">{children}</span>;

export const ThemeToggle = () => <button data-testid="theme-toggle">Toggle theme</button>;

export const Input = ({ label, placeholder, type, value, onChange, required }: {
  label?: string; placeholder?: string; type?: string;
  value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement>; required?: boolean;
}) => (
  <div>
    {label && <label>{label}</label>}
    <input type={type} placeholder={placeholder} value={value} onChange={onChange} required={required} />
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => <div className={className} />;
export const ChartSkeleton = ({ className }: { className?: string }) => <div className={className} />;
