import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../../../packages/dashboards/src/widgets/sensor/SensorChipWidget';
import '../../../../packages/dashboards/src/widgets/table/TripStatWidget';
import { DashboardGrid } from '../../../../packages/dashboards/src/DashboardGrid';
import GridEditor from '../../../../packages/dashboards/src/GridEditor';
import { WidgetEditForm } from '../../../../packages/dashboards/src/editor/WidgetEditForm';
import type { DashboardConfig } from '@riviamigo/dashboards';

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  return {
    ...actual,
    useMetricCatalog: () => ({ data: [] }),
  };
});

vi.mock('../../../../packages/dashboards/src/WidgetHost', () => ({
  WidgetHost: ({ instance }: { instance: { id: string; definitionId: string } }) => (
    <div data-testid={`widget-host-${instance.id}`}>{instance.definitionId}</div>
  ),
}));

vi.mock('../../../../packages/dashboards/src/editor/IconPicker', () => ({
  IconPicker: () => null,
}));

const BASE_CTX = {
  vehicleId: 'vehicle-1',
  from: '2026-06-01T00:00:00Z',
  to: '2026-06-10T00:00:00Z',
};

const BASE_CONFIG: DashboardConfig = {
  schemaVersion: 2,
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'editor-test',
  name: 'Editor Test',
  isDefault: false,
  isLocked: false,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      componentType: 'sensor',
      definitionId: 'total_miles',
      title: 'Miles',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: {},
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      componentType: 'custom',
      definitionId: 'trips.stat',
      title: 'Trips',
      layout: { x: 3, y: 0, w: 3, h: 2 },
      options: {},
    },
  ],
};

function getEditorStyles() {
  return Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
}

