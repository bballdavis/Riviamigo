import React, { useMemo, useState } from 'react';
import {
  AirVent,
  ClipboardCheck,
  Cog,
  Disc,
  Droplet,
  Droplets,
  LifeBuoy,
  Plus,
  RotateCcw,
  RotateCw,
  ShieldPlus,
  ThermometerSnowflake,
  Trash2,
  Wind,
  Wrench,
  Zap,
} from 'lucide-react';
import { useOwnership, useUpdateOwnershipSettings } from '@riviamigo/hooks';
import type { OwnershipMaintenanceCategory, OwnershipMaintenanceItem } from '@riviamigo/types';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, SelectPicker } from '@riviamigo/ui/primitives';
import { buildLedger, formatUsd, normalizeOwnershipResponse, scheduleTargets } from './model';

const CATEGORY_OPTIONS: Array<{ value: OwnershipMaintenanceCategory; label: string }> = [
  { value: 'oil', label: 'Oil' },
  { value: 'brakes', label: 'Brakes' },
  { value: 'tires', label: 'Tires' },
  { value: 'service', label: 'Service' },
];

const CATEGORY_ICON: Record<OwnershipMaintenanceCategory, React.ReactElement<{ className?: string }>> = {
  oil: <Droplet />,
  brakes: <Disc />,
  tires: <LifeBuoy />,
  service: <Wrench />,
};

/** An icon for what the item actually is, matched on its name; the category's icon otherwise. */
function itemIcon(label: string, category: OwnershipMaintenanceCategory): React.ReactElement<{ className?: string }> {
  const name = label.toLowerCase();
  if (/rotat/.test(name)) return <RotateCw />;
  if (/inspect/.test(name)) return <ClipboardCheck />;
  if (/brake fluid/.test(name)) return <Droplets />;
  if (/hepa/.test(name)) return <ShieldPlus />;
  if (/cabin|microfilter/.test(name)) return <Wind />;
  if (/engine air|air filter/.test(name)) return <AirVent />;
  if (/coolant/.test(name)) return <ThermometerSnowflake />;
  if (/spark/.test(name)) return <Zap />;
  if (/gear|transfer|transmission|differential/.test(name)) return <Cog />;
  if (/oil/.test(name)) return <Droplet />;
  if (/pad|rotor|brake/.test(name)) return <Disc />;
  if (/tire/.test(name)) return <LifeBuoy />;
  return CATEGORY_ICON[category];
}

/** Item colors, cycled down the list so neighbouring items never share one. */
const ITEM_COLORS = [
  CHART_COLORS.sky,
  CHART_COLORS.emerald,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.yellow,
  CHART_COLORS.teal,
  CHART_COLORS.indigo,
  CHART_COLORS.orange,
];

const MAX_ITEMS = 30;

/** One schedule row held as text while it is edited. */
interface ItemDraft {
  id: string;
  label: string;
  category: OwnershipMaintenanceCategory;
  miles: string;
  months: string;
  cost: string;
}

type ItemErrors = Partial<Record<'label' | 'miles' | 'months' | 'cost', string>>;

const toDraft = (item: OwnershipMaintenanceItem): ItemDraft => ({
  id: item.id,
  label: item.label,
  category: item.category,
  miles: item.interval_mi == null ? '' : String(item.interval_mi),
  months: item.interval_months == null ? '' : String(item.interval_months),
  cost: String(item.cost_usd),
});

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

/** How many times a year an item falls due at the given monthly mileage. */
export function timesPerYear(item: OwnershipMaintenanceItem, milesPerMonth: number): number {
  const byMiles = item.interval_mi ? (milesPerMonth * 12) / item.interval_mi : 0;
  const byTime = item.interval_months ? 12 / item.interval_months : 0;
  // Whichever comes first sets the pace.
  return Math.max(byMiles, byTime);
}

const MONTH_MS = 30.44 * 86_400_000;

