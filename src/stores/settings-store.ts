import { create } from 'zustand';
import { UserSettings } from '@/types/chat';

interface SettingsState {
  settings: UserSettings;
  isLoading: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (data: Partial<UserSettings>) => Promise<void>;
}

const defaultSettings: UserSettings = {
  id: 'default',
  userId: 'user_vee',
  theme: 'dark',
  fontSize: 'normal',
  compactMode: false,
  sendOnEnter: true,
  autoTitle: true,
  showTimestamps: true,
  streamResponses: true,
  codeLineNumbers: true,
  systemPrompt: '',
  defaultProviderId: 'xkiro',
  defaultModelId: 'qwen/qwen3.7-plus:free',
  updatedAt: new Date().toISOString(),
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  isLoading: false,

  loadSettings: async () => {
    try {
      set({ isLoading: true });
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          set({ settings: data.settings });
          // Apply theme to DOM
          if (typeof document !== 'undefined') {
            const root = document.documentElement;
            if (data.settings.theme === 'light') {
              root.classList.remove('dark');
            } else {
              root.classList.add('dark');
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  updateSettings: async (data: Partial<UserSettings>) => {
    const current = get().settings;
    const next = { ...current, ...data };
    set({ settings: next });

    // Apply theme immediately
    if (data.theme && typeof document !== 'undefined') {
      const root = document.documentElement;
      if (data.theme === 'light') {
        root.classList.remove('dark');
      } else {
        root.classList.add('dark');
      }
    }

    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },
}));
