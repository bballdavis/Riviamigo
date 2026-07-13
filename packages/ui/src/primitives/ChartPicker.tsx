import * as React from 'react';
import { Check, ChevronDown, Search, Star } from 'lucide-react';
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
  defaultValue?: TValue;
  onSetDefault?: (value: TValue) => void;
  variant?: 'default' | 'compact';
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
  defaultValue,
  onSetDefault,
  variant = 'default',
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

  function renderDefaultButton(option: ChartPickerOption & { value: TValue }) {
    if (!onSetDefault) return null;
    const isDefault = option.value === defaultValue;
    return (
      <button
        type="button"
        aria-label={isDefault ? `${option.label} is the default chart` : `Set ${option.label} as default`}
        title={isDefault ? 'Default chart' : `Set ${option.label} as default`}
        aria-pressed={isDefault}
        disabled={isDefault}
        onClick={(event) => {
          event.stopPropagation();
          onSetDefault(option.value);
        }}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
          isDefault
            ? 'text-accent sm:opacity-100'
            : 'text-fg-tertiary hover:bg-bg-elevated hover:text-accent',
        )}
      >
        <Star className="h-4 w-4" fill={isDefault ? 'currentColor' : 'none'} />
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <div ref={rootRef} className={cn('relative', className)}>
        <button
          type="button"
          aria-label={selectLabel}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
          className={cn(
            'flex h-10 max-w-[min(16rem,calc(100vw-8rem))] items-center justify-between gap-2 rounded-lg border border-border bg-bg-surface px-3 text-left text-sm font-medium text-fg',
            'transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
          )}
        >
          <span className="truncate">{selectedOption?.label ?? 'Select chart'}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-fg-tertiary transition-transform', isOpen && 'rotate-180')} />
        </button>
        {isOpen ? (
          <div className="absolute left-0 top-[calc(100%+0.375rem)] z-40 min-w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-bg-surface p-1 shadow-lg">
            <div role="listbox">
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      'group flex w-full items-center justify-between gap-1 rounded-md text-sm text-fg transition-colors',
                      'hover:bg-bg-elevated',
                      isSelected && 'bg-accent/10 text-accent',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      <span className="truncate">{option.label}</span>
                      {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                    </button>
                    {renderDefaultButton(option)}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
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
          className={cn(
            'absolute left-0 right-0 top-[calc(100%+0.375rem)] z-40 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-surface p-1 shadow-lg',
          )}
        >
          <div role="listbox">
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      'group flex w-full items-center justify-between gap-1 rounded-md text-sm text-fg transition-all',
                      'hover:bg-bg-elevated',
                      isSelected && 'bg-accent/10 text-accent',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-3 py-2 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      <span className="truncate">{option.label}</span>
                      {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                    </button>
                    {renderDefaultButton(option)}
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-3 text-sm text-fg-tertiary">No charts found</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
