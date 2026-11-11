import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, invalidateVehicleCapacityData, queryKeys } from '@riviamigo/hooks';
import { type Vehicle } from '@riviamigo/types';
import { Button, SelectPicker } from '@riviamigo/ui/primitives';
import { DEFAULT_TARGET_TIRE_PRESSURE_PSI } from '@riviamigo/ui/lib/vehicleTires';
import { X } from 'lucide-react';
import { useSettingsDraft, useSettingsLeaveGuard } from './drafts/SettingsDraftProvider';
import { useStagedValue } from './drafts/useStagedValue';
import { saveFailure } from './drafts/saveFailure';

type BatteryGen = 'gen1' | 'gen2';

const RIVIAN_BATTERY_PRESETS: Record<BatteryGen, Array<{ key: string; label: string; kwh: number | null }>> = {
  gen1: [
    { key: 'r1_standard_g1', label: 'R1T / R1S Standard (Gen 1)', kwh: 105 },
    { key: 'r1_large_g1',    label: 'R1T / R1S Large (Gen 1)',    kwh: 135 },
    { key: 'r1_max_g1',      label: 'R1T / R1S Max (Gen 1)',      kwh: 180 },
    { key: 'custom',         label: 'Custom',                     kwh: null },
  ],
  gen2: [
    { key: 'r1_standard_g2', label: 'R1T / R1S Standard (Gen 2)', kwh: 92.5 },
    { key: 'r1_large_g2',    label: 'R1T / R1S Large (Gen 2)',    kwh: 109 },
    { key: 'r1_max_g2',      label: 'R1T / R1S Max (Gen 2)',      kwh: 140 },
    { key: 'custom',         label: 'Custom',                     kwh: null },
  ],
};

const R2_PRESET = { key: 'r2', label: 'R2', kwh: 82 };
const ALL_PRESETS = [...RIVIAN_BATTERY_PRESETS.gen1, ...RIVIAN_BATTERY_PRESETS.gen2, R2_PRESET];
const R2_PACK_OPTIONS = [R2_PRESET, { key: 'custom', label: 'Custom', kwh: null }];
const BATTERY_GEN_LABELS: Record<BatteryGen, string> = { gen1: 'Gen 1', gen2: 'Gen 2' };

type BatteryVehicle = Pick<Vehicle, 'model' | 'year' | 'battery_capacity_kwh'>;

const isR1Model = (model: string | null | undefined) => /r1/i.test(model ?? '');
const isR2Model = (model: string | null | undefined) => /r2/i.test(model ?? '');

/** R1 generation from the VIN-derived model year (2025 onward is Gen 2). Non-R1 models have none. */
function r1GenerationFromYear(vehicle: BatteryVehicle | undefined): BatteryGen | null {
  if (!vehicle || !isR1Model(vehicle.model) || vehicle.year == null) return null;
  return vehicle.year >= 2025 ? 'gen2' : 'gen1';
}

function detectR1BatteryGen(vehicle: BatteryVehicle | undefined): BatteryGen | null {
  if (!vehicle || !isR1Model(vehicle.model)) return null;
  const fromYear = r1GenerationFromYear(vehicle);
  if (fromYear) return fromYear;
  const modelLower = vehicle.model.toLowerCase();
  return modelLower.includes('gen 2') || modelLower.includes('2nd') ? 'gen2' : null;
}

/** When an R1's saved capacity matches only the other generation's presets, return both generations. */
function savedCapacityGenerationMismatch(vehicle: BatteryVehicle | undefined): { saved: BatteryGen; detected: BatteryGen } | null {
  const detected = r1GenerationFromYear(vehicle);
  const kwh = vehicle?.battery_capacity_kwh;
  if (!detected || kwh == null) return null;
  const saved: BatteryGen = detected === 'gen2' ? 'gen1' : 'gen2';
  return RIVIAN_BATTERY_PRESETS[saved].some((p) => p.key !== 'custom' && p.kwh === kwh) ? { saved, detected } : null;
}

function batteryPresetFor(gen: BatteryGen, key: string) {
  return RIVIAN_BATTERY_PRESETS[gen].find((p) => p.key === key) || ALL_PRESETS.find((p) => p.key === key);
}

/** Battery and tire fields staged by the vehicle editor. */
interface VehicleBatteryForm {
  name: string;
  gen: BatteryGen;
  preset: string;
  customKwh: string;
  targetTirePressure: string;
}

type VehicleBatteryErrors = Partial<Record<'name' | 'pack' | 'customKwh' | 'targetTirePressure', string>>;

