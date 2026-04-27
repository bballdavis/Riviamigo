import * as React from 'react';
import { cn } from '../lib/utils';

// ── Page shell ─────────────────────────────────────────────────────────────

export interface PageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function PageLayout({ title, subtitle, actions, children, className }: PageLayoutProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold font-display text-fg tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-fg-tertiary">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Stat card grid ──────────────────────────────────────────────────────────

export function StatCardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-4', className)}>
      {children}
    </div>
  );
}

// ── Chart section ───────────────────────────────────────────────────────────

export interface ChartSectionProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ChartSection({ title, subtitle, actions, children, className }: ChartSectionProps) {
  return (
    <div className={cn('bg-bg-surface border border-border rounded-xl p-5', className)}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium text-fg-secondary uppercase tracking-wider">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-fg-tertiary">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
