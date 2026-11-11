/** Where the money goes: each vehicle's net cost split by category, with a panel that opens on hover or tap. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, ChartPie, GitCompareArrows, MousePointerClick } from 'lucide-react';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Card, CardContent, CardHeader } from '@riviamigo/ui/primitives';
import { formatUsd, type Ledger, type VehicleLedger } from './model';
import { Dot, RichInfo, SectionTitle, type InfoItem } from './OwnershipPrimitives';

function breakdownInfo(span: string, ownLabel: string): InfoItem[] {
  return [
    {
      key: 'bars',
      title: 'What each bar shows',
      icon: <ChartPie />,
      color: CHART_COLORS.indigo,
      body: `A vehicle's net cost ${span.toLowerCase()}, split by category. Longer bars cost more.`,
    },
    {
      key: 'order',
      title: 'Order',
      icon: <ArrowDownWideNarrow />,
      color: CHART_COLORS.sky,
      body: 'Vehicles are sorted by net cost, cheapest at the top.',
    },
    {
      key: 'gap',
      title: 'The small figure',
      icon: <GitCompareArrows />,
      color: CHART_COLORS.emerald,
      body: `How much more (+) or less (-) each vehicle cost than ${ownLabel}.`,
    },
    {
      key: 'split',
      title: 'See the split',
      icon: <MousePointerClick />,
      color: CHART_COLORS.violet,
      body: 'Hover over a bar, or tap it on a phone, for each category with its amount and share.',
    },
  ];
}

const BREAKDOWN_PARTS = [
  { key: 'depreciation', label: 'Depreciation', color: CHART_COLORS.indigo },
  { key: 'fuel', label: 'Fuel or energy', color: CHART_COLORS.amber },
  { key: 'maintenance', label: 'Maintenance', color: CHART_COLORS.sky },
  { key: 'tires', label: 'Tires', color: CHART_COLORS.violet },
  { key: 'insurance', label: 'Insurance and other', color: CHART_COLORS.teal },
] as const;

function breakdownOf(entry: VehicleLedger): Record<(typeof BREAKDOWN_PARTS)[number]['key'], number> {
  const { totals } = entry;
  return {
    depreciation: Math.max(0, totals.depreciation),
    fuel: totals.fuel,
    maintenance: totals.oil + totals.brakes + totals.service,
    tires: totals.tires,
    insurance: totals.insurance,
  };
}

function partsTotal(parts: ReturnType<typeof breakdownOf>): number {
  return BREAKDOWN_PARTS.reduce((sum, part) => sum + parts[part.key], 0);
}

export function OwnershipBreakdownCard({ ledger, colors, span }: { ledger: Ledger; colors: Record<string, string>; span: string }) {
  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn);
  const sorted = [...ledger.vehicles].sort((a, b) => a.totals.net - b.totals.net);
  const max = Math.max(1, ...sorted.map((entry) => entry.totals.net));
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!openId) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-breakdown-item]')) setOpenId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openId]);

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<ChartPie />}
          info={<RichInfo title="Reading the bars" items={breakdownInfo(span, own?.vehicle.label ?? 'your vehicle')} />}
          infoLabel="How to read the bars"
          infoWidth="w-[34rem]"
        >
          Where the money goes
        </SectionTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
          {BREAKDOWN_PARTS.map((part) => (
            <li key={part.key} className="flex items-center gap-1.5">
              <Dot color={part.color} />
              {part.label}
            </li>
          ))}
        </ul>
        <ul className="mt-4 grid gap-3">
          {sorted.map((entry) => {
            const parts = breakdownOf(entry);
            const delta = own && !entry.vehicle.isOwn ? entry.totals.net - own.totals.net : null;
            const open = openId === entry.vehicle.id;
            const panelId = `breakdown-${entry.vehicle.id}`;
            return (
              <li
                key={entry.vehicle.id}
                className="relative grid gap-1"
                data-breakdown-item
                // A mouse opens the split on hover; touch keeps tap-to-toggle below.
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setOpenId(entry.vehicle.id);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') setOpenId((current) => (current === entry.vehicle.id ? null : current));
                }}
              >
                <div className="flex items-baseline justify-between gap-3 text-base">
                  <span
                    className={`flex min-w-0 items-center gap-2 ${entry.vehicle.isOwn ? 'font-semibold text-fg' : 'text-fg-secondary'}`}
                  >
                    <Dot color={colors[entry.vehicle.id]} />
                    <span className="truncate">{entry.vehicle.label}</span>
                  </span>
                  <span className="whitespace-nowrap text-right font-mono tabular-nums text-fg">
                    {formatUsd(entry.totals.net)}
                    {delta != null ? (
                      <span className="ml-2 text-sm text-fg-secondary">
                        {delta >= 0 ? '+' : '-'}
                        {formatUsd(Math.abs(delta))}
                      </span>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={`Show where ${entry.vehicle.label}'s money goes`}
                  onClick={(event) => {
                    // A mouse already opened it on hover; a click there should not close it.
                    if ((event.nativeEvent as PointerEvent).pointerType === 'mouse') return;
                    setOpenId(open ? null : entry.vehicle.id);
                  }}
                  className="-my-2 flex min-h-7 w-full items-center rounded-full py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span
                    className={`flex h-3 w-full rounded-full bg-bg-elevated transition-shadow ${open ? 'ring-2 ring-border-strong' : ''}`}
                  >
                    {/* The filled run is its own rounded pill, so its right end is rounded too. */}
                    <span
                      className="flex h-full overflow-hidden rounded-full"
                      style={{ width: `${(partsTotal(parts) / max) * 100}%` }}
                    >
                      {BREAKDOWN_PARTS.map((part) => (
                        <span
                          key={part.key}
                          style={{
                            width: `${partsTotal(parts) > 0 ? (parts[part.key] / partsTotal(parts)) * 100 : 0}%`,
                            backgroundColor: part.color,
                          }}
                        />
                      ))}
                    </span>
                  </span>
                </button>
                {open ? <BreakdownPanel id={panelId} entry={entry} color={colors[entry.vehicle.id]} /> : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The split behind one bar: each category's amount and share, with its legend color. */
function BreakdownPanel({ id, entry, color }: { id: string; entry: VehicleLedger; color: string | undefined }) {
  const parts = breakdownOf(entry);
  const total = BREAKDOWN_PARTS.reduce((sum, part) => sum + parts[part.key], 0);
  const ref = useRef<HTMLDivElement | null>(null);
  const [above, setAbove] = useState(false);

  // Open below the bar, or above it when the window has no room below,
  // measured before paint so it never draws off screen first.
  useLayoutEffect(() => {
    const place = () => {
      const panel = ref.current;
      const anchor = panel?.parentElement;
      if (!panel || !anchor) return;
      const box = anchor.getBoundingClientRect();
      const height = panel.offsetHeight;
      const spaceBelow = window.innerHeight - box.bottom;
      const spaceAbove = box.top;
      setAbove(height > spaceBelow - 8 && spaceAbove > spaceBelow);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      role="region"
      aria-label={`${entry.vehicle.label} cost split`}
      // Padding, not margin, separates it from the bar, so a mouse can move onto it without closing it.
      className={`absolute left-0 right-0 z-20 sm:left-auto sm:w-80 ${above ? 'bottom-full pb-1' : 'top-full pt-1'}`}
    >
      <div className="rounded-lg border border-border bg-bg-surface p-3 shadow-lg">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <span className="flex min-w-0 items-center gap-2 text-base font-semibold text-fg">
          <Dot color={color} />
          <span className="truncate">{entry.vehicle.label}</span>
        </span>
        <span className="font-mono text-base font-semibold tabular-nums text-fg">{formatUsd(entry.totals.net)}</span>
      </div>
      <ul className="mt-2 grid gap-2">
        {BREAKDOWN_PARTS.map((part) => {
          const share = total > 0 ? parts[part.key] / total : 0;
          return (
            <li key={part.key} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <Dot color={part.color} />
                  {part.label}
                </span>
                <span className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-fg">{formatUsd(parts[part.key])}</span>
                  <span className="w-10 text-right text-fg-secondary">{Math.round(share * 100)}%</span>
                </span>
              </div>
              <span className="block h-1 overflow-hidden rounded-full bg-bg-elevated" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: part.color }} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-xs text-fg-secondary">
        Shares of the net cost. Maintenance covers oil, brakes, and scheduled service items.
      </p>
      </div>
    </div>
  );
}