describe('GridEditor overlays', () => {
  it('writes sensor display-filter changes back through the widget options contract', () => {
    const onChange = vi.fn();
    const widget = {
      ...BASE_CONFIG.widgets[0]!,
      options: {
        chartType: 'line',
        timeFilter: '24h',
      },
    };

    render(
      <WidgetEditForm
        widget={widget}
        onChange={onChange}
        onClose={() => undefined}
      />
    );

    const slider = screen.getByLabelText(/Display filter/);
    fireEvent.change(slider, { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ timeFilter: '15m' }),
      })
    );

  });

  it('persists all three sensor smoothing positions independently from the display filter', () => {
    const onChange = vi.fn();
    const widget = {
      ...BASE_CONFIG.widgets[0]!,
      options: {
        chartType: 'line',
        timeFilter: '24h',
        smoothness: 'gentle',
      },
    };

    render(
      <WidgetEditForm
        widget={widget}
        onChange={onChange}
        onClose={() => undefined}
      />
    );

    const smoothness = screen.getByLabelText('Curve smoothness');
    expect(smoothness).toHaveAttribute('min', '0');
    expect(smoothness).toHaveAttribute('max', '2');
    expect(smoothness).toHaveValue('1');
    fireEvent.change(smoothness, { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      options: expect.objectContaining({ smoothness: 'smooth', timeFilter: '24h' }),
    }));
    fireEvent.change(smoothness, { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      options: expect.objectContaining({ smoothness: 'straight', timeFilter: '24h' }),
    }));
  });

  it('offers the display filter for bar sprites and persists a time bin', () => {
    const onChange = vi.fn();
    const widget = {
      ...BASE_CONFIG.widgets[0]!,
      options: {
        chartType: 'bar',
        timeFilter: 'raw',
      },
    };

    render(
      <WidgetEditForm
        widget={widget}
        onChange={onChange}
        onClose={() => undefined}
      />
    );

    expect(screen.getByText(/non-raw windows sum bars within each time bin/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Display filter/), { target: { value: '4' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ timeFilter: '24h' }),
      })
    );
  });

  it('keeps edit-only overlays out of the view grid chrome', () => {
    render(<DashboardGrid widgets={BASE_CONFIG.widgets} ctx={BASE_CTX} />);

    expect(screen.getByTestId('widget-host-22222222-2222-2222-2222-222222222222')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-overlay-left-22222222-2222-2222-2222-222222222222')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit widget settings' })).toBeNull();
  });

  it('renders shared edit chrome for resizable and fixed widgets, while only resizable widgets have usable resize handles', () => {
    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
      />
    );

    const resizableLeft = screen.getByTestId('widget-overlay-left-22222222-2222-2222-2222-222222222222');
    const resizableRight = screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222');
    const fixedLeft = screen.getByTestId('widget-overlay-left-33333333-3333-3333-3333-333333333333');
    const fixedRight = screen.getByTestId('widget-overlay-right-33333333-3333-3333-3333-333333333333');

    expect(within(resizableLeft).getByRole('button', { name: 'Drag to move' })).toBeInTheDocument();
    expect(within(resizableRight).getByRole('button', { name: 'Edit widget settings' })).toBeInTheDocument();
    expect(within(fixedLeft).getByRole('button', { name: 'Drag to move' })).toBeInTheDocument();
    expect(within(fixedLeft).getByLabelText('Fixed-size widget')).toBeInTheDocument();
    expect(within(fixedRight).getByRole('button', { name: 'Edit widget settings' })).toBeInTheDocument();
    expect(resizableLeft.className).toContain('rgl-widget-control');
    expect(resizableRight.className).toContain('rgl-widget-control');
    expect(fixedLeft.className).toContain('rgl-widget-control');
    expect(fixedRight.className).toContain('rgl-widget-control');
    expect(resizableRight).toHaveAttribute('data-widget-edit-control', 'true');
    expect(resizableRight).toHaveAttribute('data-widget-resizable', 'true');
    expect(fixedRight).toHaveAttribute('data-widget-resizable', 'false');

    const resizableCard = screen.getByTestId('widget-host-22222222-2222-2222-2222-222222222222').closest('[data-fixed-size="false"]');
    const fixedCard = screen.getByTestId('widget-host-33333333-3333-3333-3333-333333333333').closest('[data-fixed-size="true"]');
    const resizableGridItem = screen.getByTestId('widget-host-22222222-2222-2222-2222-222222222222').closest('.react-grid-item');
    const fixedGridItem = screen.getByTestId('widget-host-33333333-3333-3333-3333-333333333333').closest('.react-grid-item');

    expect(resizableCard).not.toBeNull();
    expect(fixedCard).not.toBeNull();
    expect(resizableGridItem?.querySelector('.react-resizable-handle')).not.toBeNull();
    expect(fixedGridItem?.querySelector('.react-resizable-handle')).toBeNull();
    expect(fixedGridItem?.className).toContain('react-resizable-hide');
    expect(getEditorStyles()).toContain('.rgl-editor .react-grid-item.react-resizable-hide .react-resizable-handle');
  });

  it('keeps edit controls actionable in edit mode and uses interaction states only for emphasis', () => {
    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
      />
    );

    const styles = getEditorStyles();
    expect(styles).toContain('.rgl-editor .rgl-widget-control');
    expect(styles).toContain('position: absolute');
    expect(styles).toContain('top: 0.5rem');
    expect(styles).toContain('z-index: 200');
    expect(styles).toContain('.rgl-editor [data-widget-move-control="true"]');
    expect(styles).toContain('left: 0.5rem');
    expect(styles).toContain('.rgl-editor [data-widget-edit-control="true"]');
    expect(styles).toContain('right: 0.5rem');
    expect(styles).toContain('opacity: 0.72');
    expect(styles).toContain('pointer-events: auto');
    expect(styles).not.toMatch(/\.rgl-widget-control\s*\{[^}]*opacity:\s*0;/s);
    expect(styles).not.toMatch(/\.rgl-widget-control\s*\{[^}]*pointer-events:\s*none;/s);
    expect(styles).toContain('.rgl-editor .react-grid-item:hover .rgl-widget-control');
    expect(styles).toContain('.rgl-editor .react-grid-item:focus-within .rgl-widget-control');
    expect(styles).toContain('.rgl-editor .react-grid-item.resizing .rgl-widget-control');
    expect(styles).toContain('.rgl-editor .react-grid-item.react-draggable-dragging .rgl-widget-control');
    expect(styles).toContain('.rgl-editor .rgl-card[data-editing="true"] .rgl-widget-control');
    expect(styles).toContain('@media (hover: none), (pointer: coarse)');
  });

  it('keeps move and edit overlays visible while the widget editor drawer is open', () => {
    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
      />
    );

    const leftOverlay = screen.getByTestId('widget-overlay-left-22222222-2222-2222-2222-222222222222');
    const rightOverlay = screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222');

    expect(leftOverlay.className).toContain('rgl-widget-control');
    expect(rightOverlay.className).toContain('rgl-widget-control');

    fireEvent.click(within(rightOverlay).getByRole('button', { name: 'Edit widget settings' }));

    const selectedCard = screen.getByTestId('widget-host-22222222-2222-2222-2222-222222222222').closest('[data-editing="true"]');
    expect(selectedCard).not.toBeNull();
    expect(leftOverlay.className).toContain('rgl-widget-control');
    expect(rightOverlay.className).toContain('rgl-widget-control');
    expect(screen.getByRole('button', { name: 'Remove component' })).toBeInTheDocument();
  });

  it('keeps overlay actions keyboard-focusable through the focus-within visibility rule', () => {
    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
      />
    );

    const rightOverlay = screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222');
    const editButton = within(rightOverlay).getByRole('button', { name: 'Edit widget settings' });

    editButton.focus();

    expect(document.activeElement).toBe(editButton);
    expect(getEditorStyles()).toContain('.rgl-editor .react-grid-item:focus-within .rgl-widget-control');
  });

  it('confirms widget deletion from the drawer before removing the widget', () => {
    function Harness() {
      const [config, setConfig] = React.useState(BASE_CONFIG);
      return <GridEditor config={config} ctx={BASE_CTX} onConfigChange={setConfig} />;
    }

    render(<Harness />);

    fireEvent.click(
      within(screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222'))
        .getByRole('button', { name: 'Edit widget settings' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(screen.getByText('Delete this widget?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this widget?')).toBeNull();
    expect(screen.getByTestId('widget-host-22222222-2222-2222-2222-222222222222')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Widget' }));

    expect(screen.queryByTestId('widget-host-22222222-2222-2222-2222-222222222222')).toBeNull();
    expect(screen.getByText('Edit Mode')).toBeInTheDocument();
  });

  it('keeps preview-hidden widgets in the draft when editing the visible state', () => {
    const onConfigChange = vi.fn();

    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={onConfigChange}
        visibleWidgetIds={[BASE_CONFIG.widgets[0]!.id]}
      />
    );

    expect(screen.queryByTestId('widget-host-33333333-3333-3333-3333-333333333333')).toBeNull();
    fireEvent.click(
      within(screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222'))
        .getByRole('button', { name: 'Edit widget settings' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Widget' }));

    const next = onConfigChange.mock.calls.at(-1)?.[0] as DashboardConfig;
    expect(next.widgets.map((widget) => widget.id)).toEqual([
      '33333333-3333-3333-3333-333333333333',
    ]);
  });

  it('authors visibility rules and switches preview so the selected widget stays visible', () => {
    const onConfigChange = vi.fn();
    const onVisibilityStateChange = vi.fn();

    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={onConfigChange}
        visibleWidgetIds={BASE_CONFIG.widgets.map((widget) => widget.id)}
        visibilityState={{ 'vehicle-connection': 'unplugged' }}
        onVisibilityStateChange={onVisibilityStateChange}
      />
    );

    fireEvent.click(
      within(screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222'))
        .getByRole('button', { name: 'Edit widget settings' })
    );
    fireEvent.click(screen.getByLabelText('Widget visibility'));
    fireEvent.click(screen.getByText('Vehicle plugged in'));

    const next = onConfigChange.mock.calls.at(-1)?.[0] as DashboardConfig;
    expect(next.widgets[0]?.visibility).toEqual([
      { type: 'vehicle-connection', value: 'plugged' },
    ]);
    expect(onVisibilityStateChange).toHaveBeenCalledWith('vehicle-connection', 'plugged');
  });

  it('closes the widget form when a manual preview change hides its selection', () => {
    const { rerender } = render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
        visibleWidgetIds={BASE_CONFIG.widgets.map((widget) => widget.id)}
      />
    );

    fireEvent.click(
      within(screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222'))
        .getByRole('button', { name: 'Edit widget settings' })
    );
    expect(screen.getByRole('button', { name: 'Widget visibility' })).toBeInTheDocument();

    rerender(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
        visibleWidgetIds={[BASE_CONFIG.widgets[1]!.id]}
      />
    );

    expect(screen.queryByRole('button', { name: 'Widget visibility' })).toBeNull();
  });
});
