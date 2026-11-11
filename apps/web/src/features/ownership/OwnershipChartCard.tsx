/** The cost-over-time card: the chart, the month slider, the inspected-month readout, and the value toggle. */
import { CalendarClock, ChartLine, Fuel, MousePointerClick, Scale, Wrench } from 'lucide-react';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Card, CardContent, CardHeader } from '@riviamigo/ui/primitives';
import { formatMonth, OwnershipChart, type ValueMode } from './OwnershipChart';
import { CursorReadout } from './OwnershipCursorReadout';
import { MonthSlider } from './OwnershipMonthSlider';
import { RichInfo, SectionTitle, Segmented, type InfoItem } from './OwnershipPrimitives';
import type { Ledger } from './model';

const CHART_INFO: InfoItem[] = [
  {
    key: 'running',
    title: 'Running costs',
    icon: <Fuel />,
    color: CHART_COLORS.amber,
    body: 'Fuel and charging accrue with the miles you drove each month, along with insurance.',
  },
  {
    key: 'one-time',
    title: 'One-time costs',
    icon: <Wrench />,
    color: CHART_COLORS.sky,
    body: "Each vehicle's maintenance schedule (oil, filters, fluids, brakes, tires) lands as vertical jumps when items fall due.",
  },
  {
    key: 'shaded',
    title: 'Shaded months',
    icon: <CalendarClock />,
    color: CHART_COLORS.violet,
    body: 'Estimated months before tracking began and Projected months after today use your average miles a month.',
  },
  {
    key: 'inspect',
    title: 'Inspect a month',
    icon: <MousePointerClick />,
    color: CHART_COLORS.emerald,
    body: 'Hover or tap the chart, or drag the slider. The panel lists each total, what it added that month, and the gap to your vehicle.',
  },
  {
    key: 'mode',
    title: 'Money spent or net',
    icon: <Scale />,
    color: CHART_COLORS.rose,
    body: 'Money spent starts at the purchase price and adds every cost as it lands. Net of resale subtracts what each vehicle would sell for at that point.',
  },
];


export function OwnershipChartCard({
  ledger,
  mode,
  onModeChange,
  colors,
  cursorIndex,
  todayIndex,
  onCursorChange,
}: {
  ledger: Ledger;
  mode: ValueMode;
  onModeChange: (mode: ValueMode) => void;
  colors: Record<string, string>;
  cursorIndex: number;
  todayIndex: number;
  onCursorChange: (index: number | null) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle
              icon={<ChartLine />}
              info={<RichInfo title="Reading the chart" items={CHART_INFO} />}
              infoLabel="How to read the chart"
              infoWidth="w-[36rem]"
            >
              {mode === 'net' ? 'Net cost over time' : 'Money spent over time'}
            </SectionTitle>
          </div>
          <Segmented
            label="Chart value"
            value={mode}
            options={[
              { value: 'net', label: 'Net of resale' },
              { value: 'spent', label: 'Money spent' },
            ]}
            onChange={onModeChange}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
          {/* On wide screens the chart grows to the readout's height instead of leaving a gap. */}
          <div className="flex min-w-0 flex-col">
            <div className="h-[20rem] sm:h-[24rem] xl:h-auto xl:min-h-[24rem] xl:flex-1">
              <OwnershipChart
                ledger={ledger}
                mode={mode}
                colors={colors}
                cursorIndex={cursorIndex}
                onCursorChange={onCursorChange}
                className="h-full w-full"
              />
            </div>
            <div className="mt-3 grid gap-1 text-sm text-fg-secondary">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="ownership-month-slider">Drag to inspect a month</label>
                {cursorIndex !== todayIndex ? (
                  <button
                    type="button"
                    onClick={() => onCursorChange(null)}
                    className="min-h-11 rounded-md px-2 font-medium text-fg-secondary hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-6"
                  >
                    Back to today
                  </button>
                ) : null}
              </div>
              <MonthSlider
                ledger={ledger}
                value={cursorIndex}
                onChange={onCursorChange}
                valueText={formatMonth(ledger.periods[cursorIndex]?.startMs ?? ledger.startMs, { long: true })}
              />
            </div>
          </div>
          <CursorReadout
            ledger={ledger}
            mode={mode}
            colors={colors}
            cursorIndex={cursorIndex}
            isToday={cursorIndex === todayIndex}
          />
        </div>
      </CardContent>
    </Card>

  );
}
