import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ChartPickerOption {
  value: string;
  label: string;
}

export interface ChartPickerProps<TValue extends string = string> {
  value: TValue;
  options: Array<ChartPickerOption & { value: TValue }>;
  onChange: (value: TValue) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  selectLabel?: string;
  className?: string;
  trailing?: React.ReactNode;
}

export function ChartPicker<TValue extends string = string>({
  value,
  options,
  onChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search charts',
  selectLabel = 'Chart',
  className,
  trailing,
}: ChartPickerProps<TValue>) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const normalizedSearch = searchValue.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedSearch))
    : options;
  const visibleOptions = filteredOptions.some((option) => option.value === value)
    ? filteredOptions
    : options.filter((option) => option.value === value).concat(filteredOptions);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  React.useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  function handleSelect(nextValue: TValue) {
    onChange(nextValue);
    setIsOpen(false);
  }

  return (
    <div ref={rootRef} className={cn('relative mb-3 grid w-full gap-2', trailing ? 'grid-cols-[1fr_auto] sm:grid-cols-[1fr_minmax(0,3fr)_auto]' : 'grid-cols-1 sm:grid-cols-4', className)}>
      <label className={cn('relative', trailing ? 'col-span-2 sm:col-span-1' : '')}>
        <span className="sr-only">Search charts</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" />
        <input
          value={searchValue}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            onSearchChange(event.target.value);
            setIsOpen(true);
          }}
          placeholder={searchPlaceholder}
          className={cn(
            'h-9 w-full rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-sm text-fg',
            'placeholder:text-fg-tertiary transition-colors',
            'hover:border-border-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
          )}
        />
      </label>
      <div>
        <span className="sr-only">{selectLabel}</span>
        <button
          type="button"
          aria-label={selectLabel}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-3 rounded-lg border border-border bg-bg-surface px-3 text-left text-sm text-fg',
            'transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
          )}
        >
          <span className="truncate">{selectedOption?.label ?? 'Select chart'}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-fg-tertiary transition-transform', isOpen && 'rotate-180')} />
        </button>
      </div>
      {trailing ? <div className="flex items-center">{trailing}</div> : null}

      {isOpen ? (
        <div
          role="listbox"
          className={cn(
            'absolute left-0 right-0 top-[calc(100%+0.375rem)] z-40 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-surface p-1 shadow-lg',
          )}
        >
          {visibleOptions.length > 0 ? (
            visibleOptions.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-fg transition-all',
                    'hover:-mx-1 hover:w-[calc(100%+0.5rem)] hover:bg-bg-elevated hover:px-4',
                    isSelected && 'bg-accent/10 text-accent',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-3 text-sm text-fg-tertiary">No charts found</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
