import React from 'react';
import type { OwnershipSettings } from '@riviamigo/types';
import { Input } from '@riviamigo/ui/primitives';
import { DEFAULT_PROJECTION_YEARS, MAX_PROJECTION_YEARS } from './model';

/** The purchase and running-cost inputs, held as text while they are edited. */
export interface OwnershipCostsForm {
  purchasePrice: string;
  purchaseDate: string;
  purchaseOdometer: string;
  resaleValue: string;
  insuranceMonthly: string;
  tireSetCost: string;
  gasPrice: string;
  projectionYears: string;
}

export type OwnershipCostsErrors = Partial<Record<keyof OwnershipCostsForm, string>>;

const text = (value: number | null) => (value == null ? '' : String(value));

export function settingsToForm(settings: OwnershipSettings): OwnershipCostsForm {
  return {
    purchasePrice: text(settings.purchase_price_usd),
    purchaseDate: settings.purchase_date ?? '',
    purchaseOdometer: text(settings.purchase_odometer_mi ?? null),
    resaleValue: text(settings.resale_value_usd),
    insuranceMonthly: text(settings.insurance_monthly_usd),
    tireSetCost: text(settings.tire_set_cost_usd),
    gasPrice: text(settings.gas_price_usd_per_gallon),
    projectionYears: text(settings.projection_years),
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
  options: { requirePrice?: boolean } = {},
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

  let projectionYears: number | null = null;
  const rawYears = form.projectionYears.trim();
  if (rawYears) {
    const years = Number(rawYears);
    if (!Number.isInteger(years) || years < 1 || years > MAX_PROJECTION_YEARS) {
      errors.projectionYears = `Enter whole years from 1 to ${MAX_PROJECTION_YEARS}.`;
    } else {
      projectionYears = years;
    }
  }

  const settings: OwnershipSettings = {
    ...base,
    purchase_price_usd: amount('purchasePrice', 10_000_000),
    purchase_date: purchaseDate,
    purchase_odometer_mi: amount('purchaseOdometer', 2_000_000),
    resale_value_usd: amount('resaleValue', 10_000_000),
    insurance_monthly_usd: amount('insuranceMonthly', 100_000),
    tire_set_cost_usd: amount('tireSetCost', 100_000),
    gas_price_usd_per_gallon: amount('gasPrice', 100, { positive: true }),
    projection_years: projectionYears,
  };
  // The dashboard has nothing to start from without a purchase price, so it
  // is required whenever anything else is entered. Clearing every field is allowed.
  const anyEntered = Object.values(form).some((value) => value.trim() !== '');
  if (
    settings.purchase_price_usd == null &&
    !errors.purchasePrice &&
    (options.requirePrice || anyEntered)
  ) {
    errors.purchasePrice = 'Enter what you paid.';
  }
  return { settings: Object.keys(errors).length ? null : settings, errors };
}

interface OwnershipCostsFieldsProps {
  form: OwnershipCostsForm;
  errors: OwnershipCostsErrors;
  onChange: (form: OwnershipCostsForm) => void;
  /** Distinguishes the field ids when the form is mounted more than once. */
  idPrefix: string;
  /** Which fields to show, in this order; all of them when omitted. */
  fields?: Array<keyof OwnershipCostsForm>;
  disabled?: boolean;
}

const ALL_FIELDS: Array<keyof OwnershipCostsForm> = [
  'purchasePrice',
  'purchaseDate',
  'purchaseOdometer',
  'resaleValue',
  'insuranceMonthly',
  'tireSetCost',
  'gasPrice',
  'projectionYears',
];

export function OwnershipCostsFields({
  form,
  errors,
  onChange,
  idPrefix,
  fields = ALL_FIELDS,
  disabled,
}: OwnershipCostsFieldsProps) {
  const field = (key: keyof OwnershipCostsForm) => ({
    id: `${idPrefix}-${key}`,
    value: form[key],
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: event.target.value }),
    ...(errors[key] ? { error: errors[key] } : {}),
  });
  const money = { inputMode: 'decimal' as const, autoComplete: 'off' };
  const inputs: Record<keyof OwnershipCostsForm, React.ReactNode> = {
    purchasePrice: (
      <Input label="Purchase price ($)" placeholder="e.g. 84000" required {...money} {...field('purchasePrice')} />
    ),
    purchaseDate: <Input label="Purchase date" type="date" max={todayIso(new Date())} {...field('purchaseDate')} />,
    purchaseOdometer: (
      <Input
        label="Odometer at purchase (mi)"
        placeholder="0 when blank"
        hint="Leave blank for a vehicle bought new. Your miles are the odometer today minus this."
        inputMode="decimal"
        autoComplete="off"
        {...field('purchaseOdometer')}
      />
    ),
    resaleValue: (
      <Input
        label="Resale value today ($)"
        placeholder="Estimated when blank"
        hint="Leave blank to estimate it from a typical depreciation curve."
        {...money}
        {...field('resaleValue')}
      />
    ),
    insuranceMonthly: (
      <Input
        label="Insurance and other, per month ($)"
        placeholder="Estimated when blank"
        hint="Insurance, registration, and any other fixed monthly cost."
        {...money}
        {...field('insuranceMonthly')}
      />
    ),
    tireSetCost: (
      <Input
        label="Tire set cost ($)"
        placeholder="Estimated when blank"
        hint="Sets the tire price in your vehicle's built-in maintenance schedule."
        {...money}
        {...field('tireSetCost')}
      />
    ),
    gasPrice: (
      <Input
        label="Gas price for comparisons ($/gal)"
        placeholder="Average when blank"
        hint="Used for months without a stored fuel price."
        {...money}
        {...field('gasPrice')}
      />
    ),
    projectionYears: (
      <Input
        label="Projected ownership (years)"
        placeholder={`${DEFAULT_PROJECTION_YEARS} when blank`}
        hint="How long the Project view runs from the purchase date."
        inputMode="numeric"
        autoComplete="off"
        {...field('projectionYears')}
      />
    ),
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((key) => (
        <React.Fragment key={key}>{inputs[key]}</React.Fragment>
      ))}
    </div>
  );
}
