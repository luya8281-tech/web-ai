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
  user: null,
  isLoading: true,

  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        set({ user: data?.user || null, isLoading: false });
        return;
      }
    } catch (e) {
      console.error('[AuthStore] Failed to check auth', e);
    }
    set({ user: null, isLoading: false });
  },

  logout: async () => {
    window.location.href = '/api/auth/logout';
  },
}));
