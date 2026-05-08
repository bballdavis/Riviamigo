import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { Search, X } from 'lucide-react';
import { resolveIconId } from './iconMigration';

interface IconPickerProps {
  value: string | undefined;
  onChange: (next: string) => void;
}

const RECENT_KEY = 'riviamigo:icon-picker:recent';
const RECENT_MAX = 16;
const COLLECTIONS = [
  { id: '', label: 'All' },
  { id: 'lucide', label: 'Lucide' },
  { id: 'mdi', label: 'Material' },
  { id: 'heroicons', label: 'Heroicons' },
  { id: 'ph', label: 'Phosphor' },
  { id: 'tabler', label: 'Tabler' },
];

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(next: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const resolved = resolveIconId(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ query: q, limit: '64' });
        if (collection) params.set('prefix', collection);
        const response = await fetch(`https://api.iconify.design/search?${params.toString()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { icons?: string[] };
        if (!cancelled) setResults(Array.isArray(data.icons) ? data.icons : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query, collection]);

  const recentList = useMemo(() => recent.slice(0, RECENT_MAX), [recent]);

  function selectIcon(id: string) {
    onChange(id);
    const next = [id, ...recent.filter((entry) => entry !== id)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent w-full"
      >
        <Icon icon={resolved} className="h-4 w-4 text-accent" />
        <span className="truncate font-mono text-xs text-fg-secondary">{resolved}</span>
        <span className="ml-auto text-[11px] text-fg-tertiary">Change</span>
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-[22rem] rounded-xl border border-border bg-bg-elevated p-3 shadow-2xl"
        >
          <div className="mb-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" />
              <input
                autoFocus
                type="search"
                placeholder="Search icons…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-7 py-1.5 text-xs text-fg outline-none placeholder:text-fg-tertiary focus:border-accent"
              />
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-fg-tertiary hover:bg-bg-surface hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {COLLECTIONS.map((entry) => (
              <button
                key={entry.id || 'all'}
                type="button"
                onClick={() => setCollection(entry.id)}
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                  collection === entry.id
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border bg-bg-surface text-fg-tertiary hover:text-fg'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {recentList.length > 0 ? (
            <div className="mb-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                Recent
              </p>
              <div className="grid grid-cols-8 gap-1">
                {recentList.map((id) => (
                  <button
                    key={id}
                    type="button"
                    title={id}
                    onClick={() => selectIcon(id)}
                    className="flex aspect-square items-center justify-center rounded-md border border-border bg-bg-surface text-fg hover:border-accent hover:text-accent"
                  >
                    <Icon icon={id} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto pr-1">
            {loading ? (
              <p className="col-span-8 py-4 text-center text-xs text-fg-tertiary">Searching…</p>
            ) : results.length === 0 ? (
              <p className="col-span-8 py-4 text-center text-xs text-fg-tertiary">
                {query.trim().length < 2
                  ? 'Type at least 2 characters'
                  : 'No icons found'}
              </p>
            ) : (
              results.map((id) => (
                <button
                  key={id}
                  type="button"
                  title={id}
                  onClick={() => selectIcon(id)}
                  className="flex aspect-square items-center justify-center rounded-md border border-border bg-bg-surface text-fg hover:border-accent hover:text-accent"
                >
                  <Icon icon={id} className="h-4 w-4" />
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
