import type { Meta, StoryObj } from '@storybook/react';
import { EfficiencyTrendChart } from './EfficiencyTrendChart';

const meta = {
  title: 'Charts/EfficiencyTrendChart',
  component: EfficiencyTrendChart,
  parameters: { layout: 'padded' },
  args: { height: 240 },
} satisfies Meta<typeof EfficiencyTrendChart>;

export default meta;
type Story = StoryObj<typeof meta>;

function makeData(days = 60) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date('2024-01-01');
    d.setDate(d.getDate() + i);
    const base = 320 + Math.sin(i / 10) * 40;
    const dayAvg = base + (Math.random() - 0.5) * 60;
    return {
      day: d.toISOString().slice(0, 10),
      day_avg_wh_mi: +dayAvg.toFixed(1),
      rolling_7d_wh_mi: i < 6 ? null : +(base + (Math.random() - 0.5) * 20).toFixed(1),
    };
  });
}

export const Default: Story = {
  args: { data: makeData(60) },
};

export const WithBrush: Story = {
  args: { data: makeData(90), showBrush: true },
};

export const Short: Story = {
  args: { data: makeData(7) },
};

export const Loading: Story = {
  args: { data: [], loading: true },
};
