import * as React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type VisibilityState,
  type SortingState,
  type Row,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { Skeleton } from '../primitives/Skeleton';
import { EmptyState } from '../primitives/EmptyState';

export interface DataTableProps<TData> {
  data: TData[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  loading?: boolean;
  loadingRows?: number;
  onRowClick?: (row: Row<TData>) => void;
  getRowIsSelected?: (row: Row<TData>) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  columnVisibilityMenu?: boolean;
  defaultHiddenColumns?: string[];
}

export function DataTable<TData>({
  data,
  columns,
  loading = false,
  loadingRows = 8,
  onRowClick,
  getRowIsSelected,
  emptyTitle = 'No data',
  emptyDescription,
  className,
  columnVisibilityMenu = false,
  defaultHiddenColumns,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    const hidden = defaultHiddenColumns ?? [];
    return hidden.reduce<VisibilityState>((acc, id) => {
      acc[id] = false;
      return acc;
    }, {});
  });
  const [menuPosition, setMenuPosition] = React.useState<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!columnVisibilityMenu || !menuPosition) return;

    const close = () => setMenuPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPosition(null);
    };

    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [columnVisibilityMenu, menuPosition]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const menuColumns = table
    .getAllLeafColumns()
    .filter((column) => typeof column.columnDef.header === 'string');

  const openColumnMenu = (event: React.MouseEvent) => {
    if (!columnVisibilityMenu) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  return (
    <div className={cn('relative w-full overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead onContextMenu={openColumnMenu}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-border">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={cn(
                      'py-2 px-3 text-left text-xs font-medium text-fg-tertiary uppercase tracking-wider whitespace-nowrap',
                      canSort && 'cursor-pointer select-none hover:text-fg-secondary'
                    )}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    onContextMenu={openColumnMenu}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && (
                        <span className="text-fg-tertiary">
                          {sorted === 'asc' ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : sorted === 'desc' ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: loadingRows }).map((_, i) => (
              <tr key={i} className="border-b border-border/50">
                {visibleColumns.map((_, j) => (
                  <td key={j} className="py-2 px-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, visibleColumns.length)}>
                <EmptyState
                  title={emptyTitle}
                  description={emptyDescription}
                  className="py-12"
                />
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => {
              const isSelected = getRowIsSelected?.(row) ?? false;

              return (
                <tr
                  key={row.id}
                  data-state={isSelected ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border/50 transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-bg-elevated',
                    isSelected && 'bg-accent/10 ring-1 ring-inset ring-accent/35 hover:bg-accent/15'
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cn('py-2 px-3 text-fg-secondary', isSelected && 'text-fg')}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {columnVisibilityMenu && menuPosition && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-bg-surface p-2 shadow-lg"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-fg-tertiary">Columns</p>
          {menuColumns.map((column) => {
            const label = column.columnDef.header;
            if (typeof label !== 'string') return null;
            return (
              <label
                key={column.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-fg-secondary hover:bg-bg-elevated"
              >
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
