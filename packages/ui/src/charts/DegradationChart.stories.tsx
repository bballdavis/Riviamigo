import type { Meta, StoryObj } from '@storybook/react';
import { DegradationChart } from './DegradationChart';

const meta = {
  title: 'Charts/DegradationChart',
  component: DegradationChart,
  parameters: { layout: 'padded' },
  args: { height: 240 },
} satisfies Meta<typeof DegradationChart>;

export default meta;
type Story = StoryObj<typeof meta>;

function makeData(points: number, startPct = 100, endPct = 93) {
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    const pct = startPct - (startPct - endPct) * t + (Math.random() - 0.5) * 0.4;
    const rated = 135;
    const usable = (pct / 100) * rated;
    const d = new Date('2022-01-01');
    d.setMonth(d.getMonth() + i * 2);
    return {
      ts: d.toISOString(),
      usable_kwh: +usable.toFixed(2),
      rated_kwh: rated,
      capacity_pct: +pct.toFixed(2),
    };
  });
}

export const Healthy: Story = {
  args: { data: makeData(18, 100, 96) },
};

export const MildDegradation: Story = {
  args: { data: makeData(18, 99.5, 92) },
};

export const HighDegradation: Story = {
  args: { data: makeData(18, 99, 86) },
};

export const Loading: Story = {
  args: { data: [], loading: true },
};

export const Empty: Story = {
  args: { data: [] },
};
