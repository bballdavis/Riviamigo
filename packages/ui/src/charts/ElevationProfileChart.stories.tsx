import type { Meta, StoryObj } from '@storybook/react';
import { ElevationProfileChart } from './ElevationProfileChart';

const meta = {
  title: 'Charts/ElevationProfileChart',
  component: ElevationProfileChart,
  parameters: { layout: 'padded' },
  args: { height: 180 },
} satisfies Meta<typeof ElevationProfileChart>;

export default meta;
type Story = StoryObj<typeof meta>;

function makeTrack(points = 120) {
  let elev = 300;
  return Array.from({ length: points }, (_, i) => {
    elev = elev + Math.sin(i / 10) * 8 + (Math.random() - 0.5) * 5;
    const d = new Date('2024-03-10T09:00:00Z');
    d.setSeconds(d.getSeconds() + i * 30);
    return { ts: d.toISOString(), value: +elev.toFixed(1) };
  });
}

export const Default: Story = {
  args: { data: makeTrack() },
};

export const Metric: Story = {
  args: { data: makeTrack(), unit: 'm' },
};

export const Hilly: Story = {
  args: {
    data: Array.from({ length: 200 }, (_, i) => {
      const elev = 250 + Math.sin(i / 8) * 120 + i * 0.5;
      const d = new Date('2024-03-10T09:00:00Z');
      d.setSeconds(d.getSeconds() + i * 20);
      return { ts: d.toISOString(), value: +elev.toFixed(1) };
    }),
  },
};

export const Loading: Story = {
  args: { data: [], loading: true },
};
