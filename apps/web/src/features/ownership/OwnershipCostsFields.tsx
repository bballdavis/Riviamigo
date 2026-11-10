import React, { useEffect, useState } from 'react';
import { useOwnershipSettings, useUpdateOwnershipSettings } from '@riviamigo/hooks';
import type { OwnershipSettings } from '@riviamigo/types';
import { Button, Input } from '@riviamigo/ui/primitives';

/** The purchase and running-cost inputs, held as text while they are edited. */
export interface OwnershipCostsForm {
  purchasePrice: string;
  purchaseDate: string;
  resaleValue: string;
  insuranceMonthly: string;
  tireSetCost: string;
  gasPrice: string;
}

export type OwnershipCostsErrors = Partial<Record<keyof OwnershipCostsForm, string>>;

const text = (value: number | null) => (value == null ? '' : String(value));

export function settingsToForm(settings: OwnershipSettings): OwnershipCostsForm {
  return {
    purchasePrice: text(settings.purchase_price_usd),
    purchaseDate: settings.purchase_date ?? '',
    resaleValue: text(settings.resale_value_usd),
    insuranceMonthly: text(settings.insurance_monthly_usd),
    tireSetCost: text(settings.tire_set_cost_usd),
    gasPrice: text(settings.gas_price_usd_per_gallon),
  };
}

function todayIso(now: Date): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Validate the form against the same limits the API enforces. A blank field
 * clears the stored value, so the dashboard falls back to its estimate.
 */
export function formToSettings(
  form: OwnershipCostsForm,
  base: OwnershipSettings,
  now: Date = new Date(),
): { settings: OwnershipSettings | null; errors: OwnershipCostsErrors } {
  const errors: OwnershipCostsErrors = {};
  const amount = (
    key: keyof OwnershipCostsForm,
    max: number,
    options: { positive?: boolean } = {},
  ): number | null => {
    const raw = form[key].trim().replace(/[$,\s]/g, '');
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || (options.positive && value === 0)) {
      errors[key] = options.positive ? 'Enter an amount above zero.' : 'Enter an amount of zero or more.';
      return null;
    }
    if (value > max) {
      errors[key] = `Enter ${max.toLocaleString('en-US')} or less.`;
      return null;
    }
    return value;
  };

  const purchaseDate = form.purchaseDate.trim() || null;
  if (purchaseDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || Number.isNaN(Date.parse(purchaseDate))) {
      errors.purchaseDate = 'Enter a valid date.';
    } else if (purchaseDate < '2000-01-01') {
      errors.purchaseDate = 'Enter a date in 2000 or later.';
    } else if (purchaseDate > todayIso(now)) {
      errors.purchaseDate = 'The purchase date cannot be in the future.';
    }
  }

  const settings: OwnershipSettings = {
    ...base,
    purchase_price_usd: amount('purchasePrice', 10_000_000),
    purchase_date: purchaseDate,
    resale_value_usd: amount('resaleValue', 10_000_000),
    insurance_monthly_usd: amount('insuranceMonthly', 100_000),
    tire_set_cost_usd: amount('tireSetCost', 100_000),
    gas_price_usd_per_gallon: amount('gasPrice', 100, { positive: true }),
  };
  return { settings: Object.keys(errors).length ? null : settings, errors };
}

interface OwnershipCostsFieldsProps {
  form: OwnershipCostsForm;
  errors: OwnershipCostsErrors;
  onChange: (form: OwnershipCostsForm) => void;
  /** Distinguishes the field ids when the form is mounted in two places. */
  idPrefix: string;
  disabled?: boolean;
}

export function OwnershipCostsFields({ form, errors, onChange, idPrefix, disabled }: OwnershipCostsFieldsProps) {
  const field = (key: keyof OwnershipCostsForm) => ({
    id: `${idPrefix}-${key}`,
    value: form[key],
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: event.target.value }),
    ...(errors[key] ? { error: errors[key] } : {}),
  });
  const money = { inputMode: 'decimal' as const, autoComplete: 'off' };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Purchase price ($)" placeholder="e.g. 84000" {...money} {...field('purchasePrice')} />
      <Input label="Purchase date" type="date" max={todayIso(new Date())} {...field('purchaseDate')} />
      <Input
        label="Resale value today ($)"
        placeholder="Estimated when blank"
        hint="Leave blank to estimate it from a typical depreciation curve."
        {...money}
        {...field('resaleValue')}
      />
      <Input
        label="Insurance and other, per month ($)"
        placeholder="Estimated when blank"
        hint="Insurance, registration, and any other fixed monthly cost."
        {...money}
        {...field('insuranceMonthly')}
      />
      <Input label="Tire set cost ($)" placeholder="Estimated when blank" {...money} {...field('tireSetCost')} />
      <Input
        label="Gas price for comparisons ($/gal)"
        placeholder="Average when blank"
        hint="Used for months without a stored fuel price."
        {...money}
        {...field('gasPrice')}
      />
    </div>
  );
}

/** Self-contained editor for the vehicle settings area. */
export function OwnershipCostsSettings({ vehicleId }: { vehicleId: string }) {
  const { data, isLoading, isError } = useOwnershipSettings(vehicleId);
  const update = useUpdateOwnershipSettings(vehicleId);
  const [form, setForm] = useState<OwnershipCostsForm | null>(null);
  const [errors, setErrors] = useState<OwnershipCostsErrors>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(settingsToForm(data.settings));
  }, [data]);

  if (isError) {
    return <p className="text-xs text-status-danger">Ownership costs could not be loaded.</p>;
  }
  if (isLoading || !data || !form) {
    return <p className="text-xs text-fg-tertiary">Loading ownership costs...</p>;
  }

  const save = () => {
    const result = formToSettings(form, data.settings);
    setErrors(result.errors);
    setSaved(false);
    if (!result.settings) return;
    update.mutate(result.settings, { onSuccess: () => setSaved(true) });
  };

  return (
    <div className="grid gap-3 border-t border-border/70 pt-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Ownership costs</p>
        <p className="mt-1 text-xs text-fg-tertiary">
          Used by the Ownership dashboard. The same fields open from Edit costs on that page.
        </p>
      </div>
      <OwnershipCostsFields
        form={form}
        errors={errors}
        idPrefix={`settings-ownership-${vehicleId}`}
        disabled={!data.can_edit}
        onChange={(next) => {
          setForm(next);
          setSaved(false);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" loading={update.isPending} disabled={!data.can_edit} onClick={save}>
          Save ownership costs
        </Button>
        <span className="text-xs text-fg-tertiary" role="status">
          {update.isError ? 'Ownership costs could not be saved.' : saved ? 'Saved.' : ''}
        </span>
      </div>
    </div>
  );
}
