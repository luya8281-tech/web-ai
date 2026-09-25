import { create } from 'zustand';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  avatar?: string | null;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: {
    id: 'user_vee',
    name: 'Vee',
    email: 'vee@vps.local',
    role: 'admin',
    avatar: null,
  },
  isLoading: false,

  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data?.user) {
          set({ user: data.user, isLoading: false });
          return;
        }
      }
    } catch (e) {
      console.error('[AuthStore] Failed to check auth', e);
    }
    set({
      user: {
        id: 'user_vee',
        name: 'Vee',
        email: 'vee@vps.local',
        role: 'admin',
        avatar: null,
      },
      isLoading: false,
    });
  },

  logout: async () => {
    // Single-user mode: no session logout needed
  },
}));
