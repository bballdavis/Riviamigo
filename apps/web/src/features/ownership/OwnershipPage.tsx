import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { CircleDollarSign, SlidersHorizontal } from 'lucide-react';
import {
  useAuth,
  useOwnership,
  useOwnershipEnabled,
  useResolvedVehicleSelection,
  useUpdateOwnershipSettings,
} from '@riviamigo/hooks';
import type { OwnershipCustomVehicle, OwnershipSettings } from '@riviamigo/types';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Button, EmptyState, PageLayout, SelectPicker, Skeleton } from '@riviamigo/ui/primitives';
import { SensorChipSummary } from '@riviamigo/dashboards';
import { AppLayout } from '../../components/layout/AppLayout';
import { NoVehicleState } from '../../components/layout/NoVehicleState';
import type { ValueMode } from './OwnershipChart';
import { AddVehicleDialog } from './OwnershipDialogs';
import { OwnershipBreakdownCard } from './OwnershipBreakdownCard';
import { OwnershipChartCard } from './OwnershipChartCard';
import { OwnershipCompareCard } from './OwnershipCompareCard';
import { CostTable } from './OwnershipCostTable';
import { CONTROL_HEIGHT, Segmented } from './OwnershipPrimitives';
import { SourcesCard } from './OwnershipSourcesCard';
import {
  buildLedger,
  comparisonVehicles,
  enabledComparisonIds,
  formatUsd,
  horizonSpan,
  insightSentence,
  normalizeOwnershipResponse,
  ordinal,
  ownRank,
  projectionYearsOf,
  type Horizon,
  type VehicleLedger,
} from './model';

export function OwnershipContent() {
  const { setActiveVehicleId } = useAuth();
  const setSessionVehicleId = setActiveVehicleId ?? (() => {});
  const { authReady, effectiveVehicleId, vehicleSelectionReady, vehicles } = useResolvedVehicleSelection();
  const ownershipEnabled = useOwnershipEnabled();
  const navigate = useNavigate();
  const activeVehicle = vehicles.find((vehicle) => vehicle.id === effectiveVehicleId);
  const ownLabel = activeVehicle?.display_name || activeVehicle?.model || 'Your vehicle';

  return (
    <AppLayout activeKey="ownership">
      <PageLayout
        title="Ownership"
        // Like the dashboard pages, the vehicle picker gets its own row under the title on phones.
        actionsClassName="w-full justify-end sm:w-auto"
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
        ) : !ownershipEnabled ? (
          <EmptyState
            icon={<CircleDollarSign />}
            title="Ownership is turned off"
            description="Turn it back on in Settings, under Ownership, to see what your Rivian costs to own."
            action={{ label: 'Open Ownership settings', onClick: () => navigate({ to: '/settings', search: { section: 'ownership' } }) }}
          />
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
export function OwnershipDashboard({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  const ownership = useOwnership(vehicleId);
  const { isLoading, isError } = ownership;
  const data = useMemo(() => (ownership.data ? normalizeOwnershipResponse(ownership.data) : undefined), [ownership.data]);
  const update = useUpdateOwnershipSettings(vehicleId);
  const [horizon, setHorizon] = useState<Horizon>('to_date');
  const [mode, setMode] = useState<ValueMode>('spent');
  const [dialog, setDialog] = useState<'add' | null>(null);
  const navigate = useNavigate();
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

  // Every Ownership setting lives in Settings > Ownership.
  const openSettings = () => navigate({ to: '/settings', search: { section: 'ownership' } });

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
          {...(data.can_edit ? { action: { label: 'Open Ownership settings', onClick: openSettings } } : {})}
        />
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
            aria-label="Ownership settings"
            title="Ownership settings"
            className={`${CONTROL_HEIGHT} w-11 shrink-0 px-0 sm:w-auto sm:px-4`}
            onClick={openSettings}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
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

      <OwnershipCompareCard
        data={data}
        ownLabel={ownLabel}
        colors={colors}
        enabledIds={enabledIds}
        insight={insight}
        onToggle={toggleVehicle}
        onRemove={removeCustom}
        onAddVehicle={() => {
          update.reset();
          setDialog('add');
        }}
      />

      <OwnershipChartCard
        ledger={ledger}
        mode={mode}
        onModeChange={setMode}
        colors={colors}
        cursorIndex={cursorIndex}
        todayIndex={todayIndex}
        onCursorChange={setCursor}
      />

      <OwnershipBreakdownCard ledger={ledger} colors={colors} span={span} />
      <CostTable ledger={ledger} colors={colors} />
      <SourcesCard data={data} ledger={ledger} />

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
