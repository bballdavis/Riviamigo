import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { render, screen, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useVehicleStatus, useLiveStatusStore } from '@riviamigo/hooks';
import { StatusBar } from '@riviamigo/ui/primitives';
class MockWebSocket {
    static instances = [];
    url;
    protocols;
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    constructor(url, protocols) {
        this.url = url;
        this.protocols = protocols;
        MockWebSocket.instances.push(this);
    }
    open() {
        this.onopen?.(new Event('open'));
    }
    close() {
        this.onclose?.({ code: 1006, reason: 'test' });
    }
    error() {
        this.onerror?.(new Event('error'));
    }
    send() { }
}
function Probe({ vehicleId, accessToken }) {
    const { connected, connectionState } = useVehicleStatus(vehicleId, accessToken);
    return (_jsxs("div", { children: [_jsx("span", { "data-testid": "connected", children: String(connected) }), _jsx("span", { "data-testid": "state", children: connectionState })] }));
}
beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    useLiveStatusStore.setState({ status: {}, connected: {} });
    vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
describe('useVehicleStatus', () => {
    it('reports online when the socket opens and fails after repeated disconnects', async () => {
        render(_jsx(Probe, { vehicleId: "vehicle-123", accessToken: "token-123" }));
        expect(MockWebSocket.instances).toHaveLength(1);
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
        render(_jsx(StatusBar, { onlineState: "error" }));
        expect(screen.getByLabelText('Vehicle status: Connection failed')).toBeInTheDocument();
        expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });
});
