import type { Meta, StoryObj } from '@storybook/react';
import { EfficiencyVsTempChart } from './EfficiencyVsTempChart';

const meta = {
  title: 'Charts/EfficiencyVsTempChart',
  component: EfficiencyVsTempChart,
  parameters: { layout: 'padded' },
  args: { height: 240 },
} satisfies Meta<typeof EfficiencyVsTempChart>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleData = [
  { temp_c_low: -15, temp_c_high: -10, avg_efficiency_wh_mi: 480, trip_count: 3 },
  { temp_c_low: -10, temp_c_high: -5,  avg_efficiency_wh_mi: 440, trip_count: 7 },
  { temp_c_low: -5,  temp_c_high: 0,   avg_efficiency_wh_mi: 410, trip_count: 12 },
  { temp_c_low: 0,   temp_c_high: 5,   avg_efficiency_wh_mi: 375, trip_count: 18 },
  { temp_c_low: 5,   temp_c_high: 10,  avg_efficiency_wh_mi: 345, trip_count: 25 },
  { temp_c_low: 10,  temp_c_high: 15,  avg_efficiency_wh_mi: 320, trip_count: 34 },
  { temp_c_low: 15,  temp_c_high: 20,  avg_efficiency_wh_mi: 305, trip_count: 41 },
  { temp_c_low: 20,  temp_c_high: 25,  avg_efficiency_wh_mi: 295, trip_count: 38 },
  { temp_c_low: 25,  temp_c_high: 30,  avg_efficiency_wh_mi: 300, trip_count: 29 },
  { temp_c_low: 30,  temp_c_high: 35,  avg_efficiency_wh_mi: 315, trip_count: 15 },
];

export const Fahrenheit: Story = {
  args: { data: sampleData, unit: 'f' },
};

export const Celsius: Story = {
  args: { data: sampleData, unit: 'c' },
};

export const Loading: Story = {
  args: { data: [], loading: true },
};
