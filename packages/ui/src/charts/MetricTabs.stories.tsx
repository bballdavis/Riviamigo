import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { MetricTabs, type MetricTab } from '../primitives/MetricTabs';
import { Battery, TrendingDown, Moon, Activity } from 'lucide-react';

const meta = {
  title: 'Primitives/MetricTabs',
  component: MetricTabs,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MetricTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const TABS = [
  { key: 'soc',     label: 'State of Charge', icon: <Battery className="w-3.5 h-3.5" /> },
  { key: 'range',   label: 'Range',            icon: <Activity className="w-3.5 h-3.5" /> },
  { key: 'phantom', label: 'Phantom Drain',    icon: <Moon className="w-3.5 h-3.5" /> },
  { key: 'degrad',  label: 'Degradation',      icon: <TrendingDown className="w-3.5 h-3.5" /> },
];

function InteractiveWrapper({ tabs = TABS }: { tabs?: MetricTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  return (
    <MetricTabs tabs={tabs} active={active} onChange={setActive} title="Battery" subtitle="30-day history">
      <div className="h-48 flex items-center justify-center text-fg-tertiary text-sm">
        Content for: <strong className="ml-1 text-fg">{active}</strong>
      </div>
    </MetricTabs>
  );
}

export const Default: Story = {
  render: () => <InteractiveWrapper />,
  args: { tabs: TABS, active: 'soc', onChange: () => {}, children: null },
};

export const DropdownMode: Story = {
  render: () => {
    const manyTabs = Array.from({ length: 7 }, (_, i) => ({ key: `t${i}`, label: `Metric ${i + 1}` }));
    return <InteractiveWrapper tabs={manyTabs} />;
  },
  args: { tabs: [], active: 't0', onChange: () => {}, children: null },
};
