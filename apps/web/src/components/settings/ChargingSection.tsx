import React from 'react';
import { useChargingNetworkPreferences, useResolvedVehicleSelection, useUpdateChargingNetworkPreference, useVehicles } from '@riviamigo/hooks';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@riviamigo/ui/primitives';
import { AlertCircle, Zap } from 'lucide-react';
import { useSettingsDraft } from '../../features/settings/drafts/SettingsDraftProvider';
import { useStagedValue } from '../../features/settings/drafts/useStagedValue';

type CostMode = 'automatic' | 'free';
/** Staged cost mode keyed by network vendor. */
type CostModes = Record<string, CostMode>;

/** Vehicle-scoped charging policy. Only observed vendors are returned by the API. */
export function ChargingSection() {
  const { effectiveVehicleId, authReady, vehicleSelectionReady } = useResolvedVehicleSelection();
  const { data: vehicles = [] } = useVehicles();
  const preferences = useChargingNetworkPreferences(effectiveVehicleId);
  const updatePreference = useUpdateChargingNetworkPreference(effectiveVehicleId);
  const role = vehicles.find((vehicle) => vehicle.id === effectiveVehicleId)?.membership_role ?? 'viewer';
  const canManage = role === 'owner' || role === 'manager';

  const savedModes = React.useMemo<CostModes>(() => Object.fromEntries(
    (preferences.data ?? []).map((preference) => [preference.network_vendor, preference.cost_mode]),
  ), [preferences.data]);
  const staged = useStagedValue<CostModes>(savedModes);
  const setStagedModes = staged.setValue;
  React.useEffect(() => {
    // A vendor observed while the user is editing joins the staged map at its saved mode.
    setStagedModes((current) => (
      Object.keys(savedModes).every((vendor) => vendor in current) ? current : { ...savedModes, ...current }
    ));
  }, [savedModes, setStagedModes]);

  const { saving } = useSettingsDraft('charging-network-policies', {
    isDirty: staged.isDirty,
    save: saveCostModes,
    discard: staged.reset,
  });

  async function saveCostModes() {
    const submitted = staged.value;
    // Sent one vendor at a time, in the order the vendors are listed.
    const changes = (preferences.data ?? []).flatMap((preference) => {
      const next = submitted[preference.network_vendor];
      return next !== undefined && next !== preference.cost_mode
        ? [{ networkVendor: preference.network_vendor, costMode: next }]
        : [];
    });
    for (const change of changes) {
      try {
        await updatePreference.mutateAsync(change);
      } catch (error) {
        const detail = error instanceof Error && error.message ? error.message : 'Charging policy could not be saved.';
        throw new Error(`${detail} Try again.`, { cause: error });
      }
    }
    staged.commit({ ...savedModes, ...submitted });
  }

  if (!authReady || !vehicleSelectionReady) {
    return <Card><CardContent className="py-8 text-sm text-fg-tertiary">Loading charging preferences…</CardContent></Card>;
  }

  if (!effectiveVehicleId) {
    return (
      <Card>
        <EmptyState icon={<Zap />} title="No vehicle selected" description="Select a vehicle to manage its observed charging networks." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Charging</CardTitle>
          <p className="mt-1 text-sm text-fg-tertiary">Set a vehicle-wide cost policy for charging networks you have already used.</p>
        </div>
        <Badge variant={canManage ? 'info' : 'default'}>{canManage ? 'Editable' : 'Read only'}</Badge>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-xl border border-border bg-bg-elevated/35 p-3 text-sm text-fg-secondary">
          Marking a network <strong className="font-medium text-fg">Free</strong> recalculates its automatic charge-session costs. Per-session overrides always take precedence.
        </div>

        {preferences.isLoading ? (
          <div className="grid gap-2" aria-label="Loading observed charging networks">
            {[0, 1, 2].map((index) => <div key={index} className="h-16 animate-pulse rounded-xl border border-border bg-bg-elevated/50" />)}
          </div>
        ) : preferences.isError ? (
          <div className="rounded-xl border border-status-danger/30 bg-status-danger/10 p-4">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-danger" />
              <div>
                <p className="text-sm font-medium text-fg">Charging networks could not be loaded.</p>
                <p className="mt-1 text-sm text-fg-secondary">Check your connection and try again.</p>
                <Button className="mt-3 min-h-11" variant="secondary" onClick={() => preferences.refetch()}>Try again</Button>
              </div>
            </div>
          </div>
        ) : preferences.data?.length === 0 ? (
          <EmptyState icon={<Zap />} title="No observed charging networks yet" description="Networks appear here after a charge session includes a network name." />
        ) : (
          <div className="grid gap-3">
            {preferences.data?.map((preference) => {
              const pending = updatePreference.isPending && updatePreference.variables?.networkVendor === preference.network_vendor;
              const selectedMode = staged.value[preference.network_vendor] ?? preference.cost_mode;
              return (
                <article key={preference.network_vendor} className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg" title={preference.network_vendor}>{preference.network_vendor}</p>
                    <p className="mt-0.5 text-xs text-fg-tertiary">{preference.session_count} observed {preference.session_count === 1 ? 'session' : 'sessions'}</p>
                  </div>
                  {canManage ? (
                    <div role="group" aria-label={`${preference.network_vendor} cost policy`} className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg-page/60 p-1">
                      {(['automatic', 'free'] as const).map((costMode) => (
                        <button
                          key={costMode}
                          type="button"
                          aria-pressed={selectedMode === costMode}
                          disabled={pending || saving}
                          onClick={() => {
                            staged.setValue((current) => ({ ...current, [preference.network_vendor]: costMode }));
                          }}
                          className={`min-h-11 rounded-lg px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60 ${selectedMode === costMode ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-secondary hover:bg-bg-elevated/70 hover:text-fg'}`}
                        >
                          {pending ? 'Saving…' : costMode === 'automatic' ? 'Automatic' : 'Free'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Badge variant={preference.cost_mode === 'free' ? 'success' : 'default'}>{preference.cost_mode === 'free' ? 'Free' : 'Automatic'}</Badge>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {!canManage ? <p className="text-sm text-fg-tertiary">Only the vehicle owner or a manager can change charging network policies.</p> : null}
      </CardContent>
    </Card>
  );
}
