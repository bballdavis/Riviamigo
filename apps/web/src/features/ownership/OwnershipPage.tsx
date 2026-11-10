import React, { useMemo, useState } from 'react';
import { CircleDollarSign, Pencil, Plus, X } from 'lucide-react';
import {
  useAuth,
  useOwnership,
  useResolvedVehicleSelection,
  useUpdateOwnershipSettings,
} from '@riviamigo/hooks';
import type { OwnershipCustomVehicle, OwnershipResponse, OwnershipSettings } from '@riviamigo/types';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageLayout,
  SelectPicker,
  Skeleton,
  StatCard,
} from '@riviamigo/ui/primitives';
import { AppLayout } from '../../components/layout/AppLayout';
import { NoVehicleState } from '../../components/layout/NoVehicleState';
import { formatMonth, OwnershipChart, type ValueMode } from './OwnershipChart';
import { AddVehicleDialog, EditCostsDialog, ExternalConnectionsLink } from './OwnershipDialogs';
import {
  buildLedger,
  comparisonVehicles,
  enabledComparisonIds,
  formatUsd,
  HORIZONS,
  insightSentence,
  ordinal,
  ownRank,
  type Horizon,
  type Ledger,
  type VehicleLedger,
} from './model';

const MAX_CUSTOM_VEHICLES = 12;

export function OwnershipContent() {
  const { setActiveVehicleId } = useAuth();
  const setSessionVehicleId = setActiveVehicleId ?? (() => {});
  const { authReady, effectiveVehicleId, vehicleSelectionReady, vehicles } = useResolvedVehicleSelection();
  const activeVehicle = vehicles.find((vehicle) => vehicle.id === effectiveVehicleId);
  const ownLabel = activeVehicle?.display_name || activeVehicle?.model || 'Your vehicle';

  return (
    <AppLayout activeKey="ownership">
      <PageLayout
        title="Ownership"
        subtitle="What your Rivian has cost so far, and how the alternatives would have compared."
        className="pt-10 lg:pt-0"
        actions={
          vehicles.length > 1 ? (
            <SelectPicker
              className="min-w-[11rem]"
              value={effectiveVehicleId ?? ''}
              onChange={(vehicleId) => setSessionVehicleId(vehicleId || null)}
              aria-label="Select vehicle"
              options={vehicles.map((vehicle) => ({
                value: vehicle.id,
                label: vehicle.display_name || vehicle.model,
              }))}
            />
          ) : null
        }
      >
        {!authReady || !vehicleSelectionReady ? (
          <div className="p-4 text-xs text-fg-tertiary">Loading...</div>
        ) : !effectiveVehicleId ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account to see what it costs to own."
          />
        ) : (
          <OwnershipDashboard key={effectiveVehicleId} vehicleId={effectiveVehicleId} ownLabel={ownLabel} />
        )}
      </PageLayout>
    </AppLayout>
  );
}

/** The accent is reserved for the owner's vehicle; the two greens sit furthest apart. */
const COMPARISON_COLORS = [
  CHART_COLORS.sky,
  CHART_COLORS.yellow,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.emerald,
  CHART_COLORS.indigo,
  CHART_COLORS.teal,
];

