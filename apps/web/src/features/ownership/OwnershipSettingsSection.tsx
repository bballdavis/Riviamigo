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
import { Card, CardContent, CardHeader, SelectPicker, Switch } from '@riviamigo/ui/primitives';
import { useSettingsDraft, useSettingsLeaveGuard } from '../settings/drafts/SettingsDraftProvider';
import { useStagedValue } from '../settings/drafts/useStagedValue';
import {
  applyScheduleEdits,
  MaintenanceSchedulesCard,
  SettingsCardTitle,
  type ScheduleEdits,
  type ScheduleErrors,
} from './MaintenanceSchedulesSection';
import {
  formToSettings,
  OwnershipCostsFields,
  settingsToForm,
  type OwnershipCostsErrors,
  type OwnershipCostsForm,
} from './OwnershipCostsFields';
import { normalizeOwnershipResponse, scheduleTargets } from './model';

/**
 * Settings > Ownership: every setting behind the Ownership dashboard in one
 * place. The switch at the top shows or hides the dashboard for the signed-in
 * user; the cards below configure it for the chosen vehicle. Edits are staged
 * and saved with the Settings page's Save bar.
 */
export function OwnershipSettingsSection({ vehicles }: { vehicles: Vehicle[] }) {
  const savedEnabled = useOwnershipEnabled();
  const update = useUpdateOwnershipPreference();
  const enabled = useStagedValue(savedEnabled);
  useSettingsDraft('ownership-enabled', {
    isDirty: enabled.isDirty,
    save: async () => {
      const submitted = enabled.value;
      try {
        await update.mutateAsync(submitted);
      } catch {
        throw new Error('Show Ownership could not be saved. Try again.');
      }
      enabled.commit(submitted, submitted);
    },
    discard: enabled.reset,
  });
  const requestLeave = useSettingsLeaveGuard();
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
                The Ownership page adds up what your Rivian has cost and compares it with other vehicles. It is in
                preview, so it stays off until you turn it on. Turning it off again hides it from your navigation and
                keeps your saved prices and schedules. This only affects your own account.
              </p>
            </div>
            <Switch
              id="ownership-enabled"
              checked={enabled.value}
              onChange={(checked) => enabled.setValue(checked)}
              aria-label="Show Ownership"
            />
          </div>
        </CardContent>
      </Card>

      {/* Hidden rather than unmounted while switched off, so staged card edits survive the toggle. */}
      <div hidden={!enabled.value} className="grid gap-6">
        {vehicle ? (
          <>
            {choices.length > 1 ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-fg-secondary">Settings for</span>
                <SelectPicker
                  className="min-w-[11rem]"
                  aria-label="Vehicle whose Ownership settings to edit"
                  value={vehicle.id}
                  onChange={(id) => {
                    if (id !== vehicle.id) requestLeave(() => setPicked(id));
                  }}
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
        )}
      </div>
    </div>
  );
}

function VehicleOwnershipSettings({ vehicleId, ownLabel }: { vehicleId: string; ownLabel: string }) {
  const ownership = useOwnership(vehicleId);
  const data = useMemo(
    () => (ownership.data ? normalizeOwnershipResponse(ownership.data) : undefined),
    [ownership.data],
  );
  // A failed background refetch keeps the loaded data (and any staged edits) on screen.
  if (ownership.isError && !data) return <p className="text-sm text-status-danger">Ownership settings could not be loaded.</p>;
  if (ownership.isLoading || !data) return <p className="text-sm text-fg-secondary">Loading ownership settings...</p>;
  return <VehicleOwnershipEditor vehicleId={vehicleId} ownLabel={ownLabel} data={data} />;
}

/**
 * One staged draft for the vehicle's whole ownership settings object: the cost
 * cards and every schedule edit are saved together in a single request, so one
 * card can never overwrite another's unsaved values.
 */
