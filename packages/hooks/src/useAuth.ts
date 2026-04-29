import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api';

interface AuthState {
  accessToken: string | null;
  userId: string | null;
  defaultVehicleId: string | null;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  setTokens: (accessToken: string, defaultVehicleId: string | null) => void;
  setDefaultVehicleId: (vehicleId: string) => void;
  clearSession: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      userId: null,
      defaultVehicleId: null,
      isAuthenticated: false,

      setTokens: (accessToken, defaultVehicleId) => {
        api.setToken(accessToken);
        set({ accessToken, defaultVehicleId, isAuthenticated: true });
      },

      setDefaultVehicleId: (vehicleId) => {
        set({ defaultVehicleId: vehicleId });
      },

      clearSession: () => {
        api.setToken(null);
        set({ accessToken: null, userId: null, defaultVehicleId: null, isAuthenticated: false });
      },

      login: async (email, password) => {
        const tokens = await api.login(email, password);
        api.setToken(tokens.access_token);
        set({
          accessToken: tokens.access_token,
          defaultVehicleId: tokens.default_vehicle_id ?? null,
          isAuthenticated: true,
        });
      },

      register: async (email, password) => {
        const tokens = await api.register(email, password);
        api.setToken(tokens.access_token);
        set({
          accessToken: tokens.access_token,
          defaultVehicleId: tokens.default_vehicle_id ?? null,
          isAuthenticated: true,
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
          });
          return true;
        } catch {
          get().logout();
          return false;
        }
      },
    }),
    {
      name: 'rm-auth',
      partialize: (s) => ({
        accessToken: s.accessToken,
        defaultVehicleId: s.defaultVehicleId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) {
          api.setToken(state.accessToken);
          state.isAuthenticated = true;
        }
      },
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
    });
    return;
  }

  useAuth.setState({
    accessToken: tokens.access_token,
    defaultVehicleId: tokens.default_vehicle_id ?? null,
    isAuthenticated: true,
  });
});
