import React, { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { getWidgetEditorMeta } from '../registry';
import type { WidgetDef } from '../registry';

interface PaletteViewProps {
  widgets: WidgetDef[];
  onAdd: (def: WidgetDef) => void;
}

export function PaletteView({ widgets, onAdd }: PaletteViewProps) {
  const [search, setSearch] = useState('');
  const visibleWidgets = widgets.filter((def) => !getWidgetEditorMeta(def).deprecated && !isLegacyStatWidget(def));
  const filtered = search.trim()
    ? visibleWidgets.filter(
        (def) =>
          def.title.toLowerCase().includes(search.toLowerCase()) ||
          def.componentType.toLowerCase().includes(search.toLowerCase()) ||
          def.definitionId.toLowerCase().includes(search.toLowerCase())
      )
    : visibleWidgets;

  return (
    <div className="flex flex-col">
      {/* Sticky search header — sticks to top of the EditorDrawer scroll container */}
      <div
        className="sticky top-0 z-10 flex flex-col gap-2 px-3 pb-2 pt-3"
        style={{ backgroundColor: 'var(--rm-bg-page)' }}
      >
        <p className="text-xs font-medium uppercase tracking-wider text-fg-tertiary">
          Add Widget
        </p>
        <div className="relative h-8">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            placeholder="Search widgets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-full w-full rounded-lg border border-border bg-bg pl-10 pr-3 text-xs placeholder:text-fg-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
      </div>
      <div className="flex flex-col gap-3 px-3 pb-3">
        {groupWidgets(filtered).map(([category, defs]) => (
          <section key={category} className="grid gap-1">
            <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
              {category}
            </p>
            {defs.map((def) => {
              const editor = getWidgetEditorMeta(def);
              return (
                <button
                  key={`${def.componentType}:${def.definitionId}`}
                  onClick={() => onAdd(def)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs transition-colors hover:bg-bg-surface"
                  title={editor.description}
                >
                  <Plus className="h-3 w-3 shrink-0 text-fg-tertiary" />
                  <span className="min-w-0 truncate">{def.title}</span>
                  {editor.fixedSize ? (
                    <span className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-tertiary">
                      Fixed
                    </span>
                  ) : (
                    <span className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-tertiary">
                      Resizable
                    </span>
                  )}
                </button>
              );
            })}
          </section>
        ))}
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-tertiary">No widgets found</p>
        ) : null}
      </div>
    </div>
  );
}

function groupWidgets(widgets: WidgetDef[]) {
  const groups = new Map<string, WidgetDef[]>();
  for (const widget of widgets) {
    const category = getWidgetEditorMeta(widget).category ?? titleCase(widget.componentType);
    groups.set(category, [...(groups.get(category) ?? []), widget]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isLegacyStatWidget(def: WidgetDef) {
  return (
    def.componentType === 'battery' ||
    def.componentType === 'charging' ||
    (def.componentType === 'custom' && def.definitionId === 'trips.stat')
  );
}