function VehicleOwnershipEditor({
  vehicleId,
  ownLabel,
  data,
}: {
  vehicleId: string;
  ownLabel: string;
  data: OwnershipResponse;
}) {
  const update = useUpdateOwnershipSettings(vehicleId);
  const savedForm = useMemo(() => settingsToForm(data.settings), [data.settings]);
  const costs = useStagedValue<OwnershipCostsForm>(savedForm);
  const [costErrors, setCostErrors] = useState<OwnershipCostsErrors>({});
  const [scheduleEdits, setScheduleEdits] = useState<ScheduleEdits>({});
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>({});
  const targets = useMemo(() => scheduleTargets(data, ownLabel), [data, ownLabel]);

  useSettingsDraft(`ownership-settings-${vehicleId}`, {
    isDirty: costs.isDirty || Object.keys(scheduleEdits).length > 0,
    save: async () => {
      const submittedForm = costs.value;
      const submittedEdits = scheduleEdits;
      const result = formToSettings(submittedForm, data.settings);
      const schedules = applyScheduleEdits(data.settings.maintenance, scheduleEdits, targets);
      setCostErrors(result.errors);
      setScheduleErrors(schedules.errors);
      if (!result.settings || !schedules.maintenance) {
        throw new Error('Some Ownership values need attention. Fix the highlighted fields, then save again.');
      }
      const next = { ...result.settings, maintenance: schedules.maintenance };
      try {
        await update.mutateAsync(next);
      } catch {
        throw new Error('Ownership settings could not be saved. Try again.');
      }
      costs.commit(settingsToForm(next), submittedForm);
      // Keep schedule edits made while the save was running.
      setScheduleEdits((current) => (current === submittedEdits ? {} : current));
    },
    discard: () => {
      costs.reset();
      setCostErrors({});
      setScheduleEdits({});
      setScheduleErrors({});
    },
  });

  const card = (props: Omit<CostsCardProps, 'form' | 'errors' | 'onChange' | 'vehicleId' | 'canEdit'>) => (
    <CostsCard
      {...props}
      vehicleId={vehicleId}
      canEdit={data.can_edit}
      form={costs.value}
      errors={costErrors}
      onChange={(next) => costs.setValue(next)}
    />
  );

  return (
    <>
      {card({
        icon: <Wallet />,
        color: CHART_COLORS.emerald,
        title: 'Purchase and value',
        description: 'What you paid and when. The dashboard starts every vehicle at its purchase price on this date.',
        fields: ['purchasePrice', 'purchaseDate', 'purchaseOdometer', 'resaleValue'],
      })}
      {card({
        icon: <Receipt />,
        color: CHART_COLORS.rose,
        title: 'Running costs',
        description: 'Monthly costs and prices that replace the built-in estimates when you set them.',
        fields: ['insuranceMonthly', 'tireSetCost', 'gasPrice'],
      })}
      {card({
        icon: <CalendarClock />,
        color: CHART_COLORS.sky,
        title: 'Projection',
        description: 'How far ahead the Project view looks.',
        fields: ['projectionYears'],
      })}
      <MaintenanceSchedulesCard
        data={data}
        ownLabel={ownLabel}
        edits={scheduleEdits}
        errors={scheduleErrors}
        onEditsChange={setScheduleEdits}
      />
    </>
  );
}

interface CostsCardProps {
  vehicleId: string;
  canEdit: boolean;
  icon: React.ReactElement<{ className?: string }>;
  color: string;
  title: string;
  description: string;
  fields: Array<keyof OwnershipCostsForm>;
  form: OwnershipCostsForm;
  errors: OwnershipCostsErrors;
  onChange: (form: OwnershipCostsForm) => void;
}

/** One group of the cost fields; the values are staged in the vehicle's single draft. */
function CostsCard({ vehicleId, canEdit, icon, color, title, description, fields, form, errors, onChange }: CostsCardProps) {
  const idPrefix = `ownership-settings-${vehicleId}`;
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
          disabled={!canEdit}
          onChange={onChange}
        />
        {canEdit ? null : (
          <p className="mt-4 text-sm text-fg-secondary">Only the vehicle&apos;s owner or a manager can change these.</p>
        )}
      </CardContent>
    </Card>
  );
}