/** The editor's starting values for a vehicle, derived from its saved capacity and model year. */
function vehicleBatteryForm(vehicle: Vehicle): VehicleBatteryForm {
  const currentKwh = vehicle.battery_capacity_kwh;
  // Generation detection applies only to R1 models.
  const detectedGen = detectR1BatteryGen(vehicle);
  const gen: BatteryGen = detectedGen ?? 'gen1';
  const base = {
    name: vehicle.display_name ?? '',
    gen,
    targetTirePressure: String(vehicle.target_tire_pressure_psi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI),
  };

  if (isR2Model(vehicle.model)) {
    // R2 offers only its own pack or a custom capacity.
    const usesR2Pack = currentKwh == null || currentKwh === R2_PRESET.kwh;
    return { ...base, preset: usesR2Pack ? R2_PRESET.key : 'custom', customKwh: usesR2Pack ? '' : String(currentKwh) };
  }

  if (currentKwh != null) {
    // Model year wins over an older saved preset, without changing its capacity.
    const generations: BatteryGen[] = detectedGen ? [detectedGen] : ['gen1', 'gen2'];
    for (const g of generations) {
      const match = RIVIAN_BATTERY_PRESETS[g].find((p) => p.kwh === currentKwh && p.key !== 'custom');
      if (match) return { ...base, gen: g, preset: match.key, customKwh: '' };
    }
    return { ...base, preset: 'custom', customKwh: String(currentKwh) };
  }

  return { ...base, preset: gen === 'gen2' ? 'r1_large_g2' : 'r1_large_g1', customKwh: '' };
}


/**
 * Battery capacity, pack, and target tire pressure for one vehicle. The edits are staged
 * in the page-level draft; Save on the page bar runs `save`. Mounted per open editor, so
 * closing it (or switching vehicles) unregisters its draft.
 */