/**
 * How many times an item has fallen due since the purchase and when it is next
 * due, at the owner's average monthly mileage. The Ownership page counts only
 * what has fallen due, so this explains why an edit may not move its totals yet.
 */
export function dueSoFarText(
  item: OwnershipMaintenanceItem,
  milesPerMonth: number,
  startMs: number,
  nowMs: number,
): string {
  const byMiles = item.interval_mi && milesPerMonth > 0 ? item.interval_mi / milesPerMonth : Number.POSITIVE_INFINITY;
  const byTime = item.interval_months ?? Number.POSITIVE_INFINITY;
  const every = Math.min(byMiles, byTime);
  if (!Number.isFinite(every) || every <= 0) return 'Not due at your mileage';
  const elapsed = Math.max(0, (nowMs - startMs) / MONTH_MS);
  const done = Math.floor(elapsed / every);
  const next = new Date(startMs + (done + 1) * every * MONTH_MS).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${done === 0 ? 'Not due yet' : `Due ${done}× so far`}, next around ${next}`;
}

function describeInterval(item: OwnershipMaintenanceItem): string {
  const miles = item.interval_mi ? `${Math.round(item.interval_mi).toLocaleString('en-US')} mi` : null;
  const months = item.interval_months
    ? item.interval_months % 12 === 0
      ? `${item.interval_months / 12} yr`
      : `${item.interval_months} mo`
    : null;
  return miles && months ? `${miles} or ${months}` : (miles ?? months ?? '');
}

/** The maintenance schedule behind every vehicle on one Rivian's Ownership page. */
export function MaintenanceSchedulesCard({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  return (
    <Card>
      <CardHeader className="mb-3 flex-col items-start gap-1">
        <SettingsCardTitle icon={<Wrench />} color={CHART_COLORS.violet}>
          Maintenance schedules
        </SettingsCardTitle>
        <p className="text-sm text-fg-secondary">
          What each vehicle on the Ownership page needs and how often. Each item is due at its mileage or its time
          interval, whichever comes first, counting from the purchase date. The built-in schedules follow the
          manufacturers&apos; published intervals and typical U.S. prices. Only items that have fallen due count
          toward To Date; the rest show up in Project.
        </p>
      </CardHeader>
      <CardContent>
        <VehicleSchedules vehicleId={vehicleId} ownLabel={ownLabel} />
      </CardContent>
    </Card>
  );
}

/** Card heading used across Settings > Ownership: accent icon and a bold title. */
export function SettingsCardTitle({
  icon,
  color = CHART_COLORS.sky,
  children,
}: {
  icon: React.ReactElement<{ className?: string }>;
  /** Icon color; each section on a page gets its own. The title stays primary text. */
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <CardTitle className="flex items-center gap-2 text-base font-bold normal-case tracking-normal text-fg">
      <span aria-hidden style={{ color }}>
        {React.cloneElement(icon, { className: 'h-5 w-5' })}
      </span>
      {children}
    </CardTitle>
  );
}

function VehicleSchedules({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  const ownership = useOwnership(vehicleId);
  const { isLoading, isError } = ownership;
  const data = useMemo(() => (ownership.data ? normalizeOwnershipResponse(ownership.data) : undefined), [ownership.data]);
  const update = useUpdateOwnershipSettings(vehicleId);
  const [targetKey, setTargetKey] = useState('own');
  const [now] = useState(() => new Date());

  const targets = useMemo(() => (data ? scheduleTargets(data, ownLabel) : []), [data, ownLabel]);
  const ledger = useMemo(
    () => (data ? buildLedger(data, { horizon: 'to_date', now, ownLabel }) : null),
    [data, now, ownLabel],
  );
  const milesPerMonth = ledger?.avgMonthlyMiles ?? 0;

  if (isError) return <p className="text-sm text-status-danger">Maintenance schedules could not be loaded.</p>;
  if (isLoading || !data) return <p className="text-sm text-fg-secondary">Loading maintenance schedules...</p>;
  const target = targets.find((entry) => entry.key === targetKey) ?? targets[0];
  if (!target) return null;

  const save = (schedule: OwnershipMaintenanceItem[] | null, onDone: () => void) => {
    const maintenance = { ...(data.settings.maintenance ?? {}) };
    if (schedule) maintenance[target.key] = schedule;
    else delete maintenance[target.key];
    update.mutate({ ...data.settings, maintenance }, { onSuccess: onDone });
  };

  return (
    <div className="grid gap-4">
      <SelectPicker
        className="w-full sm:max-w-sm"
        aria-label="Vehicle schedule to edit"
        value={target.key}
        onChange={(key) => {
          update.reset();
          setTargetKey(key);
        }}
        options={targets.map((entry) => ({
          value: entry.key,
          label: entry.edited ? `${entry.label} (edited)` : entry.label,
          group: entry.key === 'own' ? 'Your vehicle' : 'Compared vehicles',
        }))}
      />
      <ScheduleEditor
        key={target.key}
        title={target.label}
        schedule={target.schedule}
        builtIn={target.builtIn}
        edited={target.edited}
        canEdit={data.can_edit}
        milesPerMonth={milesPerMonth}
        startMs={ledger?.startMs ?? now.getTime()}
        nowMs={now.getTime()}
        saving={update.isPending}
        saveFailed={update.isError}
        onSave={save}
      />
    </div>
  );
}

function ScheduleEditor({
  title,
  schedule,
  builtIn,
  edited,
  canEdit,
  milesPerMonth,
  startMs,
  nowMs,
  saving,
  saveFailed,
  onSave,
}: {
  title: string;
  schedule: OwnershipMaintenanceItem[];
  builtIn: OwnershipMaintenanceItem[];
  edited: boolean;
  canEdit: boolean;
  milesPerMonth: number;
  startMs: number;
  nowMs: number;
  saving: boolean;
  saveFailed: boolean;
  /** Saves the schedule, or clears the saved one when given `null`. */
  onSave: (schedule: OwnershipMaintenanceItem[] | null, onDone: () => void) => void;
}) {
  const [drafts, setDrafts] = useState(() => schedule.map(toDraft));
  const [errors, setErrors] = useState<ItemErrors[]>([]);
  const [saved, setSaved] = useState(false);
  const preview = draftsToSchedule(drafts).schedule ?? schedule;
  const yearly = preview.reduce((sum, item) => sum + timesPerYear(item, milesPerMonth) * item.cost_usd, 0);

  const change = (index: number, patch: Partial<ItemDraft>) => {
    setSaved(false);
    setDrafts((current) => current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));
  };
  const remove = (index: number) => {
    setSaved(false);
    setDrafts((current) => current.filter((_, at) => at !== index));
    setErrors((current) => current.filter((_, at) => at !== index));
  };
  const add = () => {
    setSaved(false);
    setDrafts((current) => [
      ...current,
      { id: `item-${Date.now().toString(36)}`, label: '', category: 'service', miles: '', months: '12', cost: '' },
    ]);
  };
  const submit = () => {
    const result = draftsToSchedule(drafts);
    setErrors(result.errors);
    if (result.schedule) onSave(result.schedule, () => setSaved(true));
  };
  const reset = () => {
    setDrafts(builtIn.map(toDraft));
    setErrors([]);
    onSave(null, () => setSaved(true));
  };

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
            disabled={!edited || saving}
            onClick={reset}
          >
            Reset to built-in
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={submit} className="ml-auto">
            Save schedule
          </Button>
          <span className="w-full text-sm text-fg-secondary sm:w-auto" role="status">
            {saveFailed ? 'The schedule could not be saved.' : saved ? 'Saved.' : ''}
          </span>
        </div>
      ) : (
        <p className="text-sm text-fg-secondary">Only the vehicle&apos;s owner or a manager can edit its schedules.</p>
      )}
    </div>
  );
}
