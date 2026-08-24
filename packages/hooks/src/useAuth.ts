import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api';

function userIdFromToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    const payload = JSON.parse(atob(padded)) as { sub?: string };
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

interface AuthState {
  // Access token is kept in-memory only — never written to localStorage.
  // This prevents XSS from exfiltrating long-lived credentials.
  accessToken: string | null;
  userId: string | null;
  defaultVehicleId: string | null;
  activeVehicleId: string | null;
  isAuthenticated: boolean;
  // True while an initial bootstrap session resume is in flight on page load.
  isBootstrapping: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, setupToken?: string) => Promise<void>;
  acceptAccountInvitation: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resumeSession: () => Promise<boolean>;
  setTokens: (accessToken: string, defaultVehicleId: string | null) => void;
  setDefaultVehicleId: (vehicleId: string | null) => void;
  setActiveVehicleId: (vehicleId: string | null) => void;
  clearSession: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      userId: null,
      defaultVehicleId: null,
      activeVehicleId: null,
      isAuthenticated: false,
      isBootstrapping: true,

      setTokens: (accessToken, defaultVehicleId) => {
        const userId = userIdFromToken(accessToken);
        api.setToken(accessToken);
        set({
          accessToken,
          userId,
          defaultVehicleId,
          activeVehicleId: null,
          isAuthenticated: true,
          isBootstrapping: false,
        });
      },

      setDefaultVehicleId: (vehicleId) => {
        set({ defaultVehicleId: vehicleId });
      },
      setActiveVehicleId: (vehicleId) => {
        set({ activeVehicleId: vehicleId });
      },

      clearSession: () => {
        api.setToken(null);
        set({
          accessToken: null,
          userId: null,
          defaultVehicleId: null,
          activeVehicleId: null,
          isAuthenticated: false,
          isBootstrapping: false,
        });
        // Notify any listeners (e.g. queryClient) that the session has ended.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('riviamigo:session-cleared'));
        }
      },

      login: async (email, password) => {
        const tokens = await api.login(email, password);
        const userId = userIdFromToken(tokens.access_token);
        api.setToken(tokens.access_token);
        set({
          accessToken: tokens.access_token,
          userId,
          defaultVehicleId: tokens.default_vehicle_id ?? null,
          activeVehicleId: null,
          isAuthenticated: true,
          isBootstrapping: false,
        });
      },

      register: async (email, password, setupToken) => {
        const tokens = await api.register(email, password, setupToken);
        const userId = userIdFromToken(tokens.access_token);
        api.setToken(tokens.access_token);
        set({
          accessToken: tokens.access_token,
          userId,
          defaultVehicleId: tokens.default_vehicle_id ?? null,
          activeVehicleId: null,
          isAuthenticated: true,
          isBootstrapping: false,
        });
      },

      acceptAccountInvitation: async (token, password) => {
        const tokens = await api.acceptAccountInvitation(token, password);
        const userId = userIdFromToken(tokens.access_token);
        api.setToken(tokens.access_token);
        set({
          accessToken: tokens.access_token,
          userId,
          defaultVehicleId: tokens.default_vehicle_id ?? null,
          activeVehicleId: null,
          isAuthenticated: true,
          isBootstrapping: false,
        });
      },

      logout: async () => {
        get().clearSession();
        try { await api.logout(); } catch { /* session state is already cleared */ }
      },

      resumeSession: async () => {
        try {
          const tokens = await api.resumeSession();
          if (!tokens) {
            set({ isBootstrapping: false });
            return false;
          }
          const userId = userIdFromToken(tokens.access_token);
          api.setToken(tokens.access_token);
          set({
            accessToken: tokens.access_token,
            userId,
            defaultVehicleId: tokens.default_vehicle_id ?? null,
            // Bootstrap resumes the existing browser session. Keep the user's
            // active session vehicle choice across a page refresh; the resolved
            // selection hook still validates it against the vehicles returned
            // for the authenticated user.
            activeVehicleId: get().activeVehicleId,
            isAuthenticated: true,
            isBootstrapping: false,
          });
          return true;
        } catch {
          // A failed bootstrap must finish the loading state so AuthGuard can
          // report the real session outcome rather than leaving a hard refresh
          // in a brittle half-authenticated state.
          set({ isBootstrapping: false });
          return false;
        }
      },
    }),
    {
      name: 'rm-auth',
      // Only persist non-sensitive preferences. accessToken stays in memory.
      partialize: (s) => ({
        defaultVehicleId: s.defaultVehicleId,
        activeVehicleId: s.activeVehicleId,
        userId: s.userId,
      }),
    }
  )
);

api.onAuthChange((tokens) => {
  if (!tokens) {
    useAuth.setState({
      accessToken: null,
      userId: null,
      defaultVehicleId: null,
      activeVehicleId: null,
      isAuthenticated: false,
      isBootstrapping: false,
    });
    return;
  }

  useAuth.setState({
    accessToken: tokens.access_token,
    userId: userIdFromToken(tokens.access_token),
    defaultVehicleId: tokens.default_vehicle_id ?? null,
    // Token refresh is still the same authenticated session, so do not
    // replace the user's current vehicle with the account default.
    activeVehicleId: useAuth.getState().activeVehicleId,
    isAuthenticated: true,
    isBootstrapping: false,
  });
});
