import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RawTelemetryExplorer } from '../RawTelemetryExplorer';

const api = vi.hoisted(() => ({
  getRawTelemetry: vi.fn(),
  getRawEvents: vi.fn(),
  getRawEvent: vi.fn(),
  getRivianStewardship: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({ api }));
vi.mock('@riviamigo/ui/primitives', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled, iconLeft: _iconLeft, loading: _loading, variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { iconLeft?: React.ReactNode; loading?: boolean; variant?: string; size?: string }) => <button {...props} type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SelectPicker: ({ value, options, onChange, 'aria-label': ariaLabel }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; 'aria-label': string }) => <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));

const sample = {
  ts: '2026-07-13T12:00:00Z',
  battery_level: 78,
  distance_to_empty_mi: 245,
  power_kw: -4.5,
  charger_state: 'disconnected',
  is_online: true,
  tire_fl_psi: 48,
  tire_fr_psi: 48,
} as never;

function response(samples = [sample]) {
  return {
    vehicle_id: 'vehicle-1',
    coverage: { first_event_at: sample.ts, last_event_at: sample.ts, sample_count: 31, odometer_samples: 0, battery_samples: 31, range_samples: 31, outside_temp_samples: 0, power_samples: 31, regen_samples: 0, tire_pressure_samples: 31, lock_samples: 0, software_samples: 0 },
    total: 31,
    page: 1,
    per_page: 25,
    samples,
    field_coverage: { battery_level: 31, distance_to_empty_mi: 31, power_kw: 31, tire_fl_psi: 31 },
  };
}

function renderExplorer(role: 'owner' | 'viewer' = 'owner') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><RawTelemetryExplorer isAdmin={false} vehicles={[{ id: 'vehicle-1', display_name: 'Adventure Truck', membership_role: role } as never]} /></QueryClientProvider>);
}

describe('RawTelemetryExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getRawTelemetry.mockResolvedValue(response());
    api.getRawEvents.mockResolvedValue({ vehicle_id: 'vehicle-1', retention_days: 7, total: 1, page: 1, per_page: 25, items: [{ id: 'event-1', received_at: sample.ts, event_type: 'vehicleState', message_type: 'data', has_json: true, has_payload: true }] });
    api.getRawEvent.mockResolvedValue({ id: 'event-1', received_at: sample.ts, event_type: 'vehicleState', message_type: 'data', has_json: true, has_payload: true, payload_format: 'json', payload: { batteryLevel: 78 } });
    api.getRivianStewardship.mockResolvedValue({});
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('searches, resets pagination, and exposes the selected record as grouped normalized data', async () => {
    renderExplorer();
    await screen.findAllByText('78 %');

    fireEvent.change(screen.getByLabelText('Search fields or values'), { target: { value: 'tire' } });
    await waitFor(() => expect(api.getRawTelemetry).toHaveBeenLastCalledWith('vehicle-1', expect.objectContaining({ page: 1, search: 'tire' })));

    fireEvent.click(screen.getByText('Front-left pressure'));
    await waitFor(() => expect(api.getRawTelemetry).toHaveBeenLastCalledWith('vehicle-1', expect.objectContaining({ fields: ['tire_fl_psi'], page: 1 })));
    expect(screen.getByLabelText('Selected telemetry record')).toHaveTextContent('Battery & charging');
    expect(screen.getAllByText('Tires')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Copy record JSON' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('battery_level'));
  });

  it('loads exact event payloads only for an owner or manager', async () => {
    renderExplorer('owner');
    await screen.findByText('Inbound Rivian events');
    fireEvent.click(screen.getByText('Inspect events'));

    await screen.findByText('vehicleState');
    fireEvent.click(screen.getByText('vehicleState'));
    await screen.findByText((_, element) => element?.tagName === 'PRE' && element.textContent?.includes('batteryLevel') === true);
    expect(api.getRawEvents).toHaveBeenCalled();
    expect(api.getRawEvent).toHaveBeenCalledWith('vehicle-1', 'event-1');
  });

  it('does not request original events for viewers', async () => {
    renderExplorer('viewer');
    await screen.findByText('Inbound Rivian events');
    fireEvent.click(screen.getByText('Inspect events'));

    expect(await screen.findByText(/available to vehicle owners and managers only/i)).toBeInTheDocument();
    expect(api.getRawEvents).not.toHaveBeenCalled();
  });
});
