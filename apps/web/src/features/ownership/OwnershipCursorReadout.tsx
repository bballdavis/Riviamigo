/** The readout beside the chart: every vehicle's total at the inspected month, and that month's detail. */
import React from 'react';
import { CarFront, Fuel } from 'lucide-react';
import { formatMonth, type ValueMode } from './OwnershipChart';
import { Dot } from './OwnershipPrimitives';
import { formatUsd, type Ledger, type VehicleLedger } from './model';

const PERIOD_KIND_LABEL = { estimated: 'Estimated', actual: 'Recorded', projected: 'Projected' } as const;

export function CursorReadout({
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
                  {/* Always one line tall, even when nothing landed that month, so inspecting
                      a month with one-time costs never changes the readout's height. */}
                  <span
                    className="mt-0.5 block min-h-4 truncate pl-[1.125rem] text-xs leading-4 text-fg-secondary"
                    title={oneTime.length ? oneTime.flatMap((item) => item.labels).join(', ') : undefined}
                  >
                    {/* Phones have no Month column, so the month's cost leads this line. */}
                    <span className="sm:hidden">+{formatUsd(month)} this month</span>
                    {oneTime.length ? (
                      <span>
                        <span className="sm:hidden">, </span>
                        {oneTime.flatMap((item) => item.labels).join(', ')}
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
