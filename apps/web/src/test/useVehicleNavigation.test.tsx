import React from 'react';
import { act, render as renderBase, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLiveNavigationStore, useLiveStatusStore, useVehicleNavigation, useVehicleStatus } from '@riviamigo/hooks';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public url: string, public protocols: string[]) {
    MockWebSocket.instances.push(this);
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  close(code = 1006) {
    this.onclose?.({ code, reason: 'test' } as CloseEvent);
  }

  send() {}
}

const ROUTE = {
  id: '4',
  polylines: ['_p~iF~ps|U_ulLnnqC'],
  polyline_precision: 5,
  stops: [
    { kind: 'charging', name: '12 Donner Pass Rd [RAN]', latitude: 39.33, longitude: -120.18, arrival_at: '2026-11-19T15:40:00Z' },
    { kind: 'place', name: 'Trailhead', latitude: 40.7, longitude: -120.95, arrival_at: '2026-11-19T16:12:00Z' },
  ],
};

function Probe({ vehicleId }: { vehicleId: string }) {
  useVehicleStatus(vehicleId, 'token');
  const navigation = useVehicleNavigation(vehicleId);
  return (
    <div>
      <span data-testid="route">{navigation ? navigation.route.id : 'none'}</span>
      <span data-testid="stops">{navigation ? navigation.route.stops.map((stop) => `${stop.kind}:${stop.name}`).join('|') : ''}</span>
      <span data-testid="eta">{navigation?.destination_eta ?? 'none'}</span>
    </div>
  );
}

function renderProbe(vehicleId = 'vehicle-1') {
  const view = renderBase(<QueryClientProvider client={new QueryClient()}><Probe vehicleId={vehicleId} /></QueryClientProvider>);
  const socket = MockWebSocket.instances.at(-1)!;
  act(() => socket.onopen?.(new Event('open')));
  return Object.assign(socket, { unmount: view.unmount });
}

function navigationFrame(navigation: unknown) {
  return { type: 'navigation', ts: '2026-11-19T15:49:00Z', navigation };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  useLiveStatusStore.setState({ status: {}, connected: {} });
  useLiveNavigationStore.setState({ navigation: {} });
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live navigation frames', () => {
  it('keeps the route and its arrival time from a navigation frame', () => {
    const socket = renderProbe();
    expect(screen.getByTestId('route')).toHaveTextContent('none');

    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: '2026-11-19T16:12:00Z' })));
    expect(screen.getByTestId('route')).toHaveTextContent('4');
    expect(screen.getByTestId('stops')).toHaveTextContent('charging:12 Donner Pass Rd [RAN]|place:Trailhead');
    expect(screen.getByTestId('eta')).toHaveTextContent('2026-11-19T16:12:00Z');
  });

  it('is not vehicle status: it leaves the status store alone', () => {
    const socket = renderProbe();
    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: null })));
    // A status patch would have marked the vehicle online and dated it now.
    expect(useLiveStatusStore.getState().status['vehicle-1']).toBeUndefined();

    act(() => socket.receive({ type: 'status', ts: '2026-11-19T15:50:00Z', data: { battery_level: 64 } }));
    expect(useLiveStatusStore.getState().status['vehicle-1']).toMatchObject({ battery_level: 64 });
    expect(useLiveStatusStore.getState().status['vehicle-1']).not.toHaveProperty('navigation');
    expect(screen.getByTestId('route')).toHaveTextContent('4');
  });

  it('keeps the route it already has when a frame only moves the arrival time', () => {
    const socket = renderProbe();
    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: '2026-11-19T16:12:00Z' })));
    const first = useLiveNavigationStore.getState().navigation['vehicle-1']!.route;

    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', destination_eta: '2026-11-19T16:15:00Z' })));
    expect(screen.getByTestId('eta')).toHaveTextContent('2026-11-19T16:15:00Z');
    // The same object, so the map does not decode and redraw the line again.
    expect(useLiveNavigationStore.getState().navigation['vehicle-1']!.route).toBe(first);
  });

  it('clears the route when navigation ends', () => {
    const socket = renderProbe();
    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: null })));
    act(() => socket.receive(navigationFrame({ active: false })));
    expect(screen.getByTestId('route')).toHaveTextContent('none');
  });

  it('shows no route rather than a wrong one when a frame cannot be used', () => {
    const socket = renderProbe();
    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: null })));

    // An arrival time for a route this client was never sent.
    act(() => socket.receive(navigationFrame({ active: true, route_id: '5', destination_eta: null })));
    expect(screen.getByTestId('route')).toHaveTextContent('none');

    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: null })));
    // A stop with no position.
    const broken = { ...ROUTE, id: '6', stops: [{ kind: 'place', name: 'Nowhere' }] };
    act(() => socket.receive(navigationFrame({ active: true, route_id: '6', route: broken, destination_eta: null })));
    expect(screen.getByTestId('route')).toHaveTextContent('none');

    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: null })));
    act(() => socket.receive(navigationFrame('garbage')));
    expect(screen.getByTestId('route')).toHaveTextContent('none');
  });

  it('forgets the route when access to the vehicle is removed', () => {
    const socket = renderProbe();
    act(() => socket.receive(navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: null })));
    act(() => socket.close(4403));
    expect(useLiveNavigationStore.getState().navigation['vehicle-1']).toBeUndefined();
  });
});

describe('live navigation while the socket is down', () => {
  const live = navigationFrame({ active: true, route_id: '4', route: ROUTE, destination_eta: null });

  it('removes the route once the connection has been gone for a minute', () => {
    vi.useFakeTimers();
    const socket = renderProbe();
    act(() => socket.receive(live));

    act(() => socket.close());
    // A brief drop keeps the route on the map.
    act(() => vi.advanceTimersByTime(59_000));
    expect(screen.getByTestId('route')).toHaveTextContent('4');
    // Past the grace period nothing confirms the vehicle is still navigating.
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByTestId('route')).toHaveTextContent('none');
  });

  it('keeps the route when the socket reconnects and the server confirms it', () => {
    vi.useFakeTimers();
    const socket = renderProbe();
    act(() => socket.receive(live));
    act(() => socket.close());

    // The hook reconnects; every new socket is told the current state at once.
    act(() => vi.advanceTimersByTime(1_500));
    const reconnected = MockWebSocket.instances.at(-1)!;
    expect(reconnected).not.toBe(socket);
    act(() => reconnected.onopen?.(new Event('open')));
    act(() => reconnected.receive(live));

    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByTestId('route')).toHaveTextContent('4');
  });

  it('does not let repeated failed reconnects postpone the removal', () => {
    vi.useFakeTimers();
    const socket = renderProbe();
    act(() => socket.receive(live));
    act(() => socket.close());
    // Each retry opens a socket that fails again before any frame arrives.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      act(() => vi.advanceTimersByTime(14_000));
      act(() => MockWebSocket.instances.at(-1)!.close());
    }
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByTestId('route')).toHaveTextContent('none');
  });

  it('removes the route after the page stops listening', () => {
    vi.useFakeTimers();
    const socket = renderProbe();
    act(() => socket.receive(live));
    socket.unmount();
    expect(useLiveNavigationStore.getState().navigation['vehicle-1']).toBeDefined();
    act(() => vi.advanceTimersByTime(61_000));
    expect(useLiveNavigationStore.getState().navigation['vehicle-1']).toBeUndefined();
  });
});
