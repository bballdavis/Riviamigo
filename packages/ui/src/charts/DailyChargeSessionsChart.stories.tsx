import type { Meta, StoryObj } from '@storybook/react';
import { DailyEnergyBarChart } from './DailyChargeSessionsChart';

const meta = {
  title: 'Charts/DailyEnergyBarChart',
  component: DailyEnergyBarChart,
  parameters: { layout: 'padded' },
  args: { height: 280 },
} satisfies Meta<typeof DailyEnergyBarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

function makeDailyData(days: number) {
  const start = new Date('2024-01-01T00:00:00Z');
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const dayLocal = day.toISOString().slice(0, 10);
    return {
      day_local: dayLocal,
      day_start: `${dayLocal}T00:00:00Z`,
      total_energy_kwh: Number((8 + ((index * 17) % 61) + Math.sin(index / 4) * 5).toFixed(1)),
      session_count: 1 + (index % 3),
    };
  });
}

export const SevenDays: Story = {
  args: { daily: makeDailyData(7) },
};

export const OneHundredTwentyDays: Story = {
  args: { daily: makeDailyData(120) },
};

