import type { Meta, StoryObj } from '@storybook/react';
import { SocAreaChart } from './SocAreaChart';

const meta = {
  title: 'Charts/SocAreaChart',
  component: SocAreaChart,
  parameters: { layout: 'padded' },
  args: { height: 240 },
} satisfies Meta<typeof SocAreaChart>;

export default meta;
type Story = StoryObj<typeof meta>;

function makeData(hours = 72, startSoc = 85) {
  let soc = startSoc;
  return Array.from({ length: hours * 4 }, (_, i) => {
    soc = Math.max(10, Math.min(100, soc + (Math.random() - 0.52) * 3));
    const d = new Date('2024-01-15T08:00:00Z');
    d.setMinutes(d.getMinutes() + i * 15);
    return { ts: d.toISOString(), soc: +soc.toFixed(1) };
  });
}

export const Healthy: Story = {
  args: { data: makeData(72, 85) },
};

export const LowSoc: Story = {
  args: { data: makeData(24, 22) },
};

export const WithBrush: Story = {
  args: { data: makeData(72, 75), showBrush: true },
};

export const WithChargeLimit: Story = {
  args: { data: makeData(72, 70), showChargeLimit: 80 },
};

export const Loading: Story = {
  args: { data: [], loading: true },
};

export const Empty: Story = {
  args: { data: [] },
};
