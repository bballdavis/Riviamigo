/** Maintenance schedule drafts: the text rows the editor holds, their validation, and the staged-edit bookkeeping. */
import type { OwnershipMaintenanceCategory, OwnershipMaintenanceItem } from '@riviamigo/types';
import type { ScheduleTarget } from './model';

/** One schedule row held as text while it is edited. */
export interface ItemDraft {
  id: string;
  label: string;
  category: OwnershipMaintenanceCategory;
  miles: string;
  months: string;
  cost: string;
}

export type ItemErrors = Partial<Record<'label' | 'miles' | 'months' | 'cost', string>>;

export const toDraft = (item: OwnershipMaintenanceItem): ItemDraft => ({
  id: item.id,
  label: item.label,
  category: item.category,
  miles: item.interval_mi == null ? '' : String(item.interval_mi),
  months: item.interval_months == null ? '' : String(item.interval_months),
  cost: String(item.cost_usd),
});

/** An unsaved change to one vehicle's schedule, staged until the Settings page is saved. */
export interface ScheduleEdit {
  drafts: ItemDraft[];
  /** The user chose "Reset to built-in"; saving clears the stored schedule if the rows still match it. */
  resetToBuiltIn: boolean;
}

export type ScheduleEdits = Record<string, ScheduleEdit>;
export type ScheduleErrors = Record<string, ItemErrors[]>;

const sameDrafts = (left: ItemDraft[], right: ItemDraft[]) => JSON.stringify(left) === JSON.stringify(right);

/** Drop edits that no longer change anything, so an undone edit is not "unsaved". */
export function normalizeScheduleEdits(edits: ScheduleEdits, targets: ScheduleTarget[]): ScheduleEdits {
  const next: ScheduleEdits = {};
  for (const [key, edit] of Object.entries(edits)) {
    const target = targets.find((entry) => entry.key === key);
    if (!target) continue;
    const savedDrafts = target.schedule.map(toDraft);
    const builtInDrafts = target.builtIn.map(toDraft);
    const unchanged = edit.resetToBuiltIn
      ? !target.edited && sameDrafts(edit.drafts, builtInDrafts)
      : sameDrafts(edit.drafts, savedDrafts);
    if (!unchanged) next[key] = edit;
  }
  return next;
}

/**
 * Apply staged schedule edits to the stored maintenance map. Returns per-target
 * field errors instead of a map when any edited row is invalid.
 */
export function applyScheduleEdits(
  stored: Record<string, OwnershipMaintenanceItem[]> | null | undefined,
  edits: ScheduleEdits,
  targets: ScheduleTarget[],
): { maintenance: Record<string, OwnershipMaintenanceItem[]> | null; errors: ScheduleErrors } {
  const maintenance = { ...(stored ?? {}) };
  const errors: ScheduleErrors = {};
  for (const [key, edit] of Object.entries(edits)) {
    const target = targets.find((entry) => entry.key === key);
    if (edit.resetToBuiltIn && target && sameDrafts(edit.drafts, target.builtIn.map(toDraft))) {
      delete maintenance[key];
      continue;
    }
    const result = draftsToSchedule(edit.drafts);
    if (result.schedule) maintenance[key] = result.schedule;
    else errors[key] = result.errors;
  }
  return { maintenance: Object.keys(errors).length ? null : maintenance, errors };
}

/** Validate drafts against the limits the API enforces. */
export function draftsToSchedule(drafts: ItemDraft[]): {
  schedule: OwnershipMaintenanceItem[] | null;
  errors: ItemErrors[];
} {
  const number = (raw: string) => Number(raw.trim().replace(/[$,\s]/g, ''));
  const errors = drafts.map((draft) => {
    const found: ItemErrors = {};
    const label = draft.label.trim();
    if (!label || label.length > 60) found.label = 'Enter a name of 1 to 60 characters.';
    const miles = draft.miles.trim();
    const months = draft.months.trim();
    if (!miles && !months) found.miles = 'Enter miles, months, or both.';
    if (miles && !(number(miles) >= 100 && number(miles) <= 500_000)) found.miles = 'Enter 100 to 500,000 miles.';
    if (months && !(Number.isInteger(number(months)) && number(months) >= 1 && number(months) <= 240)) {
      found.months = 'Enter 1 to 240 months.';
    }
    if (!(number(draft.cost) >= 0 && number(draft.cost) <= 100_000)) found.cost = 'Enter $0 to $100,000.';
    return found;
  });
  if (errors.some((found) => Object.keys(found).length > 0)) return { schedule: null, errors };
  return {
    errors,
    schedule: drafts.map((draft) => ({
      id: draft.id,
      label: draft.label.trim(),
      category: draft.category,
      interval_mi: draft.miles.trim() ? number(draft.miles) : null,
      interval_months: draft.months.trim() ? number(draft.months) : null,
      cost_usd: number(draft.cost),
    })),
  };
}
