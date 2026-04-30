import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useVehicleStatus, useLiveStatusStore } from '@riviamigo/hooks';

// ---------------------------------------------------------------------------
// Manual WebSocket mock — controls open/message/close from the test
// ---------------------------------------------------------------------------

class MockWS {
  static instances: MockWS[] = [];

  url: string;
  protocols: string[];
  readyState: number = 0; // CONNECTING

  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols)
      ? protocols
      : protocols
      ? [protocols]
      : [];
    MockWS.instances.push(this);
  }

  // Called by hook cleanup — should silence handlers
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '', wasClean: true } as CloseEvent);
  }

  // ---- test helpers ----

  _open() {
    this.readyState = 1; // OPEN
    this.onopen?.({} as Event);
  }

  _message(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  _close(code = 1006) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason: '', wasClean: code === 1000 } as CloseEvent);
  }

  _error() {
    this.onerror?.({} as Event);
    this._close(1006);
  }
}

function wsAt(index: number) {
  const ws = MockWS.instances[index];
  if (!ws) throw new Error(`Missing MockWS instance ${index}`);
  return ws;
}

function latestWs() {
  return wsAt(MockWS.instances.length - 1);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useVehicleStatus', () => {
  beforeEach(() => {
    MockWS.instances = [];
    vi.stubGlobal('WebSocket', MockWS);
    useLiveStatusStore.setState({ status: {}, connected: {} });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ---- connection setup ----

  it('does not connect when vehicleId is null', () => {
    renderHook(() => useVehicleStatus(null, 'tok'));
    expect(MockWS.instances).toHaveLength(0);
  });

  it('does not connect when accessToken is null', () => {
    renderHook(() => useVehicleStatus('vid-1', null));
    expect(MockWS.instances).toHaveLength(0);
  });

  it('returns idle state when not connected', () => {
    const { result } = renderHook(() => useVehicleStatus(null, null));
    expect(result.current.connectionState).toBe('idle');
    expect(result.current.connected).toBe(false);
    expect(result.current.status).toBeNull();
  });

  it('opens WS with correct URL and JWT subprotocol', () => {
    renderHook(() => useVehicleStatus('vid-abc', 'my-jwt'));
    expect(MockWS.instances).toHaveLength(1);
    const ws = wsAt(0);
    expect(ws.url).toContain('/v1/vehicles/live?vehicle_id=vid-abc');
    expect(ws.protocols).toContain('bearer');
    expect(ws.protocols).toContain('bearer.my-jwt');
  });

  it('sets connectionState to "online" and connected=true on open', () => {
    const { result } = renderHook(() => useVehicleStatus('vid-1', 'tok'));
    act(() => wsAt(0)._open());
    expect(result.current.connectionState).toBe('online');
    expect(result.current.connected).toBe(true);
  });

  // ---- message handling ----

  it('updates store status on message', () => {
    renderHook(() => useVehicleStatus('vid-1', 'tok'));
    act(() => {
      wsAt(0)._open();
      wsAt(0)._message(
        JSON.stringify({ type: 'status', ts: '2026-01-01T00:00:00Z', data: { battery_level: 80 } })
      );
    });
    const status = useLiveStatusStore.getState().status['vid-1'];
    expect(status).toMatchObject({
      vehicle_id: 'vid-1',
      is_online: true,
      last_updated: '2026-01-01T00:00:00Z',
      battery_level: 80,
    });
  });

  it('silently ignores non-JSON messages', () => {
    const { result } = renderHook(() => useVehicleStatus('vid-1', 'tok'));
    act(() => {
      wsAt(0)._open();
      wsAt(0)._message('not-json');
    });
    expect(result.current.status).toBeNull();
  });

  // ---- reconnect & backoff ----

  it('reconnects after close with initial 1 s delay', async () => {
    renderHook(() => useVehicleStatus('vid-1', 'tok'));
    act(() => wsAt(0)._open());

    act(() => wsAt(0)._close());
    expect(MockWS.instances).toHaveLength(1); // no immediate reconnect

    await act(async () => { vi.advanceTimersByTime(999); });
    expect(MockWS.instances).toHaveLength(1); // still waiting

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(MockWS.instances).toHaveLength(2); // reconnected
  });

  it('doubles the backoff on each failed attempt', async () => {
    renderHook(() => useVehicleStatus('vid-1', 'tok'));
    act(() => wsAt(0)._open());

    // Attempt 1 → fires after 1000 ms, next delay will be 2000 ms
    act(() => wsAt(0)._close());
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(MockWS.instances).toHaveLength(2);

    // Attempt 2 → fires after 2000 ms
    act(() => wsAt(1)._close());
    await act(async () => { vi.advanceTimersByTime(1999); });
    expect(MockWS.instances).toHaveLength(2); // still waiting

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(MockWS.instances).toHaveLength(3);
  });

  it('grows backoff up to the 5th attempt (32 s)', async () => {
    // Sequence: 1s → 2s → 4s → 8s → 16s; 5th timer fires at 32s
    renderHook(() => useVehicleStatus('vid-1', 'tok'));
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < 5; i++) {
      act(() => wsAt(i)._close());
      // Advance to just before the next reconnect fires to confirm it hasn't happened yet
      await act(async () => { vi.advanceTimersByTime(delays[i]! - 1); });
      expect(MockWS.instances).toHaveLength(i + 1);
      // Now fire it
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(MockWS.instances).toHaveLength(i + 2);
    }
  });

  it('sets connectionState to "failed" after MAX_RECONNECT_ATTEMPTS (5) but keeps retrying', async () => {
    const { result } = renderHook(() => useVehicleStatus('vid-1', 'tok'));
    // 5 reconnects exhaust the limit; 6th close sets "failed"
    for (let i = 0; i <= 5; i++) {
      act(() => wsAt(i)._close());
      if (i < 5) {
        await act(async () => { vi.advanceTimersByTime(60_000); });
      }
    }
    expect(result.current.connectionState).toBe('failed');

    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(MockWS.instances).toHaveLength(7);
  });

  it('resets reconnect counter and backoff on successful open', async () => {
    const { result } = renderHook(() => useVehicleStatus('vid-1', 'tok'));

    // Burn 3 attempts
    for (let i = 0; i < 3; i++) {
      act(() => wsAt(i)._close());
      await act(async () => { vi.advanceTimersByTime(60_000); });
    }

    // Fourth WS opens cleanly → resets counter
    act(() => wsAt(3)._open());
    expect(result.current.connectionState).toBe('online');

    // Close again — should restart from attempt 1, not hit "failed" immediately
    act(() => wsAt(3)._close());
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(result.current.connectionState).toBe('connecting');
    expect(MockWS.instances).toHaveLength(5);
  });

  it('resets reconnect counter when the access token changes after failure', async () => {
    const { result, rerender } = renderHook(
      ({ token }) => useVehicleStatus('vid-1', token),
      { initialProps: { token: 'expired-token' } },
    );

    for (let i = 0; i <= 5; i++) {
      act(() => wsAt(i)._close());
      if (i < 5) {
        await act(async () => { vi.advanceTimersByTime(60_000); });
      }
    }
    expect(result.current.connectionState).toBe('failed');

    rerender({ token: 'fresh-token' });
    expect(latestWs().protocols).toContain('bearer.fresh-token');

    act(() => latestWs()._close());
    await act(async () => { vi.advanceTimersByTime(1000); });

    expect(result.current.connectionState).toBe('connecting');
    expect(latestWs().protocols).toContain('bearer.fresh-token');
  });

  // ---- cleanup ----

  it('closes the socket and stops reconnecting on unmount', () => {
    const { unmount } = renderHook(() => useVehicleStatus('vid-1', 'tok'));
    const ws = wsAt(0);
    act(() => ws._open());

    unmount();

    // After unmount, handlers are nulled — even if the server fires onclose, no reconnect
    act(() => {
      // Simulate a server-side close arriving after we've already unmounted
      if (ws.onclose) ws.onclose({ code: 1001 } as CloseEvent);
    });
    vi.runAllTimers();
    expect(MockWS.instances).toHaveLength(1);
  });

  it('cancels a pending reconnect timer on unmount', async () => {
    const { unmount } = renderHook(() => useVehicleStatus('vid-1', 'tok'));
    act(() => wsAt(0)._close());
    // Reconnect is scheduled but not fired yet
    unmount();
    await act(async () => { vi.runAllTimers(); });
    expect(MockWS.instances).toHaveLength(1); // no reconnect happened
  });
});

