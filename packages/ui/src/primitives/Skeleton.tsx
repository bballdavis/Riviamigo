import * as React from 'react';
import { cn } from '../lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rounded?: boolean;
}

export function Skeleton({ className, rounded = false, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-bg-elevated',
        rounded ? 'rounded-full' : 'rounded-lg',
        className
      )}
      {...props}
    />
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Y-axis lines */}
      <div className="flex items-end gap-2 h-48">
        <div className="flex flex-col justify-between h-full py-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="w-8 h-2.5" />
          ))}
        </div>
        {/* Bars / area */}
        <div className="flex-1 flex items-end gap-1 h-full">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton
              key={i}
              className="flex-1"
              style={{ height: `${30 + Math.random() * 70}%` }}
            />
          ))}
        </div>
      </div>
      {/* X-axis labels */}
      <div className="flex justify-between pl-10">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="w-10 h-2.5" />
        ))}
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5 flex flex-col gap-3">
      <Skeleton className="w-24 h-3" />
      <Skeleton className="w-32 h-8" />
      <Skeleton className="w-20 h-2.5" />
    </div>
  );
}
