import React, { useMemo, useState } from 'react';
import { CalendarClock, CircleDollarSign, Receipt, Wallet } from 'lucide-react';
import {
  useOwnership,
  useOwnershipEnabled,
  useResolvedVehicleSelection,
  useUpdateOwnershipPreference,
  useUpdateOwnershipSettings,
} from '@riviamigo/hooks';
import type { OwnershipResponse, Vehicle } from '@riviamigo/types';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Button, Card, CardContent, CardHeader, SelectPicker, Switch } from '@riviamigo/ui/primitives';
import { MaintenanceSchedulesCard, SettingsCardTitle } from './MaintenanceSchedulesSection';
import {
  formToSettings,
  OwnershipCostsFields,
  settingsToForm,
  type OwnershipCostsErrors,
  type OwnershipCostsForm,
} from './OwnershipCostsFields';
import { normalizeOwnershipResponse } from './model';

/**
 * Settings > Ownership: every setting behind the Ownership dashboard in one
 * place. The switch at the top shows or hides the dashboard for the signed-in
 * user; the cards below configure it for the chosen vehicle.
 */
export function OwnershipSettingsSection({ vehicles }: { vehicles: Vehicle[] }) {
  const enabled = useOwnershipEnabled();
  const update = useUpdateOwnershipPreference();
  const { effectiveVehicleId } = useResolvedVehicleSelection();
  const owned = vehicles.filter((vehicle) => !vehicle.is_demo);
  const choices = owned.length > 0 ? owned : vehicles;
  // Start on the vehicle the dashboard shows, so its settings button lands here.
  const [picked, setPicked] = useState<string | null>(null);
  const vehicle =
    choices.find((entry) => entry.id === picked) ??
    choices.find((entry) => entry.id === effectiveVehicleId) ??
    choices[0];

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <SettingsCardTitle icon={<CircleDollarSign />} color={CHART_COLORS.accent}>
                <label htmlFor="ownership-enabled">Show Ownership</label>
              </SettingsCardTitle>
              <p className="mt-1 text-sm text-fg-secondary">
                The Ownership page adds up what your Rivian has cost and compares it with other vehicles. Turn it off
                to hide it from your navigation. Your saved prices and schedules are kept, and this only affects your
                own account.
              </p>
              {update.isError ? (
                <p role="alert" className="mt-2 text-sm text-status-danger">
                  The setting could not be saved. Try again.
                </p>
              ) : null}
            </div>
            <Switch
              id="ownership-enabled"
              checked={enabled}
              disabled={update.isPending}
              onChange={(checked) => update.mutate(checked)}
              aria-label="Show Ownership"
            />
          </div>
        </CardContent>
      </Card>

      {enabled ? (
        vehicle ? (
          <>
            {choices.length > 1 ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-fg-secondary">Settings for</span>
                <SelectPicker
                  className="min-w-[11rem]"
                  aria-label="Vehicle whose Ownership settings to edit"
                  value={vehicle.id}
                  onChange={(id) => setPicked(id)}
                  options={choices.map((entry) => ({ value: entry.id, label: entry.display_name || entry.model }))}
                />
              </div>
            ) : null}
            <VehicleOwnershipSettings
              key={vehicle.id}
              vehicleId={vehicle.id}
              ownLabel={vehicle.display_name || vehicle.model}
            />
          </>
        ) : (
          <p className="text-sm text-fg-secondary">Add a vehicle to set up the Ownership page.</p>
        )
      ) : null}
    </div>
  );
}

function VehicleOwnershipSettings({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  const ownership = useOwnership(vehicleId);
  const data = useMemo(
    () => (ownership.data ? normalizeOwnershipResponse(ownership.data) : undefined),
    [ownership.data],
  );
  if (ownership.isError) return <p className="text-sm text-status-danger">Ownership settings could not be loaded.</p>;
  if (ownership.isLoading || !data) return <p className="text-sm text-fg-secondary">Loading ownership settings...</p>;

  return (
    <>
      <CostsCard
        vehicleId={vehicleId}
        data={data}
        icon={<Wallet />}
        color={CHART_COLORS.emerald}
        title="Purchase and value"
        description="What you paid and when. The dashboard starts every vehicle at its purchase price on this date."
        fields={['purchasePrice', 'purchaseDate', 'resaleValue']}
        requirePrice
      />
      <CostsCard
        vehicleId={vehicleId}
        data={data}
        icon={<Receipt />}
        color={CHART_COLORS.rose}
        title="Running costs"
        description="Monthly costs and prices that replace the built-in estimates when you set them."
        fields={['insuranceMonthly', 'tireSetCost', 'gasPrice']}
      />
      <CostsCard
        vehicleId={vehicleId}
        data={data}
        icon={<CalendarClock />}
        color={CHART_COLORS.sky}
        title="Projection"
        description="How far ahead the Project view looks."
        fields={['projectionYears']}
      />
      <MaintenanceSchedulesCard vehicleId={vehicleId} ownLabel={ownLabel} />
    </>
  );
}

/** One section of the cost settings, saved on its own; other fields keep their stored values. */
function CostsCard({
  vehicleId,
  data,
  icon,
  color,
  title,
  description,
  fields,
  requirePrice = false,
}: {
  vehicleId: string;
  data: OwnershipResponse;
  icon: React.ReactElement<{ className?: string }>;
  color: string;
  title: string;
  description: string;
  fields: Array<keyof OwnershipCostsForm>;
  requirePrice?: boolean;
}) {
  const update = useUpdateOwnershipSettings(vehicleId);
  const [form, setForm] = useState<OwnershipCostsForm>(() => settingsToForm(data.settings));
  const [errors, setErrors] = useState<OwnershipCostsErrors>({});
  const [saved, setSaved] = useState(false);
  const idPrefix = `ownership-settings-${vehicleId}`;

  const save = () => {
    // Only this card's fields come from the edits; the rest stay as stored.
    const stored = settingsToForm(data.settings);
    const merged = { ...stored, ...Object.fromEntries(fields.map((key) => [key, form[key]])) } as OwnershipCostsForm;
    const result = formToSettings(merged, data.settings, new Date(), { requirePrice });
    const own = Object.fromEntries(
      Object.entries(result.errors).filter(([key]) => fields.includes(key as keyof OwnershipCostsForm)),
    ) as OwnershipCostsErrors;
    setErrors(own);
    setSaved(false);
    if (!result.settings) return;
    update.mutate(result.settings, { onSuccess: () => setSaved(true) });
  };

  return (
    <Card>
      <CardHeader className="mb-3 flex-col items-start gap-1">
        <SettingsCardTitle icon={icon} color={color}>
          {title}
        </SettingsCardTitle>
        <p className="text-sm text-fg-secondary">{description}</p>
      </CardHeader>
      <CardContent>
        <OwnershipCostsFields
          form={form}
          errors={errors}
          fields={fields}
          idPrefix={idPrefix}
          disabled={!data.can_edit}
          onChange={(next) => {
            setForm(next);
            setSaved(false);
          }}
        />
        {data.can_edit ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm" loading={update.isPending} onClick={save}>
              Save {title.toLowerCase()}
            </Button>
            <span className="text-sm text-fg-secondary" role="status">
              {update.isError ? 'Could not be saved. Try again.' : saved ? 'Saved.' : ''}
            </span>
          </div>
        ) : (
          <p className="mt-4 text-sm text-fg-secondary">Only the vehicle&apos;s owner or a manager can change these.</p>
        )}
      </CardContent>
    </Card>
  );
}
