import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tooltip } from '../../../../packages/ui/src/primitives/Tooltip';

describe('Tooltip', () => {
  it('associates descriptions with focusable children and dismisses touch openings outside the trigger', () => {
    render(
      <Tooltip content="Helpful detail">
        <button type="button">Details</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful detail');
    expect(trigger).toHaveAttribute('aria-describedby');

    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
