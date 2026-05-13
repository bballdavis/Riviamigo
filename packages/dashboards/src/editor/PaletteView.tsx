import React, { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { WidgetDef } from '../registry';

interface PaletteViewProps {
  widgets: WidgetDef[];
  onAdd: (def: WidgetDef) => void;
}

export function PaletteView({ widgets, onAdd }: PaletteViewProps) {
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? widgets.filter(
        (def) =>
          def.title.toLowerCase().includes(search.toLowerCase()) ||
          def.componentType.toLowerCase().includes(search.toLowerCase()) ||
          def.definitionId.toLowerCase().includes(search.toLowerCase())
      )
    : widgets;

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="shrink-0 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
        Add Widget
      </p>
      <div className="relative h-8 shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" />
        <input
          type="search"
          placeholder="Search widgets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-full w-full rounded-lg border border-border bg-bg pl-8 pr-3 text-xs placeholder:text-fg-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
      </div>
      <div className="flex min-h-0 flex-col gap-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        {filtered.map((def) => (
          <button
            key={`${def.componentType}:${def.definitionId}`}
            onClick={() => onAdd(def)}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs transition-colors hover:bg-bg-surface"
          >
            <Plus className="h-3 w-3 shrink-0 text-fg-tertiary" />
            <span className="min-w-0 truncate">{def.title}</span>
            <span className="ml-auto shrink-0 capitalize text-fg-tertiary">{def.componentType}</span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-tertiary">No widgets found</p>
        ) : null}
      </div>
    </div>
  );
}
