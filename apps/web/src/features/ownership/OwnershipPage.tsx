import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  CalendarClock,
  Calculator,
  CarFront,
  ChartLine,
  ChartPie,
  CircleDollarSign,
  Database,
  Disc,
  Droplet,
  Fuel,
  GitCompareArrows,
  Info,
  LifeBuoy,
  MousePointerClick,
  Plus,
  Receipt,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  Wrench,
  X,
} from 'lucide-react';
import {
  useAuth,
  useOwnership,
  useResolvedVehicleSelection,
  useUpdateOwnershipSettings,
} from '@riviamigo/hooks';
import type { OwnershipCustomVehicle, OwnershipResponse, OwnershipSettings } from '@riviamigo/types';
import { CHART_COLORS, COST_TIMELINE_PLOT_INSET } from '@riviamigo/ui/charts';
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
  Tooltip,
} from '@riviamigo/ui/primitives';
import { SensorChipSummary } from '@riviamigo/dashboards';
import { AppLayout } from '../../components/layout/AppLayout';
import { NoVehicleState } from '../../components/layout/NoVehicleState';
import { formatMonth, OwnershipChart, type ValueMode } from './OwnershipChart';
import { AddVehicleDialog, EditCostsDialog, ExternalConnectionsLink } from './OwnershipDialogs';
import { RivianMark } from './RivianMark';
import {
  buildLedger,
  comparisonVehicles,
  enabledComparisonIds,
  formatUsd,
  horizonSpan,
  insightSentence,
  ordinal,
  ownRank,
  projectionYearsOf,
  type Horizon,
  type Ledger,
  type OneTimeKind,
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
          <div className="p-4 text-sm text-fg-secondary">Loading...</div>
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

/**
 * One color per built-in vehicle, in their listed order (EV9, Model Y, Tahoe,
 * X7, Range Rover, Cayenne, Camry Hybrid, Prius). The six on by default get
 * the clearly different hues; indigo and teal, which sit close to sky and
 * emerald, go to the two that start off. Amber is left out because some
 * themes use it as the accent, which is reserved for the owner's vehicle.
 */
const COMPARISON_COLORS = [
  CHART_COLORS.sky,
  CHART_COLORS.yellow,
  CHART_COLORS.emerald,
  CHART_COLORS.rose,
  CHART_COLORS.indigo,
  CHART_COLORS.violet,
  CHART_COLORS.muted,
  CHART_COLORS.teal,
];

function OwnershipDashboard({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  const { data, isLoading, isError } = useOwnership(vehicleId);
  const update = useUpdateOwnershipSettings(vehicleId);
  const [horizon, setHorizon] = useState<Horizon>('to_date');
  const [mode, setMode] = useState<ValueMode>('spent');
  const [dialog, setDialog] = useState<'settings' | 'add' | null>(null);
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

  const settingsDialog =
    dialog === 'settings' ? (
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
          {...(data.can_edit ? { action: { label: 'Edit settings', onClick: () => setDialog('settings') } } : {})}
        />
        {settingsDialog}
      </>
    );
  }

  const projectionYears = projectionYearsOf(data.settings);
  const span = horizonSpan(horizon, projectionYears);
  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn) as VehicleLedger;
  const rank = ownRank(ledger);
  // The month holding today: the default inspection point in both views.
  const todayIndex = ledger.periods.reduce(
    (last, period, index) => (period.kind === 'projected' ? last : index),
    0,
  );
  const cursorIndex = Math.min(cursor ?? todayIndex, Math.max(0, ledger.periods.length - 1));
  const allVehicles = comparisonVehicles(data);
  const customCount = data.settings.comparisons.custom.length;
  const insight = insightSentence(ledger, span);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          label="Time span"
          value={horizon}
          options={[
            { value: 'to_date', label: 'To Date' },
            { value: 'projected', label: 'Project' },
          ]}
          onChange={(value) => {
            setHorizon(value);
            setCursor(null);
          }}
        />
        {data.can_edit ? (
          <Button
            variant="secondary"
            size="md"
            aria-label="Edit settings"
            title={`Edit settings (projection: ${projectionYears} years)`}
            className={`${CONTROL_HEIGHT} w-11 shrink-0 px-0 sm:w-auto sm:px-4`}
            onClick={() => setDialog('settings')}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Edit settings</span>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SensorChipSummary
          title="Total Spent"
          value={formatUsd(own.totals.spent)}
          icon="lucide:wallet"
          secondary={`+${formatUsd(own.totals.spent - own.vehicle.priceUsd)} running costs`}
          dataAccent="series-03"
          valueColor="data"
        />
        <SensorChipSummary
          title="Net Cost"
          value={formatUsd(own.totals.net)}
          icon="lucide:circle-dollar-sign"
          secondary={`After ${formatUsd(own.totals.resaleValue)} resale`}
          accentBorder
        />
        <SensorChipSummary
          title="Net per Mile"
          value={own.totals.netPerMile == null ? 'N/A' : formatUsd(own.totals.netPerMile, { cents: true })}
          icon="lucide:route"
          secondary={`Over ${Math.round(own.totals.miles).toLocaleString('en-US')} mi`}
          dataAccent="series-04"
          valueColor="data"
        />
        <SensorChipSummary
          title="Rank"
          value={rank.of > 1 ? ordinal(rank.rank) : 'N/A'}
          icon="lucide:trophy"
          secondary={rank.of > 1 ? `Of ${rank.of} by net cost` : 'Turn on a vehicle to compare'}
          dataAccent="series-02"
          valueColor="data"
        />
      </div>

      <Card>
        <CardHeader>
          <SectionTitle
            icon={<GitCompareArrows />}
            infoLabel="How the comparison works"
            info={
              <>
                <span className="block font-semibold text-fg">How the comparison works</span>
                <span className="mt-1 block text-fg-secondary">
                  Every vehicle is driven your miles, month by month, from your purchase date, and pays the same gas
                  and electricity prices. Turn a vehicle on or off to add or remove its line.
                </span>
                {insight ? <span className="mt-2 block border-t border-border pt-2 text-fg">{insight}</span> : null}
              </>
            }
          >
            Compare with
          </SectionTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <span
              className={`${CHIP} border-2 bg-accent/10 font-medium text-fg`}
              style={{ borderColor: colors.own }}
            >
              {ownLabel}
            </span>
            {allVehicles.map((vehicle) => {
              const on = enabledIds.includes(vehicle.id);
              const removable = vehicle.isCustom && data.can_edit;
              const edge = on ? { borderColor: colors[vehicle.id] } : undefined;
              return (
                <span key={vehicle.id} className="inline-flex items-stretch">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleVehicle(vehicle.id)}
                    style={edge}
                    className={[
                      CHIP,
                      'border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      removable ? 'rounded-r-none' : '',
                      on
                        ? 'bg-bg-elevated font-medium text-fg'
                        : 'border-border text-fg-secondary hover:border-border-strong hover:text-fg-secondary',
                    ].join(' ')}
                  >
                    {vehicle.label}
                  </button>
                  {removable ? (
                    <button
                      type="button"
                      aria-label={`Remove ${vehicle.label}`}
                      onClick={() => removeCustom(vehicle.id)}
                      style={edge}
                      className={[
                        'inline-flex w-11 items-center justify-center rounded-r-lg border-2 border-l-0 transition-colors sm:w-9',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        on ? 'bg-bg-elevated text-fg-secondary hover:text-fg' : 'border-border text-fg-secondary hover:text-fg',
                      ].join(' ')}
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
                className={`${CHIP} gap-1.5 border-2 border-dashed border-border-strong text-fg-secondary hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
              >
                <Plus className="h-4 w-4" />
                Add a vehicle
              </button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div>
              <SectionTitle
                icon={<ChartLine />}
                info={<RichInfo title="Reading the chart" items={CHART_INFO} />}
                infoLabel="How to read the chart"
                infoWidth="w-[36rem]"
              >
                {mode === 'net' ? 'Net cost over time' : 'Money spent over time'}
              </SectionTitle>
              <p className="mt-1 text-base text-fg-secondary">
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
            {/* On wide screens the chart grows to the readout's height instead of leaving a gap. */}
            <div className="flex min-w-0 flex-col">
              <div className="h-[20rem] sm:h-[24rem] xl:h-auto xl:min-h-[24rem] xl:flex-1">
                <OwnershipChart
                  ledger={ledger}
                  mode={mode}
                  colors={colors}
                  cursorIndex={cursorIndex}
                  onCursorChange={setCursor}
                  className="h-full w-full"
                />
              </div>
              <div className="mt-3 grid gap-1 text-sm text-fg-secondary">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="ownership-month-slider">Drag to inspect a month</label>
                  {cursorIndex !== todayIndex ? (
                    <button
                      type="button"
                      onClick={() => setCursor(null)}
                      className="min-h-11 rounded-md px-2 font-medium text-fg-secondary hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-6"
                    >
                      Back to today
                    </button>
                  ) : null}
                </div>
                <MonthSlider
                  ledger={ledger}
                  value={cursorIndex}
                  onChange={setCursor}
                  valueText={formatMonth(ledger.periods[cursorIndex]?.startMs ?? ledger.startMs, { long: true })}
                />
              </div>
            </div>
            <CursorReadout
              ledger={ledger}
              mode={mode}
              colors={colors}
              cursorIndex={cursorIndex}
              isToday={cursorIndex === todayIndex}
            />
          </div>
        </CardContent>
      </Card>

      <BreakdownCard ledger={ledger} colors={colors} span={span} />
      <CostTable ledger={ledger} colors={colors} />
      <SourcesCard data={data} ledger={ledger} />

      {settingsDialog}
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

/** Shared height for the toolbar controls: touch-sized on phones, compact from `sm`. */
const CONTROL_HEIGHT = 'h-11 sm:h-9';

/** Rounded-rectangle chip shared by the comparison toggles. */
const CHIP = 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base transition-colors sm:min-h-9';

interface InfoItem {
  key: string;
  title: string;
  icon: React.ReactElement<{ className?: string }>;
  color: string;
  body: string;
}

/**
 * The layout every info tooltip on this page shares: a bold heading, then
 * items with a tinted icon and a bold title in the item's color. Two columns
 * from `sm`, one on phones, so it stays short enough to fit the screen.
 */
function RichInfo({ title, items, footer }: { title: string; items: InfoItem[]; footer?: string }) {
  return (
    <>
      <span className="block text-base font-bold text-fg">{title}</span>
      <span className="mt-2 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {items.map((item) => (
          <span key={item.key} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: item.color, backgroundColor: `color-mix(in oklab, ${item.color} 16%, transparent)` }}
            >
              {React.cloneElement(item.icon, { className: 'h-4 w-4' })}
            </span>
            <span className="min-w-0">
              <span className="block font-bold" style={{ color: item.color }}>
                {item.title}
              </span>
              <span className="mt-0.5 block text-fg-secondary">{item.body}</span>
            </span>
          </span>
        ))}
      </span>
      {footer ? <span className="mt-3 block border-t border-border pt-2 text-fg-secondary">{footer}</span> : null}
    </>
  );
}

const CHART_INFO: InfoItem[] = [
  {
    key: 'running',
    title: 'Running costs',
    icon: <Fuel />,
    color: CHART_COLORS.amber,
    body: 'Fuel and charging accrue with the miles you drove each month, along with insurance.',
  },
  {
    key: 'one-time',
    title: 'One-time costs',
    icon: <Wrench />,
    color: CHART_COLORS.sky,
    body: 'Oil changes, brakes, tires, and annual service land as vertical jumps at the mileage or anniversary they fall due.',
  },
  {
    key: 'shaded',
    title: 'Shaded months',
    icon: <CalendarClock />,
    color: CHART_COLORS.violet,
    body: 'Estimated months before tracking began and Projected months after today use your average miles a month.',
  },
  {
    key: 'inspect',
    title: 'Inspect a month',
    icon: <MousePointerClick />,
    color: CHART_COLORS.emerald,
    body: 'Hover or tap the chart, or drag the slider. The panel lists each total, what it added that month, and the gap to your vehicle.',
  },
  {
    key: 'mode',
    title: 'Money spent or net',
    icon: <Scale />,
    color: CHART_COLORS.rose,
    body: 'Money spent counts every dollar paid. Net of resale subtracts what each vehicle would sell for at that point.',
  },
];

function breakdownInfo(span: string, ownLabel: string): InfoItem[] {
  return [
    {
      key: 'bars',
      title: 'What each bar shows',
      icon: <ChartPie />,
      color: CHART_COLORS.indigo,
      body: `A vehicle's net cost ${span.toLowerCase()}, split by category. Longer bars cost more.`,
    },
    {
      key: 'order',
      title: 'Order',
      icon: <ArrowDownWideNarrow />,
      color: CHART_COLORS.sky,
      body: 'Vehicles are sorted by net cost, cheapest at the top.',
    },
    {
      key: 'gap',
      title: 'The small figure',
      icon: <GitCompareArrows />,
      color: CHART_COLORS.emerald,
      body: `How much more (+) or less (-) each vehicle cost than ${ownLabel}.`,
    },
    {
      key: 'split',
      title: 'See the split',
      icon: <MousePointerClick />,
      color: CHART_COLORS.violet,
      body: 'Hover over a bar, or tap it on a phone, for each category with its amount and share.',
    },
  ];
}

/**
 * The month slider, laid on the chart's time axis: its track spans exactly
 * the plot area and the mark sits at the inspected month's instant, so it
 * lines up with the dashed cursor above. A native range input (in time
 * units, snapped to whole months) keeps keyboard and screen-reader support;
 * its thumb is invisible and the Rivian mark is drawn in its place.
 */
function MonthSlider({
  ledger,
  value,
  onChange,
  valueText,
}: {
  ledger: Ledger;
  value: number;
  onChange: (value: number) => void;
  valueText: string;
}) {
  const last = Math.max(0, ledger.periods.length - 1);
  const span = Math.max(1, ledger.endMs - ledger.startMs);
  const at = ledger.periods[value]?.endMs ?? ledger.endMs;
  const share = Math.min(1, Math.max(0, (at - ledger.startMs) / span));
  const indexAt = (ms: number) => {
    const index = ledger.periods.findIndex((period) => period.endMs >= ms);
    return index === -1 ? last : index;
  };
  const step = (delta: number) => onChange(Math.min(last, Math.max(0, value + delta)));
  const half = SLIDER_THUMB_PX / 2;
  return (
    <div
      className="relative h-11"
      style={{ marginLeft: COST_TIMELINE_PLOT_INSET.left, marginRight: COST_TIMELINE_PLOT_INSET.right }}
    >
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
      {/* The input overhangs the track by half a thumb on each side, so the
          thumb's center travels exactly from the plot's left edge to its right. */}
      <input
        id="ownership-month-slider"
        type="range"
        min={ledger.startMs}
        max={ledger.endMs}
        step="any"
        value={at}
        onChange={(event) => onChange(indexAt(Number(event.target.value)))}
        onKeyDown={(event) => {
          const moves: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 };
          if (event.key in moves) step(moves[event.key] ?? 0);
          else if (event.key === 'Home') onChange(0);
          else if (event.key === 'End') onChange(last);
          else return;
          event.preventDefault();
        }}
        aria-valuetext={valueText}
        className={[
          'peer absolute top-0 h-full cursor-pointer appearance-none bg-transparent focus:outline-none',
          '[&::-webkit-slider-thumb]:h-10 [&::-webkit-slider-thumb]:w-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
          '[&::-moz-range-thumb]:h-10 [&::-moz-range-thumb]:w-10 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0',
        ].join(' ')}
        style={{ left: -half, width: `calc(100% + ${SLIDER_THUMB_PX}px)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
        style={{ left: `${share * 100}%` }}
      >
        {/* Just the mark; a halo in the page color keeps it clear of the filled track. */}
        <RivianMark className="h-10 w-10 [filter:drop-shadow(0_0_2px_var(--rm-bg-page))_drop-shadow(0_0_2px_var(--rm-bg-page))]" />
      </span>
    </div>
  );
}

/** Width of the slider's hit area, which the drawn mark is centered on. */
const SLIDER_THUMB_PX = 40;

function SectionTitle({
  icon,
  info,
  infoLabel = 'About this section',
  infoWidth = 'w-80',
  children,
}: {
  icon: React.ReactElement<{ className?: string }>;
  info?: React.ReactNode;
  /** Accessible name of the info button; each one on the page should differ. */
  infoLabel?: string;
  infoWidth?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="text-accent">
        {React.cloneElement(icon, { className: 'h-5 w-5' })}
      </span>
      <CardTitle className="text-base font-bold text-fg">{children}</CardTitle>
      {info ? (
        <Tooltip content={info} align="start" contentClassName={`${infoWidth} px-3.5 py-3 text-sm leading-relaxed`}>
          <button
            type="button"
            aria-label={infoLabel}
            className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg-secondary transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-8 sm:min-w-8"
          >
            <Info className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

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
    <div
      role="group"
      aria-label={label}
      className={`inline-flex shrink-0 rounded-lg border border-border bg-bg-elevated/50 p-0.5 ${CONTROL_HEIGHT}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={[
            'h-full rounded-md px-3 text-base font-medium transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            option.value === value ? 'bg-bg-surface text-fg shadow-sm' : 'text-fg-secondary hover:text-fg-secondary',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const PERIOD_KIND_LABEL = { estimated: 'Estimated', actual: 'Recorded', projected: 'Projected' } as const;

const ONE_TIME_LABEL: Record<OneTimeKind, [string, string]> = {
  oil: ['Oil change', 'Oil changes'],
  brakes: ['Brakes', 'Brakes'],
  tires: ['Tires', 'Tires'],
  service: ['Annual service', 'Annual service'],
};

function CursorReadout({
  ledger,
  mode,
  colors,
  cursorIndex,
  isToday,
}: {
  ledger: Ledger;
  mode: ValueMode;
  colors: Record<string, string>;
  cursorIndex: number;
  isToday: boolean;
}) {
  const period = ledger.periods[cursorIndex];
  if (!period) return null;
  const valueAt = (entry: VehicleLedger, index: number) => entry.atPeriodEnd[index]?.[mode] ?? 0;
  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn);
  const ownValue = own ? valueAt(own, cursorIndex + 1) : 0;
  const rows = ledger.vehicles
    .map((entry) => ({
      entry,
      value: valueAt(entry, cursorIndex + 1),
      // Money spent that month, whichever value the chart shows.
      month: (entry.atPeriodEnd[cursorIndex + 1]?.spent ?? 0) - (entry.atPeriodEnd[cursorIndex]?.spent ?? 0),
      oneTime: entry.months[cursorIndex]?.oneTime ?? [],
    }))
    .sort((a, b) => a.value - b.value);
  const ownMonth = own?.months[cursorIndex];
  const ownOneTime = ownMonth?.oneTime.reduce((sum, item) => sum + item.usd, 0) ?? 0;
  const totalLabel = mode === 'net' ? 'Net' : 'Spent';

  return (
    <aside className="flex min-w-0 flex-col rounded-xl border border-border bg-bg-elevated/40 p-3 sm:p-4" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-semibold text-fg">
          {formatMonth(period.startMs, { long: true })}
          {/* The to-date ledger stops today, part way through the month. */}
          {period.endMs === ledger.nowMs && ledger.endMs === ledger.nowMs ? (
            <span className="ml-1.5 text-sm font-normal text-fg-secondary">through today</span>
          ) : null}
        </p>
        <span className="flex items-center gap-1.5 text-sm text-fg-secondary">
          {isToday ? <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent">Today</span> : null}
          {PERIOD_KIND_LABEL[period.kind]}
        </span>
      </div>

      <table className="mt-3 w-full table-fixed text-base">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-fg-secondary">
            <th scope="col" className="pb-1.5 text-left font-medium">Vehicle</th>
            <th scope="col" className="hidden w-[4.5rem] pb-1.5 text-right font-medium sm:table-cell">Month</th>
            <th scope="col" className="w-[6.25rem] pb-1.5 pl-3 text-right font-medium">{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entry, value, month, oneTime }) => {
            const isOwn = entry.vehicle.isOwn;
            const delta = own && !isOwn ? value - ownValue : null;
            return (
              <tr key={entry.vehicle.id} className="border-t border-border/60 align-top">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                  <span className={`flex min-w-0 items-start gap-2 ${isOwn ? 'font-semibold text-fg' : 'text-fg-secondary'}`}>
                    <span className="mt-[0.3rem] flex">
                      <Dot color={colors[entry.vehicle.id]} />
                    </span>
                    <span className="min-w-0 break-words">{entry.vehicle.label}</span>
                  </span>
                  <span className="mt-0.5 block pl-[1.125rem] text-xs text-fg-secondary">
                    {/* Phones have no Month column, so the month's cost leads this line. */}
                    <span className="sm:hidden">+{formatUsd(month)} this month</span>
                    {oneTime.length ? (
                      <span>
                        <span className="sm:hidden">, </span>
                        {oneTime.map((item) => ONE_TIME_LABEL[item.kind][item.count > 1 ? 1 : 0]).join(', ')}
                      </span>
                    ) : null}
                  </span>
                </th>
                <td className="hidden whitespace-nowrap py-1.5 text-right font-mono text-sm tabular-nums text-fg-secondary sm:table-cell">
                  +{formatUsd(month)}
                </td>
                <td className="whitespace-nowrap py-1.5 pl-3 text-right">
                  <span className={`block font-mono tabular-nums ${isOwn ? 'font-semibold text-fg' : 'text-fg'}`}>
                    {formatUsd(value)}
                  </span>
                  {delta != null ? (
                    <span className="block font-mono text-xs tabular-nums text-fg-secondary">
                      {delta >= 0 ? '+' : '-'}
                      {formatUsd(Math.abs(delta))}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {own && ledger.vehicles.length > 1 ? (
        <p className="mt-1 text-xs text-fg-secondary">Small figures under each total compare it with {own.vehicle.label}.</p>
      ) : null}

      <div className="mt-auto grid gap-4 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-2">
        {ownMonth && own ? (
          <div className="grid content-start gap-1.5">
            <ReadoutHeading icon={<CarFront />}>{own.vehicle.label} this month</ReadoutHeading>
            <dl className="grid gap-1.5 text-sm">
              <ReadoutRow label="Charging" value={formatUsd(ownMonth.fuel)} />
              <ReadoutRow label="Insurance and other" value={formatUsd(ownMonth.insurance)} />
              <ReadoutRow label="One-time" value={formatUsd(ownOneTime)} />
            </dl>
          </div>
        ) : null}
        <div className="grid content-start gap-1.5">
          <ReadoutHeading icon={<Fuel />}>Driving &amp; prices</ReadoutHeading>
          <dl className="grid gap-1.5 text-sm">
          <ReadoutRow label="Miles" value={Math.round(period.miles).toLocaleString('en-US')} />
          <ReadoutRow
            label={period.gasFromSeries ? 'Gas' : 'Gas, est.'}
            value={`${formatUsd(period.gasRegularUsd, { cents: true })}/gal`}
          />
          <ReadoutRow
            label={ledger.electricityRateAssumed ? 'Charging, typical' : 'Your charging'}
            value={`${formatUsd(ledger.electricityUsdPerKwh, { cents: true })}/kWh`}
          />
          </dl>
        </div>
      </div>
    </aside>
  );
}

function ReadoutHeading({
  icon,
  children,
}: {
  icon: React.ReactElement<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fg">
      <span aria-hidden className="text-accent">
        {React.cloneElement(icon, { className: 'h-3.5 w-3.5' })}
      </span>
      {children}
    </p>
  );
}

/** A label that reads as the heading of its value: bold and full-strength, with the figure quieter. */
function ReadoutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="font-semibold text-fg">{label}</dt>
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

function partsTotal(parts: ReturnType<typeof breakdownOf>): number {
  return BREAKDOWN_PARTS.reduce((sum, part) => sum + parts[part.key], 0);
}

function BreakdownCard({ ledger, colors, span }: { ledger: Ledger; colors: Record<string, string>; span: string }) {
  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn);
  const sorted = [...ledger.vehicles].sort((a, b) => a.totals.net - b.totals.net);
  const max = Math.max(1, ...sorted.map((entry) => entry.totals.net));
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!openId) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-breakdown-item]')) setOpenId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openId]);

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<ChartPie />}
          info={<RichInfo title="Reading the bars" items={breakdownInfo(span, own?.vehicle.label ?? 'your vehicle')} />}
          infoLabel="How to read the bars"
          infoWidth="w-[34rem]"
        >
          Where the money goes
        </SectionTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
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
            const open = openId === entry.vehicle.id;
            const panelId = `breakdown-${entry.vehicle.id}`;
            return (
              <li
                key={entry.vehicle.id}
                className="relative grid gap-1"
                data-breakdown-item
                // A mouse opens the split on hover; touch keeps tap-to-toggle below.
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setOpenId(entry.vehicle.id);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') setOpenId((current) => (current === entry.vehicle.id ? null : current));
                }}
              >
                <div className="flex items-baseline justify-between gap-3 text-base">
                  <span
                    className={`flex min-w-0 items-center gap-2 ${entry.vehicle.isOwn ? 'font-semibold text-fg' : 'text-fg-secondary'}`}
                  >
                    <Dot color={colors[entry.vehicle.id]} />
                    <span className="truncate">{entry.vehicle.label}</span>
                  </span>
                  <span className="whitespace-nowrap text-right font-mono tabular-nums text-fg">
                    {formatUsd(entry.totals.net)}
                    {delta != null ? (
                      <span className="ml-2 text-sm text-fg-secondary">
                        {delta >= 0 ? '+' : '-'}
                        {formatUsd(Math.abs(delta))}
                      </span>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={`Show where ${entry.vehicle.label}'s money goes`}
                  onClick={(event) => {
                    // A mouse already opened it on hover; a click there should not close it.
                    if ((event.nativeEvent as PointerEvent).pointerType === 'mouse') return;
                    setOpenId(open ? null : entry.vehicle.id);
                  }}
                  className="-my-2 flex min-h-7 w-full items-center rounded-full py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span
                    className={`flex h-3 w-full rounded-full bg-bg-elevated transition-shadow ${open ? 'ring-2 ring-border-strong' : ''}`}
                  >
                    {/* The filled run is its own rounded pill, so its right end is rounded too. */}
                    <span
                      className="flex h-full overflow-hidden rounded-full"
                      style={{ width: `${(partsTotal(parts) / max) * 100}%` }}
                    >
                      {BREAKDOWN_PARTS.map((part) => (
                        <span
                          key={part.key}
                          style={{
                            width: `${partsTotal(parts) > 0 ? (parts[part.key] / partsTotal(parts)) * 100 : 0}%`,
                            backgroundColor: part.color,
                          }}
                        />
                      ))}
                    </span>
                  </span>
                </button>
                {open ? <BreakdownPanel id={panelId} entry={entry} color={colors[entry.vehicle.id]} /> : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The split behind one bar: each category's amount and share, with its legend color. */
function BreakdownPanel({ id, entry, color }: { id: string; entry: VehicleLedger; color: string | undefined }) {
  const parts = breakdownOf(entry);
  const total = BREAKDOWN_PARTS.reduce((sum, part) => sum + parts[part.key], 0);
  const ref = useRef<HTMLDivElement | null>(null);
  const [above, setAbove] = useState(false);

  // Open below the bar, or above it when the window has no room below,
  // measured before paint so it never draws off screen first.
  useLayoutEffect(() => {
    const place = () => {
      const panel = ref.current;
      const anchor = panel?.parentElement;
      if (!panel || !anchor) return;
      const box = anchor.getBoundingClientRect();
      const height = panel.offsetHeight;
      const spaceBelow = window.innerHeight - box.bottom;
      const spaceAbove = box.top;
      setAbove(height > spaceBelow - 8 && spaceAbove > spaceBelow);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      role="region"
      aria-label={`${entry.vehicle.label} cost split`}
      // Padding, not margin, separates it from the bar, so a mouse can move onto it without closing it.
      className={`absolute left-0 right-0 z-20 sm:left-auto sm:w-80 ${above ? 'bottom-full pb-1' : 'top-full pt-1'}`}
    >
      <div className="rounded-lg border border-border bg-bg-surface p-3 shadow-lg">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <span className="flex min-w-0 items-center gap-2 text-base font-semibold text-fg">
          <Dot color={color} />
          <span className="truncate">{entry.vehicle.label}</span>
        </span>
        <span className="font-mono text-base font-semibold tabular-nums text-fg">{formatUsd(entry.totals.net)}</span>
      </div>
      <ul className="mt-2 grid gap-2">
        {BREAKDOWN_PARTS.map((part) => {
          const share = total > 0 ? parts[part.key] / total : 0;
          return (
            <li key={part.key} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <Dot color={part.color} />
                  {part.label}
                </span>
                <span className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-fg">{formatUsd(parts[part.key])}</span>
                  <span className="w-10 text-right text-fg-secondary">{Math.round(share * 100)}%</span>
                </span>
              </div>
              <span className="block h-1 overflow-hidden rounded-full bg-bg-elevated" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: part.color }} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-xs text-fg-secondary">
        Shares of the net cost. Maintenance covers oil changes, brakes, and annual service.
      </p>
      </div>
    </div>
  );
}

/** A per-kWh price in cents under a dollar, for example 1.9¢ or 49¢. */
function cents(usdPerKwh: number): string {
  if (usdPerKwh >= 1) return formatUsd(usdPerKwh, { cents: true });
  const value = usdPerKwh * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}¢`;
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
        <SectionTitle icon={<Database />}>Where the numbers come from</SectionTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-base md:grid-cols-3 md:gap-6">
          <div>
            <dt className="font-medium text-fg">Your driving and charging</dt>
            <dd className="mt-1 text-fg-secondary">
              {ledger.mileageAssumed
                ? `No drives are recorded yet, so every month assumes a typical ${miles}.`
                : `Recorded since ${usage.tracked_from ? date(usage.tracked_from) : 'tracking began'}; earlier and future months use your average of ${miles}.`}
              {ledger.startAssumed ? ' Add a purchase date to count the months before tracking began.' : ''}
              {ledger.electricityRateAssumed
                ? ` No charging cost is recorded yet, so charging assumes ${cents(ledger.electricityUsdPerKwh)} per kWh.`
                : ` Home charging has cost you ${cents(ledger.homeUsdPerKwh)} per kWh and fast charging ${cents(ledger.fastUsdPerKwh)}, with ${Math.round(ledger.fastShare * 100)}% of your energy from fast charging. Sessions without a price use your rate for their kind.`}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">Gas prices</dt>
            <dd className="mt-1 text-fg-secondary">
              {fuel.connection_enabled ? (
                fuel.months.length ? (
                  <>
                    U.S. monthly averages from the Energy Information Administration
                    {fuel.last_updated_at ? `, updated ${date(fuel.last_updated_at)}` : ''}.
                    {fuel.refresh_failed ? ' The latest refresh failed, so stored prices are in use.' : ''}
                  </>
                ) : (
                  <>Prices could not be fetched, so every month uses a flat price. Set it in Edit settings.</>
                )
              ) : (
                <>
                  Fuel prices is turned off in{' '}
                  <ExternalConnectionsLink>Settings, under External Connections</ExternalConnectionsLink>.{' '}
                  {lastMonth
                    ? `Stored prices through ${formatMonth(Date.parse(lastMonth.month), { long: true })} are still used; later months use a flat price.`
                    : 'Every month uses a flat price, which you can set in Edit settings.'}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">Compared vehicles</dt>
            <dd className="mt-1 text-fg-secondary">
              Prices, fuel economy, and maintenance for the built-in vehicles are typical U.S. figures, not quotes.
              {data.vehicle_lookup_enabled ? '' : ' Vehicle lookup is turned off, so added vehicles are entered by hand.'}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

interface CostColumn {
  key: string;
  label: string;
  value: (entry: VehicleLedger) => number;
  count?: (entry: VehicleLedger) => number;
  /** Hidden from a vehicle's chips when it never applies, such as oil for an EV. */
  optional?: boolean;
}

const COST_COLUMNS: CostColumn[] = [
  { key: 'depreciation', label: 'Depreciation', value: (entry) => entry.totals.depreciation },
  { key: 'fuel', label: 'Fuel or energy', value: (entry) => entry.totals.fuel },
  {
    key: 'oil',
    label: 'Oil changes',
    value: (entry) => entry.totals.oil,
    count: (entry) => entry.totals.oilCount,
    optional: true,
  },
  { key: 'brakes', label: 'Brakes', value: (entry) => entry.totals.brakes, count: (entry) => entry.totals.brakeCount },
  { key: 'tires', label: 'Tires', value: (entry) => entry.totals.tires, count: (entry) => entry.totals.tireCount },
  { key: 'service', label: 'Service', value: (entry) => entry.totals.service },
  { key: 'insurance', label: 'Insurance', value: (entry) => entry.totals.insurance },
];

const MAINTENANCE_ITEMS = COST_COLUMNS.filter((column) => ['oil', 'brakes', 'tires', 'service'].includes(column.key));

const MAINTENANCE_COLORS: Record<string, string> = {
  oil: CHART_COLORS.amber,
  brakes: CHART_COLORS.rose,
  tires: CHART_COLORS.violet,
  service: CHART_COLORS.sky,
};

const MAINTENANCE_ICONS: Record<string, React.ReactElement<{ className?: string }>> = {
  oil: <Droplet />,
  brakes: <Disc />,
  tires: <LifeBuoy />,
  service: <Wrench />,
};

/** How the maintenance chips fit their row: full labels, icons only, or (last resort) a second line. */
type ChipFit = 'full' | 'icons' | 'wrap';

/**
 * Maintenance as one full-width, compact tile under the main three: its
 * total on the right and a colored chip for each item that fell due. When
 * the labeled chips do not fit on one line they drop to icon and amount
 * first, and wrap only if even that does not fit.
 */
function MaintenanceTile({ entry }: { entry: VehicleLedger }) {
  const due = MAINTENANCE_ITEMS.filter((column) => column.value(entry) > 0);
  const total = MAINTENANCE_ITEMS.reduce((sum, column) => sum + column.value(entry), 0);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<ChipFit>('full');
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  // Start from full labels whenever the row's width changes...
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([item]) => {
      const next = Math.round(item?.contentRect.width ?? 0);
      if (next === widthRef.current) return;
      widthRef.current = next;
      setFit('full');
      setWidth(next);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // ...then step down, before paint, until the chips fit on one line.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || fit === 'wrap') return;
    if (row.scrollWidth > row.clientWidth + 1) setFit(fit === 'full' ? 'icons' : 'wrap');
  }, [fit, width, due.length]);

  return (
    <div className="mt-2 flex min-w-0 items-center gap-1 rounded-lg bg-bg-elevated/70 px-2 py-2">
      <span className="mr-0.5 shrink-0 text-xs font-medium tracking-tight text-fg-secondary">Maintenance</span>
      <div
        ref={rowRef}
        className={`flex min-w-0 flex-1 items-center ${fit === 'full' ? 'gap-1.5' : 'gap-1'} ${fit === 'wrap' ? 'flex-wrap' : 'overflow-hidden'}`}
      >
        {due.length === 0 ? (
          <span className="text-sm text-fg-secondary">None due yet</span>
        ) : (
          due.map((column) => {
            const count = column.count?.(entry) ?? 0;
            const color = MAINTENANCE_COLORS[column.key] ?? CHART_COLORS.muted;
            const label = `${column.key === 'oil' && count <= 1 ? 'Oil change' : column.label}${count > 1 ? ` ×${count}` : ''}`;
            const icon = MAINTENANCE_ICONS[column.key];
            const iconOnly = fit !== 'full';
            return (
              <span
                key={column.key}
                title={iconOnly ? label : undefined}
                className={`inline-flex shrink-0 items-center rounded-md border py-0.5 text-sm ${iconOnly ? 'gap-0.5 px-1' : 'gap-1 px-1.5'}`}
                style={{ borderColor: color, backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)` }}
              >
                {icon ? (
                  <span aria-hidden style={{ color }}>
                    {React.cloneElement(icon, { className: 'h-3.5 w-3.5' })}
                  </span>
                ) : null}
                {iconOnly ? (
                  <>
                    <span className="sr-only">{label}</span>
                    {count > 1 ? <span className="text-xs font-semibold text-fg">×{count}</span> : null}
                  </>
                ) : (
                  <span className="font-medium text-fg">{label}</span>
                )}
                <span className="font-mono tabular-nums text-fg-secondary">{formatUsd(column.value(entry))}</span>
              </span>
            );
          })
        )}
      </div>
      <span className="shrink-0 pl-0.5 font-mono text-base font-semibold tabular-nums text-fg">{formatUsd(total)}</span>
    </div>
  );
}

const METHOD_ITEMS: InfoItem[] = [
  {
    key: 'depreciation',
    title: 'Depreciation',
    icon: <TrendingDown />,
    color: CHART_COLORS.indigo,
    body: 'Purchase price minus resale value at the end of the period. Uses your resale value when entered, otherwise a typical yearly loss.',
  },
  {
    key: 'fuel',
    title: 'Fuel or charging',
    icon: <Fuel />,
    color: CHART_COLORS.amber,
    body: "Every vehicle drives your miles each month. Gas uses that month's U.S. pump price. Your Rivian uses its recorded charging, with home and fast charging priced apart; other EVs pay your blended rate.",
  },
  {
    key: 'maintenance',
    title: 'Maintenance',
    icon: <Wrench />,
    color: CHART_COLORS.sky,
    body: 'Oil, brakes, and tires fall due by mileage; service once a year on your purchase anniversary. A ×2 or (2) is how many times.',
  },
  {
    key: 'insurance',
    title: 'Insurance',
    icon: <ShieldCheck />,
    color: CHART_COLORS.teal,
    body: 'Your monthly insurance, registration, and other fixed costs, counted for each month owned.',
  },
  {
    key: 'net',
    title: 'Net cost',
    icon: <Calculator />,
    // Not the accent: some themes make it the same orange as fuel.
    color: CHART_COLORS.rose,
    body: 'Depreciation plus every running cost: what owning the vehicle cost once it is sold.',
  },
];

/** How every figure in the cost breakdown is worked out, for the info tooltip. */
function CostMethodology() {
  return (
    <RichInfo
      title="How each cost is worked out"
      items={METHOD_ITEMS}
      footer="Compared vehicles use typical U.S. estimates, not quotes."
    />
  );
}

function CostTable({ ledger, colors }: { ledger: Ledger; colors: Record<string, string> }) {
  const counted = (amount: number, count: number) => (count ? `${formatUsd(amount)} (${count})` : formatUsd(amount));
  const sorted = [...ledger.vehicles].sort((a, b) => a.totals.net - b.totals.net);
  const cell = 'whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums';
  const head = 'whitespace-nowrap px-3 py-2 text-right text-sm font-medium uppercase tracking-wide text-fg-secondary';
  return (
    <Card padding="none">
      <CardHeader className="mb-0 px-5 pt-5 pb-3">
        <SectionTitle
          icon={<Receipt />}
          info={<CostMethodology />}
          infoLabel="How the costs are worked out"
          infoWidth="w-[38rem]"
        >
          Cost breakdown
        </SectionTitle>
      </CardHeader>
      <CardContent>
        {/* Small screens: one card per vehicle with its costs as labeled chips. */}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 pb-1 xl:hidden">
          {sorted.map((entry) => (
            <li
              key={entry.vehicle.id}
              className="min-w-0 rounded-xl border-2 bg-bg-elevated/30 p-3"
              style={{ borderColor: colors[entry.vehicle.id] }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate text-base ${entry.vehicle.isOwn ? 'font-semibold text-fg' : 'font-medium text-fg'}`}>
                    {entry.vehicle.label}
                  </p>
                  <p className="text-sm text-fg-secondary">Price {formatUsd(entry.vehicle.priceUsd)}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-base font-semibold tabular-nums text-fg">{formatUsd(entry.totals.net)}</p>
                  <p className="text-xs uppercase tracking-wide text-fg-secondary">Net cost</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Depreciation', value: entry.totals.depreciation },
                  { label: entry.vehicle.powertrain === 'ev' ? 'Charging' : 'Fuel', value: entry.totals.fuel },
                  { label: 'Insurance', value: entry.totals.insurance },
                ].map((tile) => (
                  <div key={tile.label} className="min-w-0 rounded-lg bg-bg-elevated/70 px-2 py-2">
                    <dt className="truncate text-xs font-medium tracking-tight text-fg-secondary">{tile.label}</dt>
                    <dd className="mt-0.5 truncate font-mono text-base tabular-nums text-fg">{formatUsd(tile.value)}</dd>
                  </div>
                ))}
              </dl>
              <MaintenanceTile entry={entry} />
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[60rem] text-base">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={`${head} text-left`}>Vehicle</th>
                <th scope="col" className={head}>Price</th>
                {COST_COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className={head}>{column.label}</th>
                ))}
                <th scope="col" className={head}>Net cost</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr key={entry.vehicle.id} className="border-b border-border/60 last:border-b-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium text-fg">
                    <span className="flex items-center gap-2">
                      <Dot color={colors[entry.vehicle.id]} />
                      {entry.vehicle.label}
                    </span>
                  </th>
                  <td className={`${cell} text-fg-secondary`}>{formatUsd(entry.vehicle.priceUsd)}</td>
                  {COST_COLUMNS.map((column) => (
                    <td key={column.key} className={`${cell} text-fg-secondary`}>
                      {counted(column.value(entry), column.count?.(entry) ?? 0)}
                    </td>
                  ))}
                  <td className={`${cell} font-semibold text-fg`}>{formatUsd(entry.totals.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="h-4" aria-hidden />
      </CardContent>
    </Card>
  );
}