export function VehicleBatteryEditor({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const queryClient = useQueryClient();
  const requestLeave = useSettingsLeaveGuard();
  const saved = React.useMemo(() => vehicleBatteryForm(vehicle), [vehicle]);
  const { value, setValue, isDirty, reset, commit } = useStagedValue<VehicleBatteryForm>(saved);
  const [errors, setErrors] = React.useState<VehicleBatteryErrors>({});
  const capacityGenerationMismatch = savedCapacityGenerationMismatch(vehicle);

  const updateVehicleSettings = useMutation({
    mutationFn: ({ vehicleId, kwh, config, targetTirePressurePsi }: { vehicleId: string; kwh: number; config: string; targetTirePressurePsi: number }) =>
      api.updateVehicleSettings(vehicleId, {
        battery_capacity_kwh: kwh,
        battery_config: config,
        target_tire_pressure_psi: targetTirePressurePsi,
      }),
    onSuccess: () => {
      invalidateVehicleCapacityData(queryClient);
    },
  });

  const updateVehicleName = useMutation({
    mutationFn: ({ vehicleId, name }: { vehicleId: string; name: string }) =>
      api.updateVehicleName(vehicleId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all });
    },
  });

  /** Any edit clears the previous inline errors so they never describe stale input. */
  function edit(patch: Partial<VehicleBatteryForm>) {
    setErrors((current) => (Object.keys(current).length > 0 ? {} : current));
    setValue((current) => ({ ...current, ...patch }));
  }

  async function save() {
    const snapshot = value;
    const name = snapshot.name.trim();
    const preset = batteryPresetFor(snapshot.gen, snapshot.preset);
    const customKwh = parseFloat(snapshot.customKwh);
    const targetTirePressurePsi = parseFloat(snapshot.targetTirePressure);

    const nextErrors: VehicleBatteryErrors = {};
    if (!name) nextErrors.name = 'Enter a vehicle name.';
    if (!preset) nextErrors.pack = 'Choose a battery pack.';
    else if (preset.key === 'custom' && (!Number.isFinite(customKwh) || customKwh <= 0)) {
      nextErrors.customKwh = 'Enter a battery capacity above 0 kWh.';
    }
    if (!Number.isFinite(targetTirePressurePsi) || targetTirePressurePsi < 20 || targetTirePressurePsi > 80) {
      nextErrors.targetTirePressure = 'Enter a target tire pressure between 20 and 80 psi.';
    }
    setErrors(nextErrors);
    const firstError = Object.values(nextErrors)[0];
    if (!preset || firstError) throw new Error(firstError ?? 'Choose a battery pack.');

    const kwh = preset.key === 'custom' || preset.kwh == null ? customKwh : preset.kwh;
    const config = preset.key === 'custom' ? `Custom (${kwh} kWh)` : preset.label;
    // Sequential, so a failed name save never hides which request went wrong. Re-saving
    // the battery fields on retry is harmless because the endpoint sets absolute values.
    try {
      await updateVehicleSettings.mutateAsync({ vehicleId: vehicle.id, kwh, config, targetTirePressurePsi });
    } catch (error) {
      throw saveFailure(error, 'Battery and tire pressure settings could not be saved. Try again.');
    }
    if (name !== vehicle.display_name) {
      try {
        await updateVehicleName.mutateAsync({ vehicleId: vehicle.id, name });
      } catch (error) {
        throw saveFailure(error, 'Battery and tire pressure were saved, but the name could not be saved. Try again.');
      }
    }
    commit(snapshot);
    onDone();
  }

  function discard() {
    reset();
    setErrors({});
  }

  useSettingsDraft(`vehicle-${vehicle.id}`, { isDirty, save, discard });

  // Closing with unsaved edits asks Save / Discard / Stay first.
  const close = () => requestLeave(onDone);

  const fieldErrorClass = 'text-xs text-status-danger';

  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <div className="grid gap-3">
        <div className="flex items-end gap-2">
          <label className="grid gap-1 flex-1">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Vehicle Name</span>
            <input
              value={value.name}
              onChange={(e) => edit({ name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
              aria-invalid={errors.name ? true : undefined}
              className="h-9 w-40 max-w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              placeholder="Vehicle name"
            />
            {errors.name && <span className={fieldErrorClass}>{errors.name}</span>}
          </label>
          <Button
            variant="secondary"
            className="h-9 w-9 shrink-0 px-0"
            iconLeft={<X className="h-5 w-5" />}
            onClick={close}
            title="Close editor"
            aria-label="Close vehicle editor"
          />
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Factory Battery Capacity</p>
        <div className="flex flex-wrap items-start gap-2">
          {isR1Model(vehicle.model) && (
            <label className="grid gap-1">
              <span className="text-xs text-fg-tertiary">Generation</span>
              <SelectPicker
                className="min-w-[6rem]"
                value={value.gen}
                onChange={(next) => edit({
                  gen: next as BatteryGen,
                  preset: next === 'gen2' ? 'r1_large_g2' : 'r1_large_g1',
                  customKwh: '',
                })}
                aria-label="Battery generation"
                options={[{ value: 'gen1', label: 'Gen 1' }, { value: 'gen2', label: 'Gen 2' }]}
              />
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-xs text-fg-tertiary">Pack</span>
            <SelectPicker
              className="min-w-[14rem]"
              value={value.preset}
              onChange={(next) => edit({ preset: next })}
              aria-label="Battery pack"
              options={(isR2Model(vehicle.model) ? R2_PACK_OPTIONS : RIVIAN_BATTERY_PRESETS[value.gen]).map((preset) => ({
                value: preset.key,
                label: `${preset.label}${preset.kwh != null ? ` (${preset.kwh} kWh)` : ''}`,
              }))}
            />
            {errors.pack && <span className={fieldErrorClass}>{errors.pack}</span>}
          </label>
          {value.preset === 'custom' && (
            <label className="grid gap-1">
              <span className="text-xs text-fg-tertiary">kWh</span>
              <input
                type="number"
                value={value.customKwh}
                onChange={(e) => edit({ customKwh: e.target.value })}
                placeholder="e.g. 135"
                min="1"
                max="500"
                step="1"
                aria-invalid={errors.customKwh ? true : undefined}
                className="h-9 w-28 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              />
              {errors.customKwh && <span className={fieldErrorClass}>{errors.customKwh}</span>}
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-xs text-fg-tertiary">Target Tire Pressure</span>
            <input
              type="number"
              value={value.targetTirePressure}
              onChange={(e) => edit({ targetTirePressure: e.target.value })}
              placeholder="40"
              min="20"
              max="80"
              step="1"
              aria-invalid={errors.targetTirePressure ? true : undefined}
              className="h-9 w-32 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
            />
            {errors.targetTirePressure && <span className={`${fieldErrorClass} max-w-[12rem]`}>{errors.targetTirePressure}</span>}
          </label>
        </div>
        {capacityGenerationMismatch && (
          <p role="note" className="text-xs text-warning">
            Your saved capacity ({vehicle.battery_capacity_kwh} kWh) matches a {BATTERY_GEN_LABELS[capacityGenerationMismatch.saved]} pack; your vehicle&apos;s VIN indicates {BATTERY_GEN_LABELS[capacityGenerationMismatch.detected]}.
          </p>
        )}
        <p className="text-xs text-fg-tertiary">
          This value is used as the baseline for battery health % and degradation charts.
          Defaults can be overridden if your vehicle came with a different pack. Target tire pressure is the recommended cold PSI; confirm it against the driver-door placard.
        </p>
      </div>
    </div>
  );
}
