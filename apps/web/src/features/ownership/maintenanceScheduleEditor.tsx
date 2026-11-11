/** One vehicle's schedule editor: its items as editable rows with the per-year cost and due-so-far figures. */
import React from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { OwnershipMaintenanceCategory, OwnershipMaintenanceItem } from '@riviamigo/types';
import { Badge, Button, Input, SelectPicker } from '@riviamigo/ui/primitives';
import { formatUsd } from './model';
import {
  draftsToSchedule,
  toDraft,
  type ItemDraft,
  type ItemErrors,
  type ScheduleEdit,
} from './maintenanceScheduleDrafts';
import { describeInterval, dueSoFarText, timesPerYear } from './maintenanceScheduleMath';
import { CATEGORY_OPTIONS, ITEM_COLORS, itemIcon } from './maintenanceScheduleVisuals';

const MAX_ITEMS = 30;

export function ScheduleEditor({
  title,
  drafts,
  errors,
  builtIn,
  edited,
  canReset,
  canEdit,
  milesPerMonth,
  startMs,
  nowMs,
  resetToBuiltIn,
  onChange,
}: {
  title: string;
  drafts: ItemDraft[];
  errors: ItemErrors[];
  builtIn: OwnershipMaintenanceItem[];
  edited: boolean;
  canReset: boolean;
  canEdit: boolean;
  milesPerMonth: number;
  startMs: number;
  nowMs: number;
  resetToBuiltIn: boolean;
  /** Stages the edited rows; nothing is saved until the Settings page is saved. */
  onChange: (edit: ScheduleEdit) => void;
}) {
  // Per row, so one unfinished row does not hide the others' figures.
  const preview = drafts.map((draft) => draftsToSchedule([draft]).schedule?.[0]);
  const yearly = preview.reduce(
    (sum, item) => sum + (item ? timesPerYear(item, milesPerMonth) * item.cost_usd : 0),
    0,
  );
  const stage = (next: ItemDraft[]) => onChange({ drafts: next, resetToBuiltIn });

  const change = (index: number, patch: Partial<ItemDraft>) =>
    stage(drafts.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));
  const remove = (index: number) => stage(drafts.filter((_, at) => at !== index));
  const add = () =>
    stage([
      ...drafts,
      { id: `item-${Date.now().toString(36)}`, label: '', category: 'service', miles: '', months: '12', cost: '' },
    ]);
  const reset = () => onChange({ drafts: builtIn.map(toDraft), resetToBuiltIn: true });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-base font-semibold text-fg">{title}</p>
          <Badge variant={edited ? 'warning' : 'default'} size="sm">
            {edited ? 'Edited' : 'Built-in'}
          </Badge>
        </div>
        <p className="text-sm text-fg-secondary">
          About <span className="font-mono font-semibold tabular-nums text-fg">{formatUsd(yearly)}</span> a year at
          your {Math.round(milesPerMonth).toLocaleString('en-US')} mi a month
        </p>
      </div>

      <ul className="grid gap-2">
        {drafts.map((draft, index) => {
          const style = {
            icon: itemIcon(draft.label, draft.category),
            color: ITEM_COLORS[index % ITEM_COLORS.length] as string,
          };
          const itemErrors = errors[index] ?? {};
          const item = preview[index];
          const pace = item ? timesPerYear(item, milesPerMonth) : 0;
          const field = (key: 'label' | 'miles' | 'months' | 'cost') => ({
            id: `maintenance-${draft.id}-${key}`,
            disabled: !canEdit,
            ...(itemErrors[key] ? { error: itemErrors[key] } : {}),
          });
          return (
            <li key={draft.id} className="@container/item rounded-lg border border-border bg-bg-elevated/40 p-3">
              <div className="mb-2 flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                  style={{ color: style.color, backgroundColor: `color-mix(in oklab, ${style.color} 16%, transparent)` }}
                >
                  {React.cloneElement(style.icon, { className: 'h-5 w-5' })}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    id={`maintenance-${draft.id}-label`}
                    aria-label="Item name"
                    placeholder="Item name"
                    value={draft.label}
                    disabled={!canEdit}
                    onChange={(event) => change(index, { label: event.target.value })}
                    className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-bold transition-colors sm:text-lg placeholder:text-fg-tertiary hover:border-border focus:border-accent focus:outline-none"
                    style={{ color: style.color }}
                  />
                  {itemErrors.label ? <p className="px-1.5 text-sm text-status-danger">{itemErrors.label}</p> : null}
                </div>
              </div>
              <div className="grid gap-2 @min-[40rem]/item:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_minmax(0,1fr)_auto] @min-[40rem]/item:items-start">
                {/* Phones: intervals on one row, then category, cost and delete on the next.
                    Wide cards: one row in the order miles, months, category, cost. */}
                <div className="grid grid-cols-2 gap-2 @min-[40rem]/item:contents">
                  <div className="@min-[40rem]/item:order-1">
                    <Input
                      label="Every (miles)"
                      inputMode="numeric"
                      placeholder="—"
                      value={draft.miles}
                      onChange={(event) => change(index, { miles: event.target.value })}
                      {...field('miles')}
                    />
                  </div>
                  <div className="@min-[40rem]/item:order-2">
                    <Input
                      label="Or (months)"
                      inputMode="numeric"
                      placeholder="—"
                      value={draft.months}
                      onChange={(event) => change(index, { months: event.target.value })}
                      {...field('months')}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 @min-[40rem]/item:contents">
                  <div className="grid gap-1.5 @min-[40rem]/item:order-3">
                    <span className="text-sm font-medium text-fg-secondary">Counts as</span>
                    <SelectPicker<OwnershipMaintenanceCategory>
                      aria-label={`Cost column for ${draft.label || 'this item'}`}
                      value={draft.category}
                      disabled={!canEdit}
                      onChange={(category) => change(index, { category })}
                      options={CATEGORY_OPTIONS}
                      triggerClassName="text-fg"
                    />
                  </div>
                  <div className="@min-[40rem]/item:order-4">
                    <Input
                      label="Cost ($)"
                      inputMode="decimal"
                      value={draft.cost}
                      onChange={(event) => change(index, { cost: event.target.value })}
                      {...field('cost')}
                    />
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Remove ${draft.label || 'item'}`}
                      onClick={() => remove(index)}
                      className="mt-[1.6rem] inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-secondary transition-colors hover:text-status-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent @min-[40rem]/item:order-5 @min-[40rem]/item:h-9 @min-[40rem]/item:w-9"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
              {item ? (
                <p className="mt-2 text-sm text-fg-secondary">
                  Every {describeInterval(item)}, whichever comes first: about{' '}
                  {pace >= 1 ? `${pace.toFixed(pace >= 10 ? 0 : 1)}× a year` : `once every ${(1 / Math.max(pace, 1e-6)).toFixed(1)} years`}
                  {' · '}
                  <span className="font-mono tabular-nums">{formatUsd(pace * item.cost_usd)}</span> a year
                  {' · '}
                  <span className="font-medium text-fg">{dueSoFarText(item, milesPerMonth, startMs, nowMs)}</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            disabled={drafts.length >= MAX_ITEMS}
            onClick={add}
          >
            Add item
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RotateCcw className="h-4 w-4" />}
            disabled={!canReset}
            onClick={reset}
          >
            Reset to built-in
          </Button>
        </div>
      ) : (
        <p className="text-sm text-fg-secondary">Only the vehicle&apos;s owner or a manager can edit its schedules.</p>
      )}
    </div>
  );
}
