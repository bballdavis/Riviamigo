import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useVehicleStatus, useLiveStatusStore } from '@riviamigo/hooks';
import { StatusBar } from '@riviamigo/ui/primitives';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  protocols: string[];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.(new Event('open'));
  }

  close() {
    this.onclose?.({ code: 1006, reason: 'test' } as CloseEvent);
  }

  error() {
    this.onerror?.(new Event('error'));
  }

  send() {}
}

function Probe({ vehicleId, accessToken }: { vehicleId: string | null; accessToken: string | null }) {
  const { connected, connectionState } = useVehicleStatus(vehicleId, accessToken);

  return (
    <div>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="state">{connectionState}</span>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  useLiveStatusStore.setState({ status: {}, connected: {} });
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useVehicleStatus', () => {
  it('reports online when the socket opens and fails after repeated disconnects', async () => {
    render(<Probe vehicleId="vehicle-123" accessToken="token-123" />);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.protocols).toEqual(['bearer', 'bearer.token-123']);
    expect(screen.getByTestId('state')).toHaveTextContent('connecting');

    await act(async () => {
      MockWebSocket.instances[0]?.open();
    });

    expect(screen.getByTestId('state')).toHaveTextContent('online');
    expect(screen.getByTestId('connected')).toHaveTextContent('true');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        MockWebSocket.instances[MockWebSocket.instances.length - 1]?.close();
        vi.runOnlyPendingTimers();
      });

      expect(MockWebSocket.instances).toHaveLength(attempt + 2);
    }

    await act(async () => {
      MockWebSocket.instances[MockWebSocket.instances.length - 1]?.close();
    });

    expect(screen.getByTestId('state')).toHaveTextContent('failed');
    expect(screen.getByTestId('connected')).toHaveTextContent('false');
    expect(MockWebSocket.instances).toHaveLength(6);
  });
});

describe('StatusBar', () => {
  it('renders a failed connection state', () => {
    render(<StatusBar onlineState="error" />);

    expect(screen.getByLabelText('Vehicle status: Connection failed')).toBeInTheDocument();
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('keeps the battery indicator visible in compact mode', () => {
    const { container } = render(<StatusBar onlineState="online" socPercent={68} compact />);

    expect(screen.getByLabelText('Battery status: 68%')).toBeInTheDocument();
    expect(screen.queryByText('68%')).not.toBeInTheDocument();
    const batteryIcon = container.querySelector('[data-battery-icon="tb-battery-three"]');
    expect(batteryIcon).toBeInTheDocument();
    expect(batteryIcon).toHaveClass('h-[1.44375rem]', 'w-[1.44375rem]');
  });

  it('uses the quarter battery icon for low charge', () => {
    const { container } = render(<StatusBar onlineState="online" socPercent={12} compact />);

    expect(screen.getByLabelText('Battery status: 12%')).toBeInTheDocument();
    const batteryIcon = container.querySelector('[data-battery-icon="tb-battery-one"]');
    expect(batteryIcon).toBeInTheDocument();
    expect(batteryIcon).toHaveClass('h-[1.44375rem]', 'w-[1.44375rem]');
  });
});
