/** The cost breakdown: a card per vehicle on small screens, a full table from `xl`, and the method tooltip. */
import { Calculator, Fuel, Receipt, ShieldCheck, TrendingDown, Wrench } from 'lucide-react';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Card, CardContent, CardHeader } from '@riviamigo/ui/primitives';
import { formatUsd, type Ledger } from './model';
import { MaintenanceTile } from './OwnershipMaintenanceTile';
import { Dot, RichInfo, SectionTitle, type InfoItem } from './OwnershipPrimitives';
import { COST_COLUMNS } from './ownershipCostColumns';

const METHOD_ITEMS: InfoItem[] = [
  {
    key: 'depreciation',
    title: 'Depreciation',
    icon: <TrendingDown />,
    color: CHART_COLORS.indigo,
    body: 'Purchase price minus resale value at the end of the period. Uses your resale value when entered, otherwise a typical yearly loss.',
  },
  {
    key: 'fuel',
    title: 'Fuel or charging',
    icon: <Fuel />,
    color: CHART_COLORS.amber,
    body: "Every vehicle drives your miles each month. Gas uses that month's U.S. pump price. Your Rivian uses its recorded charging, with home and fast charging priced apart; other EVs pay your blended rate.",
  },
  {
    key: 'maintenance',
    title: 'Maintenance',
    icon: <Wrench />,
    color: CHART_COLORS.sky,
    body: 'Each vehicle follows its own schedule from the manufacturer: items fall due by mileage or time, whichever comes first. Edit them in Settings, under Ownership. A ×2 or (2) is how many times.',
  },
  {
    key: 'insurance',
    title: 'Insurance',
    icon: <ShieldCheck />,
    color: CHART_COLORS.teal,
    body: 'Your monthly insurance, registration, and other fixed costs, counted for each month owned.',
  },
  {
    key: 'net',
    title: 'Net cost',
    icon: <Calculator />,
    // Not the accent: some themes make it the same orange as fuel.
    color: CHART_COLORS.rose,
    body: 'Depreciation plus every running cost: what owning the vehicle cost once it is sold.',
  },
];

/** How every figure in the cost breakdown is worked out, for the info tooltip. */
function CostMethodology() {
  return (
    <RichInfo
      title="How each cost is worked out"
      items={METHOD_ITEMS}
      footer="Compared vehicles use typical U.S. estimates, not quotes."
    />
  );
}

export function CostTable({ ledger, colors }: { ledger: Ledger; colors: Record<string, string> }) {
  const counted = (amount: number, count: number) => (count ? `${formatUsd(amount)} (${count})` : formatUsd(amount));
  const sorted = [...ledger.vehicles].sort((a, b) => a.totals.net - b.totals.net);
  const cell = 'whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums';
  const head = 'whitespace-nowrap px-3 py-2 text-right text-sm font-medium uppercase tracking-wide text-fg-secondary';
  return (
    <Card padding="none">
      <CardHeader className="mb-0 px-5 pt-5 pb-3">
        <SectionTitle
          icon={<Receipt />}
          info={<CostMethodology />}
          infoLabel="How the costs are worked out"
          infoWidth="w-[38rem]"
        >
          Cost breakdown
        </SectionTitle>
      </CardHeader>
      <CardContent>
        {/* Small screens: one card per vehicle with its costs as labeled chips. */}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 pb-1 xl:hidden">
          {sorted.map((entry) => (
            <li
              key={entry.vehicle.id}
              className="min-w-0 rounded-xl border-2 bg-bg-elevated/30 p-3"
              style={{ borderColor: colors[entry.vehicle.id] }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate text-base ${entry.vehicle.isOwn ? 'font-semibold text-fg' : 'font-medium text-fg'}`}>
                    {entry.vehicle.label}
                  </p>
                  <p className="text-sm text-fg-secondary">Price {formatUsd(entry.vehicle.priceUsd)}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-base font-semibold tabular-nums text-fg">{formatUsd(entry.totals.net)}</p>
                  <p className="text-xs uppercase tracking-wide text-fg-secondary">Net cost</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Depreciation', value: entry.totals.depreciation },
                  { label: entry.vehicle.powertrain === 'ev' ? 'Charging' : 'Fuel', value: entry.totals.fuel },
                  { label: 'Insurance', value: entry.totals.insurance },
                ].map((tile) => (
                  <div key={tile.label} className="min-w-0 rounded-lg bg-bg-elevated/70 px-2 py-2">
                    <dt className="truncate text-xs font-medium tracking-tight text-fg-secondary">{tile.label}</dt>
                    <dd className="mt-0.5 truncate font-mono text-base tabular-nums text-fg">{formatUsd(tile.value)}</dd>
                  </div>
                ))}
              </dl>
              <MaintenanceTile entry={entry} />
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[60rem] text-base">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={`${head} text-left`}>Vehicle</th>
                <th scope="col" className={head}>Price</th>
                {COST_COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className={head}>{column.label}</th>
                ))}
                <th scope="col" className={head}>Net cost</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr key={entry.vehicle.id} className="border-b border-border/60 last:border-b-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium text-fg">
                    <span className="flex items-center gap-2">
                      <Dot color={colors[entry.vehicle.id]} />
                      {entry.vehicle.label}
                    </span>
                  </th>
                  <td className={`${cell} text-fg-secondary`}>{formatUsd(entry.vehicle.priceUsd)}</td>
                  {COST_COLUMNS.map((column) => (
                    <td key={column.key} className={`${cell} text-fg-secondary`}>
                      {counted(column.value(entry), column.count?.(entry) ?? 0)}
                    </td>
                  ))}
                  <td className={`${cell} font-semibold text-fg`}>{formatUsd(entry.totals.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="h-4" aria-hidden />
      </CardContent>
    </Card>
  );
}
