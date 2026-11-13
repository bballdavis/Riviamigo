/** The "Where the numbers come from" card: driving, gas price, and vehicle-data provenance. */
import { Database } from 'lucide-react';
import type { OwnershipResponse } from '@riviamigo/types';
import { Card, CardContent, CardHeader } from '@riviamigo/ui/primitives';
import { describeHomePlan, formatCents as cents, type Ledger } from './model';
import { formatMonth } from './OwnershipChart';
import { ExternalConnectionsLink } from './OwnershipDialogs';
import { SectionTitle } from './OwnershipPrimitives';

export function SourcesCard({ data, ledger }: { data: OwnershipResponse; ledger: Ledger }) {
  const { fuel_prices: fuel, usage } = data;
  const date = (value: string) =>
    new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const miles = `${Math.round(ledger.avgMonthlyMiles).toLocaleString('en-US')} mi a month`;
  const lastMonth = fuel.months[fuel.months.length - 1];
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={<Database />}>Where the numbers come from</SectionTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-base md:grid-cols-3 md:gap-6">
          <div>
            <dt className="font-medium text-fg">Your driving and charging</dt>
            <dd className="mt-1 text-fg-secondary">
              {ledger.mileageAssumed
                ? `No drives are recorded yet, so every month assumes a typical ${miles}.`
                : ledger.mileageFromOdometer
                  ? `Your odometer shows ${Math.round(ledger.milesToDate).toLocaleString('en-US')} mi since purchase. Recorded drives place those miles by month; the rest fill the lighter months, and future months use your average of ${miles}.`
                  : `Recorded since ${usage.tracked_from ? date(usage.tracked_from) : 'tracking began'}; earlier and future months use your average of ${miles}.`}
              {ledger.startAssumed
                ? ' Add a purchase date to count the months before tracking began and to take your miles from the odometer.'
                : ''}
              {ledger.electricityRateAssumed
                ? ` No charging cost is recorded yet, so charging assumes ${cents(ledger.electricityUsdPerKwh)} per kWh.`
                : `${
                    ledger.homePlan
                      ? ` Home charging is priced by your ${ledger.homePlan.name} plan (${describeHomePlan(ledger.homePlan)}); at the times you charge it has averaged ${cents(ledger.homeUsdPerKwh)} per kWh.`
                      : ` Home charging has averaged ${cents(ledger.homeUsdPerKwh)} per kWh. Set a price on your home in Settings > Places to price it by your electricity plan.`
                  } Fast charging has averaged ${cents(ledger.fastUsdPerKwh)} per kWh, what the networks billed you, and is ${Math.round(ledger.fastShare * 100)}% of your energy. Sessions without a price, such as older ones Rivian reported without a location, use your average for their kind.`}
              {ledger.realWorldFactor !== 1 && ledger.ownKwhPerMi != null && ledger.ownRatedKwhPerMi != null
                ? ` Your vehicle has taken ${ledger.ownKwhPerMi.toFixed(2)} kWh per mile from the wall against an EPA rating of ${ledger.ownRatedKwhPerMi.toFixed(2)}, so other electric vehicles' ratings are ${ledger.realWorldFactor > 1 ? 'raised' : 'lowered'} ${Math.round(Math.abs(ledger.realWorldFactor - 1) * 100)}% to match how you drive and charge.`
                : ''}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">Gas prices</dt>
            <dd className="mt-1 text-fg-secondary">
              {fuel.connection_enabled ? (
                fuel.months.length ? (
                  <>
                    U.S. monthly averages from the Energy Information Administration
                    {fuel.last_updated_at ? `, updated ${date(fuel.last_updated_at)}` : ''}.
                    {fuel.refresh_failed ? ' The latest refresh failed, so stored prices are in use.' : ''}
                  </>
                ) : (
                  <>Prices could not be fetched, so every month uses a flat price. Set it in Settings, under Ownership.</>
                )
              ) : (
                <>
                  Fuel prices is turned off in{' '}
                  <ExternalConnectionsLink>Settings, under External Connections</ExternalConnectionsLink>.{' '}
                  {lastMonth
                    ? `Stored prices through ${formatMonth(Date.parse(lastMonth.month), { long: true })} are still used; later months use a flat price.`
                    : 'Every month uses a flat price, which you can set in Settings, under Ownership.'}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">Compared vehicles</dt>
            <dd className="mt-1 text-fg-secondary">
              Prices, fuel economy, and maintenance for the built-in vehicles are typical U.S. figures, not quotes.
              {data.vehicle_lookup_enabled ? '' : ' Vehicle lookup is turned off, so added vehicles are entered by hand.'}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