function OwnershipDashboard({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  const { data, isLoading, isError } = useOwnership(vehicleId);
  const update = useUpdateOwnershipSettings(vehicleId);
  const [horizon, setHorizon] = useState<Horizon>('to_date');
  const [mode, setMode] = useState<ValueMode>('spent');
  const [dialog, setDialog] = useState<'costs' | 'add' | null>(null);
  const [localEnabled, setLocalEnabled] = useState<string[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // One clock reading per mount keeps the ledger stable across re-renders.
  const [now] = useState(() => new Date());

  const enabledIds = useMemo(
    () => localEnabled ?? (data ? enabledComparisonIds(data) : []),
    [localEnabled, data],
  );
  const ledger = useMemo(
    () => (data ? buildLedger(data, { horizon, now, ownLabel, enabledIds }) : null),
    [data, horizon, now, ownLabel, enabledIds],
  );
  const colors = useMemo(() => {
    const map: Record<string, string> = { own: CHART_COLORS.accent };
    if (data) {
      comparisonVehicles(data).forEach((vehicle, index) => {
        map[vehicle.id] = COMPARISON_COLORS[index % COMPARISON_COLORS.length] as string;
      });
    }
    return map;
  }, [data]);

  if (isError) {
    return (
      <EmptyState
        icon={<CircleDollarSign />}
        title="Ownership could not be loaded"
        description="Reload the page to try again."
      />
    );
  }
  if (isLoading || !data || !ledger) {
    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const saveSettings = (settings: OwnershipSettings, onSuccess?: () => void) => {
    update.mutate(settings, { onSuccess: () => onSuccess?.() });
  };
  const saveEnabled = (ids: string[], custom = data.settings.comparisons.custom) => {
    setLocalEnabled(ids);
    // Members without edit rights can still explore; their selection is not stored.
    if (data.can_edit) {
      saveSettings({ ...data.settings, comparisons: { enabled: ids, custom } });
    }
  };
  const toggleVehicle = (id: string) => {
    saveEnabled(enabledIds.includes(id) ? enabledIds.filter((entry) => entry !== id) : [...enabledIds, id]);
  };
  const removeCustom = (id: string) => {
    saveEnabled(
      enabledIds.filter((entry) => entry !== id),
      data.settings.comparisons.custom.filter((vehicle) => vehicle.id !== id),
    );
  };
  const addCustom = (vehicle: OwnershipCustomVehicle) => {
    const ids = [...enabledIds, vehicle.id];
    saveSettings(
      { ...data.settings, comparisons: { enabled: ids, custom: [...data.settings.comparisons.custom, vehicle] } },
      () => {
        setLocalEnabled(ids);
        setDialog(null);
      },
    );
  };

  const editCostsDialog =
    dialog === 'costs' ? (
      <EditCostsDialog
        settings={data.settings}
        saving={update.isPending}
        saveFailed={update.isError}
        onClose={() => setDialog(null)}
        onSave={(settings) => saveSettings(settings, () => setDialog(null))}
      />
    ) : null;

  if (data.settings.purchase_price_usd == null) {
    return (
      <>
        <EmptyState
          icon={<CircleDollarSign />}
          title="Add what you paid"
          description={
            data.can_edit
              ? 'Enter the purchase price and date to see what the vehicle has cost and how other cars compare.'
              : 'The vehicle owner has not entered a purchase price yet.'
          }
          {...(data.can_edit ? { action: { label: 'Edit costs', onClick: () => setDialog('costs') } } : {})}
        />
        {editCostsDialog}
      </>
    );
  }

  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn) as VehicleLedger;
  const rank = ownRank(ledger);
  const horizonLabel = HORIZONS.find((entry) => entry.value === horizon)?.label ?? '';
  const lastRecorded = ledger.periods.reduce(
    (last, period, index) => (period.kind === 'projected' ? last : index),
    0,
  );
  const cursorIndex = Math.min(cursor ?? lastRecorded, Math.max(0, ledger.periods.length - 1));
  const allVehicles = comparisonVehicles(data);
  const customCount = data.settings.comparisons.custom.length;
  const insight = insightSentence(ledger, horizonLabel);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Time span"
          value={horizon}
          options={HORIZONS}
          onChange={(value) => {
            setHorizon(value);
            setCursor(null);
          }}
        />
        {data.can_edit ? (
          <Button variant="secondary" size="md" iconLeft={<Pencil className="h-4 w-4" />} onClick={() => setDialog('costs')}>
            Edit costs
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Spent"
          value={formatUsd(own.totals.spent)}
          detail={`Purchase price plus ${formatUsd(own.totals.spent - own.vehicle.priceUsd)} in running costs`}
        />
        <StatCard
          label="Net Cost"
          value={formatUsd(own.totals.net)}
          detail={`After a resale value of ${formatUsd(own.totals.resaleValue)}`}
          accent
        />
        <StatCard
          label="Net Cost per Mile"
          value={own.totals.netPerMile == null ? 'N/A' : formatUsd(own.totals.netPerMile, { cents: true })}
          detail={`Over ${Math.round(own.totals.miles).toLocaleString('en-US')} mi`}
        />
        <StatCard
          label="Rank Among Compared"
          value={rank.of > 1 ? ordinal(rank.rank) : 'N/A'}
          detail={rank.of > 1 ? `Of ${rank.of} by net cost, lowest first` : 'Turn on a vehicle to compare'}
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Compare with</CardTitle>
            <p className="mt-1 text-sm text-fg-tertiary">
              Every vehicle is driven your miles, month by month, from your purchase date.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 text-sm font-medium text-fg sm:min-h-9">
              <Dot color={colors.own} />
              {ownLabel}
            </span>
            {allVehicles.map((vehicle) => {
              const on = enabledIds.includes(vehicle.id);
              return (
                <span key={vehicle.id} className="inline-flex items-center">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleVehicle(vehicle.id)}
                    className={[
                      'inline-flex min-h-11 items-center gap-2 border px-3 text-sm transition-colors sm:min-h-9',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      vehicle.isCustom && data.can_edit ? 'rounded-l-full' : 'rounded-full',
                      on
                        ? 'border-border-strong bg-bg-elevated text-fg'
                        : 'border-border text-fg-tertiary hover:text-fg-secondary',
                    ].join(' ')}
                  >
                    <Dot color={on ? colors[vehicle.id] : undefined} />
                    {vehicle.label}
                  </button>
                  {vehicle.isCustom && data.can_edit ? (
                    <button
                      type="button"
                      aria-label={`Remove ${vehicle.label}`}
                      onClick={() => removeCustom(vehicle.id)}
                      className="inline-flex min-h-11 w-11 items-center justify-center rounded-r-full border border-l-0 border-border text-fg-tertiary transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-9 sm:w-9"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {data.can_edit && customCount < MAX_CUSTOM_VEHICLES ? (
              <button
                type="button"
                onClick={() => {
                  update.reset();
                  setDialog('add');
                }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 text-sm text-fg-secondary transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-9"
              >
                <Plus className="h-4 w-4" />
                Add a vehicle
              </button>
            ) : null}
          </div>
          {insight ? <p className="mt-4 text-sm text-fg-secondary">{insight}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{mode === 'net' ? 'Net cost over time' : 'Money spent over time'}</CardTitle>
              <p className="mt-1 text-sm text-fg-tertiary">
                {mode === 'net'
                  ? 'Purchase price and running costs, less what each vehicle would sell for.'
                  : 'Starts at the purchase price and adds every cost as it lands.'}
              </p>
            </div>
            <Segmented
              label="Chart value"
              value={mode}
              options={[
                { value: 'net', label: 'Net of resale' },
                { value: 'spent', label: 'Money spent' },
              ]}
              onChange={setMode}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0">
              <OwnershipChart
                ledger={ledger}
                mode={mode}
                colors={colors}
                cursorIndex={cursorIndex}
                onCursorChange={setCursor}
              />
              <label className="mt-3 grid gap-1 text-xs text-fg-tertiary">
                Drag to inspect a month
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, ledger.periods.length - 1)}
                  step={1}
                  value={cursorIndex}
                  onChange={(event) => setCursor(Number(event.target.value))}
                  aria-valuetext={formatMonth(ledger.periods[cursorIndex]?.startMs ?? ledger.startMs, { long: true })}
                  className="h-11 w-full accent-accent sm:h-6"
                />
              </label>
              <p className="mt-2 text-xs text-fg-tertiary">
                Fuel and charging accrue with the miles you drove each month. Oil changes, brakes, tires and
                annual service land as one-time jumps at the mileage they fall due.
              </p>
            </div>
            <CursorReadout ledger={ledger} mode={mode} colors={colors} cursorIndex={cursorIndex} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <BreakdownCard ledger={ledger} horizonLabel={horizonLabel} />
        <SourcesCard data={data} ledger={ledger} />
      </div>

      <CostTable ledger={ledger} colors={colors} />

      {editCostsDialog}
      {dialog === 'add' ? (
        <AddVehicleDialog
          lookupEnabled={data.vehicle_lookup_enabled}
          saving={update.isPending}
          saveFailed={update.isError}
          onAdd={addCustom}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Dot({ color }: { color: string | undefined }) {
  return (
    <span
      aria-hidden
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${color ? '' : 'border border-border-strong'}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

function Segmented<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border bg-bg-elevated/50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={[
            'min-h-11 rounded-md px-3 text-sm font-medium transition-colors sm:min-h-8',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            option.value === value ? 'bg-bg-surface text-fg shadow-sm' : 'text-fg-tertiary hover:text-fg-secondary',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const PERIOD_KIND_LABEL = { estimated: 'Estimated', actual: 'Recorded', projected: 'Projected' } as const;

function CursorReadout({
  ledger,
  mode,
  colors,
  cursorIndex,
}: {
  ledger: Ledger;
  mode: ValueMode;
  colors: Record<string, string>;
  cursorIndex: number;
}) {
  const period = ledger.periods[cursorIndex];
  if (!period) return null;
  const values = ledger.vehicles
    .map((entry) => ({ entry, value: entry.atPeriodEnd[cursorIndex + 1]?.[mode] ?? 0 }))
    .sort((a, b) => a.value - b.value);
  return (
    <aside className="rounded-xl border border-border bg-bg-elevated/40 p-4" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-fg">{formatMonth(period.startMs, { long: true })}</p>
        <p className="text-xs text-fg-tertiary">{PERIOD_KIND_LABEL[period.kind]}</p>
      </div>
      <ul className="mt-3 grid gap-2">
        {values.map(({ entry, value }) => (
          <li key={entry.vehicle.id} className="flex items-center justify-between gap-3 text-sm">
            <span className={`flex min-w-0 items-center gap-2 ${entry.vehicle.isOwn ? 'font-semibold text-fg' : 'text-fg-secondary'}`}>
              <Dot color={colors[entry.vehicle.id]} />
              <span className="truncate">{entry.vehicle.label}</span>
            </span>
            <span className="font-mono tabular-nums text-fg">{formatUsd(value)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 grid gap-1.5 border-t border-border pt-3 text-xs text-fg-tertiary">
        <ReadoutRow label="Miles that month" value={Math.round(period.miles).toLocaleString('en-US')} />
        <ReadoutRow
          label={period.gasFromSeries ? 'Gas that month' : 'Gas, estimated'}
          value={`${formatUsd(period.gasRegularUsd, { cents: true })}/gal`}
        />
        <ReadoutRow
          label={ledger.electricityRateAssumed ? 'Charging rate, typical' : 'Your charging rate'}
          value={`${formatUsd(ledger.electricityUsdPerKwh, { cents: true })}/kWh`}
        />
      </dl>
    </aside>
  );
}

function ReadoutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-mono tabular-nums text-fg-secondary">{value}</dd>
    </div>
  );
}

const BREAKDOWN_PARTS = [
  { key: 'depreciation', label: 'Depreciation', color: CHART_COLORS.indigo },
  { key: 'fuel', label: 'Fuel or energy', color: CHART_COLORS.amber },
  { key: 'maintenance', label: 'Maintenance', color: CHART_COLORS.sky },
  { key: 'tires', label: 'Tires', color: CHART_COLORS.violet },
  { key: 'insurance', label: 'Insurance and other', color: CHART_COLORS.teal },
] as const;

function breakdownOf(entry: VehicleLedger): Record<(typeof BREAKDOWN_PARTS)[number]['key'], number> {
  const { totals } = entry;
  return {
    depreciation: Math.max(0, totals.depreciation),
    fuel: totals.fuel,
    maintenance: totals.oil + totals.brakes + totals.service,
    tires: totals.tires,
    insurance: totals.insurance,
  };
}

function BreakdownCard({ ledger, horizonLabel }: { ledger: Ledger; horizonLabel: string }) {
  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn);
  const sorted = [...ledger.vehicles].sort((a, b) => a.totals.net - b.totals.net);
  const max = Math.max(1, ...sorted.map((entry) => entry.totals.net));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Where the money goes</CardTitle>
          <p className="mt-1 text-sm text-fg-tertiary">Net cost by category, {horizonLabel.toLowerCase()}.</p>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-tertiary">
          {BREAKDOWN_PARTS.map((part) => (
            <li key={part.key} className="flex items-center gap-1.5">
              <Dot color={part.color} />
              {part.label}
            </li>
          ))}
        </ul>
        <ul className="mt-4 grid gap-3">
          {sorted.map((entry) => {
            const parts = breakdownOf(entry);
            const delta = own && !entry.vehicle.isOwn ? entry.totals.net - own.totals.net : null;
            return (
              <li key={entry.vehicle.id} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={entry.vehicle.isOwn ? 'font-semibold text-fg' : 'text-fg-secondary'}>
                    {entry.vehicle.label}
                  </span>
                  <span className="text-right font-mono tabular-nums text-fg">
                    {formatUsd(entry.totals.net)}
                    {delta != null ? (
                      <span className="ml-2 text-xs text-fg-tertiary">
                        {delta >= 0 ? '+' : '-'}
                        {formatUsd(Math.abs(delta))}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-bg-elevated" aria-hidden>
                  {BREAKDOWN_PARTS.map((part) => (
                    <span
                      key={part.key}
                      title={`${part.label}: ${formatUsd(parts[part.key])}`}
                      style={{ width: `${(parts[part.key] / max) * 100}%`, backgroundColor: part.color }}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function SourcesCard({ data, ledger }: { data: OwnershipResponse; ledger: Ledger }) {
  const { fuel_prices: fuel, usage } = data;
  const date = (value: string) =>
    new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const miles = `${Math.round(ledger.avgMonthlyMiles).toLocaleString('en-US')} mi a month`;
  const lastMonth = fuel.months[fuel.months.length - 1];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the numbers come from</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm">
          <div>
            <dt className="font-medium text-fg">Your driving and charging</dt>
            <dd className="mt-1 text-fg-tertiary">
              {ledger.mileageAssumed
                ? `No drives are recorded yet, so every month assumes a typical ${miles}.`
                : `Recorded since ${usage.tracked_from ? date(usage.tracked_from) : 'tracking began'}; earlier and future months use your average of ${miles}.`}
              {ledger.startAssumed ? ' Add a purchase date to count the months before tracking began.' : ''}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">Gas prices</dt>
            <dd className="mt-1 text-fg-tertiary">
              {fuel.connection_enabled ? (
                fuel.months.length ? (
                  <>
                    U.S. monthly averages from the Energy Information Administration
                    {fuel.last_updated_at ? `, updated ${date(fuel.last_updated_at)}` : ''}.
                    {fuel.refresh_failed ? ' The latest refresh failed, so stored prices are in use.' : ''}
                  </>
                ) : (
                  <>Prices could not be fetched, so every month uses a flat price. Set it in Edit costs.</>
                )
              ) : (
                <>
                  Fuel prices is turned off in{' '}
                  <ExternalConnectionsLink>Settings, under External Connections</ExternalConnectionsLink>.{' '}
                  {lastMonth
                    ? `Stored prices through ${formatMonth(Date.parse(lastMonth.month), { long: true })} are still used; later months use a flat price.`
                    : 'Every month uses a flat price, which you can set in Edit costs.'}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">Compared vehicles</dt>
            <dd className="mt-1 text-fg-tertiary">
              Prices, fuel economy, and maintenance for the built-in vehicles are typical U.S. figures, not quotes.
              {data.vehicle_lookup_enabled ? '' : ' Vehicle lookup is turned off, so added vehicles are entered by hand.'}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function CostTable({ ledger, colors }: { ledger: Ledger; colors: Record<string, string> }) {
  const counted = (amount: number, count: number) => (count ? `${formatUsd(amount)} (${count})` : formatUsd(amount));
  const sorted = [...ledger.vehicles].sort((a, b) => a.totals.net - b.totals.net);
  const cell = 'whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums';
  const head = 'whitespace-nowrap px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-fg-tertiary';
  return (
    <Card padding="none">
      <CardHeader className="mb-0 px-5 pt-5 pb-3">
        <CardTitle>Cost breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={`${head} text-left`}>Vehicle</th>
                <th scope="col" className={head}>Price</th>
                <th scope="col" className={head}>Depreciation</th>
                <th scope="col" className={head}>Fuel or energy</th>
                <th scope="col" className={head}>Oil changes</th>
                <th scope="col" className={head}>Brakes</th>
                <th scope="col" className={head}>Tires</th>
                <th scope="col" className={head}>Service</th>
                <th scope="col" className={head}>Insurance</th>
                <th scope="col" className={head}>Net cost</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ vehicle, totals }) => (
                <tr key={vehicle.id} className="border-b border-border/60 last:border-b-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium text-fg">
                    <span className="flex items-center gap-2">
                      <Dot color={colors[vehicle.id]} />
                      {vehicle.label}
                    </span>
                  </th>
                  <td className={`${cell} text-fg-secondary`}>{formatUsd(vehicle.priceUsd)}</td>
                  <td className={`${cell} text-fg-secondary`}>{formatUsd(totals.depreciation)}</td>
                  <td className={`${cell} text-fg-secondary`}>{formatUsd(totals.fuel)}</td>
                  <td className={`${cell} text-fg-secondary`}>{counted(totals.oil, totals.oilCount)}</td>
                  <td className={`${cell} text-fg-secondary`}>{counted(totals.brakes, totals.brakeCount)}</td>
                  <td className={`${cell} text-fg-secondary`}>{counted(totals.tires, totals.tireCount)}</td>
                  <td className={`${cell} text-fg-secondary`}>{formatUsd(totals.service)}</td>
                  <td className={`${cell} text-fg-secondary`}>{formatUsd(totals.insurance)}</td>
                  <td className={`${cell} font-semibold text-fg`}>{formatUsd(totals.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-fg-tertiary">
          Numbers in parentheses count how many times the item fell due. Figures for compared vehicles are estimates.
        </p>
      </CardContent>
    </Card>
  );
}
