import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Decorative ambient gradient orbs (background element, aria-hidden).
 * Place at the root layout, behind content with -z-10 or pointer-events-none.
 */
export function AmbientOrbs({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('fixed inset-0 overflow-hidden pointer-events-none -z-10', className)}
    >
      {/* Top-left amber orb */}
      <div className="absolute -top-48 -left-48 w-96 h-96 rounded-full bg-accent/5 blur-3xl" />
      {/* Bottom-right subtle orb */}
      <div className="absolute -bottom-64 -right-48 w-[600px] h-[600px] rounded-full bg-accent/3 blur-3xl" />
    </div>
  );
}
