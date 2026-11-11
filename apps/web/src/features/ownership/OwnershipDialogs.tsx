import React, { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { api, useOwnershipVehicleLookupMenu } from '@riviamigo/hooks';
import type { OwnershipCustomVehicle, OwnershipPowertrain } from '@riviamigo/types';
import { Button, Input, ResponsiveDialog, SelectPicker, Switch } from '@riviamigo/ui/primitives';

const CLOSE_BUTTON_CLASS =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const HEADER_CLASS =
  'flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:p-5';
const FOOTER_CLASS =
  'flex flex-col-reverse gap-2 border-t border-border bg-bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:p-5';

export function ExternalConnectionsLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      to="/settings"
      search={{ section: 'external' }}
      className="font-medium text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Add a vehicle
// ---------------------------------------------------------------------------

const POWERTRAIN_OPTIONS: Array<{ value: OwnershipPowertrain; label: string }> = [
  { value: 'gas', label: 'Gas' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'ev', label: 'Electric' },
];

interface AddVehicleDialogProps {
  lookupEnabled: boolean;
  saving: boolean;
  saveFailed: boolean;
  onAdd: (vehicle: OwnershipCustomVehicle) => void;
  onClose: () => void;
}

interface VehicleDraft {
  label: string;
  powertrain: OwnershipPowertrain;
  price: string;
  mpg: string;
  kwhPerMi: string;
  premiumFuel: boolean;
}

type DraftErrors = Partial<Record<'label' | 'price' | 'mpg' | 'kwhPerMi', string>>;

function draftToVehicle(draft: VehicleDraft): { vehicle: OwnershipCustomVehicle | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const label = draft.label.trim();
  if (!label || label.length > 80) errors.label = 'Enter a name of 1 to 80 characters.';
  const number = (raw: string) => Number(raw.trim().replace(/[$,\s]/g, ''));
  const price = number(draft.price);
  if (!draft.price.trim() || !Number.isFinite(price) || price <= 0 || price > 10_000_000) {
    errors.price = 'Enter the price you would pay.';
  }
  const isEv = draft.powertrain === 'ev';
  const mpg = number(draft.mpg);
  const kwhPerMi = number(draft.kwhPerMi);
  if (isEv && (!draft.kwhPerMi.trim() || !Number.isFinite(kwhPerMi) || kwhPerMi < 0.05 || kwhPerMi > 3)) {
    errors.kwhPerMi = 'Enter a value between 0.05 and 3.';
  }
  if (!isEv && (!draft.mpg.trim() || !Number.isFinite(mpg) || mpg < 1 || mpg > 250)) {
    errors.mpg = 'Enter a value between 1 and 250.';
  }
  if (Object.keys(errors).length) return { vehicle: null, errors };
  return {
    errors,
    vehicle: {
      id: `custom_${Date.now().toString(36)}`,
      label,
      powertrain: draft.powertrain,
      price_usd: price,
      mpg: isEv ? null : mpg,
      kwh_per_mi: isEv ? kwhPerMi : null,
      premium_fuel: !isEv && draft.premiumFuel,
    },
  };
}

function isConnectionDisabled(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'EXTERNAL_CONNECTION_DISABLED';
}

export function AddVehicleDialog({ lookupEnabled, saving, saveFailed, onAdd, onClose }: AddVehicleDialogProps) {
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'failed' | 'disabled'>('idle');
  const [fuelNote, setFuelNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<VehicleDraft>({
    label: '',
    powertrain: 'gas',
    price: '',
    mpg: '',
    kwhPerMi: '',
    premiumFuel: false,
  });
  const [errors, setErrors] = useState<DraftErrors>({});

  const years = useOwnershipVehicleLookupMenu('years', {}, lookupEnabled);
  const makes = useOwnershipVehicleLookupMenu('makes', { year }, lookupEnabled && !!year);
  const models = useOwnershipVehicleLookupMenu('models', { year, make }, lookupEnabled && !!make);
  const trims = useOwnershipVehicleLookupMenu('options', { year, make, model }, lookupEnabled && !!model);
  const lookupQueries = [years, makes, models, trims];
  // The page's copy of the connection state can be a few minutes old, so a
  // refusal from the server counts as turned off as well.
  const lookupOff = !lookupEnabled
    || lookupState === 'disabled'
    || lookupQueries.some((query) => isConnectionDisabled(query.error));
  const lookupFailed = lookupQueries.some((query) => query.isError) || lookupState === 'failed';

  const chooseTrim = async (epaId: string) => {
    setTrim(epaId);
    setLookupState('loading');
    try {
      const found = await api.lookupOwnershipVehicle(epaId);
      setDraft((current) => ({
        ...current,
        label: found.label,
        powertrain: found.powertrain,
        mpg: found.mpg != null ? String(Math.round(found.mpg * 10) / 10) : '',
        kwhPerMi: found.kwh_per_mi != null ? String(Math.round(found.kwh_per_mi * 1000) / 1000) : '',
        premiumFuel: found.premium_fuel,
      }));
      setFuelNote(found.fuel_description || null);
      setLookupState('idle');
    } catch (error) {
      setLookupState(isConnectionDisabled(error) ? 'disabled' : 'failed');
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = draftToVehicle(draft);
    setErrors(result.errors);
    if (result.vehicle) onAdd(result.vehicle);
  };

  const options = (items: Array<{ text: string; value: string }> | undefined) =>
    (items ?? []).map((item) => ({ value: item.value, label: item.text }));
  const isEv = draft.powertrain === 'ev';

  return (
    <ResponsiveDialog titleId="ownership-add-vehicle-title" onClose={onClose} className="sm:max-w-xl">
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} noValidate>
        <header className={HEADER_CLASS}>
          <div>
            <h2 id="ownership-add-vehicle-title" className="text-base font-semibold text-fg">Add a vehicle</h2>
            <p className="mt-1 text-sm text-fg-tertiary">
              Compare against any car. It is driven your miles at the prices you paid.
            </p>
          </div>
          <button type="button" aria-label="Close add a vehicle" className={CLOSE_BUTTON_CLASS} onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4 sm:px-5">
          {!lookupOff ? (
            <section className="grid gap-3" aria-label="Look up a vehicle">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Look it up</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectPicker
                  aria-label="Model year"
                  placeholder={years.isLoading ? 'Loading years...' : 'Year'}
                  value={year}
                  options={options(years.data)}
                  disabled={!years.data?.length}
                  onChange={(value) => { setYear(value); setMake(''); setModel(''); setTrim(''); }}
                />
                <SelectPicker
                  aria-label="Make"
                  placeholder={makes.isLoading ? 'Loading makes...' : 'Make'}
                  value={make}
                  options={options(makes.data)}
                  disabled={!year || !makes.data?.length}
                  onChange={(value) => { setMake(value); setModel(''); setTrim(''); }}
                />
                <SelectPicker
                  aria-label="Model"
                  placeholder={models.isLoading ? 'Loading models...' : 'Model'}
                  value={model}
                  options={options(models.data)}
                  disabled={!make || !models.data?.length}
                  onChange={(value) => { setModel(value); setTrim(''); }}
                />
                <SelectPicker
                  aria-label="Trim"
                  placeholder={trims.isLoading ? 'Loading trims...' : 'Trim'}
                  value={trim}
                  options={options(trims.data)}
                  disabled={!model || !trims.data?.length}
                  onChange={(value) => { void chooseTrim(value); }}
                />
              </div>
              <p className="text-xs text-fg-tertiary" role="status">
                {lookupFailed
                  ? 'The lookup did not respond. Enter the details below instead.'
                  : lookupState === 'loading'
                    ? 'Loading fuel economy...'
                    : fuelNote
                      ? `Fuel economy from fueleconomy.gov. Fuel: ${fuelNote}.`
                      : 'Fuel economy comes from fueleconomy.gov. It does not list prices, so enter the price yourself.'}
              </p>
            </section>
          ) : (
            <p className="rounded-lg border border-border bg-bg-elevated/50 p-3 text-sm text-fg-secondary">
              Vehicle lookup is turned off, so enter the details yourself. Turn it on in{' '}
              <ExternalConnectionsLink>Settings, under External Connections</ExternalConnectionsLink>.
            </p>
          )}

          <section className="grid gap-4" aria-label="Vehicle details">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Details</p>
            <Input
              id="ownership-add-label"
              label="Name"
              placeholder="e.g. 2025 Honda Pilot"
              value={draft.label}
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              {...(errors.label ? { error: errors.label } : {})}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg-secondary">Powertrain</span>
                <SelectPicker
                  aria-label="Powertrain"
                  value={draft.powertrain}
                  options={POWERTRAIN_OPTIONS}
                  onChange={(powertrain) => setDraft({ ...draft, powertrain })}
                />
              </div>
              <Input
                id="ownership-add-price"
                label="Price ($)"
                inputMode="decimal"
                placeholder="e.g. 48000"
                value={draft.price}
                onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                {...(errors.price ? { error: errors.price } : {})}
              />
              {isEv ? (
                <Input
                  id="ownership-add-kwh"
                  label="Energy use (kWh per mile)"
                  inputMode="decimal"
                  placeholder="e.g. 0.30"
                  value={draft.kwhPerMi}
                  onChange={(event) => setDraft({ ...draft, kwhPerMi: event.target.value })}
                  {...(errors.kwhPerMi ? { error: errors.kwhPerMi } : {})}
                />
              ) : (
                <Input
                  id="ownership-add-mpg"
                  label="Fuel economy (mpg)"
                  inputMode="decimal"
                  placeholder="e.g. 22"
                  value={draft.mpg}
                  onChange={(event) => setDraft({ ...draft, mpg: event.target.value })}
                  {...(errors.mpg ? { error: errors.mpg } : {})}
                />
              )}
              {isEv ? null : (
                <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-fg-secondary">
                  <span>Needs premium fuel</span>
                  <Switch
                    size="sm"
                    checked={draft.premiumFuel}
                    onChange={(premiumFuel) => setDraft({ ...draft, premiumFuel })}
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-fg-tertiary">
              Maintenance, insurance, and resale use typical figures for the powertrain.
            </p>
            {saveFailed ? (
              <p className="text-sm text-status-danger" role="alert">The vehicle could not be added. Try again.</p>
            ) : null}
          </section>
        </div>
        <footer className={FOOTER_CLASS}>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" size="md" loading={saving}>Add vehicle</Button>
        </footer>
      </form>
    </ResponsiveDialog>
  );
}
