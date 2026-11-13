/** The "Where the numbers come from" card: driving, gas price, and vehicle-data provenance. */
import React from 'react';
import { Database } from 'lucide-react';
import type { OwnershipResponse } from '@riviamigo/types';
import { Card, CardContent, CardHeader } from '@riviamigo/ui/primitives';
import { describeHomePlan, formatCents as cents, type Ledger } from './model';
import { formatMonth } from './OwnershipChart';
import { ExternalConnectionsLink } from './OwnershipDialogs';
import { SectionTitle } from './OwnershipPrimitives';

const mi = (value: number) => `${Math.round(value).toLocaleString('en-US')} mi`;

/** One source: what it is, the figure it gives, and a line on where that comes from. */
function Source({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/60 bg-bg-elevated/40 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums text-fg">{value}</dd>
      <dd className="text-sm text-fg-secondary">{children}</dd>
    </div>
  );
}

export function SourcesCard({
  data,
  ledger,
  onOpenSettings,
}: {
  data: OwnershipResponse;
  ledger: Ledger;
  onOpenSettings?: () => void;
}) {
  const { fuel_prices: fuel, usage } = data;
  const date = (value: string) =>
    new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const lastMonth = fuel.months[fuel.months.length - 1];
  const latestGas = [...fuel.months].reverse().find((row) => row.regular_usd != null)?.regular_usd ?? null;
  const paceMonths = ledger.recentDays != null ? Math.max(1, Math.round(ledger.recentDays / 30.44)) : null;
  const factorPercent = Math.round(Math.abs(ledger.realWorldFactor - 1) * 100);

  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={<Database />}>Where the numbers come from</SectionTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Source
            label="Odometer"
            value={
              ledger.odometerMi != null ? mi(ledger.odometerMi) : ledger.mileageAssumed ? 'No drives yet' : mi(ledger.milesToDate)
            }
          >
            {ledger.mileageAssumed
              ? `Every month assumes a typical ${mi(ledger.avgMonthlyMiles)}.`
              : ledger.mileageFromOdometer
                ? `${mi(ledger.milesToDate)} since purchase, ${mi(ledger.avgMonthlyMiles)} a month on average.`
                : `Recorded drives since ${usage.tracked_from ? date(usage.tracked_from) : 'tracking began'}.`}
            {ledger.startAssumed ? ' Add a purchase date to count from the odometer.' : ''}
          </Source>
          <Source label="Projected pace" value={`${mi(ledger.projectedMonthlyMiles)}/mo`}>
            {ledger.paceSource === 'recent' && paceMonths != null
              ? `Your last ${paceMonths} month${paceMonths === 1 ? '' : 's'} of odometer readings.`
              : ledger.paceSource === 'assumed'
                ? 'A typical mileage until drives are recorded.'
                : 'Your average so far, until three months of odometer readings build up.'}
          </Source>
          {ledger.electricityRateAssumed ? (
            <Source label="Charging" value={`${cents(ledger.electricityUsdPerKwh)}/kWh`}>
              A typical price until a charging cost is recorded.
            </Source>
          ) : (
            <>
              <Source label="Home charging" value={`${cents(ledger.homeUsdPerKwh)}/kWh`}>
                {ledger.homePlan
                  ? `${ledger.homePlan.name}: ${describeHomePlan(ledger.homePlan)}.`
                  : 'No plan on your home place; set one in Settings > Places.'}
              </Source>
              <Source label="Fast charging" value={`${cents(ledger.fastUsdPerKwh)}/kWh`}>
                What the networks billed you; {Math.round(ledger.fastShare * 100)}% of your energy.
              </Source>
            </>
          )}
          <Source label="Efficiency" value={ledger.ownKwhPerMi != null ? `${ledger.ownKwhPerMi.toFixed(2)} kWh/mi` : 'Not yet'}>
            {ledger.ownKwhPerMi != null && ledger.ownRatedKwhPerMi != null
              ? `From the wall, against an EPA ${ledger.ownRatedKwhPerMi.toFixed(2)}. ${
                  factorPercent
                    ? `Other EVs ${ledger.realWorldFactor > 1 ? 'up' : 'down'} ${factorPercent}% to match.`
                    : 'Other EVs use their ratings.'
                }`
              : 'Other EVs use their ratings until enough charging is recorded.'}
          </Source>
          <Source label="All charging" value={`${cents(ledger.electricityUsdPerKwh)}/kWh`}>
            Home and fast together; other EVs pay your rate for each month.
          </Source>
          <Source label="Gas" value={latestGas != null ? `$${latestGas.toFixed(2)}/gal` : 'Flat price'}>
            {fuel.connection_enabled ? (
              fuel.months.length ? (
                <>
                  U.S. monthly average (EIA){fuel.last_updated_at ? `, updated ${date(fuel.last_updated_at)}` : ''}.
                  {fuel.refresh_failed ? ' Latest refresh failed.' : ''}
                </>
              ) : (
                <>Prices could not be fetched; every month uses your flat price.</>
              )
            ) : (
              <>
                Turned off in <ExternalConnectionsLink>External Connections</ExternalConnectionsLink>.{' '}
                {lastMonth
                  ? `Stored through ${formatMonth(Date.parse(lastMonth.month), { long: true })}.`
                  : 'Every month uses your flat price.'}
              </>
            )}
          </Source>
          <Source label="Compared vehicles" value="Typical U.S.">
            Price, fuel economy and maintenance are estimates, not quotes.
            {data.vehicle_lookup_enabled ? '' : ' Lookup is off; add vehicles by hand.'}
          </Source>
        </dl>
        {ledger.impliedPurchaseOdometerMi != null ? (
          <p className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-fg">
            Your charging before tracking began covers fewer miles than the odometer moved. If it read about{' '}
            {mi(ledger.impliedPurchaseOdometerMi)} when you bought it, enter that as the odometer at purchase in{' '}
            {onOpenSettings ? (
              <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={onOpenSettings}>
                Ownership settings
              </button>
            ) : (
              'Ownership settings'
            )}
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
