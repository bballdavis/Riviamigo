import React, { useEffect, useMemo, useState } from 'react';
import { Disc, Droplet, LifeBuoy, Plus, RotateCcw, Trash2, Wrench } from 'lucide-react';
import { useOwnership, useUpdateOwnershipSettings } from '@riviamigo/hooks';
import type { OwnershipMaintenanceCategory, OwnershipMaintenanceItem, Vehicle } from '@riviamigo/types';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, SelectPicker } from '@riviamigo/ui/primitives';
import { buildLedger, formatUsd, scheduleTargets } from './model';

const CATEGORY_OPTIONS: Array<{ value: OwnershipMaintenanceCategory; label: string }> = [
  { value: 'oil', label: 'Oil' },
  { value: 'brakes', label: 'Brakes' },
  { value: 'tires', label: 'Tires' },
  { value: 'service', label: 'Service' },
];

const CATEGORY_STYLE: Record<OwnershipMaintenanceCategory, { icon: React.ReactElement<{ className?: string }>; color: string }> = {
  oil: { icon: <Droplet />, color: CHART_COLORS.amber },
  brakes: { icon: <Disc />, color: CHART_COLORS.rose },
  tires: { icon: <LifeBuoy />, color: CHART_COLORS.violet },
  service: { icon: <Wrench />, color: CHART_COLORS.sky },
};

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

function describeInterval(item: OwnershipMaintenanceItem): string {
  const miles = item.interval_mi ? `${Math.round(item.interval_mi).toLocaleString('en-US')} mi` : null;
  const months = item.interval_months
    ? item.interval_months % 12 === 0
      ? `${item.interval_months / 12} yr`
      : `${item.interval_months} mo`
    : null;
  return miles && months ? `${miles} or ${months}` : (miles ?? months ?? '');
}

/** Settings tab: the maintenance schedule behind every vehicle on the Ownership page. */
export function MaintenanceSchedulesSection({ vehicles }: { vehicles: Vehicle[] }) {
  const owned = vehicles.filter((vehicle) => !vehicle.is_demo);
  const choices = owned.length > 0 ? owned : vehicles;
  const [vehicleId, setVehicleId] = useState<string | null>(choices[0]?.id ?? null);
  useEffect(() => {
    if (!vehicleId && choices[0]) setVehicleId(choices[0].id);
  }, [choices, vehicleId]);
  const vehicle = choices.find((entry) => entry.id === vehicleId);

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center">
        <div>
          <CardTitle className="text-base font-bold text-fg">Maintenance schedules</CardTitle>
          <p className="mt-1 text-sm text-fg-secondary">
            What each vehicle on the Ownership page needs and how often. Each item is due at its mileage or its time
            interval, whichever comes first. The built-in schedules follow the manufacturers&apos; published intervals
            and typical U.S. prices; edit any of them to match your own.
          </p>
        </div>
        {choices.length > 1 ? (
          <SelectPicker
            className="w-full sm:w-auto sm:min-w-[11rem]"
            aria-label="Vehicle whose Ownership page to edit"
            value={vehicleId ?? ''}
            onChange={(id) => setVehicleId(id)}
            options={choices.map((entry) => ({ value: entry.id, label: entry.display_name || entry.model }))}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {vehicle ? (
          <VehicleSchedules key={vehicle.id} vehicleId={vehicle.id} ownLabel={vehicle.display_name || vehicle.model} />
        ) : (
          <p className="text-sm text-fg-secondary">Add a vehicle to set up its maintenance schedules.</p>
        )}
      </CardContent>
    </Card>
  );
}

function VehicleSchedules({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  const { data, isLoading, isError } = useOwnership(vehicleId);
  const update = useUpdateOwnershipSettings(vehicleId);
  const [targetKey, setTargetKey] = useState('own');
  const [now] = useState(() => new Date());

  const targets = useMemo(() => (data ? scheduleTargets(data, ownLabel) : []), [data, ownLabel]);
  const milesPerMonth = useMemo(
    () => (data ? buildLedger(data, { horizon: 'to_date', now, ownLabel }).avgMonthlyMiles : 0),
    [data, now, ownLabel],
  );

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
          const style = CATEGORY_STYLE[draft.category];
          const itemErrors = errors[index] ?? {};
          const item = preview[index];
          const pace = item ? timesPerYear(item, milesPerMonth) : 0;
          const field = (key: 'label' | 'miles' | 'months' | 'cost') => ({
            id: `maintenance-${draft.id}-${key}`,
            disabled: !canEdit,
            ...(itemErrors[key] ? { error: itemErrors[key] } : {}),
          });
          return (
            <li
              key={draft.id}
              className="@container/item rounded-lg border border-border bg-bg-elevated/40 p-3"
              style={{ borderLeftColor: style.color, borderLeftWidth: 3 }}
            >
              <div className="grid gap-2 @min-[44rem]/item:grid-cols-[minmax(0,2.6fr)_7.5rem_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_auto] @min-[44rem]/item:items-start">
                <div className="flex items-start gap-2 @min-[44rem]/item:order-1">
                  <span
                    aria-hidden
                    className="mt-[1.85rem] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                    style={{ color: style.color, backgroundColor: `color-mix(in oklab, ${style.color} 16%, transparent)` }}
                  >
                    {React.cloneElement(style.icon, { className: 'h-4 w-4' })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Input
                      label="Item"
                      value={draft.label}
                      onChange={(event) => change(index, { label: event.target.value })}
                      {...field('label')}
                    />
                  </div>
                </div>
                {/* Phones: intervals on one row, then category, cost and delete on the next.
                    Wide cards: one row in the order name, category, miles, months, cost. */}
                <div className="grid grid-cols-2 gap-2 @min-[44rem]/item:contents">
                  <div className="@min-[44rem]/item:order-3">
                    <Input
                      label="Every (miles)"
                      inputMode="numeric"
                      placeholder="—"
                      value={draft.miles}
                      onChange={(event) => change(index, { miles: event.target.value })}
                      {...field('miles')}
                    />
                  </div>
                  <div className="@min-[44rem]/item:order-4">
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
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 @min-[44rem]/item:contents">
                  <div className="grid gap-1.5 @min-[44rem]/item:order-2">
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
                  <div className="@min-[44rem]/item:order-5">
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
                      className="mt-[1.6rem] inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-secondary transition-colors hover:text-status-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent @min-[44rem]/item:order-6 @min-[44rem]/item:h-9 @min-[44rem]/item:w-9"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
              {item ? (
                <p className="mt-2 text-xs text-fg-secondary">
                  Every {describeInterval(item)}, whichever comes first: about{' '}
                  {pace >= 1 ? `${pace.toFixed(pace >= 10 ? 0 : 1)}× a year` : `once every ${(1 / Math.max(pace, 1e-6)).toFixed(1)} years`}
                  {' · '}
                  <span className="font-mono tabular-nums">{formatUsd(pace * item.cost_usd)}</span> a year
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
