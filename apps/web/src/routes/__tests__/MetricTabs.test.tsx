import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricTabs } from '@riviamigo/ui/primitives';

const TABS = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta' },
  { key: 'c', label: 'Gamma' },
];

describe('MetricTabs', () => {
  it('renders all tab labels', () => {
    render(
      <MetricTabs tabs={TABS} active="a" onChange={() => {}}>
        <div>content</div>
      </MetricTabs>
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('calls onChange when a tab is clicked', () => {
    const onChange = vi.fn();
    render(
      <MetricTabs tabs={TABS} active="a" onChange={onChange}>
        <div>content</div>
      </MetricTabs>
    );
    fireEvent.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('marks the active tab with accent styling', () => {
    render(
      <MetricTabs tabs={TABS} active="b" onChange={() => {}}>
        <div>content</div>
      </MetricTabs>
    );
    const betaBtn = screen.getByText('Beta').closest('button');
    expect(betaBtn).toHaveClass('bg-accent');
  });

  it('renders a dropdown when tabs exceed dropdownThreshold', () => {
    const manyTabs = Array.from({ length: 7 }, (_, i) => ({ key: `t${i}`, label: `Tab ${i}` }));
    render(
      <MetricTabs tabs={manyTabs} active="t0" onChange={() => {}} dropdownThreshold={5}>
        <div>content</div>
      </MetricTabs>
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders pill tabs when below threshold', () => {
    render(
      <MetricTabs tabs={TABS} active="a" onChange={() => {}} dropdownThreshold={5}>
        <div>content</div>
      </MetricTabs>
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(3);
  });

  it('renders the title and subtitle when provided', () => {
    render(
      <MetricTabs tabs={TABS} active="a" onChange={() => {}} title="My Chart" subtitle="sub">
        <div />
      </MetricTabs>
    );
    expect(screen.getByText('My Chart')).toBeInTheDocument();
    expect(screen.getByText('sub')).toBeInTheDocument();
  });

  it('renders children content', () => {
    render(
      <MetricTabs tabs={TABS} active="a" onChange={() => {}}>
        <div data-testid="inner">inner content</div>
      </MetricTabs>
    );
    expect(screen.getByTestId('inner')).toBeInTheDocument();
  });

  it('fires onChange with correct key when dropdown changes', () => {
    const manyTabs = Array.from({ length: 7 }, (_, i) => ({ key: `t${i}`, label: `Tab ${i}` }));
    const onChange = vi.fn();
    render(
      <MetricTabs tabs={manyTabs} active="t0" onChange={onChange} dropdownThreshold={5}>
        <div />
      </MetricTabs>
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't3' } });
    expect(onChange).toHaveBeenCalledWith('t3');
  });
});
