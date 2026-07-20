import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasswordRequirements } from '../PasswordRequirements';

describe('PasswordRequirements', () => {
  it('shows neutral, incomplete, and complete password states', () => {
    const { rerender } = render(<PasswordRequirements password="" />);
    expect(screen.getByRole('status')).toHaveTextContent('At least 12 characters');
    expect(screen.getByRole('status')).toHaveTextContent('0/12');

    rerender(<PasswordRequirements password="short" />);
    expect(screen.getByRole('status')).toHaveTextContent('5/12');
    expect(screen.getByRole('status')).toHaveClass('text-status-danger');

    rerender(<PasswordRequirements password="twelve-chars" />);
    expect(screen.getByRole('status')).toHaveTextContent('12/12');
    expect(screen.getByRole('status')).toHaveClass('text-status-positive');
  });
});
