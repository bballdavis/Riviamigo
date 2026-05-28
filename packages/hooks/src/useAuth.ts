import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api';

interface AuthState {
  // Access token is kept in-memory only — never written to localStorage.
  // This prevents XSS from exfiltrating long-lived credentials.
  accessToken: string | null;
  userId: string | null;
  defaultVehicleId: string | null;
  isAuthenticated: boolean;
  // True while an initial refresh is in flight on page load.
  isBootstrapping: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  setTokens: (accessToken: string, defaultVehicleId: string | null) => void;
  setDefaultVehicleId: (vehicleId: string | null) => void;
  clearSession: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      userId: null,
      defaultVehicleId: null,
      isAuthenticated: false,
      isBootstrapping: true,

      setTokens: (accessToken, defaultVehicleId) => {
        api.setToken(accessToken);
        set({ accessToken, defaultVehicleId, isAuthenticated: true, isBootstrapping: false });
      },

      setDefaultVehicleId: (vehicleId) => {
        set({ defaultVehicleId: vehicleId });
      },

      clearSession: () => {
        api.setToken(null);
        set({
          accessToken: null,
          userId: null,
          defaultVehicleId: null,
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
        api.setToken(tokens.access_token);
        set({
          accessToken: tokens.access_token,
          defaultVehicleId: tokens.default_vehicle_id ?? null,
          isAuthenticated: true,
          isBootstrapping: false,
        });
      },

      register: async (email, password) => {
        const tokens = await api.register(email, password);
        api.setToken(tokens.access_token);
        set({
          accessToken: tokens.access_token,
          defaultVehicleId: tokens.default_vehicle_id ?? null,
          isAuthenticated: true,
          isBootstrapping: false,
        });
      },

      logout: async () => {
        try { await api.logout(); } catch {}
        get().clearSession();
      },

      refresh: async () => {
        try {
          const tokens = await api.refresh();
          api.setToken(tokens.access_token);
          set({
            accessToken: tokens.access_token,
            defaultVehicleId: tokens.default_vehicle_id ?? null,
            isAuthenticated: true,
            isBootstrapping: false,
          });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'rm-auth',
      // Only persist non-sensitive preferences. accessToken stays in memory.
      partialize: (s) => ({
        defaultVehicleId: s.defaultVehicleId,
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
      isAuthenticated: false,
      isBootstrapping: false,
    });
    return;
  }

  useAuth.setState({
    accessToken: tokens.access_token,
    defaultVehicleId: tokens.default_vehicle_id ?? null,
    isAuthenticated: true,
    isBootstrapping: false,
  });
});
