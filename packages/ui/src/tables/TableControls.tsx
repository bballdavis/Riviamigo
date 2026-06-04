import * as React from 'react';
import { cn } from '../lib/utils';

export interface TableControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  rowsPerPage: number;
  rowsPerPageOptions: readonly number[];
  onRowsPerPageChange: (value: number) => void;
  page: number;
  totalPages: number;
  totalItems: number;
  itemLabel: string;
  searchLabel?: string;
  className?: string;
}

export function TableControls({
  search,
  onSearchChange,
  searchPlaceholder,
  rowsPerPage,
  rowsPerPageOptions,
  onRowsPerPageChange,
  page,
  totalPages,
  totalItems,
  itemLabel,
  searchLabel,
  className,
}: TableControlsProps) {
  const itemLabelPlural = totalItems === 1 ? itemLabel : `${itemLabel}s`;

  return (
    <div className={cn('flex shrink-0 flex-wrap items-center justify-between gap-3', className)}>
      <label className="relative flex-1 min-w-0 sm:min-w-[14rem] max-w-md">
        <span className="sr-only">{searchLabel ?? `Search ${itemLabelPlural}`}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-tertiary focus:border-accent"
        />
      </label>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-fg-tertiary shrink-0">
          Rows
          <select
            value={rowsPerPage}
            onChange={(event) => onRowsPerPageChange(Number(event.target.value))}
            className="rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          >
            {rowsPerPageOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <p className="text-xs text-fg-tertiary">
          Page {page} of {Math.max(totalPages, 1)} | {totalItems} {itemLabelPlural}
        </p>
      </div>
    </div>
  );
}
