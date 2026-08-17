import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, Search, Tag, X } from 'lucide-react';
import { Button, Input, Badge } from '@riviamigo/ui/primitives';
import { useCreateTripTag, useTripTags } from '@riviamigo/hooks';
import type { TripTag } from '@riviamigo/types';
import { formatTripTagName, TripTagBadge } from '@riviamigo/ui/tables';

export interface TripTagPickerProps {
  vehicleId: string | null;
  canManage: boolean;
  selectedIds: string[];
  onChange: (tagIds: string[]) => void;
  label?: string;
  disabled?: boolean;
  mode?: 'popover' | 'inline';
  mixed?: boolean;
}

export function deriveCommonTagIds(trips: Array<{ tags?: Array<Pick<TripTag, 'id'>> | undefined }>): string[] {
  if (trips.length === 0) return [];
  const common = new Set((trips[0]?.tags ?? []).map((tag) => tag.id));
  for (const trip of trips.slice(1)) {
    const ids = new Set((trip.tags ?? []).map((tag) => tag.id));
    for (const id of common) {
      if (!ids.has(id)) common.delete(id);
    }
  }
  return [...common].sort();
}

function normalizeTagName(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function useMobilePicker() {
  const [mobile, setMobile] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}

/** Compact multi-select for shared vehicle tags. It is deliberately local-filtered so every keystroke is instant. */
export function TripTagPicker({ vehicleId, canManage, selectedIds, onChange, label = 'Filter tags', disabled, mode, mixed = false }: TripTagPickerProps) {
  const inline = mode === 'inline';
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const pendingCatalogIds = React.useRef(new Set<string>());
  const cleanedStaleSignature = React.useRef<string | null>(null);
  const isMobile = useMobilePicker();
  const tagsQuery = useTripTags(vehicleId);
  const createTag = useCreateTripTag(vehicleId);
  const tags = tagsQuery.data ?? [];
  const normalizedQuery = normalizeTagName(query);
  const filtered = React.useMemo(
    () => tags.filter((tag) => normalizeTagName(tag.name).includes(normalizedQuery)),
    [tags, normalizedQuery],
  );
  const exact = tags.find((tag) => normalizeTagName(tag.name) === normalizedQuery);
  const [catalogNotice, setCatalogNotice] = React.useState('');
  const [createError, setCreateError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  React.useEffect(() => {
    if (!open || isMobile) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.parentElement?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isMobile, open]);

  React.useEffect(() => {
    if (!tagsQuery.isSuccess || selectedIds.length === 0) return;
    const catalogIds = new Set(tags.map((tag) => tag.id));
    for (const id of catalogIds) pendingCatalogIds.current.delete(id);
    const staleIds = selectedIds.filter((id) => !catalogIds.has(id) && !pendingCatalogIds.current.has(id));
    if (staleIds.length === 0) {
      cleanedStaleSignature.current = null;
      return;
    }
    const signature = staleIds.join(',');
    if (cleanedStaleSignature.current === signature) return;
    cleanedStaleSignature.current = signature;
    onChange(selectedIds.filter((id) => !staleIds.includes(id)));
    setCatalogNotice(`${staleIds.length} unavailable tag${staleIds.length === 1 ? ' was' : 's were'} removed.`);
  }, [onChange, selectedIds, tags, tagsQuery.isSuccess]);

  const select = React.useCallback((id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id].sort());
  }, [onChange, selectedIds]);

  const create = React.useCallback(async () => {
    if (!canManage || !query.trim() || exact) return;
    setCreateError('');
    try {
      const created = await createTag.mutateAsync({ name: formatTripTagName(query) });
      pendingCatalogIds.current.add(created.id);
      onChange([...selectedIds, created.id].sort());
      setQuery('');
    } catch {
      // A duplicate submitted concurrently is resolved from the refreshed catalog.
      try {
        const refreshed = await tagsQuery.refetch();
        const existing = (refreshed.data ?? []).find((tag) => normalizeTagName(tag.name) === normalizedQuery);
        if (existing) {
          onChange([...selectedIds, existing.id].sort());
          setQuery('');
          return;
        }
      } catch {
        // The actionable error below covers both create and conflict-resolution refresh failures.
      }
      setCreateError('Couldn’t create this tag. Check your connection and try again.');
    }
  }, [canManage, createTag, exact, normalizedQuery, onChange, query, selectedIds, tagsQuery]);

  const remove = (id: string) => onChange(selectedIds.filter((selected) => selected !== id));
  const addExisting = React.useCallback((id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds : [...selectedIds, id].sort());
    setQuery('');
  }, [onChange, selectedIds]);
  const selected = tags.filter((tag) => selectedIds.includes(tag.id));
  const optionCount = filtered.length + (canManage && query.trim() && !exact ? 1 : 0);

  if (inline) {
    return (
      <div className="relative min-w-0">
        <div className="flex min-h-11 flex-wrap items-center gap-1 rounded-lg border border-border bg-bg-surface px-2 py-1 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          {selected.map((tag) => (
            <button
              type="button"
              key={tag.id}
              onClick={() => remove(tag.id)}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-accent/20 bg-accent-muted px-1.5 text-sm text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-label={`Remove ${formatTripTagName(tag.name)}`}
              disabled={disabled}
            >
              <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[8rem] truncate" title={formatTripTagName(tag.name)}>{formatTripTagName(tag.name)}</span>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}
          <input
            ref={searchRef}
            value={query}
            disabled={disabled}
            onChange={(event) => { setQuery(event.target.value); setCreateError(''); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, Math.max(optionCount - 1, 0))); return; }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); return; }
              if ((event.key === 'Enter' || event.key === 'Tab') && query.trim()) {
                const tag = filtered[activeIndex];
                if (tag) { event.preventDefault(); addExisting(tag.id); }
                else if (canManage && activeIndex === filtered.length && !exact) { event.preventDefault(); void create(); }
                return;
              }
              if (event.key === 'Backspace' && !query && selectedIds.length) remove(selectedIds[selectedIds.length - 1]!);
            }}
            placeholder={mixed ? 'Mixed tags · add or replace' : selected.length ? 'Add another tag' : label}
            aria-label={mixed ? `${label} (mixed tags across selected trips)` : label}
            aria-autocomplete="list"
            aria-controls="trip-tag-inline-suggestions"
            className="h-8 min-w-[8rem] flex-1 border-0 bg-transparent px-1 text-base text-fg outline-none placeholder:text-fg-tertiary focus:ring-0 sm:text-sm"
          />
        </div>
        {catalogNotice ? <p className="sr-only" role="status" aria-live="polite">{catalogNotice}</p> : null}
        {query.trim() ? (
          <div id="trip-tag-inline-suggestions" className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-bg-surface p-1 shadow-sm" role="listbox" aria-label={`${label} suggestions`}>
            {tagsQuery.isLoading ? <p className="px-2 py-2 text-sm text-fg-tertiary">Loading tags…</p> : null}
            {tagsQuery.isError ? <div className="px-2 py-2 text-sm text-status-danger">Couldn’t load tags. <button type="button" className="font-medium underline underline-offset-2" onClick={() => void tagsQuery.refetch()}>Retry</button></div> : null}
            {!tagsQuery.isLoading && !tagsQuery.isError && filtered.map((tag, index) => (
              <button key={tag.id} type="button" role="option" aria-selected={selectedIds.includes(tag.id)} onClick={() => addExisting(tag.id)} className={`flex min-h-10 w-full items-center rounded-md px-2 text-left text-sm hover:bg-bg-elevated ${activeIndex === index ? 'bg-bg-elevated' : ''}`}>
                <TripTagBadge tag={tag} />
                {selectedIds.includes(tag.id) ? <Check className="ml-auto h-4 w-4 text-accent" aria-hidden="true" /> : null}
              </button>
            ))}
            {!tagsQuery.isLoading && !tagsQuery.isError && filtered.length === 0 && !canManage ? <p className="px-2 py-2 text-sm text-fg-tertiary">No matching tags.</p> : null}
            {canManage && !exact ? <button type="button" role="option" disabled={createTag.isPending} onClick={() => void create()} className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-50 ${activeIndex === filtered.length ? 'bg-accent/10' : ''}`}><Plus className="h-4 w-4" aria-hidden="true" />Create “{formatTripTagName(query)}”</button> : null}
          </div>
        ) : null}
        {createError ? <p className="mt-2 rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-sm text-status-danger" role="alert">{createError}</p> : null}
      </div>
    );
  }

  const panel = open ? (
    <div
      ref={panelRef}
      className={isMobile
        ? 'fixed inset-x-0 bottom-0 z-50 max-h-[80vh] rounded-t-2xl border border-border bg-bg-surface p-4 shadow-xl'
        : 'absolute left-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-bg-surface p-3 shadow-xl'}
      role={isMobile ? 'dialog' : 'listbox'}
      aria-modal={isMobile || undefined}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Tab' && isMobile) {
          const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (first && last && event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (first && last && !event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
        if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, Math.max(optionCount - 1, 0))); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); }
        if (event.key === 'Enter') {
          const tag = filtered[activeIndex];
          if (tag) { event.preventDefault(); select(tag.id); }
          else if (canManage && query.trim() && !exact) { event.preventDefault(); void create(); }
        }
        if (event.key === 'Backspace' && !query && selectedIds.length) remove(selectedIds[selectedIds.length - 1]!);
      }}
    >
      {isMobile ? <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-fg">{label}</h2><Button type="button" variant="ghost" size="md" className="h-11 w-11 px-0" onClick={() => setOpen(false)} aria-label="Close tag picker"><X className="h-4 w-4" /></Button></div> : null}
      <Input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setCreateError(''); }} placeholder="Search tags" iconLeft={<Search className="h-4 w-4" />} className="h-11" aria-label="Search existing tags" />
      <p className="mt-2 text-xs text-fg-tertiary" role="status" aria-live="polite">{query.trim() ? `${filtered.length} matching tag${filtered.length === 1 ? '' : 's'}` : `${tags.length} shared tag${tags.length === 1 ? '' : 's'}`}</p>
      {catalogNotice ? <p className="sr-only" role="status" aria-live="polite">{catalogNotice}</p> : null}
      <div className="mt-3 max-h-64 overflow-y-auto" role={isMobile ? 'listbox' : undefined}>
        {tagsQuery.isLoading ? <p className="px-2 py-4 text-sm text-fg-tertiary">Loading tags…</p> : null}
        {tagsQuery.isError ? <div className="px-2 py-3 text-sm text-status-danger">Couldn’t load tags. <button type="button" className="font-medium underline underline-offset-2" onClick={() => void tagsQuery.refetch()}>Retry</button></div> : null}
        {!tagsQuery.isLoading && !tagsQuery.isError && filtered.map((tag, index) => (
          <button key={tag.id} type="button" role="option" aria-selected={selectedIds.includes(tag.id)} onClick={() => select(tag.id)} className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors ${activeIndex === index ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'}`}>
            <TripTagBadge tag={tag} />
            {selectedIds.includes(tag.id) ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
          </button>
        ))}
        {!tagsQuery.isLoading && !tagsQuery.isError && filtered.length === 0 && !query.trim() ? <p className="px-2 py-4 text-sm text-fg-tertiary">No shared tags yet{canManage ? '. Create one to organize your trips.' : '.'}</p> : null}
            {!tagsQuery.isLoading && !tagsQuery.isError && filtered.length === 0 && query.trim() && !canManage ? <p className="px-2 py-4 text-sm text-fg-tertiary">No matching tags.</p> : null}
        {canManage && query.trim() && !exact ? <button type="button" disabled={createTag.isPending} onClick={() => void create()} className={`mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50 ${activeIndex === filtered.length ? 'bg-accent/10' : ''}`}><Plus className="h-4 w-4" />Create “{formatTripTagName(query)}”</button> : null}
      </div>
      {createError ? <p className="mt-2 rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-sm text-status-danger" role="alert">{createError}</p> : null}
      {isMobile ? <Button type="button" variant="secondary" size="md" className="mt-3 h-11 w-full" onClick={() => setOpen(false)}>Done</Button> : null}
    </div>
  ) : null;

  return (
    <div className="relative min-w-0">
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-bg-surface px-3 text-left text-sm text-fg transition-colors hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" aria-expanded={open} aria-haspopup={isMobile ? 'dialog' : 'listbox'}>
        <span className="truncate">{selected.length ? `${selected.length} tag${selected.length === 1 ? '' : 's'} selected` : label}</span><ChevronDown className="ml-auto h-4 w-4 shrink-0 text-fg-tertiary" />
      </button>
      {selected.length ? <div className="mt-2 flex flex-wrap gap-1">{selected.map((tag) => <button type="button" key={tag.id} onClick={() => remove(tag.id)} className="inline-flex h-11 items-center gap-1 rounded-lg px-1.5 focus:outline-none focus:ring-1 focus:ring-accent" aria-label={`Remove ${formatTripTagName(tag.name)}`}><TripTagBadge tag={tag} /><X className="h-3.5 w-3.5 text-fg-tertiary" /></button>)}</div> : null}
      {isMobile && open ? createPortal(<div className="fixed inset-0 z-40 bg-bg-page/70" aria-hidden="true" onClick={() => setOpen(false)} />, document.body) : null}
      {isMobile && open ? createPortal(panel, document.body) : panel}
    </div>
  );
}

export function TripTagBadges({ tags }: { tags?: TripTag[] | undefined }) {
  if (!tags?.length) return null;
  return <div className="mt-2 flex flex-wrap gap-1">{tags.slice(0, 3).map((tag) => <TripTagBadge key={tag.id} tag={tag} />)}{tags.length > 3 ? <Badge size="sm">+{tags.length - 3}</Badge> : null}</div>;
}
